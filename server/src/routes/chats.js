import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { db, tx } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { HttpError, parse } from '../util.js';
import { notifyNewMessage } from '../chatNotify.js';
import { notifyAdmin } from '../notify.js';
import { notifyUser } from '../userNotify.js';

// Чат покупателя с продавцом. Начать разговор может только покупатель (о товаре или о своём заказе),
// отвечать могут обе стороны. Сообщения подтягиваются опросом (без WebSocket).
const router = Router();
router.use(requireAuth, requireRole('buyer', 'seller'));

const sendLimiter = rateLimit({
  windowMs: 60 * 1000, limit: process.env.NODE_ENV === 'test' ? 10_000 : 30,
  keyGenerator: (req) => `u${req.user.id}`, // лимит на пользователя, а не на IP
  standardHeaders: true, legacyHeaders: false, message: { error: 'Слишком много сообщений. Подождите минуту.' },
});

// ---- Защита от спама ----
const SPAM_LIMITS = {
  links: 3, // ссылок в одном сообщении
  duplicates: 3, // одинаковых сообщений за 10 минут
  newChats: process.env.NODE_ENV === 'test' ? 1000 : 10, // новых разговоров в час
  autoBlock: process.env.NODE_ENV === 'test' ? 6 : 8, // нарушений за час до автоблокировки
};

/** Фиксирует нарушение; при частых нарушениях блокирует аккаунт и сообщает администраторам. */
function spamStrike(uid, kind) {
  db.prepare('INSERT INTO spam_events (user_id, kind) VALUES (?, ?)').run(uid, kind);
  const n = db.prepare("SELECT COUNT(*) c FROM spam_events WHERE user_id = ? AND created_at > datetime('now', '-1 hour')").get(uid).c;
  if (n < SPAM_LIMITS.autoBlock) return;
  const u = db.prepare('SELECT id, email, blocked FROM users WHERE id = ?').get(uid);
  if (!u || u.blocked) return;
  const reason = 'автоматическая блокировка за спам в чате';
  db.prepare('UPDATE users SET blocked = 1, blocked_reason = ?, token_version = token_version + 1 WHERE id = ?').run(reason, uid);
  db.prepare("INSERT INTO audit_log (admin_id, admin_email, action, target_type, target_id, reason, details) VALUES (NULL, 'система', 'user.block', 'user', ?, ?, ?)")
    .run(String(uid), reason, JSON.stringify({ email: u.email, violations: n }));
  notifyUser(uid, 'Ваш аккаунт Zetex заблокирован', `Причина: ${reason}.\nЕсли это ошибка, напишите в поддержку.`);
  notifyAdmin(`🚫 Автоблокировка за спам в чате: ${u.email} (${n} нарушений за час). Проверьте в админке.`);
}

function checkSpam(uid, text) {
  const links = (text.match(/https?:\/\/|www\./gi) || []).length;
  if (links > SPAM_LIMITS.links) { spamStrike(uid, 'links'); throw new HttpError(400, 'В сообщении слишком много ссылок'); }
  const dup = db.prepare("SELECT COUNT(*) c FROM messages WHERE sender_id = ? AND body = ? AND created_at > datetime('now', '-10 minutes')").get(uid, text).c;
  if (dup >= SPAM_LIMITS.duplicates) { spamStrike(uid, 'duplicate'); throw new HttpError(429, 'Не отправляйте одно и то же сообщение несколько раз'); }
}

const bodySchema = z.object({ text: z.string().trim().min(1, 'введите сообщение').max(2000, 'не больше 2000 символов') });

