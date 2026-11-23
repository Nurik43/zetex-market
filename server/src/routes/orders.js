import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { db, tx } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { HttpError, ORDER_STATUSES, parse } from '../util.js';
import { priceCart } from '../pricing.js';
import { CITIES, getPickupPoints } from '../delivery.js';
import { availableMethods } from '../paymentMethods.js';
import { restoreAndCancel } from '../orderOps.js';
import { notifyBuyer } from '../buyerNotify.js';
import { notifyNewOrder, notifyAdmin } from '../notify.js';
import { orderEvent } from '../audit.js';
import { sellerBalance } from '../finance.js';
import { commissionFor, suspiciousTotal } from '../settings.js';

const router = Router();
router.use(requireAuth);

const pickupName = (id) => {
  const p = getPickupPoints().find((x) => x.id === id);
  return p ? { id: p.id, name: p.name, address: p.address, city: p.city } : null;
};

const toOrder = (o, items, extra = {}) => ({
  id: o.id,
  code: o.code,
  status: o.status,
  total: o.total,
  subtotal: o.subtotal,
  discount: o.discount,
  deliveryFee: o.delivery_fee,
  promoCode: o.promo_code,
  deliveryMethod: o.delivery_method,
  city: o.city,
  address: o.address,
  pickupPoint: o.delivery_method === 'pickup' ? pickupName(o.pickup_point) : null,
  recipient: o.recipient,
  phone: o.phone,
  paymentMethod: o.payment_method,
  paymentStatus: o.payment_status,
  comment: o.comment,
  createdAt: o.created_at,
  items: items.map((i) => ({
    productId: i.product_id, sellerId: i.seller_id, title: i.title, image: i.image, price: i.price, qty: i.qty,
    ...(extra.reviewed ? { reviewed: extra.reviewed.has(i.product_id) } : {}),
  })),
});

const itemsOf = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id');

const phone = z.string().trim().refine((v) => {
  const d = v.replace(/\D/g, '');
  return d.length >= 9 && d.length <= 15;
}, 'введите корректный номер телефона');

const createSchema = z.object({
  items: z.array(z.object({
    productId: z.coerce.number().int().positive(),
    qty: z.coerce.number().int().min(1).max(999),
  })).min(1, 'корзина пуста').max(100),
  deliveryMethod: z.enum(['delivery', 'pickup']).default('delivery'),
  city: z.string().trim().max(60).default(''),
  address: z.string().trim().max(300).default(''),
  pickupPoint: z.string().trim().max(40).default(''),
  recipient: z.string().trim().min(2, 'укажите имя получателя').max(100),
  phone,
  paymentMethod: z.enum(['cash', 'payme', 'click', 'mock']).default('cash'),
  promoCode: z.string().trim().max(30).default(''),
  comment: z.string().trim().max(500).default(''),
}).superRefine((d, ctx) => {
  if (d.deliveryMethod === 'delivery') {
    if (!CITIES.includes(d.city)) ctx.addIssue({ code: 'custom', path: ['city'], message: 'выберите город из списка' });
    if (d.address.length < 5) ctx.addIssue({ code: 'custom', path: ['address'], message: 'укажите адрес доставки' });
  } else if (!getPickupPoints().some((p) => p.id === d.pickupPoint)) {
    ctx.addIssue({ code: 'custom', path: ['pickupPoint'], message: 'выберите пункт выдачи' });
  }
});

