import crypto from 'node:crypto';
import express, { Router } from 'express';
import { config } from '../config.js';
import { db, tx } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { HttpError } from '../util.js';
import { markOrderPaid, restoreAndCancel } from '../orderOps.js';

const router = Router();
const getOrder = (id) => db.prepare('SELECT * FROM orders WHERE id = ?').get(id);

// ======================= Ссылка на оплату (для покупателя) =======================
router.get('/link/:orderId(\\d+)', requireAuth, requireRole('buyer'), (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ? AND buyer_id = ?').get(Number(req.params.orderId), req.user.id);
  if (!o) throw new HttpError(404, 'Заказ не найден');
  if (o.payment_status !== 'pending' || o.status === 'cancelled') throw new HttpError(409, 'Заказ не ожидает оплаты');
  const back = `${config.appUrl}/pay/${o.id}`;
  if (o.payment_method === 'payme') {
    const p = config.payments.payme;
    const raw = `m=${p.merchantId};ac.order_id=${o.id};a=${o.total * 100};c=${back}`;
    const host = p.test ? 'https://checkout.test.paycom.uz' : 'https://checkout.paycom.uz';
    return res.json({ method: 'payme', url: `${host}/${Buffer.from(raw).toString('base64')}` });
  }
  if (o.payment_method === 'click') {
    const c = config.payments.click;
    const q = new URLSearchParams({ service_id: c.serviceId, merchant_id: c.merchantId, amount: String(o.total), transaction_param: String(o.id), return_url: back });
    return res.json({ method: 'click', url: `https://my.click.uz/services/pay?${q}` });
  }
  if (o.payment_method === 'mock') return res.json({ method: 'mock', url: null });
  throw new HttpError(400, 'Для этого заказа онлайн-оплата не нужна');
});

// ======================= Демо-оплата (без реального провайдера) =======================
router.post('/mock/:orderId(\\d+)/pay', requireAuth, requireRole('buyer'), (req, res) => {
  if (!config.payments.mock) throw new HttpError(404, 'Демо-оплата отключена');
  const id = Number(req.params.orderId);
  const o = db.prepare('SELECT * FROM orders WHERE id = ? AND buyer_id = ?').get(id, req.user.id);
  if (!o || o.payment_method !== 'mock') throw new HttpError(404, 'Заказ не найден');
  const ok = tx(() => {
    if (o.status === 'cancelled' || o.payment_status !== 'pending') return false;
    const now = Date.now();
    db.prepare("INSERT INTO payment_transactions (order_id, provider, provider_trans_id, state, amount, create_time, perform_time) VALUES (?, 'mock', ?, 2, ?, ?, ?)")
      .run(id, crypto.randomUUID(), o.total, now, now);
    return markOrderPaid(id);
  });
  if (!ok) throw new HttpError(409, 'Заказ не ожидает оплаты');
  res.json({ ok: true });
});

// ======================= Payme (Merchant API, JSON-RPC) =======================
// Реализовано по протоколу Merchant API. Перед боевым запуском прогоните сценарии в песочнице Payme.
const PAYME_TIMEOUT = 12 * 3600 * 1000;

class PaymeError extends Error {
  constructor(code, ru, data) { super(ru); this.code = code; this.data = data; }
}
const E = {
  auth: () => new PaymeError(-32504, 'Недостаточно привилегий для выполнения метода'),
  method: () => new PaymeError(-32601, 'Метод не найден'),
  amount: () => new PaymeError(-31001, 'Неверная сумма'),
  noTx: () => new PaymeError(-31003, 'Транзакция не найдена'),
  cannotCancel: () => new PaymeError(-31007, 'Заказ выполнен, отмена невозможна'),
  cannotPerform: () => new PaymeError(-31008, 'Невозможно выполнить операцию'),
  noOrder: () => new PaymeError(-31050, 'Заказ не найден', 'order_id'),
  badOrder: () => new PaymeError(-31051, 'Заказ не может быть оплачен', 'order_id'),
};

const paymeAuthorized = (req) => {
  const key = config.payments.payme.key;
  const m = /^Basic (.+)$/.exec(req.headers.authorization || '');
  if (!key || !m) return false;
  const given = Buffer.from(m[1], 'base64').toString();
  const want = `Paycom:${key}`;
  return given.length === want.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(want));
};

function paymeCheckOrder(params) {
  const id = Number(params?.account?.order_id);
  const o = Number.isInteger(id) && id > 0 ? getOrder(id) : null;
  if (!o || o.payment_method !== 'payme') throw E.noOrder();
  if (o.status === 'cancelled' || o.payment_status !== 'pending') throw E.badOrder();
  if (Number(params.amount) !== o.total * 100) throw E.amount();
  return o;
}