const sellerName = (u) => u.company_name || [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Продавец';
const buyerName = (u) => `${u.first_name}${u.last_name ? ` ${u.last_name[0]}.` : ''}`.trim() || 'Покупатель';

function load(id, uid) {
  const c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  // чужие разговоры не раскрываем — для них «не найден»
  if (!c || (c.buyer_id !== uid && c.seller_id !== uid)) throw new HttpError(404, 'Разговор не найден');
  return c;
}

const readCol = (c, uid) => (c.buyer_id === uid ? 'buyer_read_id' : 'seller_read_id');
const unreadFor = (c, uid) => db.prepare('SELECT COUNT(*) n FROM messages WHERE conversation_id = ? AND id > ? AND sender_id != ?').get(c.id, c[readCol(c, uid)], uid).n;

/** Карточка разговора для списка и шапки открытого чата. */
function summary(c, uid) {
  const meIsBuyer = c.buyer_id === uid;
  const other = db.prepare('SELECT * FROM users WHERE id = ?').get(meIsBuyer ? c.seller_id : c.buyer_id);
  const product = c.product_id ? db.prepare('SELECT id, title, image FROM products WHERE id = ?').get(c.product_id) : null;
  const order = c.order_id ? db.prepare('SELECT id, code FROM orders WHERE id = ?').get(c.order_id) : null;
  const last = db.prepare('SELECT sender_id, body, created_at FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(c.id);
  return {
    id: c.id,
    with: { name: meIsBuyer ? sellerName(other) : buyerName(other), role: meIsBuyer ? 'seller' : 'buyer' },
    product, order,
    lastMessage: last ? { text: last.body, mine: last.sender_id === uid, at: last.created_at } : null,
    lastMessageAt: c.last_message_at,
    unread: unreadFor(c, uid),
  };
}

function addMessage(c, uid, text) {
  const meIsBuyer = c.buyer_id === uid;
  const recipientId = meIsBuyer ? c.seller_id : c.buyer_id;
  const recipient = db.prepare('SELECT blocked, deleted_at FROM users WHERE id = ?').get(recipientId);
  if (!recipient || recipient.blocked || recipient.deleted_at) throw new HttpError(409, 'Собеседник недоступен');
  const prevUnread = unreadFor(c, recipientId);
  const info = db.prepare('INSERT INTO messages (conversation_id, sender_id, body) VALUES (?, ?, ?)').run(c.id, uid, text);
  const id = Number(info.lastInsertRowid);
  db.prepare(`UPDATE conversations SET last_message_at = datetime('now'), ${readCol(c, uid)} = ? WHERE id = ?`).run(id, c.id);
  return { id, recipientId, notify: prevUnread === 0 };
}

function notifyIfNeeded(c, uid, text, added) {
  if (!added.notify) return;
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  const product = c.product_id ? db.prepare('SELECT title FROM products WHERE id = ?').get(c.product_id) : null;
  const order = c.order_id ? db.prepare('SELECT code FROM orders WHERE id = ?').get(c.order_id) : null;
  notifyNewMessage({
    conversationId: c.id, recipientId: added.recipientId, text,
    senderName: c.buyer_id === uid ? buyerName(me) : sellerName(me),
    subjectLine: product ? `о товаре «${product.title}»` : order ? `о заказе ${order.code}` : '',
  });
}

const messageDto = (m, uid) => ({ id: m.id, text: m.body, mine: m.sender_id === uid, at: m.created_at });

// Начать разговор (или продолжить существующий) о товаре или заказе
const startSchema = bodySchema.extend({
  productId: z.number().int().positive().optional(),
  orderId: z.number().int().positive().optional(),
  sellerId: z.number().int().positive().optional(),
});

router.post('/', requireRole('buyer'), sendLimiter, (req, res) => {
  const d = parse(startSchema, req.body);
  const uid = req.user.id;
  let sellerId, productId = 0, orderId = 0;
  if (d.orderId) {
    const o = db.prepare('SELECT id FROM orders WHERE id = ? AND buyer_id = ?').get(d.orderId, uid);
    if (!o) throw new HttpError(404, 'Заказ не найден');
    const sellers = db.prepare('SELECT DISTINCT seller_id FROM order_items WHERE order_id = ? AND seller_id IS NOT NULL').all(o.id).map((r) => r.seller_id);
    sellerId = d.sellerId ?? (sellers.length === 1 ? sellers[0] : null);
    if (!sellerId || !sellers.includes(sellerId)) throw new HttpError(400, 'Укажите продавца из этого заказа');
    orderId = o.id;
  } else if (d.productId) {
    const p = db.prepare("SELECT id, seller_id FROM products WHERE id = ? AND status = 'active'").get(d.productId);
    if (!p) throw new HttpError(404, 'Товар не найден');
    sellerId = p.seller_id;
    productId = p.id;
  } else {
    throw new HttpError(400, 'Укажите товар или заказ');
  }
  const seller = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'seller' AND blocked = 0").get(sellerId);
  if (!seller) throw new HttpError(404, 'Продавец недоступен');
  checkSpam(uid, d.text);

  const result = tx(() => {
    let c = db.prepare('SELECT * FROM conversations WHERE buyer_id = ? AND seller_id = ? AND product_id = ? AND order_id = ?').get(uid, sellerId, productId, orderId);
    if (!c) {
      const fresh = db.prepare("SELECT COUNT(*) c FROM conversations WHERE buyer_id = ? AND created_at > datetime('now', '-1 hour')").get(uid).c;
      if (fresh >= SPAM_LIMITS.newChats) { spamStrike(uid, 'new_chats'); throw new HttpError(429, 'Слишком много новых разговоров. Попробуйте позже.'); }
      const info = db.prepare('INSERT INTO conversations (buyer_id, seller_id, product_id, order_id) VALUES (?, ?, ?, ?)').run(uid, sellerId, productId, orderId);
      c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(info.lastInsertRowid);
    }
    return { c, added: addMessage(c, uid, d.text) };
  });
  notifyIfNeeded(result.c, uid, d.text, result.added);
  res.status(201).json({ conversationId: result.c.id });
});

router.get('/', (req, res) => {
  const uid = req.user.id;
  const rows = db.prepare('SELECT * FROM conversations WHERE buyer_id = ? OR seller_id = ? ORDER BY last_message_at DESC, id DESC LIMIT 200').all(uid, uid);
  res.json({ items: rows.map((c) => summary(c, uid)) });
});

// Сколько непрочитанных сообщений всего — для значка в шапке
router.get('/unread', (req, res) => {
  const uid = req.user.id;
  const n = db.prepare(`
    SELECT COUNT(*) n FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE m.sender_id != ? AND ((c.buyer_id = ? AND m.id > c.buyer_read_id) OR (c.seller_id = ? AND m.id > c.seller_read_id))`).get(uid, uid, uid).n;
  res.json({ count: n });
});

// Сообщения; ?after=ID — только новые (для опроса). Открытие разговора отмечает сообщения прочитанными.
router.get('/:id(\\d+)', (req, res) => {
  const uid = req.user.id;
  const { after } = parse(z.object({ after: z.coerce.number().int().min(0).default(0) }), req.query);
  const c = load(Number(req.params.id), uid);
  const rows = db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND id > ? ORDER BY id LIMIT 500').all(c.id, after);
  if (rows.length) {
    const maxId = rows[rows.length - 1].id;
    if (maxId > c[readCol(c, uid)]) db.prepare(`UPDATE conversations SET ${readCol(c, uid)} = ? WHERE id = ?`).run(maxId, c.id);
  }
  res.json({ conversation: summary(load(c.id, uid), uid), messages: rows.map((m) => messageDto(m, uid)) });
});

router.post('/:id(\\d+)/messages', sendLimiter, (req, res) => {
  const { text } = parse(bodySchema, req.body);
  const uid = req.user.id;
  const c = load(Number(req.params.id), uid);
  checkSpam(uid, text);
  const added = tx(() => addMessage(c, uid, text));
  notifyIfNeeded(c, uid, text, added);
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(added.id);
  res.status(201).json({ message: messageDto(m, uid) });
});

// Пожаловаться на сообщение собеседника: модератор увидит его в админке
router.post('/messages/:id(\\d+)/report', rateLimit({
  windowMs: 60 * 60 * 1000, limit: process.env.NODE_ENV === 'test' ? 10_000 : 20,
  keyGenerator: (req) => `u${req.user.id}`, standardHeaders: true, legacyHeaders: false, message: { error: 'Слишком много жалоб. Попробуйте позже.' },
}), (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().max(300).default('') }), req.body);
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(req.params.id));
  if (!m) throw new HttpError(404, 'Сообщение не найдено');
  load(m.conversation_id, req.user.id); // только участник разговора
  if (m.sender_id === req.user.id) throw new HttpError(400, 'Нельзя пожаловаться на своё сообщение');
  const r = db.prepare('INSERT OR IGNORE INTO message_reports (message_id, reporter_id, reason) VALUES (?,?,?)').run(m.id, req.user.id, reason);
  if (r.changes) notifyAdmin(`💬 Жалоба на сообщение в чате: «${m.body.slice(0, 120)}»${reason ? `\nПричина: ${reason}` : ''}`);
  res.status(201).json({ ok: true });
});

export default router;
