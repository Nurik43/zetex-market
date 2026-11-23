import { useMemo, useSyncExternalStore } from 'react';

// Роутер на History API с чистыми адресами: /  /catalog?category=…  /product/12  /checkout  /orders  /admin
// (раньше были адреса с #/ — их по-прежнему понимаем и переписываем при загрузке).
const EVENT = 'ztx:navigate';

// Старые ссылки вида /#/product/12 → /product/12
if (typeof window !== 'undefined' && window.location.hash.startsWith('#/')) {
  window.history.replaceState(null, '', window.location.hash.slice(1));
}

const subscribe = (cb) => {
  window.addEventListener('popstate', cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener('popstate', cb);
    window.removeEventListener(EVENT, cb);
  };
};
const getSnapshot = () => window.location.pathname + window.location.search;

export function parseLocation(url) {
  const [path, qs = ''] = url.split('?');
  const parts = path.split('/');
  const name = parts[1] || 'home';
  // /product/12 → id = '12'
  return { name, id: parts[2] || '', path: path || '/', params: Object.fromEntries(new URLSearchParams(qs)) };
}

export function useRoute() {
  const url = useSyncExternalStore(subscribe, getSnapshot, () => '/');
  return useMemo(() => parseLocation(url), [url]);
}

export function navigate(path, { replace = false } = {}) {
  if (getSnapshot() === path) return;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', path);
  window.dispatchEvent(new Event(EVENT));
}

/**
 * Обычные <a href="/…"> работают как переходы внутри приложения (без перезагрузки страницы).
 * Не трогаем: клики с модификаторами, средняя кнопка, target, download, внешние адреса, якоря #…, /api и /uploads.
 */
export function installLinkInterceptor() {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
    const href = a.getAttribute('href');
    if (!href.startsWith('/') || href.startsWith('//') || /^\/(api|uploads)\//.test(href)) return;
    e.preventDefault();
    navigate(href);
  });
}

/** Ссылка на каталог с фильтрами; пустые значения отбрасываются. */
export function catalogUrl(filters = {}) {
  const u = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v !== '' && v != null && v !== false) u.set(k, String(v)); });
  const s = u.toString();
  return '/catalog' + (s ? `?${s}` : '');
}
