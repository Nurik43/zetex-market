import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { db } from './db.js';
import { config } from './config.js';
import { searchText } from './util.js';
import { TAXONOMY, LEGACY_SUB_BY_TITLE } from './taxonomy.js';
import { DEMO } from './demo-catalog.js';
import { placeholderFor } from './placeholder.js';

// Категории из старого mock-файла приводим к категориям каталога
const CATEGORY_MAP = { 'Игрушки': 'Детские товары', 'Спорт': 'Спорт и отдых', 'Красота': 'Красота и уход' };

/** Заполняет пустую БД демо-аккаунтами и товарами из products.json. */
export function seedIfEmpty() {
  if (!config.seedDemo) return false; // в production демо-аккаунтов с известными паролями не создаём
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) return false;

  const insUser = db.prepare(`
    INSERT INTO users (email, password_hash, role, first_name, last_name, phone, birth_date, gender, email_verified)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`);
  insUser.run('info@zetex.uz', bcrypt.hashSync('Password123!', 10), 'buyer', 'Нурик', 'К', '+998 (99) 970-67-05', '2005-08-02', 'Мужской');
  const seller = insUser.run('seller@zetex.uz', bcrypt.hashSync('SellerPassword123', 10), 'seller', 'Продавец', 'Zetex', '+998 (99) 111-22-33', '1995-01-01', 'Мужской');

  const file = new URL('../../src/mock/products.json', import.meta.url);
  const products = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  const ins = db.prepare(`
    INSERT INTO products (seller_id, title, description, category, price, monthly_price, badge, image, rating, reviews, stock, search)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const p of products) {
    p.category = CATEGORY_MAP[p.category] || p.category;
    ins.run(seller.lastInsertRowid, p.title, p.description || '', p.category, p.price, p.monthlyPrice || null,
      p.badge || null, p.image, p.rating || 0, p.reviews || 0, 100, searchText(p.title, p.category, p.description || ''));
  }
  return true;
}

const DEMO_VERSION = '3';

/**
 * Один раз (по версии в таблице meta) расставляет подкатегории у старых товаров
 * и добавляет демо-каталог. Повторный запуск ничего не делает, поэтому удалённые
 * продавцом демо-товары не возвращаются.
 */
export function ensureDemoCatalog() {
  if (!config.seedDemo) return 0;
  const done = db.prepare("SELECT value FROM meta WHERE key = 'demo_catalog'").get();
  if (done && done.value >= DEMO_VERSION) return 0;
  const seller = db.prepare("SELECT id FROM users WHERE email = 'seller@zetex.uz'").get();
  if (!seller) return 0;

  // 1) подкатегории для существующих товаров
  const old = db.prepare("SELECT id, title FROM products WHERE subcategory = ''").all();
  for (const p of old) {
    const hit = LEGACY_SUB_BY_TITLE.find(([re]) => re.test(p.title));
    if (hit) db.prepare('UPDATE products SET subcategory = ?, search = search || ? WHERE id = ?').run(hit[1], ' ' + hit[1].toLowerCase(), p.id);
  }

  // 2) демо-товары
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const exists = db.prepare('SELECT 1 FROM products WHERE title = ?');
  const ins = db.prepare(`
    INSERT INTO products (seller_id, title, description, category, subcategory, price, monthly_price, badge, image, rating, reviews, stock, search)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let added = 0;
  TAXONOMY.forEach((cat, ci) => {
    for (const group of cat.groups) {
      for (const sub of group.items) {
        for (const [title, price] of DEMO[sub] || []) {
          if (exists.get(title)) continue;
          const { name, svg } = placeholderFor(title, sub, ci);
          fs.writeFileSync(path.join(config.uploadDir, name), svg);
          const n = parseInt(title.length.toString() + price.toString().slice(0, 2), 10);
          const rating = Math.round((4.2 + (n % 9) / 10) * 10) / 10;
          const reviews = 3 + ((n * 37) % 380);
          const monthly = price >= 1_000_000 ? `${(Math.round(price / 12 / 1000) * 1000).toLocaleString('ru-RU')} сум/мес` : null;
          ins.run(seller.id, title, '', cat.name, sub, price, monthly, null, `/uploads/${name}`,
            Math.min(rating, 5), reviews, 20 + (n % 80), searchText(title, cat.name, sub));
          added++;
        }
      }
    }
  });
  // 3) у демо-товаров с пометкой акции есть настоящая старая цена
  db.prepare(`UPDATE products SET old_price = CAST(ROUND(price * 1.2 / 1000.0) AS INTEGER) * 1000
    WHERE old_price IS NULL AND badge IN ('Распродажа', 'Скидка', 'Акция') AND price >= 10000`).run();
  db.prepare("INSERT INTO meta (key, value) VALUES ('demo_catalog', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(DEMO_VERSION);
  return added;
}

/**
 * Администратор: из ADMIN_EMAIL / ADMIN_PASSWORD; вне production без них создаётся демо-аккаунт.
 * Если администратор уже есть — ничего не делает.
 */
export function ensureAdmin() {
  if (db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get()) return null;
  let email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  let pw = process.env.ADMIN_PASSWORD || '';
  if (!email || !pw) {
    if (config.isProd) return null;
    email = 'admin@zetex.uz'; pw = 'Admin12345!';
  }
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    console.warn(`ADMIN_EMAIL ${email} уже занят обычным аккаунтом — администратор не создан`);
    return null;
  }
  db.prepare(`INSERT INTO users (email, password_hash, role, first_name, last_name, email_verified) VALUES (?, ?, 'admin', 'Администратор', 'Zetex', 1)`)
    .run(email, bcrypt.hashSync(pw, 10));
  return email;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(seedIfEmpty() ? 'Seeded demo accounts' : 'DB is not empty, skipped');
  console.log(`Demo catalog: +${ensureDemoCatalog()} products`);
}
