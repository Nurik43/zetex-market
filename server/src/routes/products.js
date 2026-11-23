import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { db } from '../db.js';
import { requireAuth, requireRole, optionalAuth } from '../auth.js';
import { removeUploadIfUnused } from './uploads.js';
import { CATEGORIES, HttpError, parse, searchText, toProduct } from '../util.js';
import { TAXONOMY, isValidSub } from '../taxonomy.js';
import { placeholderFor } from '../placeholder.js';
import { parseCsv, csvCell } from '../csv.js';
import { notifyReport, notifyAdmin } from '../notify.js';
import { moderationMode } from '../settings.js';

const router = Router();

const bool = z.enum(['1', 'true', '0', 'false']).transform((v) => v === '1' || v === 'true');

const listSchema = z.object({
  q: z.string().trim().max(100).default(''),
  category: z.string().trim().max(60).default(''),
  subcategory: z.string().trim().max(80).default(''),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  inStock: bool.optional(),
  ids: z.string().trim().max(300).regex(/^[\d,]*$/, 'ids: числа через запятую').default(''),
  sort: z.enum(['new', 'price_asc', 'price_desc', 'rating', 'popular']).default('new'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

const ORDER_BY = {
  new: 'created_at DESC, id DESC',
  price_asc: 'price ASC, id DESC',
  price_desc: 'price DESC, id DESC',
  rating: 'rating DESC, reviews DESC, id DESC',
  popular: 'reviews DESC, rating DESC, id DESC',
};

// Экранируем спецсимволы LIKE, чтобы поиск "50%" искал буквально
const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => '\\' + c);

function buildWhere(f, { skip = [] } = {}) {
  const where = ["status = 'active'"]; // скрытые модератором товары в витрину не попадают
  const args = [];
  if (f.q && !skip.includes('q')) {
    where.push(`search LIKE ? ESCAPE '\\'`);
    args.push(`%${likeEscape(f.q.toLowerCase())}%`);
  }
  if (f.category && f.category !== 'Все товары' && !skip.includes('category')) { where.push('category = ?'); args.push(f.category); }
  if (f.subcategory && !skip.includes('subcategory')) { where.push('subcategory = ?'); args.push(f.subcategory); }
  if (f.minPrice !== undefined) { where.push('price >= ?'); args.push(f.minPrice); }
  if (f.maxPrice !== undefined) { where.push('price <= ?'); args.push(f.maxPrice); }
  if (f.minRating !== undefined) { where.push('rating >= ? AND reviews > 0'); args.push(f.minRating); }
  if (f.inStock) where.push('stock > 0');
  if (f.ids) {
    const ids = f.ids.split(',').filter(Boolean).map(Number).slice(0, 50);
    where.push(`id IN (${ids.map(() => '?').join(',') || 'NULL'})`);
    args.push(...ids);
  }
  return { w: `WHERE ${where.join(' AND ')}`, args };
}

router.get('/', (req, res) => {
  const f = parse(listSchema, req.query);
  const { w, args } = buildWhere(f);
  const total = db.prepare(`SELECT COUNT(*) c FROM products ${w}`).get(...args).c;
  const rows = db.prepare(`SELECT * FROM products ${w} ORDER BY ${ORDER_BY[f.sort]} LIMIT ? OFFSET ?`)
    .all(...args, f.limit, (f.page - 1) * f.limit);
  res.json({ items: rows.map(toProduct), total, page: f.page, pages: Math.max(1, Math.ceil(total / f.limit)) });
});

// Данные для боковых фильтров: счётчики по категориям/подкатегориям и границы цены
router.get('/meta', (req, res) => {
  const f = parse(listSchema.pick({ q: true, category: true }), req.query);
  const { w, args } = buildWhere({ q: f.q }, {});
  const cats = db.prepare(`SELECT category c, COUNT(*) n FROM products ${w} GROUP BY category`).all(...args);
  const subs = db.prepare(`SELECT category c, subcategory s, COUNT(*) n FROM products ${w} AND subcategory != '' GROUP BY category, subcategory`).all(...args);
  const scope = buildWhere({ q: f.q, category: f.category });
  const range = db.prepare(`SELECT COALESCE(MIN(price), 0) lo, COALESCE(MAX(price), 0) hi, COUNT(*) n FROM products ${scope.w}`).get(...scope.args);
  res.json({
    total: cats.reduce((s, r) => s + r.n, 0),
    categories: Object.fromEntries(cats.map((r) => [r.c, r.n])),
    subcategories: Object.fromEntries(subs.map((r) => [`${r.c}|${r.s}`, r.n])),
    minPrice: range.lo,
    maxPrice: range.hi,
  });
});

// Подсказки при вводе в поиск: несколько товаров и подходящие разделы каталога
router.get('/suggest', (req, res) => {
  const { q } = parse(z.object({ q: z.string().trim().min(1).max(60) }), req.query);
  const needle = q.toLowerCase();
  const rows = db.prepare(`SELECT * FROM products WHERE status = 'active' AND search LIKE ? ESCAPE '\\' ORDER BY reviews DESC, id DESC LIMIT 5`)
    .all(`%${likeEscape(needle)}%`);
  const sections = [];
  for (const cat of TAXONOMY) {
    if (cat.name.toLowerCase().includes(needle)) sections.push({ category: cat.name, subcategory: '' });
    for (const g of cat.groups) {
      for (const sub of g.items) if (sub.toLowerCase().includes(needle)) sections.push({ category: cat.name, subcategory: sub });
    }
  }
  res.json({
    products: rows.map((r) => ({ id: r.id, title: r.title, price: r.price, image: r.image, category: r.category })),
    sections: sections.slice(0, 4),
  });
});

// Товары текущего продавца (до маршрута /:id, чтобы 'mine' не принимался за id)
router.get('/mine/list', requireAuth, requireRole('seller'), (req, res) => {
  const rows = db.prepare('SELECT * FROM products WHERE seller_id = ? ORDER BY id DESC').all(req.user.id);
  res.json({ items: rows.map(toProduct) });
});

router.get('/categories', (_req, res) => res.json({ categories: CATEGORIES, tree: TAXONOMY }));

// ---------- Валидация товара ----------
// Фото: путь загруженного файла (/uploads/<id>.jpg) либо внешняя https-ссылка
const image = z.string().min(1).max(500).refine(
  (v) => /^\/uploads\/[a-f0-9]{32}\.(jpg|png|webp|gif|svg)$/.test(v) || /^https?:\/\/[^\s]+$/.test(v),
  'загрузите фото через форму (путь /uploads/…)',
);

const productSchema = z.object({
  title: z.string().trim().min(3, 'минимум 3 символа').max(200),
  description: z.string().trim().max(5000).default(''),
  category: z.enum(CATEGORIES),
  subcategory: z.string().trim().max(80).default(''),
  price: z.coerce.number().int().positive('цена должна быть больше 0').max(2_000_000_000),
  oldPrice: z.coerce.number().int().positive().max(2_000_000_000).nullish(),
  monthlyPrice: z.string().trim().max(50).nullish(),
  badge: z.string().trim().max(30).nullish(),
  image,
  images: z.array(image).max(7, 'не больше 7 дополнительных фото').default([]),
  specs: z.array(z.object({
    name: z.string().trim().min(1).max(60),
    value: z.string().trim().min(1).max(200),
  })).max(30, 'не больше 30 характеристик').default([]),
  stock: z.coerce.number().int().min(0).max(1_000_000).default(100),
})
  .refine((d) => isValidSub(d.category, d.subcategory), { path: ['subcategory'], message: 'подкатегория не относится к выбранной категории' })
  .refine((d) => !d.oldPrice || d.oldPrice > d.price, { path: ['oldPrice'], message: 'старая цена должна быть выше текущей' });

const cols = (d) => [d.title, d.description, d.category, d.subcategory, d.price, d.oldPrice ?? null, d.monthlyPrice ?? null, d.badge ?? null,
  d.image, JSON.stringify(d.images), JSON.stringify(d.specs), d.stock, searchText(d.title, d.category, d.description, d.subcategory)];

const INSERT = `INSERT INTO products (seller_id, title, description, category, subcategory, price, old_price, monthly_price, badge, image, images, specs, stock, search)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const UPDATE = `UPDATE products SET title=?, description=?, category=?, subcategory=?, price=?, old_price=?, monthly_price=?, badge=?,
  image=?, images=?, specs=?, stock=?, search=? WHERE id = ?`;

// Новый товар сразу в каталоге или на проверке — по режиму модерации из настроек админки
const needsReview = (sellerId) => {
  const mode = moderationMode();
  if (mode === 'all') return true;
  if (mode !== 'new_sellers') return false;
  return !db.prepare('SELECT trusted FROM users WHERE id = ?').get(sellerId)?.trusted;
};
const markPending = (id, title) => {
  db.prepare("UPDATE products SET status = 'pending' WHERE id = ?").run(id);
  notifyAdmin(`🆕 Новый товар на проверке: «${title}» (id ${id}).`);
};

router.post('/', requireAuth, requireRole('seller'), (req, res) => {
  const d = parse(productSchema, req.body);
  const info = db.prepare(INSERT).run(req.user.id, ...cols(d));
  if (needsReview(req.user.id)) markPending(info.lastInsertRowid, d.title);
  res.status(201).json({ product: toProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid)) });
});

// ---------- Импорт из CSV ----------
const HEADERS = {
  title: ['title', 'название', 'наименование'],
  category: ['category', 'категория'],
  subcategory: ['subcategory', 'подкатегория'],
  price: ['price', 'цена'],
  oldPrice: ['old_price', 'oldprice', 'старая цена'],
  stock: ['stock', 'остаток', 'количество'],
  description: ['description', 'описание'],
  image: ['image', 'image_url', 'фото', 'изображение'],
};
const TEMPLATE = ['title', 'category', 'subcategory', 'price', 'old_price', 'stock', 'description', 'image'];

router.get('/import/template', (_req, res) => {
  const sample = ['Смартфон Samsung Galaxy A55', 'Электроника', 'Смартфоны', 3990000, 4590000, 25, 'Экран 6,6", 8/256 ГБ', 'https://example.com/photo.jpg'];
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="zetex-import-template.csv"' });
  res.send('﻿' + [TEMPLATE, sample].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n');
});

const importSchema = z.object({ csv: z.string().min(1, 'файл пустой').max(900_000), dryRun: z.boolean().default(false) });
const toInt = (v) => {
  const s = String(v ?? '').replace(/[\s\u00a0]/g, '').replace(',', '.');
  if (s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : NaN;
};

router.post('/import', requireAuth, requireRole('seller'), (req, res) => {
  const { csv, dryRun } = parse(importSchema, req.body);
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new HttpError(400, 'В файле нет строк с товарами');
  if (rows.length - 1 > 500) throw new HttpError(400, 'Не больше 500 товаров за один импорт');

  const head = rows[0].map((h) => h.trim().toLowerCase());
  const idx = {};
  for (const [key, names] of Object.entries(HEADERS)) idx[key] = head.findIndex((h) => names.includes(h));
  for (const req_ of ['title', 'category', 'price']) {
    if (idx[req_] < 0) throw new HttpError(400, `Не найдена колонка «${HEADERS[req_][0]}»`);
  }

  const mine = new Map(db.prepare('SELECT id, title FROM products WHERE seller_id = ?').all(req.user.id).map((p) => [p.title.toLowerCase(), p.id]));
  const catByLower = new Map(CATEGORIES.map((c) => [c.toLowerCase(), c]));
  const result = { created: 0, updated: 0, errors: [], dryRun };

  const run = () => rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const get = (k) => (idx[k] >= 0 ? (r[idx[k]] ?? '').trim() : '');
    try {
      const category = catByLower.get(get('category').toLowerCase());
      if (!category) throw new Error(`неизвестная категория «${get('category')}»`);
      const price = toInt(get('price'));
      const oldPrice = toInt(get('oldPrice'));
      const stock = toInt(get('stock'));
      if (Number.isNaN(price) || Number.isNaN(oldPrice) || Number.isNaN(stock)) throw new Error('цена, старая цена и остаток должны быть числами');
      const img = get('image');
      if (img && !/^https?:\/\/[^\s]+$/.test(img)) throw new Error('фото: нужна ссылка вида https://…');

      const title = get('title');
      let imagePath = img;
      if (!imagePath) {
        // без ссылки делаем картинку-заглушку, продавец заменит её в кабинете
        const { name, svg } = placeholderFor(title || 'товар', get('subcategory') || category, 0);
        imagePath = `/uploads/${name}`;
        if (!dryRun) fs.writeFileSync(path.join(config.uploadDir, name), svg);
      }
      const d = parse(productSchema, {
        title, category, subcategory: get('subcategory'), price, oldPrice: oldPrice || null,
        stock: stock ?? 100, description: get('description'), image: imagePath,
      });
      const existing = mine.get(d.title.toLowerCase());
      if (!dryRun) {
        if (existing) db.prepare(UPDATE).run(...cols(d), existing);
        else {
          const nid = db.prepare(INSERT).run(req.user.id, ...cols(d)).lastInsertRowid;
          mine.set(d.title.toLowerCase(), nid);
          if (needsReview(req.user.id)) db.prepare("UPDATE products SET status = 'pending' WHERE id = ?").run(nid);
        }
      }
      existing ? result.updated++ : result.created++;
    } catch (e) {
      result.errors.push({ row: line, error: String(e.message).replace(/^[a-zA-Z.]+: /, (m) => m) });
    }
  });

  if (dryRun) run();
  else { db.exec('BEGIN'); try { run(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } }
  res.json(result);
});

// ---------- Один товар ----------
function ownProduct(req) {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id));
  if (!row) throw new HttpError(404, 'Товар не найден');
  if (row.seller_id !== req.user.id) throw new HttpError(403, 'Это не ваш товар');
  return row;
}

const galleryOf = (row) => { try { return [row.image, ...JSON.parse(row.images || '[]')]; } catch { return [row.image]; } };

router.get('/:id/related', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id));
  if (!p) throw new HttpError(404, 'Товар не найден');
  // сначала та же подкатегория, потом остальная категория
  const rows = db.prepare(`
    SELECT * FROM products WHERE status = 'active' AND id != ? AND category = ?
    ORDER BY (subcategory = ? AND subcategory != '') DESC, reviews DESC, id DESC LIMIT 8`).all(p.id, p.category, p.subcategory);
  res.json({ items: rows.map(toProduct) });
});

router.post('/:id/report', requireAuth, rateLimit({
  windowMs: 60 * 60 * 1000, limit: process.env.NODE_ENV === 'test' ? 10_000 : 10,
  message: { error: 'Слишком много жалоб. Попробуйте позже.' },
}), (req, res) => {
  const d = parse(z.object({
    reason: z.enum(['spam', 'prohibited', 'fake', 'wrong', 'other']),
    text: z.string().trim().max(1000).default(''),
  }), req.body);
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(id)) throw new HttpError(404, 'Товар не найден');
  if (db.prepare("SELECT 1 FROM reports WHERE product_id = ? AND user_id = ? AND status = 'open'").get(id, req.user.id)) {
    throw new HttpError(409, 'Вы уже отправили жалобу на этот товар — мы её рассматриваем');
  }
  const info = db.prepare('INSERT INTO reports (product_id, user_id, reason, text) VALUES (?, ?, ?, ?)').run(id, req.user.id, d.reason, d.text);
  notifyReport(info.lastInsertRowid);
  res.status(201).json({ ok: true });
});

router.get('/:id', optionalAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id));
  const canSeeHidden = req.user && (req.user.role === 'admin' || req.user.id === row?.seller_id);
  if (!row || (row.status !== 'active' && !canSeeHidden)) throw new HttpError(404, 'Товар не найден');
  res.json({ product: toProduct(row) });
});

router.put('/:id', requireAuth, requireRole('seller'), (req, res) => {
  const old = ownProduct(req);
  const d = parse(productSchema, req.body);
  db.prepare(UPDATE).run(...cols(d), Number(req.params.id));
  // удаляем файлы, которые больше нигде не используются
  const keep = new Set([d.image, ...d.images]);
  for (const f of galleryOf(old)) if (!keep.has(f)) removeUploadIfUnused(db, f);
  res.json({ product: toProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id))) });
});

router.delete('/:id', requireAuth, requireRole('seller'), (req, res) => {
  const old = ownProduct(req);
  db.prepare('DELETE FROM products WHERE id = ?').run(Number(req.params.id));
  for (const f of galleryOf(old)) removeUploadIfUnused(db, f);
  res.json({ ok: true });
});

export default router;
