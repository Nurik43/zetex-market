import { useEffect, useState } from 'react';
import { api } from './api';

// Публичные настройки сервера (способы оплаты, города, пункты выдачи): грузятся один раз
let cached = null;
let pending = null;

export function useConfig() {
  const [cfg, setCfg] = useState(cached);
  useEffect(() => {
    if (cached) return;
    pending ??= api.config().then((c) => { cached = c; return c; }).catch(() => { pending = null; return null; });
    let alive = true;
    pending.then((c) => { if (alive && c) setCfg(c); });
    return () => { alive = false; };
  }, []);
  return cfg;
}
