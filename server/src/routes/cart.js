import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { HttpError, parse } from '../util.js';

// Корзина покупателя хранится на сервере: одна и та же на любом устройстве.
const router = Router();
router.use(requireAuth, requireRole('buyer'));

const MAX_LINES = 50;
const MAX_QTY = 99;

/** Корзина с актуальными ценой и остатком; скрытые товары в ней не показываются. */
export function cartOf(userId) {
  const rows = db.prepare(`
    SELECT c.qty, p.id, p.title, p.price, p.image, p.stock, p.old_price
    FROM cart_items c JOIN products p ON p.id = c.product_id
    WHERE c.user_id = ? AND p.status = 'active' ORDER BY c.updated_at DESC, p.id DESC`).all(userId);
  return rows.map((r) => ({ id: r.id, title: r.title, price: r.price, image: r.image, stock: r.stock, count: r.qty }));
}
const reply = (res, userId) => res.json({ items: cartOf(userId) });

router.get('/', (req, res) => reply(res, req.user.id));

// Установить количество; 0 — убрать из корзины
router.put('/:productId(\\d+)', (req, res) => {
  const { qty } = parse(z.object({ qty: z.number().int().min(0).max(MAX_QTY) }), req.body);
  const pid = Number(req.params.productId);
  const uid = req.user.id;
  if (qty === 0) {
    db.prepare('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?').run(uid, pid);
    return reply(res, uid);
  }
  const p = db.prepare("SELECT id, stock, seller_id FROM products WHERE id = ? AND status = 'active'").get(pid);
  if (!p) throw new HttpError(404, 'Товар не найден');
  if (p.seller_id === uid) throw new HttpError(400, 'Свой товар купить нельзя');
  if (p.stock === 0) throw new HttpError(409, 'Товара нет в наличии');
  if (qty > p.stock) throw new HttpError(409, `В наличии только ${p.stock} шт.`);
  const exists = db.prepare('SELECT 1 FROM cart_items WHERE user_id = ? AND product_id = ?').get(uid, pid);
  if (!exists && db.prepare('SELECT COUNT(*) c FROM cart_items WHERE user_id = ?').get(uid).c >= MAX_LINES) {
    throw new HttpError(409, `В корзине не больше ${MAX_LINES} разных товаров`);
  }
  db.prepare(`
    INSERT INTO cart_items (user_id, product_id, qty) VALUES (?, ?, ?)
    ON CONFLICT (user_id, product_id) DO UPDATE SET qty = excluded.qty, updated_at = datetime('now')`).run(uid, pid, qty);
  reply(res, uid);
});

router.delete('/:productId(\\d+)', (req, res) => {
  db.prepare('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?').run(req.user.id, Number(req.params.productId));
  reply(res, req.user.id);
});

router.delete('/', (req, res) => {
  db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(req.user.id);
  reply(res, req.user.id);
});

export default router;
