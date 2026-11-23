import { db } from './db.js';

/** Запись в журнал действий администратора. */
export function audit(req, action, targetType = '', targetId = '', { reason = '', details = null } = {}) {
  db.prepare('INSERT INTO audit_log (admin_id, admin_email, action, target_type, target_id, reason, details) VALUES (?,?,?,?,?,?,?)')
    .run(req?.user?.id ?? null, req?.user?.email ?? '', action, targetType, String(targetId ?? ''), reason || '',
      details == null ? '' : typeof details === 'string' ? details : JSON.stringify(details));
}

/** Событие в истории заказа (таймлайн в карточке заказа). */
export function orderEvent(orderId, type, text = '', actor = '') {
  db.prepare('INSERT INTO order_events (order_id, type, text, actor) VALUES (?,?,?,?)').run(orderId, type, text, actor);
}
