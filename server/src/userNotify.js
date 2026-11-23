import { db } from './db.js';
import { sendMailSafe } from './mailer.js';
import { sendTelegram, telegramEnabled } from './notify.js';

/** Письмо и (если привязан) Telegram конкретному пользователю. Не бросает исключений. */
export async function notifyUser(userId, subject, text) {
  try {
    const u = db.prepare('SELECT email, telegram_chat_id FROM users WHERE id = ?').get(userId);
    if (!u) return;
    await sendMailSafe({ to: u.email, subject, text });
    if (telegramEnabled() && u.telegram_chat_id) await sendTelegram(u.telegram_chat_id, `${subject}\n${text}`);
  } catch (e) {
    console.error('notifyUser:', e.message);
  }
}
