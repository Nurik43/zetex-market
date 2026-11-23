import { db } from './db.js';

/** Деньги продавца: по доставленным заказам минус комиссия маркетплейса минус уже выплаченное. */
export function sellerBalance(sellerId) {
  const r = db.prepare(`
    SELECT COALESCE(SUM(i.price * i.qty), 0) gross, COALESCE(SUM(ROUND(i.price * i.qty * i.commission_pct / 100.0)), 0) commission
    FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.seller_id = ? AND o.status = 'delivered'`).get(sellerId);
  const paid = db.prepare('SELECT COALESCE(SUM(amount), 0) s FROM payouts WHERE seller_id = ?').get(sellerId).s;
  const pending = db.prepare(`
    SELECT COALESCE(SUM(i.price * i.qty - ROUND(i.price * i.qty * i.commission_pct / 100.0)), 0) s
    FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.seller_id = ? AND o.status IN ('pending','confirmed','shipped')`).get(sellerId).s;
  const net = r.gross - r.commission;
  return { gross: r.gross, commission: r.commission, net, paid, balance: net - paid, pendingNet: pending };
}
