import { useMemo } from 'react';
import { Phone, Mail, MapPin, Clock, Send } from 'lucide-react';
import { t, getLang } from '../i18n';
import { navigate } from '../router';
import { useConfig } from '../useConfig';
import { buildLegal, LEGAL_UPDATED, LEGAL_PAGES, LEGAL_TITLES } from '../legal/content';
import './legal.css';

function Contacts({ cfg }) {
  const c = cfg?.company || {};
  const points = cfg?.delivery?.pickupPoints || [];
  const rows = [
    c.phone && { icon: Phone, label: t('Телефон'), value: c.phone, href: `tel:${c.phone.replace(/[^\d+]/g, '')}` },
    c.email && { icon: Mail, label: t('Почта'), value: c.email, href: `mailto:${c.email}` },
    c.telegram && { icon: Send, label: 'Telegram', value: c.telegram.replace(/^https?:\/\//, ''), href: c.telegram },
    c.hours && { icon: Clock, label: t('Часы работы поддержки'), value: c.hours },
    c.address && { icon: MapPin, label: t('Адрес'), value: c.address },
  ].filter(Boolean);

  return (
    <>
      <h1>{t('Контакты')}</h1>
      <p className="ztx-legal-lead">{c.name}{c.inn ? `, ${t('ИНН')} ${c.inn}` : ''}</p>
      {rows.length ? (
        <ul className="ztx-contact-list">
          {rows.map((r) => (
            <li key={r.label}>
              <r.icon size={18} aria-hidden="true" />
              <div>
                <span>{r.label}</span>
                {r.href ? <a href={r.href} target={r.href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer">{r.value}</a> : <strong>{r.value}</strong>}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ztx-legal-note">{t('Контактные данные поддержки пока не заполнены.')}</p>
      )}
      <p>{t('Для вопросов по заказу укажите его номер (например, ZTX-123456) — так мы ответим быстрее. Частые вопросы собраны в разделе')} <a href="/faq">{t('Вопросы и ответы')}</a>.</p>
      {points.length > 0 && (
        <>
          <h2>{t('Пункты выдачи')}</h2>
          <ul className="ztx-contact-points">
            {points.map((p) => <li key={p.id}><strong>{p.name}</strong><span>{p.city}, {p.address}</span></li>)}
          </ul>
        </>
      )}
    </>
  );
}

export default function Legal({ slug }) {
  const cfg = useConfig();
  const docs = useMemo(() => buildLegal(cfg), [cfg]);
  const doc = docs[slug];

  return (
    <article className="ztx-legal">
      <nav className="ztx-legal-nav" aria-label={t('Разделы')}>
        {LEGAL_PAGES.map((s) => (
          <a key={s} href={`/${s}`} aria-current={s === slug ? 'page' : undefined}>{t(LEGAL_TITLES[s])}</a>
        ))}
      </nav>
      <div className="ztx-legal-body">
        {slug === 'contacts' ? <Contacts cfg={cfg} /> : doc && (
          <>
            <h1>{t(doc.title)}</h1>
            {slug !== 'faq' && <p className="ztx-legal-lead">{t('Редакция от')} {LEGAL_UPDATED}</p>}
            {getLang() === 'uz' && <p className="ztx-legal-note">{t('Текст доступен на русском языке.')}</p>}
            {slug === 'faq'
              ? doc.sections.map((s) => (
                <details key={s.h} className="ztx-faq-item">
                  <summary>{s.h}</summary>
                  {s.p.map((x) => <p key={x}>{x}</p>)}
                </details>
              ))
              : doc.sections.map((s) => (
                <section key={s.h}>
                  <h2>{s.h}</h2>
                  {s.p.map((x) => <p key={x}>{x}</p>)}
                </section>
              ))}
          </>
        )}
        <p><button type="button" className="ztx-legal-back" onClick={() => (window.history.length > 1 ? window.history.back() : navigate('/'))}>← {t('Назад')}</button></p>
      </div>
    </article>
  );
}
