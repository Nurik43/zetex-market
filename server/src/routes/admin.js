import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { db, tx } from '../db.js';
import { requireAuth, requireRole, requireScope } from '../auth.js';
import { HttpError, ORDER_STATUSES, asyncHandler, parse, toProduct } from '../util.js';
import { removeUploadIfUnused } from './uploads.js';
import { salesAnalytics } from './orders.js';
import { createPromo, updatePromo, deletePromo, listPromos } from './promos.js';
import { recalcRating } from './reviews.js';
import { audit, orderEvent } from '../audit.js';
import { csvCell } from '../csv.js';
import { notifyUser } from '../userNotify.js';
import { notifyBuyer } from '../buyerNotify.js';
import { restoreAndCancel } from '../orderOps.js';
import { sellerBalance } from '../finance.js';
import { CATEGORIES } from '../taxonomy.js';
import { CITIES, getPickupPoints, getDeliveryFee, getFreeFrom } from '../delivery.js';
import {
  MODERATION_MODES, moderationMode, commissionDefault, commissionCategories, suspiciousTotal,
  companyInfo, getSetting, setSetting, homeContentRaw,
} from '../settings.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

// Права: full — всё; moderator — пользователи, товары, жалобы, отзывы, чаты; finance — заказы, выплаты, выгрузки.
const MOD = requireScope('moderator');
const FIN = requireScope('finance');
const FULL = requireScope();

