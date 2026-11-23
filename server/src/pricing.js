import { db } from './db.js';
import { HttpError } from './util.js';
import { deliveryFee } from './delivery.js';

/** Находит промокод и проверяет, что он действует. Бросает 400/409 с понятным текстом. */
export function loadPromo(code, userId) {
  const promo = db.prepare('SELECT * FROM promos WHERE code = ?').get(String(code).trim());
  if (!promo || !promo.active) throw new HttpError(400, 'Промокод не найден');
  if (promo.expires_at && Date.parse(promo.expires_at.replace(' ', 'T') + 'Z') < Date.now()) throw new HttpError(400, 'Срок действия промокода истёк');
  if (promo.max_uses != null && promo.used_count >= promo.max_uses) throw new HttpError(400, 'Промокод уже использован максимальное число раз');
  if (userId) {
    const used = db.prepare("SELECT COUNT(*) c FROM orders WHERE buyer_id = ? AND promo_code = ? COLLATE NOCASE AND status != 'cancelled'").get(userId, promo.code).c;
    if (used > 0) throw new HttpError(400, 'Вы уже использовали этот промокод');
  }
  return promo;
}

/**
 * Считает корзину по данным из БД: цены, остатки, скидку и доставку.
 * Клиенту доверять нельзя — приходят только id и количество.
 */
export function priceCart(items, { promoCode, userId, deliveryMethod = 'delivery' } = {}) {
  const wanted = new Map();
  for (const it of items) wanted.set(it.productId, (wanted.get(it.productId) || 0) + it.qty);

  const lines = [];
  let subtotal = 0;
  for (const [pid, qty] of wanted) {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(pid);
    if (!p || p.status !== 'active') throw new HttpError(409, `Товар #${pid} больше не продаётся`);
    if (p.stock < qty) throw new HttpError(409, `«${p.title}»: в наличии только ${p.stock} шт.`);
    subtotal += p.price * qty;
    lines.push({ p, qty });
  }

  let discount = 0;
  let promo = null;
  if (promoCode) {
    promo = loadPromo(promoCode, userId);
    // промокод продавца действует только на его товары, общий — на всю корзину
    const eligible = lines
      .filter((l) => promo.seller_id == null || l.p.seller_id === promo.seller_id)
      .reduce((s, l) => s + l.p.price * l.qty, 0);
    if (eligible === 0) throw new HttpError(400, 'Промокод не подходит к товарам в корзине');
    if (eligible < promo.min_total) throw new HttpError(400, `Промокод действует от ${promo.min_total.toLocaleString('ru-RU')} сум`);
    discount = promo.type === 'percent' ? Math.floor((eligible * promo.value) / 100) : Math.min(promo.value, eligible);
  }

  const goods = subtotal - discount;
  const fee = deliveryFee(deliveryMethod, goods);
  return { lines, subtotal, discount, promo, deliveryFee: fee, total: goods + fee };
}
