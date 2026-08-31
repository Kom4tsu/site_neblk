const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'neblk.db'));
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

function nowSql() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function monthBounds() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'item';
}

function tableColumns(tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
}

function addColumnIfMissing(tableName, columnName, definition) {
  if (!tableColumns(tableName).includes(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function initializeSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      provider TEXT DEFAULT 'local',
      provider_id TEXT,
      role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN ('customer', 'admin')),
      phone TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS drops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      banner_url TEXT,
      banner_label TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Camisetas',
      collection_name TEXT NOT NULL DEFAULT 'Drop 01',
      price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
      compare_at_cents INTEGER,
      is_featured INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS product_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      image_url TEXT NOT NULL,
      alt_text TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS product_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      size TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT 'Preto',
      sku TEXT,
      stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE,
      UNIQUE(product_id, size, color)
    );

    CREATE TABLE IF NOT EXISTS carts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visitor_key TEXT NOT NULL UNIQUE,
      user_id INTEGER,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS cart_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cart_id INTEGER NOT NULL,
      variant_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(cart_id) REFERENCES carts(id) ON DELETE CASCADE,
      FOREIGN KEY(variant_id) REFERENCES product_variants(id) ON DELETE CASCADE,
      UNIQUE(cart_id, variant_id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'novo' CHECK(status IN ('novo', 'em_separacao', 'enviado', 'entregue', 'cancelado')),
      payment_method TEXT NOT NULL,
      payment_status TEXT NOT NULL DEFAULT 'pendente' CHECK(payment_status IN ('pendente', 'pago', 'recusado', 'reembolsado')),
      subtotal_cents INTEGER NOT NULL,
      shipping_cents INTEGER NOT NULL DEFAULT 0,
      total_cents INTEGER NOT NULL,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      customer_phone TEXT,
      shipping_address TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      variant_id INTEGER,
      product_name TEXT NOT NULL,
      size TEXT,
      color TEXT,
      quantity INTEGER NOT NULL,
      unit_price_cents INTEGER NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES products(id),
      FOREIGN KEY(variant_id) REFERENCES product_variants(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS product_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      visitor_key TEXT NOT NULL,
      viewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sales_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      target_cents INTEGER NOT NULL CHECK(target_cents >= 0),
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);
    CREATE INDEX IF NOT EXISTS idx_product_views_product ON product_views(product_id);
    CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
    CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token_hash);
    CREATE INDEX IF NOT EXISTS idx_drops_active_order ON drops(is_active, sort_order, name);
  `);

  // Migração segura para instalações já existentes.
  addColumnIfMissing('users', 'cpf', 'TEXT');
  addColumnIfMissing('users', 'address_zip', 'TEXT');
  addColumnIfMissing('users', 'address_street', 'TEXT');
  addColumnIfMissing('users', 'address_number', 'TEXT');
  addColumnIfMissing('users', 'address_complement', 'TEXT');
  addColumnIfMissing('users', 'address_district', 'TEXT');
  addColumnIfMissing('users', 'address_city', 'TEXT');
  addColumnIfMissing('users', 'address_state', 'TEXT');
  addColumnIfMissing('drops', 'banner_url', 'TEXT');
  addColumnIfMissing('drops', 'banner_label', 'TEXT');
  
  // Adiciona suporte a login social em bancos existentes
  addColumnIfMissing('users', 'provider', "TEXT DEFAULT 'local'");
  addColumnIfMissing('users', 'provider_id', 'TEXT');
}

function ensureSetting(key, value) {
  const found = db.prepare('SELECT setting_key FROM settings WHERE setting_key = ?').get(key);
  if (!found) {
    db.prepare('INSERT INTO settings (setting_key, setting_value, updated_at) VALUES (?, ?, ?)')
      .run(key, value, nowSql());
  }
}

function uniqueDropSlug(name, exceptId = null) {
  const base = slugify(name) || 'drop';
  let slug = base;
  let suffix = 2;
  const statement = db.prepare('SELECT id FROM drops WHERE slug = ?');
  while (true) {
    const found = statement.get(slug);
    if (!found || Number(found.id) === Number(exceptId)) return slug;
    slug = `${base}-${suffix++}`;
  }
}

function getDrops({ activeOnly = false } = {}) {
  const where = activeOnly ? 'WHERE d.is_active = 1' : '';
  return db.prepare(`SELECT d.*, COUNT(p.id) AS product_count
    FROM drops d
    LEFT JOIN products p ON p.collection_name = d.name
    ${where}
    GROUP BY d.id
    ORDER BY d.sort_order ASC, d.name COLLATE NOCASE ASC`).all();
}

function getDropById(id) {
  return db.prepare('SELECT * FROM drops WHERE id = ?').get(Number(id));
}

function createDrop({ name, description = '', bannerUrl = '', bannerLabel = '', isActive = true }) {
  const cleanName = String(name || '').trim();
  if (cleanName.length < 3 || cleanName.length > 50) throw new Error('Informe um nome de Drop entre 3 e 50 caracteres.');
  if (db.prepare('SELECT id FROM drops WHERE lower(name) = lower(?)').get(cleanName)) throw new Error('Já existe um Drop com esse nome.');
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS value FROM drops').get().value;
  const info = db.prepare(`INSERT INTO drops (name, slug, description, banner_url, banner_label, is_active, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(cleanName, uniqueDropSlug(cleanName), String(description || '').trim(), String(bannerUrl || '').trim() || null, String(bannerLabel || '').trim() || null, isActive ? 1 : 0, Number(maxOrder) + 1, nowSql(), nowSql());
  return Number(info.lastInsertRowid);
}

function updateDrop(id, { name, description = '', bannerUrl = undefined, bannerLabel = '', isActive = true }) {
  const current = getDropById(id);
  if (!current) throw new Error('Drop não encontrado.');
  const cleanName = String(name || '').trim();
  if (cleanName.length < 3 || cleanName.length > 50) throw new Error('Informe um nome de Drop entre 3 e 50 caracteres.');
  const duplicate = db.prepare('SELECT id FROM drops WHERE lower(name) = lower(?) AND id != ?').get(cleanName, Number(id));
  if (duplicate) throw new Error('Já existe outro Drop com esse nome.');

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`UPDATE drops SET name = ?, slug = ?, description = ?, banner_url = ?, banner_label = ?, is_active = ?, updated_at = ? WHERE id = ?`)
      .run(cleanName, uniqueDropSlug(cleanName, id), String(description || '').trim(), bannerUrl === undefined ? current.banner_url : (String(bannerUrl || '').trim() || null), String(bannerLabel || '').trim() || null, isActive ? 1 : 0, nowSql(), Number(id));
    if (current.name !== cleanName) {
      db.prepare('UPDATE products SET collection_name = ?, updated_at = ? WHERE collection_name = ?')
        .run(cleanName, nowSql(), current.name);
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) { /* no-op */ }
    throw error;
  }
}