const pageSchema = z.object({
  q: z.string().trim().max(100).default(''),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const paginate = (rows, { page, limit }) => ({
  items: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, pages: Math.max(1, Math.ceil(rows.length / limit)),
});
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'дата в формате ГГГГ-ММ-ДД').or(z.literal('')).default('');
const reasonSchema = z.string().trim().max(300).default('');
const idList = z.array(z.coerce.number().int().positive()).min(1, 'ничего не выбрано').max(200, 'не больше 200 за раз');

const tzShift = () => {
  const n = Math.trunc(config.tzOffsetHours);
  return `'${n >= 0 ? '+' : '-'}${Math.abs(n)} hours'`;
};
const dayKey = (ms) => new Date(ms + config.tzOffsetHours * 3600e3).toISOString().slice(0, 10);
const fmt = (n) => Number(n).toLocaleString('ru-RU');
const sellerLabel = (u) => u.company_name || [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email;

/** CSV для Excel: разделитель «;», BOM, защита от формул (=, +, -, @ в начале текста). */
function sendCsv(res, filename, header, rows) {
  const safe = (v) => {
    const s = String(v ?? '');
    return /^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
  };
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + [header, ...rows].map((r) => r.map((c) => csvCell(safe(c))).join(';')).join('\r\n'));
}

// ================= Обзор и аналитика =================
router.get('/stats', (_req, res) => {
  const count = (sql, ...a) => db.prepare(sql).get(...a).c;
  const roles = Object.fromEntries(db.prepare("SELECT role, COUNT(*) n FROM users WHERE deleted_at = '' GROUP BY role").all().map((r) => [r.role, r.n]));
  const byStatus = Object.fromEntries(ORDER_STATUSES.map((s) => [s, count('SELECT COUNT(*) c FROM orders WHERE status = ?', s)]));
  res.json({
    users: { buyer: roles.buyer ?? 0, seller: roles.seller ?? 0, admin: roles.admin ?? 0, total: count("SELECT COUNT(*) c FROM users WHERE deleted_at = ''") },
    products: { active: count("SELECT COUNT(*) c FROM products WHERE status = 'active'"), hidden: count("SELECT COUNT(*) c FROM products WHERE status = 'hidden'"), pending: count("SELECT COUNT(*) c FROM products WHERE status = 'pending'") },
    orders: { total: count('SELECT COUNT(*) c FROM orders'), byStatus },
    gmv: db.prepare("SELECT COALESCE(SUM(total), 0) s FROM orders WHERE status != 'cancelled'").get().s,
    openReports: count("SELECT COUNT(*) c FROM reports WHERE status = 'open'"),
    openChatReports: count("SELECT COUNT(*) c FROM message_reports WHERE status = 'open'"),
    pendingRefunds: count("SELECT COUNT(*) c FROM orders WHERE payment_status = 'refund_pending'"),
    analytics: salesAnalytics({ days: 30 }),
  });
});

// Сравнение периода с предыдущим, новые пользователи, топы, воронка заказов
router.get('/analytics', (req, res) => {
  const { days } = parse(z.object({ days: z.coerce.number().int().refine((n) => [7, 30, 90].includes(n), '7, 30 или 90').default(30) }), req.query);
  const shift = tzShift();
  const now = Date.now();
  const cur = { from: dayKey(now - (days - 1) * 864e5), to: dayKey(now) };
  const prev = { from: dayKey(now - (2 * days - 1) * 864e5), to: dayKey(now - days * 864e5) };

  const period = ({ from, to }) => {
    const o = db.prepare(`
      SELECT COUNT(*) orders,
             COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total END), 0) gmv,
             COALESCE(SUM(status = 'delivered'), 0) delivered,
             COALESCE(SUM(status = 'cancelled'), 0) cancelled,
             COALESCE(SUM(status IN ('confirmed','shipped','delivered')), 0) confirmed,
             COALESCE(SUM(payment_status IN ('refund_pending','refunded')), 0) refunds
      FROM orders WHERE date(created_at, ${shift}) BETWEEN ? AND ?`).get(from, to);
    const u = db.prepare(`
      SELECT COALESCE(SUM(role = 'buyer'), 0) buyers, COALESCE(SUM(role = 'seller'), 0) sellers
      FROM users WHERE deleted_at = '' AND date(created_at, ${shift}) BETWEEN ? AND ?`).get(from, to);
    const active = o.orders - o.cancelled;
    return { orders: o.orders, gmv: o.gmv, delivered: o.delivered, cancelled: o.cancelled, confirmed: o.confirmed, refunds: o.refunds,
      avgOrder: active ? Math.round(o.gmv / active) : 0, newBuyers: u.buyers, newSellers: u.sellers };
  };

  const byDay = new Map(db.prepare(`
    SELECT date(created_at, ${shift}) d, COALESCE(SUM(role = 'buyer'), 0) buyers, COALESCE(SUM(role = 'seller'), 0) sellers
    FROM users WHERE deleted_at = '' AND date(created_at, ${shift}) >= ? GROUP BY d`).all(cur.from).map((r) => [r.d, r]));
  const newUsers = [];
  for (let k = days - 1; k >= 0; k--) {
    const d = dayKey(now - k * 864e5);
    newUsers.push({ date: d, buyers: byDay.get(d)?.buyers ?? 0, sellers: byDay.get(d)?.sellers ?? 0 });
  }

  const topSellers = db.prepare(`
    SELECT u.id, u.email, u.company_name, u.first_name, u.last_name, SUM(i.price * i.qty) revenue, COUNT(DISTINCT o.id) orders
    FROM order_items i JOIN orders o ON o.id = i.order_id JOIN users u ON u.id = i.seller_id
    WHERE o.status != 'cancelled' AND date(o.created_at, ${shift}) BETWEEN ? AND ?
    GROUP BY u.id ORDER BY revenue DESC LIMIT 5`).all(cur.from, cur.to)
    .map((r) => ({ id: r.id, name: sellerLabel(r), revenue: r.revenue, orders: r.orders }));
  const topProducts = db.prepare(`
    SELECT COALESCE(i.product_id, 0) productId, i.title, SUM(i.qty) qty, SUM(i.price * i.qty) revenue
    FROM order_items i JOIN orders o ON o.id = i.order_id
    WHERE o.status != 'cancelled' AND date(o.created_at, ${shift}) BETWEEN ? AND ?
    GROUP BY i.title ORDER BY revenue DESC LIMIT 5`).all(cur.from, cur.to);

  const carts = db.prepare(`
    SELECT COUNT(DISTINCT c.user_id) users, COALESCE(SUM(c.qty * p.price), 0) amount
    FROM cart_items c JOIN products p ON p.id = c.product_id`).get();

  const current = period(cur);
  res.json({
    days, current, previous: period(prev), newUsers, topSellers, topProducts,
    funnel: [
      { key: 'placed', value: current.orders },
      { key: 'confirmed', value: current.confirmed },
      { key: 'delivered', value: current.delivered },
    ],
    carts: { users: carts.users, amount: carts.amount }, // корзины прямо сейчас (истории корзин нет)
  });
});

// ================= Пользователи =================
const USER_SORT = {
  new: 'u.id DESC', old: 'u.id ASC', orders: 'orders DESC, u.id DESC', products: 'products DESC, u.id DESC',
};

const toAdminUser = (u) => ({
  id: u.id, email: u.email, role: u.role, firstName: u.first_name, lastName: u.last_name, phone: u.phone, companyName: u.company_name,
  blocked: !!u.blocked, blockedReason: u.blocked_reason, trusted: !!u.trusted, emailVerified: !!u.email_verified, createdAt: u.created_at,
  products: u.products, orders: u.orders, adminScope: u.role === 'admin' ? u.admin_scope : undefined,
});

router.get('/users', MOD, (req, res) => {
  const f = parse(pageSchema.extend({
    role: z.enum(['buyer', 'seller', 'admin', '']).default(''),
    status: z.enum(['active', 'blocked', '']).default(''),
    sort: z.enum(Object.keys(USER_SORT)).default('new'),
  }), req.query);
  const needle = f.q.toLowerCase();
  const where = ["u.deleted_at = ''"], args = [];
  if (f.role) { where.push('u.role = ?'); args.push(f.role); }
  if (f.status) where.push(f.status === 'blocked' ? 'u.blocked = 1' : 'u.blocked = 0');
  const rows = db.prepare(`
    SELECT u.*, (SELECT COUNT(*) FROM products p WHERE p.seller_id = u.id) products, (SELECT COUNT(*) FROM orders o WHERE o.buyer_id = u.id) orders
    FROM users u WHERE ${where.join(' AND ')} ORDER BY ${USER_SORT[f.sort]}`).all(...args)
    .filter((u) => !needle || `${u.email} ${u.first_name} ${u.last_name} ${u.company_name}`.toLowerCase().includes(needle))
    .map(toAdminUser);
  res.json(paginate(rows, f));
});

// Полная карточка пользователя: заказы, товары, жалобы, переписка, история входов, журнал
router.get('/users/:id(\\d+)', MOD, (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare(`
    SELECT u.*, (SELECT COUNT(*) FROM products p WHERE p.seller_id = u.id) products, (SELECT COUNT(*) FROM orders o WHERE o.buyer_id = u.id) orders
    FROM users u WHERE u.id = ?`).get(id);
  if (!u) throw new HttpError(404, 'Пользователь не найден');
  const one = (sql, ...a) => db.prepare(sql).get(...a).c;
  res.json({
    user: { ...toAdminUser(u), middleName: u.middle_name, birthDate: u.birth_date, inn: u.inn, telegramLinked: !!u.telegram_chat_id, totpEnabled: !!u.totp_enabled, deleted: !!u.deleted_at },
    orders: db.prepare('SELECT id, code, status, total, payment_status paymentStatus, created_at createdAt FROM orders WHERE buyer_id = ? ORDER BY id DESC LIMIT 15').all(id),
    products: db.prepare('SELECT id, title, price, stock, status, status_reason statusReason FROM products WHERE seller_id = ? ORDER BY id DESC LIMIT 20').all(id),
    soldOrders: u.role === 'seller' ? one('SELECT COUNT(DISTINCT order_id) c FROM order_items WHERE seller_id = ?', id) : 0,
    reportsAgainst: one('SELECT COUNT(*) c FROM reports r JOIN products p ON p.id = r.product_id WHERE p.seller_id = ?', id),
    reportsBy: one('SELECT COUNT(*) c FROM reports WHERE user_id = ?', id),
    conversations: one('SELECT COUNT(*) c FROM conversations WHERE buyer_id = ? OR seller_id = ?', id, id),
    messageReportsAgainst: one('SELECT COUNT(*) c FROM message_reports mr JOIN messages m ON m.id = mr.message_id WHERE m.sender_id = ?', id),
    balance: u.role === 'seller' ? sellerBalance(id) : null,
    logins: db.prepare('SELECT ip, ua, ok, created_at createdAt FROM login_events WHERE user_id = ? ORDER BY id DESC LIMIT 15').all(id),
    history: db.prepare("SELECT action, reason, admin_email adminEmail, created_at createdAt FROM audit_log WHERE target_type = 'user' AND target_id = ? ORDER BY id DESC LIMIT 15").all(String(id)),
  });
});

router.patch('/users/:id(\\d+)', MOD, (req, res) => {
  const d = parse(z.object({ blocked: z.boolean().optional(), trusted: z.boolean().optional(), reason: reasonSchema }), req.body);
  const id = Number(req.params.id);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) throw new HttpError(404, 'Пользователь не найден');
  if (u.deleted_at) throw new HttpError(409, 'Аккаунт удалён пользователем');
  if (d.blocked !== undefined) {
    if (u.role === 'admin') throw new HttpError(400, 'Администратора заблокировать нельзя');
    if (d.blocked && !d.reason) throw new HttpError(400, 'Укажите причину блокировки');
    db.prepare('UPDATE users SET blocked = ?, blocked_reason = ?, token_version = token_version + 1 WHERE id = ?').run(d.blocked ? 1 : 0, d.blocked ? d.reason : '', id);
    audit(req, d.blocked ? 'user.block' : 'user.unblock', 'user', id, { reason: d.reason, details: { email: u.email } });
    notifyUser(id, d.blocked ? 'Ваш аккаунт Zetex заблокирован' : 'Ваш аккаунт Zetex разблокирован',
      d.blocked ? `Причина: ${d.reason}.\nЕсли это ошибка, напишите в поддержку.` : 'Доступ к аккаунту восстановлен.');
  }
  if (d.trusted !== undefined) {
    if (u.role !== 'seller') throw new HttpError(400, 'Отметка «проверенный» только для продавцов');
    db.prepare('UPDATE users SET trusted = ? WHERE id = ?').run(d.trusted ? 1 : 0, id);
    audit(req, d.trusted ? 'user.trust' : 'user.untrust', 'user', id, { details: { email: u.email } });
  }
  res.json({ ok: true });
});

