import { Shield } from 'lucide-react';
import { t } from '../i18n';
import { useConfig } from '../useConfig';
import './footer.css';

export default function Footer({ onOpenAuth }) {
  const cfg = useConfig();
  const c = cfg?.company || {};
  const social = [
    c.telegram && ['Telegram', c.telegram],
    c.instagram && ['Instagram', c.instagram],
    c.youtube && ['YouTube', c.youtube],
  ].filter(Boolean);

  return (
    <footer className="ztx-footer">
      <div className="ztx-footer-in">
        <div className="ztx-footer-grid">
          <nav aria-label={t('О нас')}>
            <h4>{t('О нас')}</h4>
            <a href="/contacts">{t('Контакты')}</a>
            <a href="/contacts">{t('Пункты выдачи')}</a>
            <a href="/faq">{t('Вопросы и ответы')}</a>
          </nav>
          <nav aria-label={t('Пользователям')}>
            <h4>{t('Пользователям')}</h4>
            <a href="/returns">{t('Возврат и обмен')}</a>
            <a href="/faq">{t('Доставка и оплата')}</a>
            <a href="/terms">{t('Пользовательское соглашение')}</a>
          </nav>
          <nav aria-label={t('Для предпринимателей')}>
            <h4>{t('Для предпринимателей')}</h4>
            <button type="button" onClick={onOpenAuth}>{t('Продавайте на Zetex')}</button>
            <button type="button" onClick={onOpenAuth}>{t('Вход для продавцов')}</button>
          </nav>
          <div>
            <h4>{t('Поддержка')}</h4>
            {c.phone && <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}>{c.phone}</a>}
            {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
            {c.hours && <span className="ztx-footer-muted">{c.hours}</span>}
            {!c.phone && !c.email && <a href="/contacts">{t('Как с нами связаться')}</a>}
            {social.length > 0 && (
              <div className="ztx-footer-social">
                {social.map(([label, href]) => <a key={label} href={href} target="_blank" rel="noopener noreferrer">{label}</a>)}
              </div>
            )}
          </div>
        </div>

        <div className="ztx-footer-bottom">
          <div className="ztx-footer-legal">
            <a href="/privacy">{t('Политика конфиденциальности')}</a>
            <a href="/terms">{t('Пользовательское соглашение')}</a>
            <a href="/returns">{t('Возврат и обмен')}</a>
          </div>
          <div className="ztx-footer-copy">
            <Shield size={14} aria-hidden="true" />
            <span>{new Date().getFullYear()} © {c.name || 'Zetex Market'}. {t('Все права защищены')}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