function archiveDrop(id) {
  const current = getDropById(id);
  if (!current) throw new Error('Drop não encontrado.');
  db.prepare('UPDATE drops SET is_active = 0, updated_at = ? WHERE id = ?').run(nowSql(), Number(id));
}

function moveDrop(id, direction) {
  const current = getDropById(id);
  if (!current) throw new Error('Drop não encontrado.');
  const comparator = direction === 'up' ? '<' : '>';
  const orderBy = direction === 'up' ? 'sort_order DESC, id DESC' : 'sort_order ASC, id ASC';
  const neighbor = db.prepare(`SELECT * FROM drops WHERE sort_order ${comparator} ? ORDER BY ${orderBy} LIMIT 1`).get(current.sort_order);
  if (!neighbor) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    const now = nowSql();
    db.prepare('UPDATE drops SET sort_order = ?, updated_at = ? WHERE id = ?').run(neighbor.sort_order, now, current.id);
    db.prepare('UPDATE drops SET sort_order = ?, updated_at = ? WHERE id = ?').run(current.sort_order, now, neighbor.id);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) { /* no-op */ }
    throw error;
  }
}

function syncDropsFromProducts() {
  const rows = db.prepare(`SELECT DISTINCT collection_name FROM products
    WHERE trim(collection_name) != '' ORDER BY CASE WHEN collection_name = 'Drop 01' THEN 0 ELSE 1 END, collection_name`).all();
  rows.forEach((row) => {
    const exists = db.prepare('SELECT id FROM drops WHERE lower(name) = lower(?)').get(row.collection_name);
    if (!exists) createDrop({ name: row.collection_name, description: '' });
  });
  const drop01 = db.prepare("SELECT id FROM drops WHERE lower(name) = lower('Drop 01')").get();
  if (drop01) db.prepare('UPDATE drops SET sort_order = 1 WHERE id = ?').run(drop01.id);
}

