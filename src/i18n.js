import { useSyncExternalStore } from 'react';
import { uz } from './locales/uz';

// Интерфейс RU/UZ. Ключом служит сама русская строка: t('Корзина') → «Savat» в узбекском.
// Нет перевода — показывается русский текст. Параметры: t('Заказ {code}', { code }).
const KEY = 'ztx_lang';
const LANGS = ['ru', 'uz'];

function initial() {
  try {
    const saved = localStorage.getItem(KEY);
    if (LANGS.includes(saved)) return saved;
  } catch { /* приватный режим */ }
  return typeof navigator !== 'undefined' && /^uz/i.test(navigator.language || '') ? 'uz' : 'ru';
}

let lang = initial();
const listeners = new Set();
if (typeof document !== 'undefined') document.documentElement.lang = lang;

export const getLang = () => lang;

export function setLang(next) {
  if (!LANGS.includes(next) || next === lang) return;
  lang = next;
  try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
  document.documentElement.lang = next;
  listeners.forEach((cb) => cb());
}

export function t(text, params) {
  if (typeof text !== 'string') return text;
  let out = lang === 'uz' ? (uz[text] ?? text) : text;
  if (params) out = out.replace(/\{(\w+)\}/g, (m, k) => (params[k] ?? m));
  return out;
}

const subscribe = (cb) => { listeners.add(cb); return () => listeners.delete(cb); };
/** Подписка компонента на смену языка (достаточно один раз в App — дочерние перерисовываются вместе с ним). */
export const useLang = () => useSyncExternalStore(subscribe, getLang, () => 'ru');

export const locale = () => (lang === 'uz' ? 'uz-UZ' : 'ru-RU');
export const fmtDate = (value, opts = { day: 'numeric', month: 'long', year: 'numeric' }) => {
  const d = new Date(String(value).includes('T') ? value : `${String(value).replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(locale(), opts);
};

/** Русское склонение по числу: plural(5, ['товар', 'товара', 'товаров']). В узбекском формы нет — берётся перевод последней формы. */
export const plural = (n, [one, few, many]) => {
  if (lang === 'uz') return t(many);
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};
