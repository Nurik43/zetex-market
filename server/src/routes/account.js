import crypto from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { db, tx } from '../db.js';
import { requireAuth, clearSessionCookie } from '../auth.js';
import { HttpError, asyncHandler, parse, toProduct, toUser } from '../util.js';
import { sendMailSafe } from '../mailer.js';
import { removeUploadIfUnused } from './uploads.js';

const router = Router();
router.use(requireAuth);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: process.env.NODE_ENV === 'test' ? 10_000 : 10,
  standardHeaders: true, legacyHeaders: false, message: { error: 'Слишком много попыток. Попробуйте позже.' },
});

const ACTIVE = "('pending','confirmed','shipped')";

/** Всё, что мы храним о пользователе, одним файлом. */
function collect(user) {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  const orders = db.prepare('SELECT * FROM orders WHERE buyer_id = ? ORDER BY id').all(user.id).map((o) => ({
    code: o.code, status: o.status, createdAt: o.created_at, total: o.total, subtotal: o.subtotal, discount: o.discount, deliveryFee: o.delivery_fee,
    promoCode: o.promo_code, deliveryMethod: o.delivery_method, city: o.city, address: o.address, recipient: o.recipient, phone: o.phone,
    paymentMethod: o.payment_method, paymentStatus: o.payment_status, comment: o.comment,
    items: db.prepare('SELECT title, price, qty FROM order_items WHERE order_id = ?').all(o.id),
  }));
  const messages = (convId) => db.prepare('SELECT sender_id, body, created_at FROM messages WHERE conversation_id = ? ORDER BY id').all(convId)
    .map((m) => ({ from: m.sender_id === user.id ? 'я' : 'собеседник', text: m.body, at: m.created_at }));
  const data = {
    exportedAt: new Date().toISOString(),
    profile: { ...toUser(row), createdAt: row.created_at, termsAcceptedAt: row.terms_accepted_at || null },
    orders,
    favorites: db.prepare('SELECT p.id, p.title FROM favorites f JOIN products p ON p.id = f.product_id WHERE f.user_id = ?').all(user.id),
    cart: db.prepare('SELECT p.id, p.title, c.qty FROM cart_items c JOIN products p ON p.id = c.product_id WHERE c.user_id = ?').all(user.id),
    reviews: db.prepare('SELECT r.rating, r.text, r.created_at createdAt, p.title productTitle FROM reviews r JOIN products p ON p.id = r.product_id WHERE r.user_id = ?').all(user.id),
    reports: db.prepare('SELECT reason, text, status, created_at createdAt FROM reports WHERE user_id = ?').all(user.id),
    conversations: db.prepare('SELECT * FROM conversations WHERE buyer_id = ? OR seller_id = ? ORDER BY id').all(user.id, user.id)
      .map((c) => ({ createdAt: c.created_at, messages: messages(c.id) })),
  };
  if (row.role === 'seller') {
    data.products = db.prepare('SELECT * FROM products WHERE seller_id = ? ORDER BY id').all(user.id).map(toProduct);
    data.promos = db.prepare('SELECT code, type, value, min_total minTotal, max_uses maxUses, used_count usedCount, expires_at expiresAt, active FROM promos WHERE seller_id = ?').all(user.id);
    data.receivedOrders = db.prepare(`
      SELECT DISTINCT o.code, o.status, o.created_at createdAt FROM orders o JOIN order_items i ON i.order_id = o.id WHERE i.seller_id = ? ORDER BY o.id`).all(user.id);
  }
  return data;
}

router.get('/export', (req, res) => {
  res.set('Content-Disposition', 'attachment; filename="zetex-my-data.json"');
  res.type('application/json').send(JSON.stringify(collect(req.user), null, 2));
});

const deleteSchema = z.object({ password: z.string().min(1, 'введите пароль') });

/**
 * Удаление аккаунта. Личные данные стираются, а записи о заказах остаются без имён и адресов
 * (на них ссылаются чужие заказы, и их нужно хранить для учёта). Войти в такой аккаунт нельзя.
 */
router.post('/delete', limiter, asyncHandler(async (req, res) => {
  const { password } = parse(deleteSchema, req.body);
  const uid = req.user.id;
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  if (row.role === 'admin') throw new HttpError(403, 'Аккаунт администратора удалить нельзя');
  if (!(await bcrypt.compare(password, row.password_hash))) throw new HttpError(400, 'Пароль неверен');

  const images = [];
  tx(() => {
    const active = row.role === 'seller'
      ? db.prepare(`SELECT COUNT(DISTINCT o.id) c FROM orders o JOIN order_items i ON i.order_id = o.id WHERE i.seller_id = ? AND o.status IN ${ACTIVE}`).get(uid).c
      : db.prepare(`SELECT COUNT(*) c FROM orders WHERE buyer_id = ? AND status IN ${ACTIVE}`).get(uid).c;
    if (active > 0) {
      throw new HttpError(409, `Есть незавершённые заказы (${active}). Дождитесь их завершения${row.role === 'buyer' ? ' или отмените заказы в статусе «В обработке»' : ''} и повторите.`);
    }
    // заказы покупателя: убираем имя, телефон и адрес
    db.prepare("UPDATE orders SET recipient = 'Удалённый пользователь', phone = '', address = '', comment = '' WHERE buyer_id = ?").run(uid);
    if (row.role === 'seller') {
      for (const p of db.prepare('SELECT image, images FROM products WHERE seller_id = ?').all(uid)) {
        images.push(p.image);
        try { images.push(...JSON.parse(p.images)); } catch { /* нет доп. фото */ }
      }
      db.prepare('DELETE FROM products WHERE seller_id = ?').run(uid);
      db.prepare('DELETE FROM promos WHERE seller_id = ?').run(uid);
    }
    db.prepare('DELETE FROM favorites WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM auth_tokens WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM conversations WHERE buyer_id = ? OR seller_id = ?').run(uid, uid); // сообщения удаляются каскадом
    db.prepare('UPDATE reports SET user_id = NULL WHERE user_id = ?').run(uid);
    // отзывы остаются (на них держится рейтинг товара), но без имени автора
    db.prepare(`
      UPDATE users SET email = ?, password_hash = '!deleted', first_name = 'Пользователь', last_name = '', middle_name = '', phone = '',
        birth_date = '', gender = '', company_name = '', inn = '', email_verified = 0, blocked = 1, telegram_chat_id = '', telegram_code = '',
        token_version = token_version + 1, deleted_at = datetime('now')
      WHERE id = ?`).run(`deleted-${uid}-${crypto.randomBytes(4).toString('hex')}@deleted.invalid`, uid);
  });
  for (const img of images) removeUploadIfUnused(db, img);

  await sendMailSafe({
    to: row.email,
    subject: 'Ваш аккаунт на Zetex Market удалён',
    text: `Здравствуйте, ${row.first_name}!\n\nАккаунт ${row.email} удалён, личные данные стёрты. Если это были не вы, срочно напишите в поддержку.\n\nВы всегда можете зарегистрироваться снова.`,
  });
  clearSessionCookie(res);
  res.json({ ok: true });
}));

export default router;
