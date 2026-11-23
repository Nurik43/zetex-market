import { config } from './config.js';
import { db } from './db.js';
import { sendMailSafe } from './mailer.js';
import { sendTelegram, telegramEnabled } from './notify.js';

const fmt = (n) => Number(n).toLocaleString('ru-RU');

// Что пишем покупателю при каждом событии заказа
const EVENTS = {
  placed: (o) => ({ subject: `Заказ ${o.code} оформлен`, lines: ['Мы получили ваш заказ и передали его продавцу.'] }),
  paid: (o) => ({ subject: `Заказ ${o.code} оплачен`, lines: ['Оплата получена, спасибо! Продавец скоро подтвердит заказ.'] }),
  confirmed: (o) => ({ subject: `Заказ ${o.code} подтверждён`, lines: ['Продавец подтвердил заказ и готовит его к отправке.'] }),
  shipped: (o) => ({ subject: `Заказ ${o.code} передан в доставку`, lines: [o.delivery_method === 'pickup' ? 'Заказ едет в пункт выдачи, мы сообщим, когда его можно забрать.' : 'Заказ передан в доставку.'] }),
  delivered: (o) => ({ subject: `Заказ ${o.code} доставлен`, lines: ['Заказ вручён. Оставьте отзыв о товарах в разделе «Мои заказы» — это поможет другим покупателям.'] }),
  cancelled: (o) => ({
    subject: `Заказ ${o.code} отменён`,
    lines: [
      'Заказ отменён, товары вернулись в продажу.',
      ...(o.payment_status === 'refund_pending' ? ['Оплата прошла, возврат средств оформляется, срок зависит от вашего банка или платёжной системы.'] : []),
    ],
  }),
  expired: (o) => ({ subject: `Заказ ${o.code} отменён: не дождались оплаты`, lines: [`Мы не получили оплату в течение ${config.payments.holdMinutes} минут, поэтому заказ отменён. Можно оформить его заново.`] }),
};

/**
 * Сообщает покупателю о событии по заказу: письмом и, если привязан, в Telegram.
 * Никогда не бросает исключений — уведомление не должно ломать основной запрос.
 */
export async function notifyBuyer(orderId, event) {
  try {
    const build = EVENTS[event];
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!build || !o) return;
    const u = db.prepare('SELECT email, first_name, telegram_chat_id FROM users WHERE id = ?').get(o.buyer_id);
    if (!u) return;
    const { subject, lines } = build(o);
    const items = db.prepare('SELECT title, qty, price FROM order_items WHERE order_id = ?').all(orderId);
    const summary = [
      ...items.map((i) => `• ${i.title} × ${i.qty}`),
      `Итого: ${fmt(o.total)} сум`,
    ];
    const body = [`Здравствуйте, ${u.first_name || 'покупатель'}!`, '', ...lines, '', ...summary, '', `Подробности: ${config.appUrl}/orders`].join('\n');
    await sendMailSafe({ to: u.email, subject, text: body });
    if (telegramEnabled() && u.telegram_chat_id) {
      await sendTelegram(u.telegram_chat_id, `${subject}\n${lines.join('\n')}\nИтого: ${fmt(o.total)} сум`);
    }
  } catch (e) {
    console.error('buyer notify error:', e.message);
  }
}
