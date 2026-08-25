const crypto = require('crypto');
const { db, nowSql, monthBounds } = require('./db');

const secureCookie = process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
const sessionDays = Number(process.env.SESSION_DAYS || 7);
const cookieDomain = String(process.env.COOKIE_DOMAIN || '').trim() || undefined;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookie,
    maxAge,
    path: '/',
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  };
}

function createSession(userId, res) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000);
  db.prepare('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(hashToken(rawToken), userId, expires.toISOString(), nowSql());
  res.cookie('neblk_session', rawToken, cookieOptions(sessionDays * 24 * 60 * 60 * 1000));
}

function destroySession(req, res) {
  if (req.cookies?.neblk_session) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(hashToken(req.cookies.neblk_session));
  }
  res.clearCookie('neblk_session', cookieOptions(0));
}

function loadUser(req, res, next) {
  const rawToken = req.cookies?.neblk_session;
  req.user = null;
  if (rawToken) {
    const session = db.prepare(`SELECT s.token, s.expires_at,
      u.id, u.name, u.email, u.role, u.phone, u.cpf,
      u.address_zip, u.address_street, u.address_number, u.address_complement,
      u.address_district, u.address_city, u.address_state
      FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(hashToken(rawToken));
    if (session && new Date(session.expires_at).getTime() > Date.now()) {
      req.user = {
        id: session.id,
        name: session.name,
        email: session.email,
        role: session.role,
        phone: session.phone,
        cpf: session.cpf,
        address_zip: session.address_zip,
        address_street: session.address_street,
        address_number: session.address_number,
        address_complement: session.address_complement,
        address_district: session.address_district,
        address_city: session.address_city,
        address_state: session.address_state,
      };
    } else {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(hashToken(rawToken));
      res.clearCookie('neblk_session', cookieOptions(0));
    }
  }
  next();
}

function attachVisitor(req, res, next) {
  let visitorKey = req.cookies?.neblk_visitor;
  if (!visitorKey || !/^[a-f0-9]{40,80}$/i.test(visitorKey)) {
    visitorKey = crypto.randomBytes(24).toString('hex');
    res.cookie('neblk_visitor', visitorKey, cookieOptions(365 * 24 * 60 * 60 * 1000));
  }
  req.visitorKey = visitorKey;
  next();
}

function verifyCsrf(req, res, next) {
  const csrfToken = req.cookies?.neblk_csrf;
  const sent = req.body?._csrf || req.get('x-csrf-token');
  const sentBuffer = Buffer.from(String(sent || ''));
  const expectedBuffer = Buffer.from(String(csrfToken || ''));
  if (!csrfToken || !sent || sentBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sentBuffer, expectedBuffer)) {
    return res.status(403).render('error', { title: 'Ação não autorizada', message: 'A sessão do formulário expirou. Atualize a página e tente novamente.' });
  }
  next();
}

function csrfProtection(req, res, next) {
  let csrfToken = req.cookies?.neblk_csrf;
  if (!csrfToken || !/^[a-f0-9]{32,80}$/i.test(csrfToken)) {
    csrfToken = crypto.randomBytes(24).toString('hex');
    res.cookie('neblk_csrf', csrfToken, { ...cookieOptions(365 * 24 * 60 * 60 * 1000), httpOnly: false });
  }
  res.locals.csrfToken = csrfToken;
  // multipart bodies are parsed by Multer inside their specific route. They are verified after Multer runs.
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.path.startsWith('/webhooks/') && !req.is('multipart/form-data')) {
    return verifyCsrf(req, res, next);
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    req.flash('error', 'Faça login para continuar.');
    return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    req.flash('error', 'Acesso restrito à administração.');
    return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl || '/admin/dashboard')}`);
  }
  next();
}

function ensureCart(visitorKey, userId = null) {
  let cart = db.prepare('SELECT * FROM carts WHERE visitor_key = ?').get(visitorKey);
  if (!cart) {
    const result = db.prepare('INSERT INTO carts (visitor_key, user_id, updated_at) VALUES (?, ?, ?)')
      .run(visitorKey, userId, nowSql());
    cart = db.prepare('SELECT * FROM carts WHERE id = ?').get(result.lastInsertRowid);
  } else if (userId && cart.user_id !== userId) {
    db.prepare('UPDATE carts SET user_id = ?, updated_at = ? WHERE id = ?').run(userId, nowSql(), cart.id);
    cart.user_id = userId;
  }
  return cart;
}