// ================= Модерация товаров =================
const PRODUCT_SORT = { new: 'p.id DESC', price_asc: 'p.price ASC, p.id DESC', price_desc: 'p.price DESC, p.id DESC', stock_asc: 'p.stock ASC, p.id DESC' };

router.get('/products', MOD, (req, res) => {
  const f = parse(pageSchema.extend({
    status: z.enum(['active', 'hidden', 'pending', '']).default(''),
    category: z.string().trim().max(80).default(''),
    sellerId: z.coerce.number().int().positive().optional(),
    sort: z.enum(Object.keys(PRODUCT_SORT)).default('new'),
  }), req.query);
  const where = [], args = [];
  if (f.status) { where.push('p.status = ?'); args.push(f.status); }
  if (f.category) { where.push('p.category = ?'); args.push(f.category); }
  if (f.sellerId) { where.push('p.seller_id = ?'); args.push(f.sellerId); }
  const rows = db.prepare(`
    SELECT p.*, u.email seller_email, u.company_name, u.first_name, u.last_name, u.trusted seller_trusted FROM products p LEFT JOIN users u ON u.id = p.seller_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${PRODUCT_SORT[f.sort]}`).all(...args)
    .filter((p) => !f.q || p.search.includes(f.q.toLowerCase()))
    .map((p) => ({ ...toProduct(p), sellerEmail: p.seller_email, sellerName: p.seller_email ? sellerLabel({ company_name: p.company_name, first_name: p.first_name, last_name: p.last_name, email: p.seller_email }) : '', sellerTrusted: !!p.seller_trusted }));
  res.json(paginate(rows, f));
});

const PRODUCT_NOTES = {
  hidden: (t, reason) => ['Товар скрыт из каталога', `Товар «${t}» скрыт модератором.${reason ? `\nПричина: ${reason}.` : ''}\nИсправьте замечания и напишите в поддержку, чтобы вернуть его в каталог.`],
  active: (t) => ['Товар опубликован', `Товар «${t}» прошёл проверку и доступен в каталоге.`],
};

function setProductsStatus(req, ids, status, reason, trustSeller = false) {
  const changed = [];
  tx(() => {
    for (const id of ids) {
      const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
      if (!p || p.status === status) continue;
      db.prepare('UPDATE products SET status = ?, status_reason = ? WHERE id = ?').run(status, status === 'hidden' ? reason : '', id);
      changed.push(p);
    }
  });
  if (changed.length) {
    audit(req, status === 'hidden' ? 'product.hide' : 'product.show', 'product', changed.map((p) => p.id).join(','), { reason, details: { titles: changed.map((p) => p.title).slice(0, 10) } });
    const note = PRODUCT_NOTES[status];
    const bySeller = new Map();
    for (const p of changed) { if (p.seller_id) bySeller.set(p.seller_id, [...(bySeller.get(p.seller_id) || []), p.title]); }
    for (const [sid, titles] of bySeller) {
      const [subj, text] = note(titles.length === 1 ? titles[0] : `${titles[0]} и ещё ${titles.length - 1}`, reason);
      notifyUser(sid, subj, text);
    }
    if (trustSeller && status === 'active') {
      for (const sid of bySeller.keys()) {
        db.prepare('UPDATE users SET trusted = 1 WHERE id = ?').run(sid);
        audit(req, 'user.trust', 'user', sid);
      }
    }
  }
  return changed.length;
}

router.patch('/products/:id(\\d+)/status', MOD, (req, res) => {
  const d = parse(z.object({ status: z.enum(['active', 'hidden']), reason: reasonSchema, trustSeller: z.boolean().default(false) }), req.body);
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(id)) throw new HttpError(404, 'Товар не найден');
  if (d.status === 'hidden' && !d.reason) throw new HttpError(400, 'Укажите причину — продавец увидит её в кабинете');
  setProductsStatus(req, [id], d.status, d.reason, d.trustSeller);
  res.json({ ok: true });
});

function removeProducts(req, ids, reason) {
  let n = 0;
  for (const id of ids) {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!p) continue;
    db.prepare('DELETE FROM products WHERE id = ?').run(p.id);
    let extra = [];
    try { extra = JSON.parse(p.images); } catch { /* пусто */ }
    for (const f of [p.image, ...extra]) removeUploadIfUnused(db, f);
    audit(req, 'product.delete', 'product', p.id, { reason, details: { title: p.title, sellerId: p.seller_id } });
    if (p.seller_id) notifyUser(p.seller_id, 'Товар удалён', `Товар «${p.title}» удалён модератором.${reason ? `\nПричина: ${reason}.` : ''}`);
    n++;
  }
  return n;
}

router.delete('/products/:id(\\d+)', MOD, (req, res) => {
  const { reason } = parse(z.object({ reason: reasonSchema }), req.body ?? {});
  if (!removeProducts(req, [Number(req.params.id)], reason)) throw new HttpError(404, 'Товар не найден');
  res.json({ ok: true });
});

router.post('/products/bulk', MOD, (req, res) => {
  const d = parse(z.object({ ids: idList, action: z.enum(['hide', 'activate', 'delete']), reason: reasonSchema, trustSeller: z.boolean().default(false) }), req.body);
  if (d.action !== 'activate' && !d.reason) throw new HttpError(400, 'Укажите причину');
  const done = d.action === 'delete' ? removeProducts(req, d.ids, d.reason)
    : setProductsStatus(req, d.ids, d.action === 'hide' ? 'hidden' : 'active', d.reason, d.trustSeller);
  res.json({ ok: true, done });
});

