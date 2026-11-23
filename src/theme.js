import { useSyncExternalStore } from 'react';

// Тема: 'system' (по настройке устройства) | 'light' | 'dark'
const KEY = 'ztx_theme';
const read = () => {
  try { const v = localStorage.getItem(KEY); if (v === 'light' || v === 'dark') return v; } catch { /* ignore */ }
  return 'system';
};

let pref = read();
const listeners = new Set();

function apply() {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0d121b' : '#1f4fe0');
}
apply(); // до первого рендера — без вспышки светлой темы
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply);

export function setTheme(next) {
  pref = next;
  try { next === 'system' ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, next); } catch { /* ignore */ }
  apply();
  listeners.forEach((cb) => cb());
}
const subscribe = (cb) => { listeners.add(cb); return () => listeners.delete(cb); };
export const useTheme = () => useSyncExternalStore(subscribe, () => pref, () => 'system');
