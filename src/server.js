require('dotenv').config();

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const morgan = require('morgan');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');

const { db, getSettings, setSetting, nowSql, slugify, monthBounds, getDrops, getDropById, createDrop, updateDrop, archiveDrop, moveDrop } = require('./db');
const {
  createSession, destroySession, loadUser, attachVisitor, csrfProtection, verifyCsrf, requireAuth, requireAdmin,
  getCartDetails, addToCart, updateCartItem, removeCartItem, checkoutCart, recordProductView,
  getDashboardMetrics, formatCurrency, formatDate, statusLabel, ensureCart,
} = require('./utils');

const app = express();
const port = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';
const publicUrl = String(process.env.APP_URL || `http://localhost:${port}`).replace(/\/+$/, '');
const adminUrl = String(process.env.ADMIN_URL || '').replace(/\/+$/, '');
const publicHost = hostnameFromUrl(publicUrl);
const adminHost = hostnameFromUrl(adminUrl);
const allowedHosts = String(process.env.ALLOWED_HOSTS || '')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const cookieDomain = String(process.env.COOKIE_DOMAIN || '').trim() || undefined;

function hostnameFromUrl(value) {
  try { return new URL(value).hostname.toLowerCase(); } catch (_) { return ''; }
}

function urlForAdmin(path = '/admin/dashboard') {
  if (!adminUrl) return path;
  return `${adminUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

function flashCookieOptions(maxAge) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction || process.env.COOKIE_SECURE === 'true',
    maxAge,
    path: '/',
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  };
}

function moneyTextToCents(value) {
  const raw = String(value || '').trim();
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '')
    : raw.replace(/[^0-9.-]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : 0;
}

function calculateShipping(subtotalCents) {
  const settings = getSettings();
  const mode = String(settings.shipping_mode || 'manual');
  const flatRate = moneyTextToCents(settings.shipping_flat_rate || '0');
  const freeOver = moneyTextToCents(settings.shipping_free_over || '0');
  if (mode !== 'flat') return { method: 'manual', cents: 0, label: 'Frete calculado após o pedido', isEstimated: true };
  if (freeOver > 0 && Number(subtotalCents) >= freeOver) return { method: 'flat', cents: 0, label: 'Frete grátis', isEstimated: false };
  return { method: 'flat', cents: flatRate, label: flatRate ? 'Entrega padrão' : 'Frete grátis', isEstimated: false };
}

function normalizeCep(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 8);
}

async function sendPasswordResetEmail({ to, name, resetUrl }) {
  const host = String(process.env.SMTP_HOST || '').trim();
  const from = String(process.env.SMTP_FROM || '').trim();
  if (!host || !from) {
    console.log(`[NEBLK] Link de redefinição para ${to}: ${resetUrl}`);
    return { sent: false, development: true };
  }
  const port = Number(process.env.SMTP_PORT || 587);
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === 'true' || port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
  });
  await transporter.sendMail({
    from,
    to,
    subject: 'Redefina sua senha — NEBLK',
    text: `Olá, ${name}. Use este link para redefinir sua senha: ${resetUrl}. O link expira em 1 hora.`,
    html: `<p>Olá, <strong>${name}</strong>.</p><p>Use o link abaixo para redefinir sua senha na NEBLK. Ele expira em 1 hora.</p><p><a href="${resetUrl}">Redefinir minha senha</a></p>`,
  });
  return { sent: true, development: false };
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(morgan(isProduction ? 'combined' : 'dev'));
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: isProduction ? '7d' : 0 }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  const host = String(req.hostname || '').toLowerCase();
  if (isProduction && allowedHosts.length && host && !allowedHosts.includes(host)) {
    return res.status(421).send('Hostname não permitido.');
  }
  req.isAdminHost = Boolean(adminHost && host === adminHost);
  req.isPublicHost = !publicHost || host === publicHost || host === 'localhost' || host === '127.0.0.1';
  next();
});
app.use(loadUser);
app.use(attachVisitor);

app.use((req, res, next) => {
  let message = null;
  const raw = req.cookies?.neblk_flash;
  if (raw) {
    try { message = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')); } catch (_) { message = null; }
    res.clearCookie('neblk_flash', flashCookieOptions(0));
  }
  req.flash = (type, text) => {
    const value = Buffer.from(JSON.stringify({ type, text }), 'utf8').toString('base64url');
    res.cookie('neblk_flash', value, flashCookieOptions(15000));
  };
  res.locals.flash = message;
  next();
});

app.use(csrfProtection);
app.use((req, res, next) => {
  const settings = getSettings();
  const cart = getCartDetails(req.visitorKey, req.user?.id);
  res.locals.settings = settings;
  res.locals.user = req.user;
  res.locals.cartCount = cart.quantity;
  res.locals.currentPath = req.path;
  res.locals.formatCurrency = formatCurrency;
  res.locals.formatDate = formatDate;
  res.locals.statusLabel = statusLabel;
  res.locals.year = new Date().getFullYear();
  res.locals.publicUrl = publicUrl;
  res.locals.adminUrl = adminUrl;
  res.locals.isAdminHost = req.isAdminHost;
  res.locals.navDrops = getDrops({ activeOnly: true });
  next();
});

// O painel usa o subdomínio admin.neblk.com.br. O caminho /admin nunca é exposto como link na loja.
app.use((req, res, next) => {
  if (req.path === '/health' || !isProduction) return next();
  if (req.isAdminHost) {
    if (req.path === '/') return res.redirect('/admin/dashboard');
    const publicOnly = ['/loja', '/cadastro', '/conta', '/carrinho', '/checkout', '/pedido'];
    if (publicOnly.some((prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`))) {
      return res.redirect('/admin/dashboard');
    }
  } else if (req.path === '/admin' || req.path.startsWith('/admin/')) {
    return res.redirect(urlForAdmin(req.originalUrl));
  }
  next();
});