// ================= Заказы =================
const ORDER_SORT = { new: 'o.id DESC', old: 'o.id ASC', total_desc: 'o.total DESC, o.id DESC', total_asc: 'o.total ASC, o.id DESC' };
const orderFilters = z.object({
  status: z.enum([...ORDER_STATUSES, '']).default(''),
  paymentStatus: z.enum(['cod', 'pending', 'paid', 'unpaid', 'refund_pending', 'refunded', '']).default(''),
  from: dateStr, to: dateStr,
  sellerId: z.coerce.number().int().positive().optional(),
  minTotal: z.coerce.number().int().min(0).optional(),
  maxTotal: z.coerce.number().int().min(0).optional(),
  sort: z.enum(Object.keys(ORDER_SORT)).default('new'),
});

function queryOrders(f) {
  const where = [], args = [];
  if (f.status) { where.push('o.status = ?'); args.push(f.status); }
  if (f.paymentStatus) { where.push('o.payment_status = ?'); args.push(f.paymentStatus); }
  if (f.from) { where.push(`date(o.created_at, ${tzShift()}) >= ?`); args.push(f.from); }
  if (f.to) { where.push(`date(o.created_at, ${tzShift()}) <= ?`); args.push(f.to); }
  if (f.sellerId) { where.push('EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.seller_id = ?)'); args.push(f.sellerId); }
  if (f.minTotal !== undefined) { where.push('o.total >= ?'); args.push(f.minTotal); }
  if (f.maxTotal !== undefined) { where.push('o.total <= ?'); args.push(f.maxTotal); }
  return db.prepare(`
    SELECT o.*, u.email buyer_email FROM orders o JOIN users u ON u.id = o.buyer_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${ORDER_SORT[f.sort]}`).all(...args)
    .filter((o) => !f.q || `${o.code} ${o.buyer_email} ${o.recipient} ${o.phone}`.toLowerCase().includes(f.q.toLowerCase()));
}
const toAdminOrder = (o) => ({
  id: o.id, code: o.code, status: o.status, total: o.total, paymentMethod: o.payment_method, paymentStatus: o.payment_status,
  buyerEmail: o.buyer_email, recipient: o.recipient, phone: o.phone, city: o.city, createdAt: o.created_at,
});

router.get('/orders', FIN, (req, res) => {
  const f = parse(pageSchema.merge(orderFilters), req.query);
  res.json(paginate(queryOrders(f).map(toAdminOrder), f));
});

router.get('/orders/:id(\\d+)', FIN, (req, res) => {
  const o = db.prepare('SELECT o.*, u.email buyer_email, u.id buyer_uid FROM orders o JOIN users u ON u.id = o.buyer_id WHERE o.id = ?').get(Number(req.params.id));
  if (!o) throw new HttpError(404, 'Заказ не найден');
  res.json({
    order: {
      ...toAdminOrder(o), buyerId: o.buyer_uid, subtotal: o.subtotal, discount: o.discount, deliveryFee: o.delivery_fee, promoCode: o.promo_code,
      deliveryMethod: o.delivery_method, address: o.address, pickupPoint: o.pickup_point, comment: o.comment,
    },
    items: db.prepare(`
      SELECT i.id, i.product_id productId, i.title, i.price, i.qty, i.commission_pct commissionPct, i.seller_id sellerId, u.email sellerEmail
      FROM order_items i LEFT JOIN users u ON u.id = i.seller_id WHERE i.order_id = ? ORDER BY i.id`).all(o.id),
    payments: db.prepare('SELECT provider, provider_trans_id id, state, amount, create_time createTime, perform_time performTime, cancel_time cancelTime FROM payment_transactions WHERE order_id = ? ORDER BY id').all(o.id),
    events: db.prepare('SELECT type, text, actor, created_at createdAt FROM order_events WHERE order_id = ? ORDER BY id').all(o.id),
  });
});

const ADMIN_NEXT = { pending: ['confirmed', 'cancelled'], confirmed: ['shipped', 'cancelled'], shipped: ['delivered', 'cancelled'], delivered: [], cancelled: [] };

router.post('/orders/:id(\\d+)/status', FIN, (req, res) => {
  const d = parse(z.object({ status: z.enum(ORDER_STATUSES), reason: reasonSchema }), req.body);
  const id = Number(req.params.id);
  tx(() => {
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!o) throw new HttpError(404, 'Заказ не найден');
    if (!ADMIN_NEXT[o.status].includes(d.status)) throw new HttpError(409, `Нельзя перевести заказ из «${o.status}» в «${d.status}»`);
    if (d.status === 'confirmed' && o.payment_status === 'pending') throw new HttpError(409, 'Заказ ещё не оплачен покупателем');
    if (d.status === 'cancelled') {
      if (!d.reason) throw new HttpError(400, 'Укажите причину отмены');
      restoreAndCancel(id);
    } else {
      const pay = d.status === 'delivered' && o.payment_status === 'cod' ? 'paid' : o.payment_status;
      db.prepare('UPDATE orders SET status = ?, payment_status = ? WHERE id = ?').run(d.status, pay, id);
    }
    orderEvent(id, d.status, `Администратор: статус «${d.status}»${d.reason ? ` (${d.reason})` : ''}`, 'админ');
    audit(req, 'order.status', 'order', id, { reason: d.reason, details: { from: o.status, to: d.status, code: o.code } });
  });
  notifyBuyer(id, d.status);
  res.json({ ok: true });
});

// Деньги по оплаченному и отменённому заказу вернули вручную — снимаем пометку
router.post('/orders/:id(\\d+)/refund-done', FIN, (req, res) => {
  const { note } = parse(z.object({ note: reasonSchema }), req.body ?? {});
  const id = Number(req.params.id);
  const r = db.prepare("UPDATE orders SET payment_status = 'refunded' WHERE id = ? AND payment_status = 'refund_pending'").run(id);
  if (!r.changes) throw new HttpError(409, 'У заказа нет ожидающего возврата');
  orderEvent(id, 'refunded', `Возврат денег выполнен${note ? ` (${note})` : ''}`, 'админ');
  audit(req, 'order.refund_done', 'order', id, { reason: note });
  res.json({ ok: true });
});

// ================= Финансы: комиссия и выплаты =================
function sellersFinance() {
  const sellers = db.prepare("SELECT * FROM users WHERE role = 'seller' AND deleted_at = '' ORDER BY id").all();
  return sellers.map((u) => ({ id: u.id, email: u.email, name: sellerLabel(u), ...sellerBalance(u.id) }));
}

