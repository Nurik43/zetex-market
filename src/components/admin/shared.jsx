import { useState } from 'react';
import { useToast } from '../useToast';
import { t } from '../../i18n';
import { Badge } from './common';
import { useDebounced } from './hooks';

export const stat = (map, key) => { const [label, tone] = map[key] || [key, 'neutral']; return <Badge tone={tone}>{t(label)}</Badge>; };

/** Общий обработчик действий: пишет тост, обновляет список. */
export function useAct() {
  const { toast } = useToast();
  return async (fn, okMsg, after) => {
    try { await fn(); if (okMsg) toast(t(okMsg)); after?.(); return true; } catch (e) { toast(e.message, 'error'); return false; }
  };
}

/**
 * Состояние фильтров списка: q (с задержкой), page и произвольные поля; смена фильтра сбрасывает страницу.
 * Если передан key — выбранные фильтры запоминаются в браузере (после перезагрузки страницы они на месте);
 * preset (переход с карточки «Обзора») важнее запомненного.
 */
const storeKey = (key) => `ztx-admin-f:${key}`;
export function useFilters(init, key, preset = {}) {
  const [f, setF] = useState(() => {
    let saved = {};
    if (key) { try { saved = JSON.parse(localStorage.getItem(storeKey(key)) || '{}') || {}; } catch { saved = {}; } }
    const clean = Object.fromEntries(Object.entries(saved).filter(([k]) => k in init && k !== 'page'));
    return { q: '', ...init, ...clean, ...preset, page: 1 };
  });
  const q = useDebounced(f.q);
  const save = (next) => {
    if (!key) return;
    try { const { page, ...rest } = next; void page; localStorage.setItem(storeKey(key), JSON.stringify(rest)); } catch { /* без хранилища — просто не запоминаем */ }
  };
  const set = (patch) => setF((s) => { const next = { ...s, page: 1, ...patch }; save(next); return next; });
  const dirty = Object.entries({ q: '', ...init }).some(([k, v]) => f[k] !== v);
  const reset = () => { const next = { q: '', ...init, page: 1 }; setF(next); save(next); };
  return { f, set, page: (page) => setF((s) => ({ ...s, page })), params: { ...f, q }, dirty, reset };
}

export const dt = (v) => (v ? String(v).replace('T', ' ').slice(0, 16) : '—');
export const personName = (u) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.companyName || u.email;
export const ROLES = { buyer: 'Покупатель', seller: 'Продавец', admin: 'Администратор' };
