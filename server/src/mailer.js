import nodemailer from 'nodemailer';
import { config } from './config.js';

let transport = null;
/** Последние письма (в памяти): без SMTP письма не уходят, а пишутся в консоль и сюда — удобно для разработки и тестов. */
export const outbox = [];

export async function sendMail({ to, subject, text }) {
  if (config.smtpUrl) {
    transport ||= nodemailer.createTransport(config.smtpUrl);
    await transport.sendMail({ from: config.mailFrom, to, subject, text });
    return;
  }
  outbox.push({ to, subject, text, at: Date.now() });
  if (outbox.length > 50) outbox.shift();
  if (process.env.NODE_ENV !== 'test') console.log(`\n[mail → ${to}] ${subject}\n${text}\n`);
}

/** Письма не должны ломать основной запрос: ошибка отправки только логируется. */
export function sendMailSafe(msg) {
  return sendMail(msg).catch((e) => console.error('mail error:', e.message));
}
