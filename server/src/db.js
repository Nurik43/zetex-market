import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

export const db = new DatabaseSync(config.dbFile);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

const USER_COLS = ['id', 'email', 'password_hash', 'role', 'first_name', 'last_name', 'middle_name', 'phone', 'birth_date', 'gender',
  'company_name', 'inn', 'email_verified', 'blocked', 'token_version', 'telegram_chat_id', 'telegram_code', 'created_at'];

const usersDDL = (name) => `
CREATE TABLE IF NOT EXISTS ${name} (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  email            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash    TEXT NOT NULL,
  role             TEXT NOT NULL CHECK (role IN ('buyer','seller','admin')),
  first_name       TEXT NOT NULL,
  last_name        TEXT NOT NULL,
  middle_name      TEXT NOT NULL DEFAULT '',
  phone            TEXT NOT NULL DEFAULT '',
  birth_date       TEXT NOT NULL DEFAULT '',
  gender           TEXT NOT NULL DEFAULT '',
  company_name     TEXT NOT NULL DEFAULT '',
  inn              TEXT NOT NULL DEFAULT '',
  email_verified   INTEGER NOT NULL DEFAULT 0,
  blocked          INTEGER NOT NULL DEFAULT 0,
  token_version    INTEGER NOT NULL DEFAULT 0,
  telegram_chat_id TEXT NOT NULL DEFAULT '',
  telegram_code    TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);`;

const usersSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get()?.sql;
if (!usersSql) {
  db.exec(usersDDL('users'));
} else if (!usersSql.includes("'admin'")) {
  // Старая база: роль admin и новые колонки требуют пересоздания таблицы (CHECK нельзя изменить через ALTER)
  const old = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  const copy = USER_COLS.filter((c) => old.includes(c));
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(usersDDL('users_new'));
    // все уже существующие аккаунты считаем подтверждёнными: раньше проверки почты не было
    db.exec(`INSERT INTO users_new (${copy.join(', ')}, email_verified) SELECT ${copy.join(', ')}, 1 FROM users`);
    db.exec('DROP TABLE users');
    db.exec('ALTER TABLE users_new RENAME TO users');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL,
  price         INTEGER NOT NULL CHECK (price > 0),
  monthly_price TEXT,
  badge         TEXT,
  image         TEXT NOT NULL,
  rating        REAL NOT NULL DEFAULT 0,
  reviews       INTEGER NOT NULL DEFAULT 0,
  stock         INTEGER NOT NULL DEFAULT 100 CHECK (stock >= 0),
  search        TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_seller ON products(seller_id);

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS favorites (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL UNIQUE,
  buyer_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total      INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending','confirmed','shipped','delivered','cancelled')),
  address    TEXT NOT NULL DEFAULT '',
  comment    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id);

CREATE TABLE IF NOT EXISTS order_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  seller_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title      TEXT NOT NULL,
  image      TEXT NOT NULL,
  price      INTEGER NOT NULL,
  qty        INTEGER NOT NULL CHECK (qty > 0)
);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_items_seller ON order_items(seller_id);
`);

// Миграции для уже существующих баз
if (!db.prepare('PRAGMA table_info(products)').all().some((c) => c.name === 'subcategory')) {
  db.exec("ALTER TABLE products ADD COLUMN subcategory TEXT NOT NULL DEFAULT ''");
}
db.exec('CREATE INDEX IF NOT EXISTS idx_products_sub ON products(category, subcategory)');

const addColumn = (table, col, ddl) => {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
  }
};

// Товары: старая цена, дополнительные фото, характеристики, модерация
addColumn('users', 'terms_accepted_at', "TEXT NOT NULL DEFAULT ''"); // когда пользователь принял условия при регистрации
addColumn('products', 'old_price', 'INTEGER');
addColumn('products', 'images', "TEXT NOT NULL DEFAULT '[]'");
addColumn('products', 'specs', "TEXT NOT NULL DEFAULT '[]'");
addColumn('products', 'status', "TEXT NOT NULL DEFAULT 'active'");
db.exec('CREATE INDEX IF NOT EXISTS idx_products_status ON products(status)');

// Заказы: доставка, оплата, скидки
addColumn('orders', 'delivery_method', "TEXT NOT NULL DEFAULT 'delivery'");
addColumn('orders', 'city', "TEXT NOT NULL DEFAULT ''");
addColumn('orders', 'pickup_point', "TEXT NOT NULL DEFAULT ''");
addColumn('orders', 'phone', "TEXT NOT NULL DEFAULT ''");
addColumn('orders', 'recipient', "TEXT NOT NULL DEFAULT ''");
addColumn('orders', 'payment_method', "TEXT NOT NULL DEFAULT 'cash'");
addColumn('orders', 'payment_status', "TEXT NOT NULL DEFAULT 'cod'");
addColumn('users', 'deleted_at', "TEXT NOT NULL DEFAULT ''"); // аккаунт удалён (данные обезличены)
addColumn('orders', 'subtotal', 'INTEGER NOT NULL DEFAULT 0');
addColumn('orders', 'discount', 'INTEGER NOT NULL DEFAULT 0');
addColumn('orders', 'delivery_fee', 'INTEGER NOT NULL DEFAULT 0');
addColumn('orders', 'promo_code', "TEXT NOT NULL DEFAULT ''");
db.exec('UPDATE orders SET subtotal = total WHERE subtotal = 0');

db.exec(`
CREATE TABLE IF NOT EXISTS reviews (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text       TEXT NOT NULL DEFAULT '',
  reply      TEXT NOT NULL DEFAULT '',
  replied_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (product_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);

CREATE TABLE IF NOT EXISTS promos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  type       TEXT NOT NULL CHECK (type IN ('percent','fixed')),
  value      INTEGER NOT NULL CHECK (value > 0),
  min_total  INTEGER NOT NULL DEFAULT 0,
  max_uses   INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  seller_id  INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('reset','verify')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason     TEXT NOT NULL,
  text       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cart_items (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty        INTEGER NOT NULL CHECK (qty > 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, product_id)
);

-- Переписка покупателя с продавцом. product_id / order_id = 0, если разговор не привязан к товару или заказу
-- (это не внешние ключи: переписка переживает удаление товара)
CREATE TABLE IF NOT EXISTS conversations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  buyer_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id      INTEGER NOT NULL DEFAULT 0,
  order_id        INTEGER NOT NULL DEFAULT 0,
  buyer_read_id   INTEGER NOT NULL DEFAULT 0,
  seller_read_id  INTEGER NOT NULL DEFAULT 0,
  last_message_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (buyer_id, seller_id, product_id, order_id)
);
CREATE INDEX IF NOT EXISTS idx_conv_buyer ON conversations(buyer_id, last_message_at);
CREATE INDEX IF NOT EXISTS idx_conv_seller ON conversations(seller_id, last_message_at);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body            TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS payment_transactions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id          INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL,
  provider_trans_id TEXT NOT NULL,
  state             INTEGER NOT NULL,
  amount            INTEGER NOT NULL,
  create_time       INTEGER NOT NULL,
  perform_time      INTEGER NOT NULL DEFAULT 0,
  cancel_time       INTEGER NOT NULL DEFAULT 0,
  reason            INTEGER,
  UNIQUE (provider, provider_trans_id)
);
CREATE INDEX IF NOT EXISTS idx_pay_order ON payment_transactions(order_id);
`);

/** Транзакция: откатывается при исключении. */
export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---- Админ-панель: журнал, роли, 2FA, настройки, выплаты, история заказов, модерация чатов ----
addColumn('users', 'admin_scope', "TEXT NOT NULL DEFAULT 'full'"); // full | moderator | finance (только для role = admin)
addColumn('users', 'totp_secret', "TEXT NOT NULL DEFAULT ''");
addColumn('users', 'totp_enabled', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'blocked_reason', "TEXT NOT NULL DEFAULT ''");
addColumn('users', 'trusted', 'INTEGER NOT NULL DEFAULT 0'); // проверенный продавец: товары публикуются без модерации
addColumn('products', 'status_reason', "TEXT NOT NULL DEFAULT ''");
addColumn('order_items', 'commission_pct', 'REAL NOT NULL DEFAULT 0'); // комиссия маркетплейса на момент заказа

db.exec(`
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id    INTEGER,
  admin_email TEXT NOT NULL DEFAULT '',
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id   TEXT NOT NULL DEFAULT '',
  reason      TEXT NOT NULL DEFAULT '',
  details     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(id);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_log(target_type, target_id);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS payouts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount     INTEGER NOT NULL CHECK (amount > 0),
  note       TEXT NOT NULL DEFAULT '',
  admin_id   INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payouts_seller ON payouts(seller_id);

CREATE TABLE IF NOT EXISTS order_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  text       TEXT NOT NULL DEFAULT '',
  actor      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_oevents_order ON order_events(order_id, id);

CREATE TABLE IF NOT EXISTS login_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  email      TEXT NOT NULL DEFAULT '',
  ip         TEXT NOT NULL DEFAULT '',
  ua         TEXT NOT NULL DEFAULT '',
  ok         INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_login_user ON login_events(user_id, id);

CREATE TABLE IF NOT EXISTS message_reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (message_id, reporter_id)
);

CREATE TABLE IF NOT EXISTS spam_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_spam_user ON spam_events (user_id, created_at);
`);
db.exec("DELETE FROM spam_events WHERE created_at < datetime('now', '-7 days')");
db.exec("DELETE FROM login_events WHERE created_at < datetime('now', '-90 days')");
