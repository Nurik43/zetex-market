import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { HttpError, toProduct } from '../util.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT p.* FROM favorites f JOIN products p ON p.id = f.product_id
    WHERE f.user_id = ? ORDER BY f.created_at DESC, p.id DESC`).all(req.user.id);
  res.json({ items: rows.map(toProduct) });
});

router.put('/:productId', (req, res) => {
  const pid = Number(req.params.productId);
  if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(pid)) throw new HttpError(404, 'Товар не найден');
  db.prepare('INSERT OR IGNORE INTO favorites (user_id, product_id) VALUES (?, ?)').run(req.user.id, pid);
  res.json({ ok: true });
});

router.delete('/:productId', (req, res) => {
  db.prepare('DELETE FROM favorites WHERE user_id = ? AND product_id = ?').run(req.user.id, Number(req.params.productId));
  res.json({ ok: true });
});

export default router;
