import { config } from './config.js';
import { db } from './db.js';

const read = (key) => {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!r) return undefined;
  try { return JSON.parse(r.value); } catch { return undefined; }
};

export const getSetting = (key, fallback) => read(key) ?? fallback;

export function setSetting(key, value) {
  if (value === undefined || value === null) db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  else db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
}

/** Режим модерации новых товаров: off — публикуются сразу; new_sellers — проверяем непроверенных продавцов; all — все товары. */
export const MODERATION_MODES = ['off', 'new_sellers', 'all'];
export const moderationMode = () => getSetting('moderation', 'off');

export const commissionDefault = () => Number(getSetting('commission_default', Number(process.env.COMMISSION_PERCENT ?? 10)));
export const commissionCategories = () => getSetting('commission_categories', {});
export const commissionFor = (category) => {
  const v = commissionCategories()[category];
  return Number.isFinite(Number(v)) && v !== undefined && v !== '' ? Number(v) : commissionDefault();
};

export const suspiciousTotal = () => Number(getSetting('suspicious_total', 20_000_000));

/** Контакты: значения из настроек админки перекрывают переменные окружения. */
export const companyInfo = () => {
  const over = getSetting('company', {});
  const out = { ...config.company };
  for (const [k, v] of Object.entries(over)) if (typeof v === 'string' && v.trim() !== '') out[k] = v.trim();
  return out;
};

/** Объявление над шапкой сайта. */
export const announcement = () => {
  const a = getSetting('announcement', null);
  return a && a.active && a.text ? { text: String(a.text), link: a.link ? String(a.link) : '' } : null;
};

/** Тексты и баннеры главной страницы; пустые поля — стандартный текст из интерфейса. */
export const homeContent = () => {
  const h = getSetting('home', {});
  const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  return {
    title: str(h.title, 80), text: str(h.text, 300), button: str(h.button, 30),
    banners: (Array.isArray(h.banners) ? h.banners : []).filter((b) => b && b.active && b.title).slice(0, 5)
      .map((b) => ({ title: str(b.title, 80), text: str(b.text, 200), link: str(b.link, 300), tone: ['brand', 'accent', 'warn'].includes(b.tone) ? b.tone : 'brand' })),
  };
};
export const homeContentRaw = () => {
  const h = getSetting('home', {});
  return { title: h.title || '', text: h.text || '', button: h.button || '', banners: Array.isArray(h.banners) ? h.banners : [] };
};
