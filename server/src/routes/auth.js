import crypto from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { db } from '../db.js';
import QRCode from 'qrcode';
import { signToken, setSessionCookie, clearSessionCookie, requireAuth, requireRole } from '../auth.js';
import { newSecret, verifyTotp, otpauthUrl } from '../totp.js';
import { HttpError, asyncHandler, parse, toUser, sha256 } from '../util.js';
import { sendMailSafe } from '../mailer.js';

const router = Router();

const limiter = (limit) => rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 10_000 : limit,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток. Попробуйте позже.' },
});
const authLimiter = limiter(30);
const mailLimiter = limiter(8);

const password = z
  .string()
  .min(8, 'минимум 8 символов')
  .max(100)
  .regex(/[A-Z]/, 'нужна заглавная буква')
  .regex(/[a-z]/, 'нужна строчная буква')
  .regex(/[0-9]/, 'нужна цифра');

/** Открывает сессию: cookie для браузера; токен в теле — только для не-браузерных клиентов (без заголовка X-Zetex-Client). */
function openSession(req, res, row, status = 200) {
  setSessionCookie(res, row);
  const body = { user: toUser(row) };
  if (!req.headers['x-zetex-client']) body.token = signToken(row);
  res.status(status).json(body);
}

/** Создаёт одноразовую ссылку (в базе хранится только хэш). */
function issueToken(userId, type, ttlMinutes) {
  const raw = crypto.randomBytes(32).toString('hex');
  if (type === 'reset') db.prepare("UPDATE auth_tokens SET used_at = datetime('now') WHERE user_id = ? AND type = 'reset' AND used_at IS NULL").run(userId);
  db.prepare(`INSERT INTO auth_tokens (user_id, type, token_hash, expires_at) VALUES (?, ?, ?, datetime('now', '+${ttlMinutes} minutes'))`)
    .run(userId, type, sha256(raw));
  return raw;
}

/** Забирает токен: возвращает user_id или бросает 400. Токен сгорает при использовании. */
function consumeToken(raw, type) {
  const row = db.prepare(`SELECT * FROM auth_tokens WHERE token_hash = ? AND type = ?`).get(sha256(String(raw)), type);
  if (!row || row.used_at || row.expires_at < new Date().toISOString().slice(0, 19).replace('T', ' ')) {
    throw new HttpError(400, 'Ссылка недействительна или устарела');
  }
  db.prepare("UPDATE auth_tokens SET used_at = datetime('now') WHERE id = ?").run(row.id);
  return row.user_id;
}

function sendVerification(row) {
  const t = issueToken(row.id, 'verify', 60 * 24);
  return sendMailSafe({
    to: row.email,
    subject: 'Подтвердите почту на Zetex Market',
    text: `Здравствуйте, ${row.first_name}!\n\nПодтвердите адрес почты по ссылке (действует 24 часа):\n${config.appUrl}/verify-email?token=${t}\n\nЕсли вы не регистрировались — просто проигнорируйте письмо.`,
  });
}

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email('некорректная почта').max(120),
  password,
  role: z.enum(['buyer', 'seller']).default('buyer'), // admin через API создать нельзя
  firstName: z.string().trim().min(2, 'минимум 2 символа').max(60),
  lastName: z.string().trim().min(2, 'минимум 2 символа').max(60),
  phone: z.string().trim().max(30).default(''),
  companyName: z.string().trim().max(120).default(''),
  inn: z.string().trim().regex(/^\d{0,14}$/, 'только цифры').default(''),
  acceptTerms: z.boolean().refine((v) => v === true, 'необходимо принять условия'),
});

router.post('/register', authLimiter, asyncHandler(async (req, res) => {
  const d = parse(registerSchema, req.body);
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(d.email)) {
    throw new HttpError(409, 'Пользователь с такой почтой уже зарегистрирован');
  }
  const hash = await bcrypt.hash(d.password, 10);
  const info = db.prepare(`
    INSERT INTO users (email, password_hash, role, first_name, last_name, phone, company_name, inn, terms_accepted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`).run(d.email, hash, d.role, d.firstName, d.lastName, d.phone, d.companyName, d.inn);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  sendVerification(row);
  openSession(req, res, row, 201);
}));

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, 'введите почту'),
  password: z.string().min(1, 'введите пароль'),
  code: z.string().trim().max(10).optional(),
});

const loginEvent = (req, row, email, ok) =>
  db.prepare('INSERT INTO login_events (user_id, email, ip, ua, ok) VALUES (?,?,?,?,?)')
    .run(row?.id ?? null, String(email).slice(0, 200), String(req.ip || '').slice(0, 60), String(req.headers['user-agent'] || '').slice(0, 200), ok ? 1 : 0);

// Хэш-заглушка, чтобы время ответа не выдавало, существует ли почта
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 10);

router.post('/login', authLimiter, asyncHandler(async (req, res) => {
  const d = parse(loginSchema, req.body);
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(d.email);
  const ok = await bcrypt.compare(d.password, row ? row.password_hash : DUMMY_HASH);
  if (!row || !ok) { loginEvent(req, row, d.email, false); throw new HttpError(401, 'Неверная почта или пароль'); }
  if (row.blocked) throw new HttpError(403, `Аккаунт заблокирован.${row.blocked_reason ? ` Причина: ${row.blocked_reason}.` : ''} Напишите в поддержку.`);
  if (row.totp_enabled) {
    if (!d.code) { const e = new HttpError(401, 'Введите код из приложения-аутентификатора'); e.need2fa = true; throw e; }
    if (!verifyTotp(row.totp_secret, d.code)) { loginEvent(req, row, d.email, false); const e = new HttpError(401, 'Неверный код из приложения'); e.need2fa = true; throw e; }
  }
  loginEvent(req, row, d.email, true);
  openSession(req, res, row);
}));