const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 8 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) return cb(new Error('Envie apenas imagens JPG, PNG ou WEBP.'));
    cb(null, true);
  },
});

function productRows(where = '1=1', params = [], orderBy = 'p.created_at DESC') {
  return db.prepare(`SELECT p.*, COALESCE(SUM(pv.stock), 0) AS total_stock,
      (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.sort_order, pi.id LIMIT 1) AS image_url,
      (SELECT COUNT(*) FROM product_views v WHERE v.product_id = p.id) AS view_count,
      (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi WHERE oi.product_id = p.id) AS sold_count
    FROM products p
    LEFT JOIN product_variants pv ON pv.product_id = p.id
    WHERE ${where}
    GROUP BY p.id
    ORDER BY ${orderBy}`).all(...params);
}

function getProductById(id) {
  const product = db.prepare(`SELECT p.*, COALESCE(SUM(pv.stock), 0) AS total_stock
    FROM products p LEFT JOIN product_variants pv ON pv.product_id = p.id WHERE p.id = ? GROUP BY p.id`).get(id);
  if (!product) return null;
  product.images = db.prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order, id').all(id);
  product.variants = db.prepare(`SELECT * FROM product_variants WHERE product_id = ? ORDER BY CASE size WHEN 'P' THEN 1 WHEN 'M' THEN 2 WHEN 'G' THEN 3 WHEN 'GG' THEN 4 WHEN 'XG' THEN 5 ELSE 9 END, id`).all(id);
  return product;
}

function parseVariants(input, color) {
  const entries = String(input || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [sizeRaw, stockRaw] = part.split(':').map((value) => value.trim());
      return { size: String(sizeRaw || '').toUpperCase(), stock: Number(stockRaw), color: String(color || 'Preto').trim() || 'Preto' };
    })
    .filter((variant) => /^[A-Z0-9]{1,4}$/.test(variant.size) && Number.isInteger(variant.stock) && variant.stock >= 0);
  if (!entries.length) throw new Error('Informe as variações no formato P:5, M:10, G:8.');
  return entries;
}

function moneyToCents(value) {
  const normalized = String(value || '').replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('Informe um preço válido.');
  return Math.round(parsed * 100);
}

