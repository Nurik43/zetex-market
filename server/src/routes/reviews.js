import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth, requireRole, optionalAuth } from '../auth.js';
import { HttpError, parse } from '../util.js';

const router = Router();

/** Рейтинг и число отзывов товара считаются только из настоящих отзывов. */
export function recalcRating(productId) {
  const r = db.prepare('SELECT COUNT(*) n, AVG(rating) a FROM reviews WHERE product_id = ?').get(productId);
  db.prepare('UPDATE products SET rating = ?, reviews = ? WHERE id = ?').run(r.n ? Math.round(r.a * 10) / 10 : 0, r.n, productId);
}

const hasDelivered = (userId, productId) => !!db.prepare(`
  SELECT 1 FROM order_items i JOIN orders o ON o.id = i.order_id
  WHERE o.buyer_id = ? AND i.product_id = ? AND o.status = 'delivered' LIMIT 1`).get(userId, productId);

const shortName = (first, last) => `${first}${last ? ` ${last[0]}.` : ''}`;

router.get('/products/:id/reviews', optionalAuth, (req, res) => {
  const pid = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(pid)) throw new HttpError(404, 'Товар не найден');
  const { page, limit } = parse(z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(10),
  }), req.query);

  const rows = db.prepare(`
    SELECT r.*, u.first_name, u.last_name FROM reviews r JOIN users u ON u.id = r.user_id
    WHERE r.product_id = ? ORDER BY r.id DESC LIMIT ? OFFSET ?`).all(pid, limit, (page - 1) * limit);
  const agg = db.prepare('SELECT COUNT(*) n, AVG(rating) a FROM reviews WHERE product_id = ?').get(pid);
  const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const b of db.prepare('SELECT rating, COUNT(*) n FROM reviews WHERE product_id = ? GROUP BY rating').all(pid)) breakdown[b.rating] = b.n;

  const mine = req.user ? db.prepare('SELECT id FROM reviews WHERE product_id = ? AND user_id = ?').get(pid, req.user.id) : null;
  res.json({
    items: rows.map((r) => ({
      id: r.id, rating: r.rating, text: r.text, createdAt: r.created_at,
      author: shortName(r.first_name, r.last_name),
      reply: r.reply, repliedAt: r.replied_at,
      mine: req.user?.id === r.user_id,
    })),
    total: agg.n,
    average: agg.n ? Math.round(agg.a * 10) / 10 : 0,
    breakdown,
    // отзыв можно оставить после получения заказа, один на товар
    canReview: !!req.user && req.user.role === 'buyer' && !mine && hasDelivered(req.user.id, pid),
    myReviewId: mine?.id ?? null,
  });
});

const reviewSchema = z.object({
  rating: z.coerce.number().int().min(1, 'поставьте оценку от 1 до 5').max(5),
  text: z.string().trim().max(2000).default(''),
});

router.post('/products/:id/reviews', requireAuth, requireRole('buyer'), (req, res) => {
  const pid = Number(req.params.id);
  const d = parse(reviewSchema, req.body);
  if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(pid)) throw new HttpError(404, 'Товар не найден');
  if (!hasDelivered(req.user.id, pid)) throw new HttpError(403, 'Оставить отзыв можно после получения товара');
  if (db.prepare('SELECT 1 FROM reviews WHERE product_id = ? AND user_id = ?').get(pid, req.user.id)) {
    throw new HttpError(409, 'Вы уже оставили отзыв на этот товар');
  }
  const info = db.prepare('INSERT INTO reviews (product_id, user_id, rating, text) VALUES (?, ?, ?, ?)').run(pid, req.user.id, d.rating, d.text);
  recalcRating(pid);
  res.status(201).json({ id: info.lastInsertRowid });
});

function loadReview(req) {
  const r = db.prepare('SELECT * FROM reviews WHERE id = ?').get(Number(req.params.id));
  if (!r) throw new HttpError(404, 'Отзыв не найден');
  return r;
}

router.patch('/reviews/:id', requireAuth, (req, res) => {
  const r = loadReview(req);
  if (r.user_id !== req.user.id) throw new HttpError(403, 'Это не ваш отзыв');
  const d = parse(reviewSchema, req.body);
  db.prepare('UPDATE reviews SET rating = ?, text = ? WHERE id = ?').run(d.rating, d.text, r.id);
  recalcRating(r.product_id);
  res.json({ ok: true });
});

router.delete('/reviews/:id', requireAuth, (req, res) => {
  const r = loadReview(req);
  if (r.user_id !== req.user.id && req.user.role !== 'admin') throw new HttpError(403, 'Недостаточно прав');
  db.prepare('DELETE FROM reviews WHERE id = ?').run(r.id);
  recalcRating(r.product_id);
  res.json({ ok: true });
});

// Продавец отвечает на отзыв о своём товаре
router.post('/reviews/:id/reply', requireAuth, requireRole('seller'), (req, res) => {
  const r = loadReview(req);
  const p = db.prepare('SELECT seller_id FROM products WHERE id = ?').get(r.product_id);
  if (p?.seller_id !== req.user.id) throw new HttpError(403, 'Это отзыв не о вашем товаре');
  const { text } = parse(z.object({ text: z.string().trim().min(1, 'введите ответ').max(1000) }), req.body);
  db.prepare("UPDATE reviews SET reply = ?, replied_at = datetime('now') WHERE id = ?").run(text, r.id);
  res.json({ ok: true });
});

export default router;
