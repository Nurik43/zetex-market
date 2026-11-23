import { config } from './config.js';
import { db } from './db.js';

// Транспорт можно подменить в тестах
let transport = async (method, body) => {
  const res = await fetch(`https://api.telegram.org/bot${config.telegram.token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return res.json();
};
export const setTelegramTransport = (fn) => { transport = fn; };
export const telegramEnabled = () => !!config.telegram.token;

let botUsername = '';
export const getBotUsername = () => botUsername;

export async function sendTelegram(chatId, text) {
  if (!telegramEnabled() || !chatId) return false;
  try {
    const r = await transport('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true });
    return !!r?.ok;
  } catch (e) {
    console.error('telegram error:', e.message);
    return false;
  }
}

const fmt = (n) => Number(n).toLocaleString('ru-RU');

/** Сообщает каждому продавцу о новом заказе с его товарами. */
export async function notifyNewOrder(orderId) {
  if (!telegramEnabled()) return;
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!o) return;
  const sellers = db.prepare(`
    SELECT DISTINCT u.id, u.telegram_chat_id FROM order_items i JOIN users u ON u.id = i.seller_id
    WHERE i.order_id = ? AND u.telegram_chat_id != ''`).all(orderId);
  for (const s of sellers) {
    const items = db.prepare('SELECT title, qty, price FROM order_items WHERE order_id = ? AND seller_id = ?').all(orderId, s.id);
    const sum = items.reduce((t, i) => t + i.price * i.qty, 0);
    const where = o.delivery_method === 'pickup' ? 'Самовывоз' : `${o.city}, ${o.address}`;
    await sendTelegram(s.telegram_chat_id,
      `🛒 Новый заказ ${o.code}\n${items.map((i) => `• ${i.title} × ${i.qty}`).join('\n')}\nСумма: ${fmt(sum)} сум\n${where}\n${o.recipient}, ${o.phone}\nОплата: ${o.payment_method === 'cash' ? 'при получении' : o.payment_status === 'paid' ? 'оплачено' : 'ожидает оплаты'}`);
  }
}

export async function notifyPaid(orderId) {
  if (!telegramEnabled()) return;
  const o = db.prepare('SELECT code FROM orders WHERE id = ?').get(orderId);
  const sellers = db.prepare(`SELECT DISTINCT u.telegram_chat_id c FROM order_items i JOIN users u ON u.id = i.seller_id WHERE i.order_id = ? AND u.telegram_chat_id != ''`).all(orderId);
  for (const s of sellers) await sendTelegram(s.c, `💳 Заказ ${o.code} оплачен — можно подтверждать.`);
}

export async function notifyReport(reportId) {
  if (!telegramEnabled()) return;
  const r = db.prepare('SELECT r.*, p.title FROM reports r JOIN products p ON p.id = r.product_id WHERE r.id = ?').get(reportId);
  if (r) await notifyAdmin(`⚠️ Жалоба на товар «${r.title}»: ${r.reason}${r.text ? `\n${r.text}` : ''}`);
}

/** Сообщение администраторам: общий чат из TELEGRAM_ADMIN_CHAT_ID и чаты админов, привязавших Telegram. */
export async function notifyAdmin(text) {
  if (!telegramEnabled()) return;
  const ids = new Set(db.prepare("SELECT telegram_chat_id c FROM users WHERE role = 'admin' AND blocked = 0 AND telegram_chat_id != ''").all().map((r) => r.c));
  if (config.telegram.adminChatId) ids.add(config.telegram.adminChatId);
  for (const id of ids) await sendTelegram(id, text);
}

/** Привязка чата: продавец отправляет боту /start КОД, полученный в кабинете. */
export function handleUpdate(update) {
  const msg = update?.message;
  const m = /^\/start(?:\s+([A-Z0-9]{6,12}))?$/i.exec(msg?.text?.trim() || '');
  if (!m) return null;
  const chatId = String(msg.chat.id);
  const code = (m[1] || '').toUpperCase();
  if (!code) return { chatId, reply: 'Здравствуйте! Чтобы получать уведомления, откройте свой кабинет на Zetex и нажмите «Привязать Telegram».' };
  const u = db.prepare("SELECT id, role FROM users WHERE telegram_code = ? AND telegram_code != '' AND role IN ('seller', 'buyer', 'admin')").get(code);
  if (!u) return { chatId, reply: 'Код не найден или устарел. Получите новый в своём кабинете.' };
  db.prepare("UPDATE users SET telegram_chat_id = ?, telegram_code = '' WHERE id = ?").run(chatId, u.id);
  return { chatId, reply: u.role === 'seller' ? '✅ Готово! Теперь новые заказы будут приходить сюда.' : u.role === 'admin' ? '✅ Готово! Сюда будут приходить жалобы и важные события.' : '✅ Готово! Статусы ваших заказов будут приходить сюда.' };
}

/** Long polling: бот отвечает на /start. Запускается один раз при старте сервера. */
export async function startTelegramBot() {
  if (!telegramEnabled()) return;
  try {
    const me = await transport('getMe', {});
    botUsername = me?.result?.username || '';
  } catch { /* имя бота — только для ссылки в интерфейсе */ }
  let offset = 0;
  const loop = async () => {
    try {
      const r = await transport('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
      for (const u of r?.result || []) {
        offset = u.update_id + 1;
        const out = handleUpdate(u);
        if (out) await sendTelegram(out.chatId, out.reply);
      }
    } catch (e) {
      console.error('telegram polling:', e.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
    setImmediate(loop);
  };
  loop();
}