const findTx = (id) => db.prepare("SELECT * FROM payment_transactions WHERE provider = 'payme' AND provider_trans_id = ?").get(String(id));
const paymeTxInfo = (t) => ({
  create_time: t.create_time, perform_time: t.perform_time, cancel_time: t.cancel_time,
  transaction: String(t.id), state: t.state, reason: t.reason ?? null,
});

function cancelExpired(t) {
  db.prepare('UPDATE payment_transactions SET state = -1, reason = 4, cancel_time = ? WHERE id = ?').run(Date.now(), t.id);
}

const paymeMethods = {
  CheckPerformTransaction(params) {
    paymeCheckOrder(params);
    return { allow: true };
  },
  CreateTransaction(params) {
    return tx(() => {
      const existing = findTx(params.id);
      if (existing) {
        if (existing.state !== 1) throw E.cannotPerform();
        if (Date.now() - existing.create_time > PAYME_TIMEOUT) { cancelExpired(existing); throw E.cannotPerform(); }
        return { create_time: existing.create_time, transaction: String(existing.id), state: 1 };
      }
      const o = paymeCheckOrder(params);
      // на один заказ — одна активная транзакция
      if (db.prepare("SELECT 1 FROM payment_transactions WHERE order_id = ? AND provider = 'payme' AND state = 1").get(o.id)) throw E.cannotPerform();
      const time = Number(params.time) || Date.now();
      const info = db.prepare("INSERT INTO payment_transactions (order_id, provider, provider_trans_id, state, amount, create_time) VALUES (?, 'payme', ?, 1, ?, ?)")
        .run(o.id, String(params.id), o.total, time);
      return { create_time: time, transaction: String(info.lastInsertRowid), state: 1 };
    });
  },
  PerformTransaction(params) {
    return tx(() => {
      const t = findTx(params.id);
      if (!t) throw E.noTx();
      if (t.state === 2) return { transaction: String(t.id), perform_time: t.perform_time, state: 2 };
      if (t.state !== 1) throw E.cannotPerform();
      if (Date.now() - t.create_time > PAYME_TIMEOUT) { cancelExpired(t); throw E.cannotPerform(); }
      const now = Date.now();
      db.prepare('UPDATE payment_transactions SET state = 2, perform_time = ? WHERE id = ?').run(now, t.id);
      markOrderPaid(t.order_id);
      return { transaction: String(t.id), perform_time: now, state: 2 };
    });
  },
  CancelTransaction(params) {
    return tx(() => {
      const t = findTx(params.id);
      if (!t) throw E.noTx();
      if (t.state < 0) return { transaction: String(t.id), cancel_time: t.cancel_time, state: t.state };
      const now = Date.now();
      if (t.state === 1) {
        db.prepare('UPDATE payment_transactions SET state = -1, reason = ?, cancel_time = ? WHERE id = ?').run(params.reason ?? null, now, t.id);
        restoreAndCancel(t.order_id); // оплаты не было — отменяем заказ и возвращаем товар на склад
        return { transaction: String(t.id), cancel_time: now, state: -1 };
      }
      // возврат после оплаты возможен, пока заказ не отправлен
      const o = getOrder(t.order_id);
      if (['shipped', 'delivered'].includes(o.status)) throw E.cannotCancel();
      db.prepare('UPDATE payment_transactions SET state = -2, reason = ?, cancel_time = ? WHERE id = ?').run(params.reason ?? null, now, t.id);
      restoreAndCancel(o.id);
      db.prepare("UPDATE orders SET payment_status = 'refunded' WHERE id = ?").run(o.id); // деньги вернул сам Payme
      return { transaction: String(t.id), cancel_time: now, state: -2 };
    });
  },
  CheckTransaction(params) {
    const t = findTx(params.id);
    if (!t) throw E.noTx();
    return paymeTxInfo(t);
  },
  GetStatement(params) {
    const rows = db.prepare("SELECT * FROM payment_transactions WHERE provider = 'payme' AND create_time BETWEEN ? AND ? ORDER BY create_time")
      .all(Number(params.from) || 0, Number(params.to) || Date.now());
    return {
      transactions: rows.map((t) => ({
        id: t.provider_trans_id, time: t.create_time, amount: t.amount * 100,
        account: { order_id: String(t.order_id) }, ...paymeTxInfo(t),
      })),
    };
  },
};

