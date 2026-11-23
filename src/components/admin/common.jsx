import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, RotateCw, Search, X } from 'lucide-react';
import { t } from '../../i18n';

/** Диалог подтверждения опасного действия (вместо window.confirm). */
export function ConfirmDialog({ title, text, confirmLabel, danger = true, onConfirm, onCancel }) {
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const run = async () => {
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); }
  };

  return (
    <div className="ztx-admin-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="ztx-admin-dialog" role="dialog" aria-modal="true" aria-labelledby="ztx-admin-dlg-title">
        <h3 id="ztx-admin-dlg-title">{title}</h3>
        {text && <p>{text}</p>}
        <div className="ztx-admin-dialog-actions">
          <button ref={cancelRef} type="button" className="ztx-admin-btn" onClick={onCancel}>{t('Отмена')}</button>
          <button type="button" className={`ztx-admin-btn ${danger ? 'is-danger-solid' : 'is-primary'}`} onClick={run} disabled={busy}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Строка фильтров: поиск + произвольные элементы. */
export function Toolbar({ q, onQ, placeholder, children }) {
  return (
    <div className="ztx-admin-toolbar">
      {onQ && (
        <label className="ztx-admin-search">
          <Search size={16} aria-hidden="true" />
          <input type="search" value={q} onChange={(e) => onQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
        </label>
      )}
      {children}
    </div>
  );
}

export function Select({ value, onChange, label, options }) {
  return (
    <select className="ztx-admin-select" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
    </select>
  );
}

export function ErrorBox({ message, onRetry }) {
  return (
    <div className="ztx-admin-state is-error" role="alert">
      <AlertTriangle size={28} aria-hidden="true" />
      <p>{message}</p>
      {onRetry && <button type="button" className="ztx-admin-btn" onClick={onRetry}><RotateCw size={15} aria-hidden="true" /> {t('Повторить')}</button>}
    </div>
  );
}

export function Empty({ text }) {
  return (
    <div className="ztx-admin-state">
      <Inbox size={28} aria-hidden="true" />
      <p>{text}</p>
    </div>
  );
}

export function Skeleton({ rows = 5 }) {
  return (
    <div className="ztx-admin-skel" aria-busy="true" aria-label={t('Загрузка…')}>
      {Array.from({ length: rows }, (_, i) => <div key={i} className="ztx-admin-skel-row" />)}
    </div>
  );
}

export function Pager({ data, onPage }) {
  if (!data || data.pages <= 1) return null;
  return (
    <nav className="ztx-admin-pager" aria-label={t('Страницы')}>
      <button type="button" className="ztx-admin-btn is-icon" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)} aria-label={t('Предыдущая страница')}>
        <ChevronLeft size={16} />
      </button>
      <span>{t('Страница {page} из {pages}', { page: data.page, pages: data.pages })}</span>
      <button type="button" className="ztx-admin-btn is-icon" disabled={data.page >= data.pages} onClick={() => onPage(data.page + 1)} aria-label={t('Следующая страница')}>
        <ChevronRight size={16} />
      </button>
    </nav>
  );
}

/** Каркас результата запроса: скелетон / ошибка / пусто / содержимое + пагинация. */
export function ListState({ query, empty, onPage, children }) {
  const { data, error, loading, retry } = query;
  if (!data && loading) return <Skeleton />;
  if (!data) return <ErrorBox message={error || t('Не удалось загрузить данные')} onRetry={retry} />;
  return (
    <div className={loading ? 'ztx-admin-fading' : ''}>
      {error && <ErrorBox message={error} onRetry={retry} />}
      {data.items.length === 0 ? <Empty text={empty} /> : children(data.items)}
      <div className="ztx-admin-total">{t('Всего: {n}', { n: data.total })}</div>
      <Pager data={data} onPage={onPage} />
    </div>
  );
}

export function Badge({ tone = 'neutral', children }) {
  return <span className={`ztx-admin-badge is-${tone}`}>{children}</span>;
}

/** Диалог с обязательной (или необязательной) причиной — текст уходит продавцу и в журнал. */
export function ReasonDialog({ title, text, confirmLabel, danger = true, required = true, label, extra, onConfirm, onCancel }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);
  const run = async (e) => {
    e.preventDefault();
    if (required && !reason.trim()) { setErr(t('Укажите причину')); return; }
    setBusy(true); setErr('');
    try { await onConfirm(reason.trim()); } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  return (
    <div className="ztx-admin-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <form className="ztx-admin-dialog" role="dialog" aria-modal="true" aria-labelledby="ztx-admin-rsn-title" onSubmit={run}>
        <h3 id="ztx-admin-rsn-title">{title}</h3>
        {text && <p>{text}</p>}
        <label className="ztx-admin-field">{label || t('Причина')}{required ? ' *' : ''}
          <textarea ref={ref} className="ztx-admin-input" rows={3} maxLength={300} value={reason} onChange={(e) => { setReason(e.target.value); setErr(''); }}
            placeholder={t('Что именно не так — это увидит продавец или покупатель')} />
        </label>
        {extra}
        {err && <p className="ztx-admin-formerr" role="alert">{err}</p>}
        <div className="ztx-admin-dialog-actions">
          <button type="button" className="ztx-admin-btn" onClick={onCancel}>{t('Отмена')}</button>
          <button type="submit" className={`ztx-admin-btn ${danger ? 'is-danger-solid' : 'is-primary'}`} disabled={busy}>{confirmLabel}</button>
        </div>
      </form>
    </div>
  );
}

/** Боковая панель с подробностями (карточка пользователя, заказа, переписка). */
export function Drawer({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="ztx-admin-overlay is-drawer" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="ztx-admin-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="ztx-admin-drawer-head">
          <h3>{title}</h3>
          <button type="button" className="ztx-admin-btn is-icon" onClick={onClose} aria-label={t('Закрыть')}><X size={16} /></button>
        </div>
        <div className="ztx-admin-drawer-body">{children}</div>
      </aside>
    </div>
  );
}

/** Панель массовых действий — появляется, когда выбраны строки. */
export function BulkBar({ count, onClear, children }) {
  if (!count) return null;
  return (
    <div className="ztx-admin-bulk" role="region" aria-label={t('Массовые действия')}>
      <b>{t('Выбрано: {n}', { n: count })}</b>
      <div className="ztx-admin-actions">{children}<button type="button" className="ztx-admin-btn" onClick={onClear}>{t('Снять выбор')}</button></div>
    </div>
  );
}

export const Field = ({ label, children, hint }) => (
  <label className="ztx-admin-field">{label}{children}{hint && <span className="ztx-admin-muted">{hint}</span>}</label>
);

/** Ссылка-скачивание CSV (cookie уходит автоматически). */
export const CsvLink = ({ href, children }) => <a className="ztx-admin-btn" href={href} download>{children || t('Скачать CSV')}</a>;

/** Кнопка «Сбросить фильтры» — видна, только когда что-то выбрано. */
export function ResetFilters({ filters }) {
  if (!filters.dirty) return null;
  return <button type="button" className="ztx-admin-btn" onClick={filters.reset}>{t('Сбросить фильтры')}</button>;
}