function getCartDetails(visitorKey, userId) {
  const cart = ensureCart(visitorKey, userId);
  const items = db.prepare(`SELECT
      ci.id AS cart_item_id, ci.quantity,
      pv.id AS variant_id, pv.size, pv.color, pv.stock,
      p.id AS product_id, p.slug, p.name, p.price_cents, p.is_active,
      (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.sort_order, pi.id LIMIT 1) AS image_url
    FROM cart_items ci
    JOIN product_variants pv ON pv.id = ci.variant_id
    JOIN products p ON p.id = pv.product_id
    WHERE ci.cart_id = ?
    ORDER BY ci.id DESC`).all(cart.id);
  const subtotal = items.reduce((sum, item) => sum + item.price_cents * item.quantity, 0);
  return { cart, items, subtotal, quantity: items.reduce((sum, item) => sum + item.quantity, 0) };
}

function addToCart(visitorKey, userId, variantId, quantity) {
  const cart = ensureCart(visitorKey, userId);
  const variant = db.prepare(`SELECT pv.id, pv.stock, p.is_active FROM product_variants pv JOIN products p ON p.id = pv.product_id WHERE pv.id = ?`).get(variantId);
  if (!variant || !variant.is_active) throw new Error('Este produto não está mais disponível.');
  const qty = Math.max(1, Math.min(Number(quantity) || 1, 20));
  const existing = db.prepare('SELECT * FROM cart_items WHERE cart_id = ? AND variant_id = ?').get(cart.id, variantId);
  const requested = qty + (existing?.quantity || 0);
  if (requested > variant.stock) throw new Error('A quantidade solicitada é maior que o estoque disponível.');
  if (existing) {
    db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(requested, existing.id);
  } else {
    db.prepare('INSERT INTO cart_items (cart_id, variant_id, quantity) VALUES (?, ?, ?)').run(cart.id, variantId, qty);
  }
  db.prepare('UPDATE carts SET updated_at = ? WHERE id = ?').run(nowSql(), cart.id);
}

function updateCartItem(visitorKey, itemId, quantity) {
  const cart = ensureCart(visitorKey);
  const item = db.prepare(`SELECT ci.*, pv.stock FROM cart_items ci JOIN product_variants pv ON pv.id = ci.variant_id WHERE ci.id = ? AND ci.cart_id = ?`).get(itemId, cart.id);
  if (!item) throw new Error('Item não encontrado no carrinho.');
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1) {
    db.prepare('DELETE FROM cart_items WHERE id = ?').run(item.id);
  } else {
    if (qty > item.stock) throw new Error('A quantidade solicitada é maior que o estoque disponível.');
    db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(Math.min(qty, 20), item.id);
  }
  db.prepare('UPDATE carts SET updated_at = ? WHERE id = ?').run(nowSql(), cart.id);
}

function removeCartItem(visitorKey, itemId) {
  const cart = ensureCart(visitorKey);
  db.prepare('DELETE FROM cart_items WHERE id = ? AND cart_id = ?').run(itemId, cart.id);
}

function makeOrderNumber() {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  let value;
  do {
    value = `NB-${date}-${crypto.randomInt(1000, 10000)}`;
  } while (db.prepare('SELECT id FROM orders WHERE order_number = ?').get(value));
  return value;
}

function checkoutCart(visitorKey, user, checkout) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const cartData = getCartDetails(visitorKey, user.id);
    if (!cartData.items.length) throw new Error('Seu carrinho está vazio.');

    for (const item of cartData.items) {
      if (!item.is_active || item.stock < item.quantity) {
        throw new Error(`Estoque insuficiente para ${item.name} (${item.size}).`);
      }
    }

    const orderNumber = makeOrderNumber();
    const shippingCents = checkout.shippingMethod === 'retirada' ? 0 : Number(checkout.shippingCents || 0);
    const total = cartData.subtotal + shippingCents;
    const createdAt = nowSql();
    const order = db.prepare(`INSERT INTO orders
        (order_number, user_id, status, payment_method, payment_status, subtotal_cents, shipping_cents, total_cents,
        customer_name, customer_email, customer_phone, shipping_address, notes, created_at, updated_at)
        VALUES (?, ?, 'novo', ?, 'pendente', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(orderNumber, user.id, checkout.paymentMethod, cartData.subtotal, shippingCents, total,
        checkout.customerName, user.email, checkout.phone || '', checkout.address, checkout.notes || '', createdAt, createdAt);
    const orderId = Number(order.lastInsertRowid);
    const orderItemStmt = db.prepare(`INSERT INTO order_items
      (order_id, product_id, variant_id, product_name, size, color, quantity, unit_price_cents)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const stockStmt = db.prepare('UPDATE product_variants SET stock = stock - ? WHERE id = ?');
    for (const item of cartData.items) {
      orderItemStmt.run(orderId, item.product_id, item.variant_id, item.name, item.size, item.color, item.quantity, item.price_cents);
      stockStmt.run(item.quantity, item.variant_id);
    }
    db.prepare('DELETE FROM cart_items WHERE cart_id = ?').run(cartData.cart.id);
    db.exec('COMMIT');
    return { id: orderId, orderNumber, total, paymentMethod: checkout.paymentMethod };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) { /* transaction already closed */ }
    throw error;
  }
}

