import crypto from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { HttpError } from '../util.js';
import { CITIES, getPickupPoints, getDeliveryFee, getFreeFrom } from '../delivery.js';
import { companyInfo, announcement, homeContent } from '../settings.js';
import { availableMethods } from '../paymentMethods.js';
import { telegramEnabled, getBotUsername } from '../notify.js';

const router = Router();

// Публичные настройки для интерфейса: способы оплаты, доставка, интеграции
router.get('/config', (_req, res) => {
  res.json({
    payments: availableMethods(),
    delivery: { cities: CITIES, pickupPoints: getPickupPoints(), fee: getDeliveryFee(), freeFrom: getFreeFrom() },
    telegram: { enabled: telegramEnabled(), botUsername: getBotUsername() },
    requireVerifiedEmail: config.requireVerifiedEmail,
    company: companyInfo(),
    announcement: announcement(),
    home: homeContent(),
    holdMinutes: config.payments.holdMinutes,
  });
});

// Привязка Telegram продавца или покупателя: выдаём одноразовый код, продавец отправляет его боту командой /start
router.post('/telegram/link-code', requireAuth, requireRole('seller', 'buyer', 'admin'), (req, res) => {
  if (!telegramEnabled()) throw new HttpError(503, 'Telegram-бот не настроен на сервере');
  const code = crypto.randomBytes(5).toString('hex').toUpperCase();
  db.prepare('UPDATE users SET telegram_code = ? WHERE id = ?').run(code, req.user.id);
  const bot = getBotUsername();
  res.json({ code, botUsername: bot, url: bot ? `https://t.me/${bot}?start=${code}` : null });
});

router.delete('/telegram/link', requireAuth, requireRole('seller', 'buyer', 'admin'), (req, res) => {
  db.prepare("UPDATE users SET telegram_chat_id = '', telegram_code = '' WHERE id = ?").run(req.user.id);
  res.json({ ok: true });
});

export default router;
