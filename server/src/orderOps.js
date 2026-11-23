import { db, tx } from './db.js';
import { config } from './config.js';
import { notifyNewOrder, notifyAdmin } from './notify.js';
import { orderEvent } from './audit.js';
import { notifyBuyer } from './buyerNotify.js';

const itemsOf = (id) => db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id);

/** Отменяет заказ и возвращает всё на место: остатки, счётчик промокода, статус оплаты. Вызывать внутри транзакции. */
export function restoreAndCancel(orderId) {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!o || o.status === 'cancelled') return o;
  // оплаченный заказ требует возврата денег через провайдера — помечаем, чтобы администратор не забыл
  const pay = o.payment_status === 'paid' && o.payment_method !== 'cash' ? 'refund_pending'
    : o.payment_status === 'pending' ? 'unpaid' : o.payment_status;
  db.prepare("UPDATE orders SET status = 'cancelled', payment_status = ? WHERE id = ?").run(pay, orderId);
  if (pay === 'refund_pending') {
    orderEvent(orderId, 'refund_pending', 'Нужен возврат денег покупателю', 'система');
    notifyAdmin(`💸 Заказ ${o.code} отменён после оплаты — верните ${Number(o.total).toLocaleString('ru-RU')} сум покупателю и отметьте в админке.`);
  }
  for (const i of itemsOf(orderId)) {
    if (i.product_id) db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(i.qty, i.product_id);
  }
  if (o.promo_code) db.prepare('UPDATE promos SET used_count = MAX(used_count - 1, 0) WHERE code = ?').run(o.promo_code);
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
}

/** Онлайн-оплата прошла: заказ становится оплаченным, продавец получает уведомление. */
export function markOrderPaid(orderId) {
  const r = db.prepare("UPDATE orders SET payment_status = 'paid' WHERE id = ? AND payment_status = 'pending' AND status != 'cancelled'").run(orderId);
  if (r.changes > 0) { orderEvent(orderId, 'paid', 'Оплата получена', 'система'); notifyNewOrder(orderId); notifyBuyer(orderId, 'paid'); }
  return r.changes > 0;
}

/** Отменяет онлайн-заказы, за которые не заплатили в отведённое время, и освобождает товар. */
export function expireUnpaidOrders(minutes = config.payments.holdMinutes) {
  const stale = db.prepare(`
    SELECT id FROM orders WHERE payment_status = 'pending' AND status = 'pending'
    AND created_at < datetime('now', '-${Math.max(1, Math.floor(minutes))} minutes')`).all();
  for (const { id } of stale) {
    tx(() => {
      restoreAndCancel(id);
      orderEvent(id, 'expired', 'Не дождались оплаты — заказ отменён', 'система');
      db.prepare("UPDATE payment_transactions SET state = -1, reason = 4, cancel_time = ? WHERE order_id = ? AND state = 1").run(Date.now(), id);
    });
    notifyBuyer(id, 'expired');
  }
  return stale.length;
}