// Цены, скидки и остатки считает сервер — клиенту доверять нельзя
router.post('/', requireRole('buyer'), (req, res) => {
  const d = parse(createSchema, req.body);
  if (config.requireVerifiedEmail && !req.user.emailVerified) throw new HttpError(403, 'Подтвердите почту, чтобы оформить заказ');
  if (!availableMethods()[d.paymentMethod]) throw new HttpError(400, 'Этот способ оплаты сейчас недоступен');

  const order = tx(() => {
    const cart = priceCart(d.items, { promoCode: d.promoCode, userId: req.user.id, deliveryMethod: d.deliveryMethod });
    const code = 'ZTX-' + crypto.randomInt(100000, 1000000);
    const point = d.deliveryMethod === 'pickup' ? getPickupPoints().find((p) => p.id === d.pickupPoint) : null;
    const info = db.prepare(`
      INSERT INTO orders (code, buyer_id, total, subtotal, discount, delivery_fee, promo_code, delivery_method, city, address, pickup_point,
                          recipient, phone, payment_method, payment_status, comment)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(code, req.user.id, cart.total, cart.subtotal, cart.discount, cart.deliveryFee, cart.promo?.code ?? '',
        d.deliveryMethod, point ? point.city : d.city, point ? point.address : d.address, d.pickupPoint,
        d.recipient, d.phone, d.paymentMethod, d.paymentMethod === 'cash' ? 'cod' : 'pending', d.comment);
    const oid = info.lastInsertRowid;
    for (const { p, qty } of cart.lines) {
      db.prepare('INSERT INTO order_items (order_id, product_id, seller_id, title, image, price, qty, commission_pct) VALUES (?,?,?,?,?,?,?,?)')
        .run(oid, p.id, p.seller_id, p.title, p.image, p.price, qty, commissionFor(p.category));
      db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(qty, p.id);
    }
    // заказанное уходит из корзины
    for (const { p } of cart.lines) db.prepare('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?').run(req.user.id, p.id);
    if (cart.promo) db.prepare('UPDATE promos SET used_count = used_count + 1 WHERE id = ?').run(cart.promo.id);
    orderEvent(oid, 'placed', d.paymentMethod === 'cash' ? 'Заказ оформлен, оплата при получении' : 'Заказ оформлен, ожидает онлайн-оплаты', 'покупатель');
    return db.prepare('SELECT * FROM orders WHERE id = ?').get(oid);
  });
  if (order.total >= suspiciousTotal()) notifyAdmin(`🔎 Крупный заказ ${order.code} на ${Number(order.total).toLocaleString('ru-RU')} сум — проверьте в админке.`);
  // продавцам онлайн-заказа сообщим после оплаты
  if (order.payment_method === 'cash') { notifyNewOrder(order.id); notifyBuyer(order.id, 'placed'); }
  else notifyBuyer(order.id, 'placed');
  res.status(201).json({ order: toOrder(order, itemsOf.all(order.id)) });
});

// Заказы покупателя; reviewed показывает, оставлен ли отзыв на позицию
router.get('/', requireRole('buyer'), (req, res) => {
  const rows = db.prepare('SELECT * FROM orders WHERE buyer_id = ? ORDER BY id DESC').all(req.user.id);
  const reviewed = new Set(db.prepare('SELECT product_id FROM reviews WHERE user_id = ?').all(req.user.id).map((r) => r.product_id));
  res.json({ items: rows.map((o) => toOrder(o, itemsOf.all(o.id), { reviewed })) });
});

router.get('/:id(\\d+)', requireRole('buyer'), (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ? AND buyer_id = ?').get(Number(req.params.id), req.user.id);
  if (!o) throw new HttpError(404, 'Заказ не найден');
  res.json({ order: toOrder(o, itemsOf.all(o.id)) });
});

router.post('/:id(\\d+)/cancel', requireRole('buyer'), (req, res) => {
  const id = Number(req.params.id);
  const order = tx(() => {
    const o = db.prepare('SELECT * FROM orders WHERE id = ? AND buyer_id = ?').get(id, req.user.id);
    if (!o) throw new HttpError(404, 'Заказ не найден');
    if (o.status !== 'pending') throw new HttpError(409, 'Отменить можно только заказ «В обработке»');
    orderEvent(id, 'cancelled', 'Заказ отменён покупателем', 'покупатель');
    return restoreAndCancel(id);
  });
  res.json({ order: toOrder(order, itemsOf.all(id)) });
});

// ---- Продавец: заказы, содержащие его товары (видит только свои позиции) ----
const sellerItems = db.prepare('SELECT * FROM order_items WHERE order_id = ? AND seller_id = ? ORDER BY id');

router.get('/seller/list', requireRole('seller'), (req, res) => {
  const rows = db.prepare(`
    SELECT DISTINCT o.* FROM orders o JOIN order_items i ON i.order_id = o.id
    WHERE i.seller_id = ? ORDER BY o.id DESC`).all(req.user.id);
  res.json({
    items: rows.map((o) => {
      const items = sellerItems.all(o.id, req.user.id);
      return {
        ...toOrder(o, items),
        total: items.reduce((s, i) => s + i.price * i.qty, 0), // у продавца — только сумма его товаров
        buyer: { name: o.recipient, phone: o.phone },
      };
    }),
  });
});

const statusSchema = z.object({ status: z.enum(ORDER_STATUSES) });
const NEXT = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

router.patch('/seller/:id(\\d+)/status', requireRole('seller'), (req, res) => {
  const { status } = parse(statusSchema, req.body);
  const id = Number(req.params.id);
  const order = tx(() => {
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!o || !sellerItems.all(id, req.user.id).length) throw new HttpError(404, 'Заказ не найден');
    if (!NEXT[o.status].includes(status)) {
      throw new HttpError(409, `Нельзя перевести заказ из «${o.status}» в «${status}»`);
    }
    if (status === 'confirmed' && o.payment_status === 'pending') throw new HttpError(409, 'Заказ ещё не оплачен покупателем');
    orderEvent(id, status, `Статус: ${status}`, 'продавец');
    if (status === 'cancelled') return restoreAndCancel(id);
    // наличные получены при вручении
    const pay = status === 'delivered' && o.payment_status === 'cod' ? 'paid' : o.payment_status;
    db.prepare('UPDATE orders SET status = ?, payment_status = ? WHERE id = ?').run(status, pay, id);
    return db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  });
  notifyBuyer(id, status);
  res.json({ order: toOrder(order, sellerItems.all(id, req.user.id)) });
});

// Статистика продавца
router.get('/seller/stats', requireRole('seller'), (req, res) => {
  const products = db.prepare('SELECT COUNT(*) c FROM products WHERE seller_id = ?').get(req.user.id).c;
  const revenue = db.prepare(`
    SELECT COALESCE(SUM(i.price * i.qty), 0) s FROM order_items i JOIN orders o ON o.id = i.order_id
    WHERE i.seller_id = ? AND o.status = 'delivered'`).get(req.user.id).s;
  const active = db.prepare(`
    SELECT COUNT(DISTINCT o.id) c FROM orders o JOIN order_items i ON i.order_id = o.id
    WHERE i.seller_id = ? AND o.status IN ('pending','confirmed','shipped')`).get(req.user.id).c;
  const sold = db.prepare(`
    SELECT COALESCE(SUM(i.qty), 0) s FROM order_items i JOIN orders o ON o.id = i.order_id
    WHERE i.seller_id = ? AND o.status != 'cancelled'`).get(req.user.id).s;
  res.json({ products, revenue, activeOrders: active, itemsSold: sold, ...sellerBalance(req.user.id) });
});

router.get('/seller/payouts', requireRole('seller'), (req, res) => {
  const items = db.prepare('SELECT id, amount, note, created_at createdAt FROM payouts WHERE seller_id = ? ORDER BY id DESC LIMIT 100').all(req.user.id);
  res.json({ items, ...sellerBalance(req.user.id) });
});

// Аналитика продаж: выручка по дням, топ товаров, заказы по статусам (отменённые в выручку не входят)
const tzShift = () => {
  const n = Math.trunc(config.tzOffsetHours);
  return `'${n >= 0 ? '+' : '-'}${Math.abs(n)} hours'`;
};
const dayKey = (ms) => new Date(ms + config.tzOffsetHours * 3600e3).toISOString().slice(0, 10);

export function salesAnalytics({ sellerId = null, days = 30 } = {}) {
  const shift = tzShift();
  const start = dayKey(Date.now() - (days - 1) * 864e5);
  const who = sellerId == null ? '' : 'AND i.seller_id = ?';
  const args = sellerId == null ? [start] : [start, sellerId];

  const rows = db.prepare(`
    SELECT date(o.created_at, ${shift}) d, COUNT(DISTINCT o.id) orders, SUM(i.price * i.qty) revenue
    FROM order_items i JOIN orders o ON o.id = i.order_id
    WHERE o.status != 'cancelled' AND date(o.created_at, ${shift}) >= ? ${who}
    GROUP BY d`).all(...args);
  const byDay = new Map(rows.map((r) => [r.d, r]));
  const series = [];
  for (let k = days - 1; k >= 0; k--) {
    const d = dayKey(Date.now() - k * 864e5);
    series.push({ date: d, orders: byDay.get(d)?.orders ?? 0, revenue: byDay.get(d)?.revenue ?? 0 });
  }

  const top = db.prepare(`
    SELECT COALESCE(i.product_id, 0) productId, i.title, SUM(i.qty) qty, SUM(i.price * i.qty) revenue
    FROM order_items i JOIN orders o ON o.id = i.order_id
    WHERE o.status != 'cancelled' AND date(o.created_at, ${shift}) >= ? ${who}
    GROUP BY i.title ORDER BY revenue DESC LIMIT 5`).all(...args);

  const statuses = db.prepare(`
    SELECT o.status s, COUNT(DISTINCT o.id) n FROM order_items i JOIN orders o ON o.id = i.order_id
    WHERE date(o.created_at, ${shift}) >= ? ${who} GROUP BY o.status`).all(...args);

  const revenue = series.reduce((s, x) => s + x.revenue, 0);
  const orders = series.reduce((s, x) => s + x.orders, 0);
  return {
    days, series, top,
    byStatus: Object.fromEntries(ORDER_STATUSES.map((s) => [s, statuses.find((x) => x.s === s)?.n ?? 0])),
    totals: { revenue, orders, avgOrder: orders ? Math.round(revenue / orders) : 0 },
  };
}

router.get('/seller/analytics', requireRole('seller'), (req, res) => {
  const { days } = parse(z.object({ days: z.coerce.number().int().refine((n) => [7, 30, 90].includes(n), '7, 30 или 90').default(30) }), req.query);
  res.json(salesAnalytics({ sellerId: req.user.id, days }));
});

export default router;