router.get('/finance/sellers', FIN, (_req, res) => {
  const items = sellersFinance();
  const sum = (k) => items.reduce((s, x) => s + x[k], 0);
  res.json({ items, totals: { gross: sum('gross'), commission: sum('commission'), net: sum('net'), paid: sum('paid'), balance: sum('balance') } });
});

router.get('/finance/payouts', FIN, (req, res) => {
  const f = parse(pageSchema.extend({ sellerId: z.coerce.number().int().positive().optional() }), req.query);
  const rows = db.prepare(`
    SELECT p.id, p.seller_id sellerId, p.amount, p.note, p.created_at createdAt, u.email sellerEmail, u.company_name, u.first_name, u.last_name, a.email adminEmail
    FROM payouts p JOIN users u ON u.id = p.seller_id LEFT JOIN users a ON a.id = p.admin_id
    ${f.sellerId ? 'WHERE p.seller_id = ?' : ''} ORDER BY p.id DESC`).all(...(f.sellerId ? [f.sellerId] : []))
    .map((r) => ({ id: r.id, sellerId: r.sellerId, sellerName: sellerLabel({ company_name: r.company_name, first_name: r.first_name, last_name: r.last_name, email: r.sellerEmail }), amount: r.amount, note: r.note, createdAt: r.createdAt, adminEmail: r.adminEmail }));
  res.json(paginate(rows, f));
});

router.post('/finance/payouts', FIN, (req, res) => {
  const d = parse(z.object({ sellerId: z.coerce.number().int().positive(), amount: z.coerce.number().int().positive('сумма должна быть больше 0'), note: reasonSchema }), req.body);
  tx(() => {
    const u = db.prepare("SELECT id, email FROM users WHERE id = ? AND role = 'seller'").get(d.sellerId);
    if (!u) throw new HttpError(404, 'Продавец не найден');
    const { balance } = sellerBalance(u.id);
    if (d.amount > balance) throw new HttpError(409, `Нельзя выплатить больше остатка: к выплате ${fmt(balance)} сум`);
    const info = db.prepare('INSERT INTO payouts (seller_id, amount, note, admin_id) VALUES (?,?,?,?)').run(u.id, d.amount, d.note, req.user.id);
    audit(req, 'payout.create', 'payout', info.lastInsertRowid, { reason: d.note, details: { sellerId: u.id, email: u.email, amount: d.amount } });
  });
  notifyUser(d.sellerId, 'Выплата от Zetex', `Вам выплачено ${fmt(d.amount)} сум.${d.note ? `\n${d.note}` : ''}`);
  res.status(201).json({ ok: true });
});

router.get('/finance/commission', FIN, (_req, res) => {
  res.json({ commissionDefault: commissionDefault(), commissionCategories: commissionCategories() });
});

// ================= Жалобы на товары =================
router.get('/reports', MOD, (req, res) => {
  const f = parse(pageSchema.extend({ status: z.enum(['open', 'resolved', 'dismissed', '']).default('open') }), req.query);
  const rows = db.prepare(`
    SELECT r.*, p.title, p.image, p.status product_status, u.email reporter FROM reports r JOIN products p ON p.id = r.product_id LEFT JOIN users u ON u.id = r.user_id
    ${f.status ? 'WHERE r.status = ?' : ''} ORDER BY r.id DESC`).all(...(f.status ? [f.status] : []))
    .map((r) => ({ id: r.id, productId: r.product_id, productTitle: r.title, productImage: r.image, productStatus: r.product_status, reason: r.reason, text: r.text, status: r.status, reporter: r.reporter, createdAt: r.created_at }));
  res.json(paginate(rows, f));
});

router.patch('/reports/:id(\\d+)', MOD, (req, res) => {
  const d = parse(z.object({ status: z.enum(['open', 'resolved', 'dismissed']), hideProduct: z.boolean().default(false), reason: reasonSchema }), req.body);
  const rep = db.prepare('SELECT * FROM reports WHERE id = ?').get(Number(req.params.id));
  if (!rep) throw new HttpError(404, 'Жалоба не найдена');
  if (d.hideProduct && !d.reason) throw new HttpError(400, 'Укажите причину скрытия товара');
  db.prepare('UPDATE reports SET status = ? WHERE id = ?').run(d.status, rep.id);
  audit(req, 'report.' + d.status, 'report', rep.id, { reason: d.reason, details: { productId: rep.product_id } });
  if (d.hideProduct) setProductsStatus(req, [rep.product_id], 'hidden', d.reason);
  res.json({ ok: true });
});

router.post('/reports/bulk', MOD, (req, res) => {
  const d = parse(z.object({ ids: idList, status: z.enum(['resolved', 'dismissed']) }), req.body);
  const run = db.prepare("UPDATE reports SET status = ? WHERE id = ? AND status = 'open'");
  let done = 0;
  tx(() => { for (const id of d.ids) done += run.run(d.status, id).changes; });
  audit(req, 'report.bulk_' + d.status, 'report', d.ids.join(','), { details: { done } });
  res.json({ ok: true, done });
});

// ================= Отзывы =================
router.get('/reviews', MOD, (req, res) => {
  const f = parse(pageSchema.extend({ rating: z.coerce.number().int().min(1).max(5).optional() }), req.query);
  const rows = db.prepare(`
    SELECT r.*, p.title, u.email FROM reviews r JOIN products p ON p.id = r.product_id JOIN users u ON u.id = r.user_id
    ${f.rating ? 'WHERE r.rating = ?' : ''} ORDER BY r.id DESC`).all(...(f.rating ? [f.rating] : []))
    .filter((r) => !f.q || `${r.title} ${r.text} ${r.email}`.toLowerCase().includes(f.q.toLowerCase()))
    .map((r) => ({ id: r.id, productId: r.product_id, productTitle: r.title, rating: r.rating, text: r.text, author: r.email, createdAt: r.created_at }));
  res.json(paginate(rows, f));
});

function removeReviews(req, ids, reason) {
  let n = 0;
  tx(() => {
    for (const id of ids) {
      const r = db.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
      if (!r) continue;
      db.prepare('DELETE FROM reviews WHERE id = ?').run(r.id);
      recalcRating(r.product_id);
      n++;
    }
  });
  if (n) audit(req, 'review.delete', 'review', ids.join(','), { reason, details: { done: n } });
  return n;
}

router.delete('/reviews/:id(\\d+)', MOD, (req, res) => {
  const { reason } = parse(z.object({ reason: reasonSchema }), req.body ?? {});
  if (!removeReviews(req, [Number(req.params.id)], reason)) throw new HttpError(404, 'Отзыв не найден');
  res.json({ ok: true });
});

