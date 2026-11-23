import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Секрет JWT: из окружения, иначе генерируется один раз и хранится в data/.jwt_secret
function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(DATA_DIR, '.jwt_secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export const config = {
  port: Number(process.env.PORT) || 3001,
  jwtSecret: loadSecret(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  uploadDir: UPLOAD_DIR,
  dbFile: process.env.DB_FILE || path.join(DATA_DIR, 'zetex.db'),
  corsOrigin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
    : ['http://localhost:5173', 'http://127.0.0.1:5173'],
  isProd: process.env.NODE_ENV === 'production',
  // Демо-аккаунты (с известными паролями) и демо-товары: по умолчанию только вне production; в production — SEED_DEMO=1
  seedDemo: process.env.NODE_ENV !== 'production' || process.env.SEED_DEMO === '1',
  // Публичный адрес сайта: используется в ссылках из писем и в возвратах после оплаты
  appUrl: (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, ''),
  tzOffsetHours: Number(process.env.TZ_OFFSET_HOURS ?? 5), // Ташкент: UTC+5
  cookieName: 'ztx_session',
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === '1' : process.env.NODE_ENV === 'production',
  trustProxy: process.env.TRUST_PROXY === '1' || process.env.NODE_ENV === 'production',
  smtpUrl: process.env.SMTP_URL || '',
  mailFrom: process.env.MAIL_FROM || 'Zetex Market <no-reply@zetex.uz>',
  requireVerifiedEmail: process.env.REQUIRE_VERIFIED_EMAIL === '1',
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    adminChatId: process.env.TELEGRAM_ADMIN_CHAT_ID || '',
  },
  payments: {
    // Демо-оплата без реального провайдера: включена вне production или по PAYMENTS_MOCK=1
    mock: process.env.PAYMENTS_MOCK ? process.env.PAYMENTS_MOCK === '1' : process.env.NODE_ENV !== 'production',
    payme: {
      merchantId: process.env.PAYME_MERCHANT_ID || '',
      key: process.env.PAYME_KEY || '',
      test: process.env.PAYME_TEST === '1',
    },
    click: {
      serviceId: process.env.CLICK_SERVICE_ID || '',
      merchantId: process.env.CLICK_MERCHANT_ID || '',
      secretKey: process.env.CLICK_SECRET_KEY || '',
    },
    holdMinutes: Number(process.env.PAYMENT_HOLD_MINUTES) || 30, // сколько ждём оплату онлайн-заказа
  },
  // Реквизиты и контакты для страниц «Контакты», условий и подвала. Пустое не показывается.
  company: {
    name: process.env.COMPANY_NAME || 'ООО «ZETEX MARKET»',
    inn: process.env.COMPANY_INN || '',
    address: process.env.COMPANY_ADDRESS || '',
    phone: process.env.SUPPORT_PHONE || '',
    email: process.env.SUPPORT_EMAIL || '',
    hours: process.env.SUPPORT_HOURS || '',
    telegram: process.env.SUPPORT_TELEGRAM || '', // например https://t.me/zetex_support
    instagram: process.env.SOCIAL_INSTAGRAM || '',
    youtube: process.env.SOCIAL_YOUTUBE || '',
  },
  distDir: process.env.DIST_DIR || path.join(__dirname, '..', '..', 'dist'),
};
