import { useSyncExternalStore } from 'react';

/**
 * Небольшое хранилище списка id в localStorage с подпиской (для «сравнения» и «недавно просмотренных»).
 * Переживает перезагрузку, синхронизируется между вкладками.
 */
export function createIdList(key, max) {
  let cache;
  const listeners = new Set();
  const read = () => {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return Array.isArray(v) ? v.filter((x) => Number.isInteger(x)).slice(0, max) : [];
    } catch { return []; }
  };
  cache = read();
  const emit = () => listeners.forEach((cb) => cb());
  const write = (list) => {
    cache = list.slice(0, max);
    try { localStorage.setItem(key, JSON.stringify(cache)); } catch { /* квота/приватный режим */ }
    emit();
  };
  window.addEventListener('storage', (e) => { if (e.key === key) { cache = read(); emit(); } });
  const subscribe = (cb) => { listeners.add(cb); return () => listeners.delete(cb); };
  return {
    get: () => cache,
    use: () => useSyncExternalStore(subscribe, () => cache, () => []),
    /** Добавить в начало (без дублей). Возвращает false, если лимит достигнут и это не «недавние». */
    add: (id, { evict = false } = {}) => {
      if (cache.includes(id)) return true;
      if (cache.length >= max && !evict) return false;
      write([id, ...cache]);
      return true;
    },
    remove: (id) => write(cache.filter((x) => x !== id)),
    clear: () => write([]),
    has: (id) => cache.includes(id),
  };
}

export const recentlyViewed = createIdList('ztx_recent', 12);
export const compareList = createIdList('ztx_compare', 4);
