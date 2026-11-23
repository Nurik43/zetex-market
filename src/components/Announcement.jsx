import { useState } from 'react';
import { X } from 'lucide-react';
import { useConfig } from '../useConfig';
import { t } from '../i18n';

/** Объявление над шапкой — задаётся администратором в «Настройки». Закрывается до конца сессии вкладки. */
export default function Announcement() {
  const cfg = useConfig();
  const a = cfg?.announcement;
  const key = a ? `ztx-ann:${a.text}` : '';
  const [closed, setClosed] = useState(() => { try { return !!key && sessionStorage.getItem(key) === '1'; } catch { return false; } });
  if (!a || closed) return null;
  const close = () => { setClosed(true); try { sessionStorage.setItem(key, '1'); } catch { /* без хранилища — просто закроем */ } };
  return (
    <div className="ztx-announce" role="region" aria-label={t('Объявление')}>
      {a.link ? <a href={a.link} {...(a.link.startsWith('http') ? { target: '_blank', rel: 'noreferrer' } : {})}>{a.text}</a> : <span>{a.text}</span>}
      <button type="button" onClick={close} aria-label={t('Закрыть')}><X size={14} /></button>
    </div>
  );
}