router.post('/reviews/bulk', MOD, (req, res) => {
  const d = parse(z.object({ ids: idList, reason: reasonSchema }), req.body);
  res.json({ ok: true, done: removeReviews(req, d.ids, d.reason) });
});

// ================= Модерация чатов =================
router.get('/chat-reports', MOD, (req, res) => {
  const f = parse(pageSchema.extend({ status: z.enum(['open', 'resolved', 'dismissed', '']).default('open') }), req.query);
  const rows = db.prepare(`
    SELECT mr.*, m.body, m.conversation_id, m.sender_id, s.email sender_email, s.blocked sender_blocked, rp.email reporter_email
    FROM message_reports mr JOIN messages m ON m.id = mr.message_id JOIN users s ON s.id = m.sender_id JOIN users rp ON rp.id = mr.reporter_id
    ${f.status ? 'WHERE mr.status = ?' : ''} ORDER BY mr.id DESC`).all(...(f.status ? [f.status] : []))
    .map((r) => ({ id: r.id, messageId: r.message_id, conversationId: r.conversation_id, text: r.body, senderId: r.sender_id, senderEmail: r.sender_email, senderBlocked: !!r.sender_blocked, reporter: r.reporter_email, reason: r.reason, status: r.status, createdAt: r.created_at }));
  res.json(paginate(rows, f));
});

router.patch('/chat-reports/:id(\\d+)', MOD, (req, res) => {
  const d = parse(z.object({ status: z.enum(['open', 'resolved', 'dismissed']) }), req.body);
  const r = db.prepare('UPDATE message_reports SET status = ? WHERE id = ?').run(d.status, Number(req.params.id));
  if (!r.changes) throw new HttpError(404, 'Жалоба не найдена');
  audit(req, 'chat_report.' + d.status, 'chat_report', req.params.id);
  res.json({ ok: true });
});

router.get('/conversations', MOD, (req, res) => {
  const f = parse(pageSchema, req.query);
  const needle = f.q.toLowerCase();
  const rows = db.prepare(`
    SELECT c.*, b.email buyer_email, s.email seller_email,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) msgs,
      (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY id DESC LIMIT 1) last_body
    FROM conversations c JOIN users b ON b.id = c.buyer_id JOIN users s ON s.id = c.seller_id ORDER BY c.last_message_at DESC, c.id DESC LIMIT 1000`).all()
    .filter((c) => !needle || `${c.buyer_email} ${c.seller_email}`.toLowerCase().includes(needle))
    .map((c) => ({ id: c.id, buyerEmail: c.buyer_email, sellerEmail: c.seller_email, productId: c.product_id, orderId: c.order_id, messages: c.msgs, lastMessage: c.last_body, lastMessageAt: c.last_message_at }));
  res.json(paginate(rows, f));
});

router.get('/conversations/:id(\\d+)', MOD, (req, res) => {
  const c = db.prepare('SELECT c.*, b.email buyer_email, s.email seller_email FROM conversations c JOIN users b ON b.id = c.buyer_id JOIN users s ON s.id = c.seller_id WHERE c.id = ?').get(Number(req.params.id));
  if (!c) throw new HttpError(404, 'Разговор не найден');
  const messages = db.prepare(`
    SELECT m.id, m.body text, m.sender_id senderId, m.created_at createdAt,
      (SELECT COUNT(*) FROM message_reports mr WHERE mr.message_id = m.id) reports
    FROM messages m WHERE m.conversation_id = ? ORDER BY m.id LIMIT 500`).all(c.id)
    .map((m) => ({ ...m, sender: m.senderId === c.buyer_id ? 'buyer' : 'seller' }));
  audit(req, 'chat.view', 'conversation', c.id); // доступ к переписке фиксируется
  res.json({ conversation: { id: c.id, buyerId: c.buyer_id, buyerEmail: c.buyer_email, sellerId: c.seller_id, sellerEmail: c.seller_email, productId: c.product_id, orderId: c.order_id }, messages });
});

router.delete('/messages/:id(\\d+)', MOD, (req, res) => {
  const { reason } = parse(z.object({ reason: reasonSchema }), req.body ?? {});
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(req.params.id));
  if (!m) throw new HttpError(404, 'Сообщение не найдено');
  db.prepare('DELETE FROM messages WHERE id = ?').run(m.id);
  audit(req, 'message.delete', 'message', m.id, { reason, details: { conversationId: m.conversation_id, senderId: m.sender_id, text: m.body.slice(0, 200) } });
  res.json({ ok: true });
});

// ================= Промокоды (общие) =================
router.get('/promos', FULL, (_req, res) => res.json({ items: listPromos(null) }));
router.post('/promos', FULL, (req, res) => {
  const promo = createPromo(null, req.body);
  audit(req, 'promo.create', 'promo', promo.id, { details: { code: promo.code } });
  res.status(201).json({ promo });
});
router.patch('/promos/:id(\\d+)', FULL, (req, res) => {
  const promo = updatePromo(Number(req.params.id), null, req.body);
  audit(req, 'promo.update', 'promo', promo.id, { details: { code: promo.code } });
  res.json({ promo });
});
router.delete('/promos/:id(\\d+)', FULL, (req, res) => {
  deletePromo(Number(req.params.id), null);
  audit(req, 'promo.delete', 'promo', req.params.id);
  res.json({ ok: true });
});

// ================= Команда: роли в админке =================
const SCOPES = ['full', 'moderator', 'finance'];
const toTeam = (u) => ({ id: u.id, email: u.email, firstName: u.first_name, lastName: u.last_name, scope: u.admin_scope, blocked: !!u.blocked, totpEnabled: !!u.totp_enabled, createdAt: u.created_at });

router.get('/team', FULL, (_req, res) => {
  res.json({ items: db.prepare("SELECT * FROM users WHERE role = 'admin' AND deleted_at = '' ORDER BY id").all().map(toTeam) });
});

const passwordRule = z.string().min(10, 'минимум 10 символов').max(100).regex(/[A-Z]/, 'нужна заглавная буква').regex(/[a-z]/, 'нужна строчная буква').regex(/[0-9]/, 'нужна цифра');

router.post('/team', FULL, asyncHandler(async (req, res) => {
  const d = parse(z.object({
    email: z.string().trim().toLowerCase().email('некорректная почта'), password: passwordRule,
    firstName: z.string().trim().min(1).max(60), lastName: z.string().trim().max(60).default(''),
    scope: z.enum(SCOPES),
  }), req.body);
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(d.email)) throw new HttpError(409, 'Эта почта уже зарегистрирована');
  const hash = await bcrypt.hash(d.password, 10);
  const info = db.prepare("INSERT INTO users (email, password_hash, role, first_name, last_name, email_verified, admin_scope) VALUES (?,?, 'admin', ?, ?, 1, ?)")
    .run(d.email, hash, d.firstName, d.lastName, d.scope);
  audit(req, 'team.create', 'user', info.lastInsertRowid, { details: { email: d.email, scope: d.scope } });
  res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
}));