function saveProduct({ existingId = null, body, files }) {
  const name = String(body.name || '').trim();
  const description = String(body.description || '').trim();
  const category = String(body.category || 'Camisetas').trim();
  const collectionName = String(body.collection_name || 'Drop 01').trim();
  const priceCents = moneyToCents(body.price);
  const compareAtCents = body.compare_at ? moneyToCents(body.compare_at) : null;
  const variants = parseVariants(body.variants, body.color);
  if (name.length < 3 || description.length < 12) throw new Error('Preencha nome e descrição do produto.');
  if (compareAtCents && compareAtCents < priceCents) throw new Error('O preço de referência deve ser maior ou igual ao preço atual.');

  const active = body.is_active === 'on' ? 1 : 0;
  const featured = body.is_featured === 'on' ? 1 : 0;
  const uploaded = (files || []).map((file) => `/uploads/${file.filename}`);

  if (!existingId) {
    let base = slugify(name);
    let slug = base;
    let suffix = 2;
    while (db.prepare('SELECT id FROM products WHERE slug = ?').get(slug)) slug = `${base}-${suffix++}`;
    const info = db.prepare(`INSERT INTO products
      (name, slug, description, category, collection_name, price_cents, compare_at_cents, is_featured, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(name, slug, description, category, collectionName, priceCents, compareAtCents, featured, active, nowSql(), nowSql());
    const productId = Number(info.lastInsertRowid);
    const images = uploaded.length ? uploaded : ['/assets/products/shadow-logo.svg'];
    const imageStmt = db.prepare('INSERT INTO product_images (product_id, image_url, alt_text, sort_order) VALUES (?, ?, ?, ?)');
    images.forEach((image, index) => imageStmt.run(productId, image, name, index));
    const variantStmt = db.prepare('INSERT INTO product_variants (product_id, size, color, sku, stock) VALUES (?, ?, ?, ?, ?)');
    variants.forEach((variant, index) => variantStmt.run(productId, variant.size, variant.color, `NEBLK-${productId}-${index + 1}`, variant.stock));
    return productId;
  }

  const product = getProductById(existingId);
  if (!product) throw new Error('Produto não encontrado.');
  db.prepare(`UPDATE products SET name = ?, description = ?, category = ?, collection_name = ?, price_cents = ?, compare_at_cents = ?,
    is_featured = ?, is_active = ?, updated_at = ? WHERE id = ?`)
    .run(name, description, category, collectionName, priceCents, compareAtCents, featured, active, nowSql(), existingId);
  const removeIds = Array.isArray(body.remove_image_ids) ? body.remove_image_ids : body.remove_image_ids ? [body.remove_image_ids] : [];
  if (removeIds.length) {
    const statement = db.prepare('DELETE FROM product_images WHERE id = ? AND product_id = ?');
    removeIds.forEach((id) => statement.run(Number(id), existingId));
  }
  if (uploaded.length) {
    const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM product_images WHERE product_id = ?').get(existingId).max_sort;
    const stmt = db.prepare('INSERT INTO product_images (product_id, image_url, alt_text, sort_order) VALUES (?, ?, ?, ?)');
    uploaded.forEach((image, index) => stmt.run(existingId, image, name, maxSort + index + 1));
  }
  const currentImages = db.prepare('SELECT COUNT(*) AS total FROM product_images WHERE product_id = ?').get(existingId).total;
  if (!currentImages) db.prepare('INSERT INTO product_images (product_id, image_url, alt_text, sort_order) VALUES (?, ?, ?, 0)').run(existingId, '/assets/products/shadow-logo.svg', name);
  db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(existingId);
  const variantStmt = db.prepare('INSERT INTO product_variants (product_id, size, color, sku, stock) VALUES (?, ?, ?, ?, ?)');
  variants.forEach((variant, index) => variantStmt.run(existingId, variant.size, variant.color, `NEBLK-${existingId}-${index + 1}`, variant.stock));
  return existingId;
}

/* Storefront */
app.get('/health', (_req, res) => res.status(200).json({ ok: true, service: 'neblk-store' }));

app.get('/', (req, res) => {
  const featured = productRows('p.is_active = 1 AND p.is_featured = 1', [], 'p.created_at DESC').slice(0, 4);
  const latest = productRows('p.is_active = 1', [], 'p.created_at DESC').slice(0, 4);
  const drops = getDrops({ activeOnly: true });
  res.render('home', { title: 'NEBLK — lets you be.', featured, latest, drops });
});

app.get('/loja', (req, res) => {
  const clauses = ['p.is_active = 1'];
  const params = [];
  const q = String(req.query.q || '').trim();
  const category = String(req.query.category || '').trim();
  const collection = String(req.query.collection || '').trim();
  if (q) { clauses.push('(p.name LIKE ? OR p.description LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  if (category) { clauses.push('p.category = ?'); params.push(category); }
  if (collection) { clauses.push('p.collection_name = ?'); params.push(collection); }
  const orderMap = {
    recent: 'p.created_at DESC',
    low: 'p.price_cents ASC',
    high: 'p.price_cents DESC',
    popular: 'view_count DESC, p.created_at DESC',
  };
  const sort = String(req.query.sort || 'recent');
  const products = productRows(clauses.join(' AND '), params, orderMap[sort] || orderMap.recent);
  const categories = db.prepare('SELECT DISTINCT category FROM products WHERE is_active = 1 ORDER BY category').all().map((row) => row.category);
  const collections = db.prepare('SELECT DISTINCT collection_name FROM products WHERE is_active = 1 ORDER BY collection_name').all().map((row) => row.collection_name);
  const drops = getDrops({ activeOnly: true });
  res.render('catalog', { title: 'Loja | NEBLK', products, categories, collections, drops, filters: { q, category, collection, sort } });
});

app.get('/drops', (_req, res) => {
  const drops = getDrops({ activeOnly: true });
  res.render('drops', { title: 'Drops | NEBLK', drops });
});

app.get('/drops/:slug', (req, res, next) => {
  const drop = db.prepare('SELECT * FROM drops WHERE slug = ? AND is_active = 1').get(String(req.params.slug || '').trim());
  if (!drop) return next();
  const products = productRows('p.is_active = 1 AND p.collection_name = ?', [drop.name], 'p.created_at DESC');
  res.render('drop', { title: `${drop.name} | NEBLK`, drop, products });
});

app.get('/produto/:slug', (req, res, next) => {
  const product = db.prepare(`SELECT p.*, COALESCE(SUM(pv.stock), 0) AS total_stock
    FROM products p LEFT JOIN product_variants pv ON pv.product_id = p.id
    WHERE p.slug = ? AND p.is_active = 1 GROUP BY p.id`).get(req.params.slug);
  if (!product) return next();
  product.images = db.prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order, id').all(product.id);
  product.variants = db.prepare('SELECT * FROM product_variants WHERE product_id = ? ORDER BY stock DESC, id').all(product.id);
  product.viewCount = db.prepare('SELECT COUNT(*) AS total FROM product_views WHERE product_id = ?').get(product.id).total;
  recordProductView(product.id, req.visitorKey);
  const related = productRows('p.is_active = 1 AND p.id != ? AND (p.collection_name = ? OR p.category = ?)', [product.id, product.collection_name, product.category], 'p.created_at DESC').slice(0, 4);
  res.render('product', { title: `${product.name} | NEBLK`, product, related });
});

app.get('/carrinho', (req, res) => {
  const cart = getCartDetails(req.visitorKey, req.user?.id);
  res.render('cart', { title: 'Carrinho | NEBLK', cart });
});

app.post('/carrinho/adicionar', (req, res) => {
  try {
    addToCart(req.visitorKey, req.user?.id, Number(req.body.variant_id), Number(req.body.quantity || 1));
    req.flash('success', 'Peça adicionada ao carrinho.');
    res.redirect(req.get('referer') || '/carrinho');
  } catch (error) {
    req.flash('error', error.message || 'Não foi possível adicionar o produto.');
    res.redirect(req.get('referer') || '/loja');
  }
});

app.post('/carrinho/:id/atualizar', (req, res) => {
  try {
    updateCartItem(req.visitorKey, Number(req.params.id), Number(req.body.quantity));
    req.flash('success', 'Carrinho atualizado.');
  } catch (error) {
    req.flash('error', error.message || 'Não foi possível atualizar o carrinho.');
  }
  res.redirect('/carrinho');
});

app.post('/carrinho/:id/remover', (req, res) => {
  removeCartItem(req.visitorKey, Number(req.params.id));
  req.flash('success', 'Item removido do carrinho.');
  res.redirect('/carrinho');
});

app.get('/api/frete', (req, res) => {
  const cep = normalizeCep(req.query.cep);
  const subtotal = Number(req.query.subtotal || 0);
  if (cep.length !== 8) return res.status(400).json({ ok: false, message: 'Informe um CEP com 8 dígitos.' });
  const quote = calculateShipping(subtotal);
  return res.json({ ok: true, cep, ...quote, formatted: formatCurrency(quote.cents) });
});

/* Authentication */
app.get('/login', (req, res) => {
  const nextUrl = String(req.query.next || '');
  const wantsAdmin = req.isAdminHost || nextUrl.startsWith('/admin');
  if (wantsAdmin && !req.isAdminHost && isProduction && adminUrl) {
    return res.redirect(`${urlForAdmin('/login')}?next=${encodeURIComponent(nextUrl || '/admin/dashboard')}`);
  }
  return res.render(wantsAdmin ? 'auth/admin-login' : 'auth/login', {
    title: wantsAdmin ? 'Acesso administrativo | NEBLK' : 'Entrar | NEBLK',
    nextUrl: nextUrl || (wantsAdmin ? '/admin/dashboard' : ''),
  });
});

app.post('/login', (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const password = String(req.body.password || '');
  const safeNext = String(req.body.next || '');
  const wantsAdmin = req.isAdminHost || safeNext.startsWith('/admin');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    req.flash('error', 'E-mail ou senha inválidos.');
    return res.redirect(`/login${safeNext ? `?next=${encodeURIComponent(safeNext)}` : ''}`);
  }
  if (wantsAdmin && user.role !== 'admin') {
    req.flash('error', 'Esta conta não possui acesso ao painel administrativo.');
    return res.redirect(`/login?next=${encodeURIComponent('/admin/dashboard')}`);
  }
  createSession(user.id, res);
  ensureCart(req.visitorKey, user.id);
  req.flash('success', `Bem-vindo${user.role === 'admin' ? ', administrador' : ''}, ${user.name.split(' ')[0]}.`);

  if (wantsAdmin || user.role === 'admin') {
    if (!req.isAdminHost && isProduction && adminUrl) return res.redirect(urlForAdmin('/admin/dashboard'));
    return res.redirect('/admin/dashboard');
  }
  if (safeNext.startsWith('/') && !safeNext.startsWith('//')) return res.redirect(safeNext);
  return res.redirect('/conta');
});

app.get('/esqueci-senha', (_req, res) => res.render('auth/forgot-password', { title: 'Recuperar senha | NEBLK' }));

app.post('/esqueci-senha', async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const user = db.prepare('SELECT id, name, email FROM users WHERE email = ?').get(email);
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.prepare('DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?').run(user.id, new Date().toISOString());
    db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(tokenHash, user.id, expiresAt, nowSql());
    const resetUrl = `${publicUrl}/redefinir-senha/${token}`;
    try { await sendPasswordResetEmail({ to: user.email, name: user.name, resetUrl }); } catch (error) { console.error('[NEBLK] Falha ao enviar e-mail de recuperação:', error.message); }
  }
  req.flash('success', 'Se o e-mail estiver cadastrado, você receberá um link para redefinir sua senha.');
  res.redirect('/login');
});

app.get('/redefinir-senha/:token', (req, res) => {
  const token = String(req.params.token || '');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const reset = db.prepare('SELECT id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?').get(tokenHash, new Date().toISOString());
  if (!reset) return res.status(400).render('error', { title: 'Link inválido', message: 'Este link expirou ou já foi utilizado. Solicite uma nova recuperação de senha.' });
  res.render('auth/reset-password', { title: 'Redefinir senha | NEBLK', token });
});

app.post('/redefinir-senha/:token', (req, res) => {
  const token = String(req.params.token || '');
  const newPassword = String(req.body.password || '');
  const confirmPassword = String(req.body.password_confirmation || '');
  if (newPassword.length < 8 || newPassword !== confirmPassword) {
    req.flash('error', 'Use uma senha com pelo menos 8 caracteres e confirme os dois campos.');
    return res.redirect(`/redefinir-senha/${token}`);
  }
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const reset = db.prepare('SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?').get(tokenHash, new Date().toISOString());
  if (!reset) return res.status(400).render('error', { title: 'Link inválido', message: 'Este link expirou ou já foi utilizado. Solicite uma nova recuperação de senha.' });
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 12), reset.user_id);
    db.prepare('UPDATE password_resets SET used_at = ? WHERE id = ?').run(nowSql(), reset.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(reset.user_id);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) { /* no-op */ }
    throw error;
  }
  req.flash('success', 'Senha redefinida. Entre com sua nova senha.');
  res.redirect('/login');
});

app.get('/cadastro', (req, res) => res.render('auth/register', { title: 'Criar conta | NEBLK' }));
app.post('/cadastro', (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').toLowerCase().trim();
  const phone = String(req.body.phone || '').trim();
  const password = String(req.body.password || '');
  if (name.length < 3 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
    req.flash('error', 'Use nome completo, e-mail válido e uma senha com pelo menos 8 caracteres.');
    return res.redirect('/cadastro');
  }
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
    req.flash('error', 'Este e-mail já possui uma conta.');
    return res.redirect('/login');
  }
  const result = db.prepare('INSERT INTO users (name, email, password_hash, role, phone, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name, email, bcrypt.hashSync(password, 12), 'customer', phone, nowSql());
  createSession(Number(result.lastInsertRowid), res);
  ensureCart(req.visitorKey, Number(result.lastInsertRowid));
  req.flash('success', 'Conta criada. Seu próximo drop começa agora.');
  res.redirect('/conta');
});

app.post('/logout', (req, res) => {
  destroySession(req, res);
  req.flash('success', 'Você saiu da sua conta.');
  res.redirect(req.isAdminHost ? '/login' : '/');
});

/* Customer account and checkout */
app.get('/conta', requireAuth, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.render('account/index', { title: 'Minha conta | NEBLK', orders });
});

app.get('/conta/perfil', requireAuth, (req, res) => {
  res.render('account/profile', { title: 'Meu perfil | NEBLK' });
});

app.post('/conta/perfil', requireAuth, (req, res) => {
  const name = String(req.body.name || '').trim();
  const phone = String(req.body.phone || '').trim();
  const cpf = String(req.body.cpf || '').trim();
  const zip = normalizeCep(req.body.address_zip);
  const street = String(req.body.address_street || '').trim();
  const number = String(req.body.address_number || '').trim();
  const complement = String(req.body.address_complement || '').trim();
  const district = String(req.body.address_district || '').trim();
  const city = String(req.body.address_city || '').trim();
  const state = String(req.body.address_state || '').trim().toUpperCase().slice(0, 2);
  if (name.length < 3) {
    req.flash('error', 'Informe seu nome completo.');
    return res.redirect('/conta/perfil');
  }
  db.prepare(`UPDATE users SET name = ?, phone = ?, cpf = ?, address_zip = ?, address_street = ?, address_number = ?, address_complement = ?, address_district = ?, address_city = ?, address_state = ? WHERE id = ?`)
    .run(name, phone, cpf, zip, street, number, complement, district, city, state, req.user.id);
  req.flash('success', 'Perfil e endereço atualizados.');
  res.redirect('/conta/perfil');
});

app.post('/conta/perfil/senha', requireAuth, (req, res) => {
  const currentPassword = String(req.body.current_password || '');
  const newPassword = String(req.body.new_password || '');
  const account = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!account || !bcrypt.compareSync(currentPassword, account.password_hash)) {
    req.flash('error', 'A senha atual está incorreta.');
    return res.redirect('/conta/perfil');
  }
  if (newPassword.length < 8) {
    req.flash('error', 'A nova senha precisa ter pelo menos 8 caracteres.');
    return res.redirect('/conta/perfil');
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 12), req.user.id);
  req.flash('success', 'Senha atualizada com sucesso.');
  res.redirect('/conta/perfil');
});

app.get('/conta/pedidos/:number', requireAuth, (req, res, next) => {
  const order = db.prepare('SELECT * FROM orders WHERE order_number = ? AND user_id = ?').get(req.params.number, req.user.id);
  if (!order) return next();
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.render('account/order', { title: `${order.order_number} | NEBLK`, order, items });
});

app.get('/checkout', requireAuth, (req, res) => {
  const cart = getCartDetails(req.visitorKey, req.user.id);
  if (!cart.items.length) {
    req.flash('error', 'Adicione uma peça antes de finalizar o pedido.');
    return res.redirect('/loja');
  }
  const shipping = calculateShipping(cart.subtotal);
  res.render('checkout', { title: 'Checkout | NEBLK', cart, shipping });
});

app.post('/checkout', requireAuth, (req, res) => {
  const paymentMethod = ['pix', 'manual'].includes(req.body.payment_method) ? req.body.payment_method : 'pix';
  const customerName = String(req.body.customer_name || '').trim();
  const phone = String(req.body.phone || '').trim();
  const cpf = String(req.body.cpf || '').trim();
  const zip = normalizeCep(req.body.address_zip);
  const street = String(req.body.address_street || '').trim();
  const number = String(req.body.address_number || '').trim();
  const complement = String(req.body.address_complement || '').trim();
  const district = String(req.body.address_district || '').trim();
  const city = String(req.body.address_city || '').trim();
  const state = String(req.body.address_state || '').trim().toUpperCase().slice(0, 2);
  const addressParts = [street, number, complement, district, city && state ? `${city}/${state}` : city || state, zip].filter(Boolean);
  const address = addressParts.join(', ');

  if (customerName.length < 3 || phone.length < 8 || zip.length !== 8 || street.length < 3 || number.length < 1 || district.length < 2 || city.length < 2 || state.length !== 2) {
    req.flash('error', 'Preencha seus dados e o endereço completo para finalizar o pedido.');
    return res.redirect('/checkout');
  }
  try {
    db.prepare(`UPDATE users SET name = ?, phone = ?, cpf = ?,
      address_zip = ?, address_street = ?, address_number = ?, address_complement = ?,
      address_district = ?, address_city = ?, address_state = ? WHERE id = ?`)
      .run(customerName, phone, cpf, zip, street, number, complement, district, city, state, req.user.id);
    req.user = { ...req.user, name: customerName, phone, cpf, address_zip: zip, address_street: street, address_number: number, address_complement: complement, address_district: district, address_city: city, address_state: state };
    const cart = getCartDetails(req.visitorKey, req.user.id);
    const shipping = calculateShipping(cart.subtotal);
    const order = checkoutCart(req.visitorKey, req.user, {
      customerName,
      phone,
      address,
      notes: String(req.body.notes || '').trim(),
      paymentMethod,
      shippingMethod: shipping.method,
      shippingCents: shipping.cents,
    });
    res.redirect(`/pedido/${order.orderNumber}/sucesso`);
  } catch (error) {
    req.flash('error', error.message || 'Não foi possível criar o pedido.');
    res.redirect('/carrinho');
  }
});

app.get('/pedido/:number/sucesso', requireAuth, (req, res, next) => {
  const order = db.prepare('SELECT * FROM orders WHERE order_number = ? AND user_id = ?').get(req.params.number, req.user.id);
  if (!order) return next();
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.render('order-success', { title: 'Pedido confirmado | NEBLK', order, items });
});

/* Admin */
app.get('/admin', requireAdmin, (_req, res) => res.redirect('/admin/dashboard'));
app.get('/admin/dashboard', requireAdmin, (req, res) => {
  const metrics = getDashboardMetrics();
  res.render('admin/dashboard', { title: 'Dashboard | NEBLK Admin', metrics, chartData: JSON.stringify(metrics.dailySales) });
});

app.get('/admin/produtos', requireAdmin, (req, res) => {
  const products = productRows('1=1', [], 'p.created_at DESC');
  res.render('admin/products', { title: 'Produtos | NEBLK Admin', products });
});

app.get('/admin/produtos/novo', requireAdmin, (_req, res) => {
  res.render('admin/product-form', { title: 'Novo produto | NEBLK Admin', product: null, drops: getDrops() });
});

app.post('/admin/produtos', requireAdmin, upload.array('images', 8), verifyCsrf, (req, res) => {
  try {
    const id = saveProduct({ body: req.body, files: req.files });
    req.flash('success', 'Produto cadastrado com sucesso.');
    res.redirect(`/admin/produtos/${id}/editar`);
  } catch (error) {
    (req.files || []).forEach((file) => fs.unlink(file.path, () => {}));
    req.flash('error', error.message || 'Não foi possível cadastrar o produto.');
    res.redirect('/admin/produtos/novo');
  }
});

app.get('/admin/produtos/:id/editar', requireAdmin, (req, res, next) => {
  const product = getProductById(Number(req.params.id));
  if (!product) return next();
  res.render('admin/product-form', { title: `Editar ${product.name} | NEBLK Admin`, product, drops: getDrops() });
});

app.post('/admin/produtos/:id', requireAdmin, upload.array('images', 8), verifyCsrf, (req, res) => {
  try {
    const id = saveProduct({ existingId: Number(req.params.id), body: req.body, files: req.files });
    req.flash('success', 'Produto atualizado.');
    res.redirect(`/admin/produtos/${id}/editar`);
  } catch (error) {
    (req.files || []).forEach((file) => fs.unlink(file.path, () => {}));
    req.flash('error', error.message || 'Não foi possível atualizar o produto.');
    res.redirect(`/admin/produtos/${req.params.id}/editar`);
  }
});

app.post('/admin/produtos/:id/arquivar', requireAdmin, (req, res) => {
  db.prepare('UPDATE products SET is_active = 0, updated_at = ? WHERE id = ?').run(nowSql(), Number(req.params.id));
  req.flash('success', 'Produto arquivado. Ele não será exibido na loja.');
  res.redirect('/admin/produtos');
});


app.get('/admin/drops', requireAdmin, (_req, res) => {
  const drops = getDrops();
  res.render('admin/drops', { title: 'Drops | NEBLK Admin', drops, editingDrop: null });
});

app.get('/admin/drops/:id/editar', requireAdmin, (req, res) => {
  const drops = getDrops();
  const editingDrop = getDropById(Number(req.params.id));
  if (!editingDrop) return res.redirect('/admin/drops');
  res.render('admin/drops', { title: `Editar ${editingDrop.name} | NEBLK Admin`, drops, editingDrop });
});

app.post('/admin/drops', requireAdmin, upload.single('banner'), verifyCsrf, (req, res) => {
  try {
    createDrop({
      name: String(req.body.name || '').trim(),
      description: String(req.body.description || '').trim(),
      bannerLabel: String(req.body.banner_label || '').trim(),
      bannerUrl: req.file ? `/uploads/${req.file.filename}` : String(req.body.banner_url || '').trim(),
      isActive: req.body.is_active === 'on',
    });
    req.flash('success', 'Drop cadastrado com sucesso.');
  } catch (error) {
    if (req.file) fs.unlink(req.file.path, () => {});
    req.flash('error', error.message || 'Não foi possível cadastrar o drop.');
  }
  res.redirect('/admin/drops');
});

app.post('/admin/drops/:id', requireAdmin, upload.single('banner'), verifyCsrf, (req, res) => {
  try {
    const current = getDropById(Number(req.params.id));
    const bannerUrl = req.body.remove_banner === 'on' ? '' : (req.file ? `/uploads/${req.file.filename}` : current?.banner_url);
    updateDrop(Number(req.params.id), {
      name: String(req.body.name || '').trim(),
      description: String(req.body.description || '').trim(),
      bannerLabel: String(req.body.banner_label || '').trim(),
      bannerUrl,
      isActive: req.body.is_active === 'on',
    });
    req.flash('success', 'Drop atualizado com sucesso.');
  } catch (error) {
    if (req.file) fs.unlink(req.file.path, () => {});
    req.flash('error', error.message || 'Não foi possível atualizar o drop.');
  }
  res.redirect('/admin/drops');
});

app.post('/admin/drops/:id/mover/:direction', requireAdmin, (req, res) => {
  try {
    const direction = req.params.direction === 'up' ? 'up' : 'down';
    moveDrop(Number(req.params.id), direction);
    req.flash('success', 'Ordem dos drops atualizada.');
  } catch (error) {
    req.flash('error', error.message || 'Não foi possível alterar a ordem.');
  }
  res.redirect('/admin/drops');
});

app.post('/admin/drops/:id/arquivar', requireAdmin, (req, res) => {
  try { archiveDrop(Number(req.params.id)); req.flash('success', 'Drop arquivado.'); }
  catch (error) { req.flash('error', error.message || 'Não foi possível arquivar o drop.'); }
  res.redirect('/admin/drops');
});

app.get('/admin/pedidos', requireAdmin, (req, res) => {
  const orders = db.prepare(`SELECT o.*, COUNT(oi.id) AS items_count FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
    GROUP BY o.id ORDER BY o.created_at DESC`).all();
  res.render('admin/orders', { title: 'Pedidos | NEBLK Admin', orders });
});

app.post('/admin/pedidos/:id', requireAdmin, (req, res) => {
  const status = ['novo', 'em_separacao', 'enviado', 'entregue', 'cancelado'].includes(req.body.status) ? req.body.status : 'novo';
  const paymentStatus = ['pendente', 'pago', 'recusado', 'reembolsado'].includes(req.body.payment_status) ? req.body.payment_status : 'pendente';
  db.prepare('UPDATE orders SET status = ?, payment_status = ?, updated_at = ? WHERE id = ?')
    .run(status, paymentStatus, nowSql(), Number(req.params.id));
  req.flash('success', 'Status do pedido atualizado.');
  res.redirect('/admin/pedidos');
});

app.get('/admin/metricas', requireAdmin, (_req, res) => {
  const metrics = getDashboardMetrics();
  const products = productRows('1=1', [], 'view_count DESC, sold_count DESC');
  res.render('admin/metrics', { title: 'Métricas | NEBLK Admin', metrics, products, chartData: JSON.stringify(metrics.dailySales) });
});

app.get('/admin/configuracoes', requireAdmin, (_req, res) => {
  const settings = getSettings();
  const goal = getDashboardMetrics().goal;
  res.render('admin/settings', { title: 'Configurações | NEBLK Admin', settings, goal });
});

app.post('/admin/configuracoes', requireAdmin, (req, res) => {
  const accepted = ['brand_slogan', 'instagram_url', 'facebook_url', 'tiktok_url', 'whatsapp_url', 'support_email', 'pix_key', 'pix_beneficiary', 'pix_instructions', 'shipping_mode', 'shipping_flat_rate', 'shipping_free_over', 'shipping_origin_zip'];
  accepted.forEach((key) => setSetting(key, String(req.body[key] || '').trim()));
  req.flash('success', 'Configurações da marca atualizadas.');
  res.redirect('/admin/configuracoes');
});

app.post('/admin/senha', requireAdmin, (req, res) => {
  const currentPassword = String(req.body.current_password || '');
  const newPassword = String(req.body.new_password || '');
  const account = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!account || !bcrypt.compareSync(currentPassword, account.password_hash)) {
    req.flash('error', 'A senha atual está incorreta.');
    return res.redirect('/admin/configuracoes');
  }
  if (newPassword.length < 10) {
    req.flash('error', 'A nova senha precisa ter pelo menos 10 caracteres.');
    return res.redirect('/admin/configuracoes');
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 12), req.user.id);
  req.flash('success', 'Senha administrativa atualizada.');
  return res.redirect('/admin/configuracoes');
});

app.post('/admin/metas', requireAdmin, (req, res) => {
  try {
    const target = moneyToCents(req.body.target);
    const { start, end } = monthBounds();
    const existing = db.prepare('SELECT id FROM sales_goals WHERE start_date = ? AND end_date = ?').get(start, end);
    if (existing) {
      db.prepare('UPDATE sales_goals SET title = ?, target_cents = ? WHERE id = ?').run(String(req.body.title || 'Meta de faturamento mensal').trim(), target, existing.id);
    } else {
      db.prepare('INSERT INTO sales_goals (title, target_cents, start_date, end_date, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(String(req.body.title || 'Meta de faturamento mensal').trim(), target, start, end, nowSql());
    }
    req.flash('success', 'Meta mensal atualizada.');
  } catch (error) {
    req.flash('error', error.message || 'Não foi possível atualizar a meta.');
  }
  res.redirect('/admin/configuracoes');
});

app.use((_req, res) => res.status(404).render('error', { title: 'Página não encontrada', message: 'A página que você procura não existe ou foi movida.' }));

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error instanceof multer.MulterError) {
    return res.status(400).render('error', { title: 'Falha no upload', message: error.code === 'LIMIT_FILE_SIZE' ? 'Cada imagem deve ter no máximo 5 MB.' : 'Não foi possível processar as imagens.' });
  }
  return res.status(500).render('error', { title: 'Erro interno', message: error.message || 'Ocorreu um erro inesperado. Tente novamente.' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`NEBLK está rodando em ${process.env.APP_URL || `http://localhost:${port}`}`);
});