function recordProductView(productId, visitorKey) {
  const recent = db.prepare(`SELECT id FROM product_views
    WHERE product_id = ? AND visitor_key = ? AND viewed_at >= datetime('now', '-6 hours') LIMIT 1`).get(productId, visitorKey);
  if (!recent) {
    db.prepare('INSERT INTO product_views (product_id, visitor_key, viewed_at) VALUES (?, ?, ?)')
      .run(productId, visitorKey, nowSql());
  }
}

function getDashboardMetrics() {
  const { start, end } = monthBounds();
  const revenue = db.prepare(`SELECT COALESCE(SUM(total_cents), 0) AS total FROM orders
    WHERE created_at >= ? AND created_at < ? AND status != 'cancelado'`).get(start, end).total;
  const orders = db.prepare(`SELECT COUNT(*) AS total FROM orders WHERE created_at >= ? AND created_at < ? AND status != 'cancelado'`).get(start, end).total;
  const customers = db.prepare('SELECT COUNT(*) AS total FROM users WHERE role = ?').get('customer').total;
  const views = db.prepare(`SELECT COUNT(*) AS total FROM product_views WHERE viewed_at >= ? AND viewed_at < ?`).get(start, end).total;
  const goal = db.prepare(`SELECT * FROM sales_goals WHERE start_date <= ? AND end_date >= ? ORDER BY id DESC LIMIT 1`).get(start, start);
  const lowStock = db.prepare(`SELECT p.name, p.slug, SUM(pv.stock) AS total_stock FROM products p
    JOIN product_variants pv ON pv.product_id = p.id
    WHERE p.is_active = 1
    GROUP BY p.id
    HAVING total_stock <= 5
    ORDER BY total_stock ASC`).all();
  const topViewed = db.prepare(`SELECT p.id, p.name, p.slug, COUNT(v.id) AS views,
    (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.sort_order LIMIT 1) AS image_url
    FROM products p LEFT JOIN product_views v ON v.product_id = p.id
    GROUP BY p.id ORDER BY views DESC, p.id DESC LIMIT 5`).all();
  const topSold = db.prepare(`SELECT p.id, p.name, p.slug, COALESCE(SUM(oi.quantity), 0) AS units,
    COALESCE(SUM(oi.quantity * oi.unit_price_cents), 0) AS revenue,
    (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.sort_order LIMIT 1) AS image_url
    FROM products p LEFT JOIN order_items oi ON oi.product_id = p.id
    GROUP BY p.id ORDER BY units DESC, revenue DESC LIMIT 5`).all();
  const recentOrders = db.prepare(`SELECT id, order_number, customer_name, total_cents, status, payment_status, created_at
    FROM orders ORDER BY created_at DESC LIMIT 8`).all();
  const dailySales = db.prepare(`SELECT substr(created_at, 1, 10) AS day, COALESCE(SUM(total_cents), 0) AS total
    FROM orders WHERE created_at >= ? AND status != 'cancelado'
    GROUP BY substr(created_at, 1, 10) ORDER BY day ASC`).all(start);
  return { revenue, orders, customers, views, goal, lowStock, topViewed, topSold, recentOrders, dailySales };
}

function formatCurrency(cents) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((Number(cents) || 0) / 100);
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(String(value).replace(' ', 'T') + (String(value).endsWith('Z') ? '' : 'Z'));
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function statusLabel(status) {
  return ({ novo: 'Novo', em_separacao: 'Em separação', enviado: 'Enviado', entregue: 'Entregue', cancelado: 'Cancelado' })[status] || status;
}

module.exports = {
  createSession, destroySession, loadUser, attachVisitor, csrfProtection, verifyCsrf, requireAuth, requireAdmin,
  getCartDetails, addToCart, updateCartItem, removeCartItem, checkoutCart, recordProductView,
  getDashboardMetrics, formatCurrency, formatDate, statusLabel, ensureCart,
};