router.post('/payme', (req, res) => {
  const { id = null, method, params } = req.body || {};
  const reply = (body) => res.json({ jsonrpc: '2.0', id, ...body });
  try {
    if (!paymeAuthorized(req)) throw E.auth();
    const fn = Object.hasOwn(paymeMethods, method) ? paymeMethods[method] : null;
    if (!fn) throw E.method();
    reply({ result: fn(params || {}) });
  } catch (e) {
    if (!(e instanceof PaymeError)) { console.error(e); return reply({ error: { code: -32400, message: { ru: 'Внутренняя ошибка', uz: 'Ichki xatolik', en: 'Internal error' } } }); }
    reply({ error: { code: e.code, message: { ru: e.message, uz: e.message, en: e.message }, data: e.data } });
  }
});

// ======================= Click (SHOP-API: prepare / complete) =======================
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const CLICK_ERR = {
  ok: [0, 'Success'], sign: [-1, 'SIGN CHECK FAILED!'], amount: [-2, 'Incorrect parameter amount'], action: [-3, 'Action not found'],
  paid: [-4, 'Already paid'], noOrder: [-5, 'User does not exist'], noTx: [-6, 'Transaction does not exist'],
  update: [-7, 'Failed to update user'], request: [-8, 'Error in request from click'], cancelled: [-9, 'Transaction cancelled'],
};

function clickHandler(action) {
  return (req, res) => {
    const b = req.body || {};
    const out = (key, extra = {}) => res.json({
      click_trans_id: b.click_trans_id, merchant_trans_id: b.merchant_trans_id,
      ...extra, error: CLICK_ERR[key][0], error_note: CLICK_ERR[key][1],
    });
    const c = config.payments.click;
    if (!c.secretKey) return out('request');
    const need = ['click_trans_id', 'service_id', 'merchant_trans_id', 'amount', 'action', 'sign_time', 'sign_string', ...(action === 1 ? ['merchant_prepare_id'] : [])];
    if (need.some((k) => b[k] === undefined || b[k] === '')) return out('request');

    const raw = action === 0
      ? `${b.click_trans_id}${b.service_id}${c.secretKey}${b.merchant_trans_id}${b.amount}${b.action}${b.sign_time}`
      : `${b.click_trans_id}${b.service_id}${c.secretKey}${b.merchant_trans_id}${b.merchant_prepare_id}${b.amount}${b.action}${b.sign_time}`;
    const want = md5(raw), got = String(b.sign_string).toLowerCase();
    if (want.length !== got.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got)) || String(b.service_id) !== String(c.serviceId)) return out('sign');
    if (Number(b.action) !== action) return out('action');

    const o = getOrder(Number(b.merchant_trans_id));
    if (!o || o.payment_method !== 'click') return out('noOrder');
    if (Math.abs(Number(b.amount) - o.total) > 0.01) return out('amount');

    const now = Date.now();
    if (action === 0) {
      if (o.payment_status === 'paid') return out('paid');
      if (o.status === 'cancelled' || o.payment_status !== 'pending') return out('cancelled');
      const t = tx(() => {
        const ex = db.prepare("SELECT * FROM payment_transactions WHERE provider = 'click' AND provider_trans_id = ?").get(String(b.click_trans_id));
        if (ex) return ex;
        const info = db.prepare("INSERT INTO payment_transactions (order_id, provider, provider_trans_id, state, amount, create_time) VALUES (?, 'click', ?, 1, ?, ?)")
          .run(o.id, String(b.click_trans_id), o.total, now);
        return { id: info.lastInsertRowid };
      });
      return out('ok', { merchant_prepare_id: Number(t.id) });
    }

    // complete
    const t = db.prepare("SELECT * FROM payment_transactions WHERE provider = 'click' AND id = ? AND provider_trans_id = ? AND order_id = ?")
      .get(Number(b.merchant_prepare_id), String(b.click_trans_id), o.id);
    if (!t) return out('noTx');
    if (t.state === 2) return out('paid', { merchant_confirm_id: t.id });
    if (t.state < 0) return out('cancelled');
    if (Number(b.error) < 0) {
      db.prepare('UPDATE payment_transactions SET state = -1, reason = ?, cancel_time = ? WHERE id = ?').run(Number(b.error), now, t.id);
      return out('cancelled');
    }
    if (o.status === 'cancelled') return out('cancelled');
    tx(() => {
      db.prepare('UPDATE payment_transactions SET state = 2, perform_time = ? WHERE id = ?').run(now, t.id);
      markOrderPaid(o.id);
    });
    return out('ok', { merchant_confirm_id: Number(t.id) });
  };
}

// Click шлёт application/x-www-form-urlencoded
router.post('/click/prepare', express.urlencoded({ extended: false }), clickHandler(0));
router.post('/click/complete', express.urlencoded({ extended: false }), clickHandler(1));

export default router;