function createProduct({ name, description, category, collectionName, priceCents, compareAtCents, featured, active, images, variants }) {
  let baseSlug = slugify(name);
  let slug = baseSlug;
  let number = 2;
  while (db.prepare('SELECT id FROM products WHERE slug = ?').get(slug)) slug = `${baseSlug}-${number++}`;
  const created = nowSql();
  const info = db.prepare(`INSERT INTO products
    (name, slug, description, category, collection_name, price_cents, compare_at_cents, is_featured, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(name, slug, description, category, collectionName, priceCents, compareAtCents || null, featured ? 1 : 0, active ? 1 : 0, created, created);

  const productId = info.lastInsertRowid;
  const imageStmt = db.prepare('INSERT INTO product_images (product_id, image_url, alt_text, sort_order) VALUES (?, ?, ?, ?)');
  images.forEach((image, index) => imageStmt.run(productId, image, name, index));
  const variantStmt = db.prepare('INSERT INTO product_variants (product_id, size, color, sku, stock) VALUES (?, ?, ?, ?, ?)');
  variants.forEach((variant, index) => {
    variantStmt.run(productId, variant.size, variant.color || 'Preto', variant.sku || `NEBLK-${productId}-${index + 1}`, variant.stock || 0);
  });
  return Number(productId);
}

function seedData() {
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@neblk.com.br').toLowerCase();
  const admin = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
  if (!admin) {
    const password = process.env.ADMIN_PASSWORD || 'TroqueEstaSenhaNoPrimeiroAcesso';
    db.prepare('INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('Administrador NEBLK', adminEmail, bcrypt.hashSync(password, 12), 'admin', nowSql());
  }

  const defaults = {
    brand_slogan: 'NEBLK lets you be.',
    instagram_url: 'https://instagram.com/',
    facebook_url: 'https://facebook.com/',
    tiktok_url: '',
    whatsapp_url: '',
    support_email: adminEmail,
    pix_key: process.env.PIX_KEY || 'COLOQUE_SUA_CHAVE_PIX',
    pix_beneficiary: process.env.PIX_BENEFICIARY || 'NEBLK',
    pix_instructions: process.env.PIX_INSTRUCTIONS || 'Após efetuar o Pix, envie o comprovante pelo Instagram ou WhatsApp para validação do pedido.',
    shipping_mode: process.env.SHIPPING_MODE || 'manual',
    shipping_flat_rate: process.env.SHIPPING_FLAT_RATE || '0',
    shipping_free_over: process.env.SHIPPING_FREE_OVER || '0',
    shipping_origin_zip: process.env.SHIPPING_ORIGIN_ZIP || '',
  };
  Object.entries(defaults).forEach(([key, value]) => ensureSetting(key, value));

  const count = db.prepare('SELECT COUNT(*) AS total FROM products').get().total;
  if (count === 0) {
    createProduct({
      name: 'Oversized Purple Web',
      description: 'Camiseta oversized preta em algodão premium, com arte frontal em roxo e verde inspirada em teias urbanas. Modelagem ampla e caimento streetwear.',
      category: 'Camisetas', collectionName: 'Drop 01', priceCents: 15990, compareAtCents: 17990,
      featured: true, active: true,
      images: ['/assets/products/purple-web.svg', '/assets/products/circuit-violet.svg'],
      variants: [{ size: 'P', stock: 8 }, { size: 'M', stock: 12 }, { size: 'G', stock: 10 }, { size: 'GG', stock: 5 }],
    });
    createProduct({
      name: 'Dragon Rose Backprint',
      description: 'Peça oversized com arte de dragão em rosa queimado aplicada nas costas. Feita para compor visuais pesados, minimalistas e autorais.',
      category: 'Camisetas', collectionName: 'Dragon Series', priceCents: 16990, compareAtCents: null,
      featured: true, active: true,
      images: ['/assets/products/dragon-rose.svg', '/assets/products/neon-stroke.svg'],
      variants: [{ size: 'P', stock: 4 }, { size: 'M', stock: 9 }, { size: 'G', stock: 7 }, { size: 'GG', stock: 3 }],
    });
    createProduct({
      name: 'Essential Signature',
      description: 'A camiseta essencial da NEBLK. Logo discreta, tecido encorpado e modelagem que funciona com qualquer composição.',
      category: 'Essentials', collectionName: 'Essentials', priceCents: 12990, compareAtCents: null,
      featured: true, active: true,
      images: ['/assets/products/essential-pink.svg', '/assets/products/shadow-logo.svg'],
      variants: [{ size: 'P', stock: 14 }, { size: 'M', stock: 18 }, { size: 'G', stock: 12 }, { size: 'GG', stock: 6 }],
    });
    createProduct({
      name: 'Circuit Violet Tee',
      description: 'Estampa técnica em violeta e verde, construída para o drop que conecta textura urbana, código e identidade.',
      category: 'Camisetas', collectionName: 'Drop 01', priceCents: 15990, compareAtCents: null,
      featured: false, active: true,
      images: ['/assets/products/circuit-violet.svg'],
      variants: [{ size: 'P', stock: 6 }, { size: 'M', stock: 11 }, { size: 'G', stock: 9 }, { size: 'GG', stock: 4 }],
    });
  }

  syncDropsFromProducts();

  const { start, end } = monthBounds();
  const goal = db.prepare('SELECT id FROM sales_goals WHERE start_date = ? AND end_date = ?').get(start, end);
  if (!goal) {
    db.prepare('INSERT INTO sales_goals (title, target_cents, start_date, end_date, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('Meta de faturamento mensal', 2000000, start, end, nowSql());
  }
}

initializeSchema();
seedData();

function getSettings() {
  const rows = db.prepare('SELECT setting_key, setting_value FROM settings').all();
  return Object.fromEntries(rows.map((row) => [row.setting_key, row.setting_value]));
}

function setSetting(key, value) {
  db.prepare(`INSERT INTO settings (setting_key, setting_value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at`)
    .run(key, String(value ?? ''), nowSql());
}

// ----------------------------------------------------
// NOVAS FUNÇÕES: Suporte ao Login Social
// ----------------------------------------------------

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
}

function getUserByProvider(provider, providerId) {
  return db.prepare('SELECT * FROM users WHERE provider = ? AND provider_id = ?').get(provider, providerId);
}

function createUser({ name, email, passwordHash, provider = 'local', provider_id = null }) {
  // Para evitar erros de restrição (NOT NULL) em bancos de dados antigos gerados antes da migração, 
  // enviamos uma senha fictícia (nunca acessível) caso seja um login via rede social.
  const safeHash = passwordHash || 'OAUTH_USER_NO_PASSWORD';
  
  const info = db.prepare(`
    INSERT INTO users (name, email, password_hash, provider, provider_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, email, safeHash, provider, provider_id, nowSql());

  return getUserById(info.lastInsertRowid);
}

module.exports = {
  db,
  nowSql,
  slugify,
  getSettings,
  setSetting,
  monthBounds,
  getDrops,
  getDropById,
  createDrop,
  updateDrop,
  archiveDrop,
  moveDrop,
  getUserById,
  getUserByProvider,
  createUser
};