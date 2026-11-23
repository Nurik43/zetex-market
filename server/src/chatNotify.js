import { config } from './config.js';
import { db } from './db.js';
import { sendMailSafe } from './mailer.js';
import { sendTelegram, telegramEnabled } from './notify.js';

/**
 * Сообщает получателю о новом сообщении (почта и Telegram). Вызывается, только если у получателя
 * до этого не было непрочитанных в этом разговоре, чтобы переписка не превращалась в поток писем.
 */
export async function notifyNewMessage({ conversationId, recipientId, senderName, subjectLine, text }) {
  try {
    const u = db.prepare('SELECT email, first_name, telegram_chat_id FROM users WHERE id = ?').get(recipientId);
    if (!u) return;
    const preview = text.length > 200 ? `${text.slice(0, 199)}…` : text;
    const link = `${config.appUrl}/chats/${conversationId}`;
    await sendMailSafe({
      to: u.email,
      subject: `Новое сообщение от ${senderName} на Zetex Market`,
      text: `Здравствуйте, ${u.first_name || ''}!\n\n${senderName} написал(а)${subjectLine ? ` (${subjectLine})` : ''}:\n«${preview}»\n\nОтветить: ${link}`,
    });
    if (telegramEnabled() && u.telegram_chat_id) {
      await sendTelegram(u.telegram_chat_id, `💬 ${senderName}${subjectLine ? ` — ${subjectLine}` : ''}\n${preview}\n${link}`);
    }
  } catch (e) {
    console.error('chat notify error:', e.message);
  }
}