router.patch('/team/:id(\\d+)', FULL, (req, res) => {
  const d = parse(z.object({ scope: z.enum(SCOPES).optional(), blocked: z.boolean().optional() }), req.body);
  const id = Number(req.params.id);
  const u = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'admin'").get(id);
  if (!u) throw new HttpError(404, 'Сотрудник не найден');
  if (id === req.user.id) throw new HttpError(400, 'Свою роль и доступ менять нельзя');
  const fullLeft = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'admin' AND admin_scope = 'full' AND blocked = 0 AND deleted_at = '' AND id != ?").get(id).c;
  if (fullLeft === 0 && ((d.scope && d.scope !== 'full') || d.blocked)) throw new HttpError(409, 'Должен остаться хотя бы один администратор с полным доступом');
  if (d.scope) db.prepare('UPDATE users SET admin_scope = ?, token_version = token_version + 1 WHERE id = ?').run(d.scope, id);
  if (d.blocked !== undefined) db.prepare('UPDATE users SET blocked = ?, token_version = token_version + 1 WHERE id = ?').run(d.blocked ? 1 : 0, id);
  audit(req, 'team.update', 'user', id, { details: { email: u.email, ...d } });
  res.json({ ok: true });
});

// ================= Настройки сайта =================
const settingsView = () => ({
  moderation: moderationMode(),
  moderationModes: MODERATION_MODES,
  commissionDefault: commissionDefault(),
  commissionCategories: commissionCategories(),
  categories: CATEGORIES,
  deliveryFee: getDeliveryFee(),
  freeDeliveryFrom: getFreeFrom(),
  pickupPoints: getPickupPoints(),
  cities: CITIES,
  suspiciousTotal: suspiciousTotal(),
  company: companyInfo(),
  announcement: getSetting('announcement', { active: false, text: '', link: '' }),
  home: homeContentRaw(),
});

router.get('/settings', FULL, (_req, res) => res.json(settingsView()));

const pct = z.coerce.number().min(0, 'от 0 до 50').max(50, 'от 0 до 50');
const short = z.string().trim().max(200).default('');
const settingsSchema = z.object({
  moderation: z.enum(MODERATION_MODES),
  commissionDefault: pct,
  commissionCategories: z.record(z.string(), pct).refine((o) => Object.keys(o).every((k) => CATEGORIES.includes(k)), 'неизвестная категория'),
  deliveryFee: z.coerce.number().int().min(0).max(10_000_000),
  freeDeliveryFrom: z.coerce.number().int().min(0).max(1_000_000_000),
  suspiciousTotal: z.coerce.number().int().min(1).max(10_000_000_000),
  pickupPoints: z.array(z.object({
    id: z.string().trim().regex(/^[a-z0-9_-]{2,30}$/i, 'id пункта: латиница, цифры, - и _'),
    city: z.string().refine((c) => CITIES.includes(c), 'город из списка'),
    name: z.string().trim().min(2).max(120), address: z.string().trim().min(3).max(200),
  })).max(100).refine((l) => new Set(l.map((p) => p.id)).size === l.length, 'id пунктов должны быть уникальны'),
  company: z.object({ name: short, inn: short, address: short, phone: short, email: short, hours: short, telegram: short, instagram: short, youtube: short }).partial(),
  home: z.object({
    title: z.string().trim().max(80).default(''), text: z.string().trim().max(300).default(''), button: z.string().trim().max(30).default(''),
    banners: z.array(z.object({
      id: z.string().trim().max(30).default(''), active: z.boolean().default(true), title: z.string().trim().min(1, 'у баннера нужен заголовок').max(80),
      text: z.string().trim().max(200).default(''), link: z.string().trim().max(300).refine((v) => v === '' || /^\/(?!\/)/.test(v) || /^https:\/\//.test(v), 'ссылка: путь на сайте (/…) или https://…').default(''),
      tone: z.enum(['brand', 'accent', 'warn']).default('brand'),
    })).max(5, 'не больше 5 баннеров'),
  }),
  announcement: z.object({
    active: z.boolean(), text: z.string().trim().max(200),
    link: z.string().trim().max(300).refine((v) => v === '' || /^\/(?!\/)/.test(v) || /^https:\/\//.test(v), 'ссылка: путь на сайте (/…) или https://…').default(''),
  }),
}).partial();

router.put('/settings', FULL, (req, res) => {
  const d = parse(settingsSchema, req.body);
  const map = {
    moderation: 'moderation', commissionDefault: 'commission_default', commissionCategories: 'commission_categories',
    deliveryFee: 'delivery_fee', freeDeliveryFrom: 'free_delivery_from', suspiciousTotal: 'suspicious_total',
    pickupPoints: 'pickup_points', company: 'company', announcement: 'announcement', home: 'home',
  };
  const changed = [];
  tx(() => {
    for (const [k, key] of Object.entries(map)) {
      if (d[k] === undefined) continue;
      let v = d[k];
      if (k === 'commissionCategories') v = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null));
      setSetting(key, v);
      changed.push(k);
    }
  });
  if (changed.length) audit(req, 'settings.update', 'settings', '', { details: { changed } });
  res.json(settingsView());
});

// ================= Журнал =================
router.get('/audit', FULL, (req, res) => {
  const f = parse(pageSchema.extend({ action: z.string().trim().max(40).default(''), from: dateStr, to: dateStr }), req.query);
  const where = [], args = [];
  if (f.action) { where.push('action LIKE ?'); args.push(`${f.action}%`); }
  if (f.from) { where.push(`date(created_at, ${tzShift()}) >= ?`); args.push(f.from); }
  if (f.to) { where.push(`date(created_at, ${tzShift()}) <= ?`); args.push(f.to); }
  const rows = db.prepare(`SELECT * FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 5000`).all(...args)
    .filter((r) => !f.q || `${r.admin_email} ${r.action} ${r.target_type} ${r.target_id} ${r.reason} ${r.details}`.toLowerCase().includes(f.q.toLowerCase()))
    .map((r) => ({ id: r.id, adminEmail: r.admin_email, action: r.action, targetType: r.target_type, targetId: r.target_id, reason: r.reason, details: r.details, createdAt: r.created_at }));
  res.json(paginate(rows, f));
});