// ---- Двухфакторная защита (приложение-аутентификатор), для администраторов ----
router.post('/2fa/setup', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (row.totp_enabled) throw new HttpError(409, 'Двухфакторная защита уже включена');
  const secret = newSecret();
  db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret, req.user.id);
  const url = otpauthUrl(secret, row.email);
  res.json({ secret, otpauth: url, qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }) });
}));

router.post('/2fa/enable', requireAuth, requireRole('admin'), (req, res) => {
  const { code } = parse(z.object({ code: z.string().trim().min(6).max(10) }), req.body);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!row.totp_secret) throw new HttpError(409, 'Сначала начните настройку');
  if (!verifyTotp(row.totp_secret, code)) throw new HttpError(400, 'Неверный код. Проверьте время на телефоне и попробуйте ещё раз');
  db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(req.user.id);
  res.json({ ok: true });
});

router.post('/2fa/disable', requireAuth, requireRole('admin'), authLimiter, asyncHandler(async (req, res) => {
  const d = parse(z.object({ password: z.string().min(1), code: z.string().trim().min(6).max(10) }), req.body);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!(await bcrypt.compare(d.password, row.password_hash))) throw new HttpError(400, 'Неверный пароль');
  if (!verifyTotp(row.totp_secret, d.code)) throw new HttpError(400, 'Неверный код из приложения');
  db.prepare("UPDATE users SET totp_enabled = 0, totp_secret = '' WHERE id = ?").run(req.user.id);
  res.json({ ok: true });
}));

router.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

const profileSchema = z.object({
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().min(1).max(60).optional(),
  middleName: z.string().trim().max(60).optional(),
  phone: z.string().trim().max(30).optional(),
  birthDate: z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'формат ГГГГ-ММ-ДД').optional(),
  gender: z.string().trim().max(20).optional(),
  companyName: z.string().trim().max(120).optional(),
  inn: z.string().trim().regex(/^\d{0,14}$/, 'только цифры').optional(),
});

const COLS = {
  firstName: 'first_name', lastName: 'last_name', middleName: 'middle_name', phone: 'phone',
  birthDate: 'birth_date', gender: 'gender', companyName: 'company_name', inn: 'inn',
};

router.patch('/me', requireAuth, (req, res) => {
  const d = parse(profileSchema, req.body);
  const entries = Object.entries(d).filter(([, v]) => v !== undefined);
  if (entries.length) {
    const sets = entries.map(([k]) => `${COLS[k]} = ?`).join(', ');
    db.prepare(`UPDATE users SET ${sets} WHERE id = ?`).run(...entries.map(([, v]) => v), req.user.id);
  }
  res.json({ user: toUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

const pwSchema = z.object({ currentPassword: z.string().min(1), newPassword: password });

router.post('/change-password', requireAuth, authLimiter, asyncHandler(async (req, res) => {
  const d = parse(pwSchema, req.body);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!(await bcrypt.compare(d.currentPassword, row.password_hash))) {
    throw new HttpError(400, 'Текущий пароль неверен');
  }
  // token_version +1 выбрасывает все прежние сессии; текущая получает новый cookie
  db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?')
    .run(await bcrypt.hash(d.newPassword, 10), req.user.id);
  openSession(req, res, db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id));
}));

// --- Восстановление пароля ---
router.post('/forgot-password', mailLimiter, asyncHandler(async (req, res) => {
  const { email } = parse(z.object({ email: z.string().trim().toLowerCase().email() }), req.body);
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  // Ответ всегда одинаковый, чтобы нельзя было выяснить, кто зарегистрирован
  if (row && !row.blocked) {
    const t = issueToken(row.id, 'reset', 60);
    await sendMailSafe({
      to: row.email,
      subject: 'Сброс пароля на Zetex Market',
      text: `Здравствуйте, ${row.first_name}!\n\nЧтобы задать новый пароль, перейдите по ссылке (действует 1 час):\n${config.appUrl}/reset-password?token=${t}\n\nЕсли вы не запрашивали сброс — проигнорируйте письмо, пароль не изменится.`,
    });
  }
  res.json({ ok: true });
}));

router.post('/reset-password', authLimiter, asyncHandler(async (req, res) => {
  const d = parse(z.object({ token: z.string().min(10).max(200), password }), req.body);
  const userId = consumeToken(d.token, 'reset');
  db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?')
    .run(await bcrypt.hash(d.password, 10), userId);
  res.json({ ok: true });
}));

// --- Подтверждение почты ---
router.post('/verify-email', authLimiter, (req, res) => {
  const { token } = parse(z.object({ token: z.string().min(10).max(200) }), req.body);
  const userId = consumeToken(token, 'verify');
  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(userId);
  res.json({ ok: true });
});

router.post('/resend-verification', requireAuth, mailLimiter, asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!row.email_verified) await sendVerification(row);
  res.json({ ok: true });
}));

export default router;
