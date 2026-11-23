import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { HttpError, parse } from '../util.js';
import { priceCart } from '../pricing.js';

const router = Router();

const toPromo = (p) => ({
  id: p.id, code: p.code, type: p.type, value: p.value, minTotal: p.min_total,
  maxUses: p.max_uses, usedCount: p.used_count, expiresAt: p.expires_at, active: !!p.active,
  scope: p.seller_id == null ? 'all' : 'seller', createdAt: p.created_at,
});

export const promoSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,20}$/, '3–20 символов: латиница, цифры, - и _'),
  type: z.enum(['percent', 'fixed']),
  value: z.coerce.number().int().positive(),
  minTotal: z.coerce.number().int().min(0).default(0),
  maxUses: z.coerce.number().int().positive().nullish(),
  expiresAt: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'дата в формате ГГГГ-ММ-ДД').nullish().or(z.literal('')),
  active: z.boolean().default(true),
}).refine((d) => d.type !== 'percent' || d.value <= 90, { path: ['value'], message: 'скидка не больше 90%' });

/** Общая логика CRUD: seller_id = null для общих промокодов администратора, иначе id продавца. */
export function createPromo(sellerId, body) {
  const d = parse(promoSchema, body);
  if (db.prepare('SELECT 1 FROM promos WHERE code = ?').get(d.code)) throw new HttpError(409, 'Такой промокод уже существует');
  // срок действует до конца указанного дня
  const exp = d.expiresAt ? `${d.expiresAt} 23:59:59` : null;
  const info = db.prepare('INSERT INTO promos (code, type, value, min_total, max_uses, expires_at, active, seller_id) VALUES (?,?,?,?,?,?,?,?)')
    .run(d.code, d.type, d.value, d.minTotal, d.maxUses ?? null, exp, d.active ? 1 : 0, sellerId);
  return toPromo(db.prepare('SELECT * FROM promos WHERE id = ?').get(info.lastInsertRowid));
}

export function updatePromo(id, sellerId, body) {
  const p = db.prepare('SELECT * FROM promos WHERE id = ?').get(id);
  if (!p || p.seller_id !== sellerId) throw new HttpError(404, 'Промокод не найден');
  const d = parse(z.object({ active: z.boolean().optional(), maxUses: z.coerce.number().int().positive().nullish(), expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() }), body);
  if (d.active !== undefined) db.prepare('UPDATE promos SET active = ? WHERE id = ?').run(d.active ? 1 : 0, id);
  if ('maxUses' in d) db.prepare('UPDATE promos SET max_uses = ? WHERE id = ?').run(d.maxUses ?? null, id);
  if ('expiresAt' in d) db.prepare('UPDATE promos SET expires_at = ? WHERE id = ?').run(d.expiresAt ? `${d.expiresAt} 23:59:59` : null, id);
  return toPromo(db.prepare('SELECT * FROM promos WHERE id = ?').get(id));
}

export function deletePromo(id, sellerId) {
  const p = db.prepare('SELECT * FROM promos WHERE id = ?').get(id);
  if (!p || p.seller_id !== sellerId) throw new HttpError(404, 'Промокод не найден');
  db.prepare('DELETE FROM promos WHERE id = ?').run(id);
}

export const listPromos = (sellerId) =>
  db.prepare(`SELECT * FROM promos WHERE ${sellerId == null ? 'seller_id IS NULL' : 'seller_id = ?'} ORDER BY id DESC`).all(...(sellerId == null ? [] : [sellerId])).map(toPromo);

// Покупатель проверяет промокод до оформления: сервер считает скидку по своим ценам
router.post('/validate', requireAuth, requireRole('buyer'), (req, res) => {
  const d = parse(z.object({
    code: z.string().trim().min(1).max(30),
    deliveryMethod: z.enum(['delivery', 'pickup']).default('delivery'),
    items: z.array(z.object({ productId: z.coerce.number().int().positive(), qty: z.coerce.number().int().min(1).max(999) })).min(1).max(100),
  }), req.body);
  const c = priceCart(d.items, { promoCode: d.code, userId: req.user.id, deliveryMethod: d.deliveryMethod });
  res.json({ code: c.promo.code, discount: c.discount, subtotal: c.subtotal, deliveryFee: c.deliveryFee, total: c.total });
});

// Промокоды продавца (действуют только на его товары)
router.get('/mine', requireAuth, requireRole('seller'), (req, res) => res.json({ items: listPromos(req.user.id) }));
router.post('/mine', requireAuth, requireRole('seller'), (req, res) => res.status(201).json({ promo: createPromo(req.user.id, req.body) }));
router.patch('/mine/:id', requireAuth, requireRole('seller'), (req, res) => res.json({ promo: updatePromo(Number(req.params.id), req.user.id, req.body) }));
router.delete('/mine/:id', requireAuth, requireRole('seller'), (req, res) => { deletePromo(Number(req.params.id), req.user.id); res.json({ ok: true }); });

export default router;