// ================= Выгрузки в CSV =================
const stamp = () => dayKey(Date.now());

router.get('/export/users.csv', MOD, (_req, res) => {
  const rows = db.prepare(`
    SELECT u.*, (SELECT COUNT(*) FROM products p WHERE p.seller_id = u.id) products, (SELECT COUNT(*) FROM orders o WHERE o.buyer_id = u.id) orders
    FROM users u WHERE u.deleted_at = '' ORDER BY u.id`).all();
  audit(_req, 'export.users', 'export', '', { details: { rows: rows.length } });
  sendCsv(res, `users-${stamp()}.csv`, ['ID', 'Почта', 'Роль', 'Имя', 'Фамилия', 'Компания', 'Телефон', 'Заблокирован', 'Причина блокировки', 'Товаров', 'Заказов', 'Регистрация'],
    rows.map((u) => [u.id, u.email, u.role, u.first_name, u.last_name, u.company_name, u.phone, u.blocked ? 'да' : 'нет', u.blocked_reason, u.products, u.orders, u.created_at]));
});

router.get('/export/orders.csv', FIN, (req, res) => {
  const f = parse(pageSchema.merge(orderFilters), { ...req.query, page: 1, limit: 100 });
  const rows = queryOrders(f);
  audit(req, 'export.orders', 'export', '', { details: { rows: rows.length, from: f.from, to: f.to } });
  sendCsv(res, `orders-${stamp()}.csv`, ['Код', 'Дата', 'Статус', 'Оплата', 'Способ оплаты', 'Сумма', 'Скидка', 'Доставка', 'Покупатель', 'Получатель', 'Телефон', 'Город', 'Адрес'],
    rows.map((o) => [o.code, o.created_at, o.status, o.payment_status, o.payment_method, o.total, o.discount, o.delivery_fee, o.buyer_email, o.recipient, o.phone, o.city, o.address]));
});

// Деньги продавцов за период (по дате заказа / выплаты); без дат — за всё время
function sellersFinancePeriod(from, to) {
  const shift = tzShift();
  const range = (col) => `${from ? ` AND date(${col}, ${shift}) >= '${from}'` : ''}${to ? ` AND date(${col}, ${shift}) <= '${to}'` : ''}`;
  return db.prepare("SELECT * FROM users WHERE role = 'seller' AND deleted_at = '' ORDER BY id").all().map((u) => {
    const r = db.prepare(`
      SELECT COALESCE(SUM(i.price * i.qty), 0) gross, COALESCE(SUM(ROUND(i.price * i.qty * i.commission_pct / 100.0)), 0) commission, COUNT(DISTINCT o.id) orders
      FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.seller_id = ? AND o.status = 'delivered'${range('o.created_at')}`).get(u.id);
    const paid = db.prepare(`SELECT COALESCE(SUM(amount), 0) s FROM payouts WHERE seller_id = ?${range('created_at')}`).get(u.id).s;
    return { id: u.id, email: u.email, name: sellerLabel(u), orders: r.orders, gross: r.gross, commission: r.commission, net: r.gross - r.commission, paid };
  });
}

router.get('/export/finance.csv', FIN, (req, res) => {
  const f = parse(z.object({ from: dateStr, to: dateStr }), req.query);
  const items = sellersFinancePeriod(f.from, f.to);
  audit(req, 'export.finance', 'export', '', { details: { rows: items.length, from: f.from, to: f.to } });
  sendCsv(res, `finance-${f.from || 'all'}-${f.to || stamp()}.csv`, ['ID', 'Продавец', 'Почта', 'Доставленных заказов', 'Продано', 'Комиссия', 'Заработано', 'Выплачено за период'],
    items.map((x) => [x.id, x.name, x.email, x.orders, x.gross, x.commission, x.net, x.paid]));
});

// Выручка маркетплейса по дням за период
router.get('/export/revenue.csv', FIN, (req, res) => {
  const f = parse(z.object({ from: dateStr, to: dateStr }), req.query);
  const from = f.from || dayKey(Date.now() - 29 * 864e5), to = f.to || dayKey(Date.now());
  const shift = tzShift();
  const rows = db.prepare(`
    SELECT date(o.created_at, ${shift}) d, COUNT(*) orders,
      COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.total END), 0) gmv,
      COALESCE(SUM(o.status = 'delivered'), 0) delivered, COALESCE(SUM(o.status = 'cancelled'), 0) cancelled,
      COALESCE(SUM(o.discount), 0) discount, COALESCE(SUM(o.delivery_fee), 0) delivery,
      COALESCE((SELECT SUM(ROUND(i.price * i.qty * i.commission_pct / 100.0)) FROM order_items i JOIN orders o2 ON o2.id = i.order_id WHERE o2.status = 'delivered' AND date(o2.created_at, ${shift}) = date(o.created_at, ${shift})), 0) commission
    FROM orders o WHERE date(o.created_at, ${shift}) BETWEEN ? AND ? GROUP BY d ORDER BY d`).all(from, to);
  audit(req, 'export.revenue', 'export', '', { details: { rows: rows.length, from, to } });
  sendCsv(res, `revenue-${from}-${to}.csv`, ['Дата', 'Заказов', 'Оборот (без отменённых)', 'Доставлено', 'Отменено', 'Скидки', 'Доставка', 'Комиссия с доставленных'],
    rows.map((r) => [r.d, r.orders, r.gmv, r.delivered, r.cancelled, r.discount, r.delivery, r.commission]));
});

router.get('/export/payouts.csv', FIN, (req, res) => {
  const rows = db.prepare(`
    SELECT p.*, u.email seller_email, a.email admin_email FROM payouts p JOIN users u ON u.id = p.seller_id LEFT JOIN users a ON a.id = p.admin_id ORDER BY p.id`).all();
  audit(req, 'export.payouts', 'export', '', { details: { rows: rows.length } });
  sendCsv(res, `payouts-${stamp()}.csv`, ['ID', 'Дата', 'Продавец', 'Сумма', 'Комментарий', 'Выплатил'],
    rows.map((p) => [p.id, p.created_at, p.seller_email, p.amount, p.note, p.admin_email]));
});

router.get('/export/audit.csv', FULL, (req, res) => {
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 20000').all();
  audit(req, 'export.audit', 'export', '', { details: { rows: rows.length } });
  sendCsv(res, `audit-${stamp()}.csv`, ['ID', 'Дата', 'Администратор', 'Действие', 'Объект', 'ID объекта', 'Причина', 'Детали'],
    rows.map((r) => [r.id, r.created_at, r.admin_email, r.action, r.target_type, r.target_id, r.reason, r.details]));
});

export default router;
