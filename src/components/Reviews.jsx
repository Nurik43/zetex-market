import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, Pencil, Trash2, Store } from 'lucide-react';
import { api } from '../api';
import { t, fmtDate, locale } from '../i18n';
import { useToast } from './useToast';
import Stars from './Stars';
import './reviews.css';

const LIMIT = 10;
const MAX_TEXT = 2000;

// Форма создания/правки отзыва
function ReviewForm({ initial, busy, onSubmit, onCancel }) {
  const [rating, setRating] = useState(initial?.rating || 0);
  const [text, setText] = useState(initial?.text || '');
  const [err, setErr] = useState('');

  const submit = (e) => {
    e.preventDefault();
    if (!rating) { setErr(t('Поставьте оценку от 1 до 5')); return; }
    onSubmit({ rating, text: text.trim() });
  };

  return (
    <form className="ztx-reviews-form" onSubmit={submit} noValidate>
      <div className="ztx-reviews-form-row">
        <span className="ztx-reviews-label" id="ztx-rv-rating">{t('Ваша оценка')}</span>
        <Stars value={rating} size={28} onChange={(v) => { setRating(v); setErr(''); }} label={t('Ваша оценка')} />
      </div>
      <label className="ztx-reviews-label" htmlFor="ztx-rv-text">{t('Комментарий')}</label>
      <textarea
        id="ztx-rv-text"
        value={text}
        maxLength={MAX_TEXT}
        rows={4}
        placeholder={t('Что понравилось, что нет, как товар в использовании?')}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="ztx-reviews-form-foot">
        <span className="ztx-reviews-count">{text.length} / {MAX_TEXT}</span>
        {err && <span className="ztx-reviews-err" role="alert">{err}</span>}
        <span className="ztx-reviews-spacer" />
        {onCancel && <button type="button" className="ztx-reviews-btn" onClick={onCancel} disabled={busy}>{t('Отмена')}</button>}
        <button type="submit" className="ztx-reviews-btn primary" disabled={busy}>
          {initial ? t('Сохранить') : t('Отправить отзыв')}
        </button>
      </div>
    </form>
  );
}

export default function Reviews({ productId, user, onOpenAuth, onChanged }) {
  const { toast } = useToast();
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const pageRef = useRef(1);
  const userId = user?.id ?? null;

  // Загрузка первых страниц (reload=true — вернуться к началу после изменений)
  const load = useCallback(async (page, append) => {
    try {
      const d = await api.reviews(productId, { page, limit: LIMIT });
      pageRef.current = page;
      setError('');
      setState((s) => (append && s ? { ...d, items: [...s.items, ...d.items] } : d));
    } catch (e) {
      setError(e.message);
    }
  }, [productId]);

  useEffect(() => {
    // сброс при смене товара/пользователя — осознанная синхронизация с внешними данными
    /* eslint-disable react-hooks/set-state-in-effect */
    setState(null);
    setEditing(null);
    setConfirmDel(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    load(1, false);
  }, [load, userId]);

  const more = async () => {
    setLoadingMore(true);
    await load(pageRef.current + 1, true);
    setLoadingMore(false);
  };

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      await fn();
      toast(okMsg);
      setEditing(null);
      setConfirmDel(null);
      await load(1, false);
      onChanged?.();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (error && !state) {
    return (
      <div className="ztx-reviews-state" role="alert">
        <p>{error}</p>
        <button className="ztx-reviews-btn" onClick={() => load(1, false)}>{t('Повторить')}</button>
      </div>
    );
  }
  if (!state) return <div className="ztx-reviews-skel" aria-busy="true" aria-label={t('Загрузка…')} />;

  const { items, total, average, breakdown, canReview } = state;
  const hasMore = items.length < total;

  let formBlock = null;
  if (!user) {
    formBlock = (
      <div className="ztx-reviews-note">
        <span>{t('Войдите, чтобы оставить отзыв')}</span>
        <button className="ztx-reviews-btn primary" onClick={onOpenAuth}>{t('Войти')}</button>
      </div>
    );
  } else if (canReview) {
    formBlock = (
      <ReviewForm
        busy={busy}
        onSubmit={(d) => run(() => api.addReview(productId, d), t('Спасибо за отзыв!'))}
      />
    );
  } else if (state.myReviewId == null) {
    formBlock = <div className="ztx-reviews-note"><span>{t('Оставить отзыв можно после получения товара')}</span></div>;
  }

  return (
    <div className="ztx-reviews">
      {total > 0 && (
        <div className="ztx-reviews-summary">
          <div className="ztx-reviews-avg">
            <b>{average.toLocaleString(locale(), { minimumFractionDigits: 1 })}</b>
            <Stars value={average} size={18} />
            <span>{t('Отзывов: {n}', { n: total })}</span>
          </div>
          <ul className="ztx-reviews-bars" aria-label={t('Распределение оценок')}>
            {[5, 4, 3, 2, 1].map((n) => (
              <li key={n}>
                <span className="ztx-reviews-bar-n">{n}</span>
                <span className="ztx-reviews-bar"><i style={{ width: `${total ? ((breakdown[n] || 0) / total) * 100 : 0}%` }} /></span>
                <span className="ztx-reviews-bar-c">{breakdown[n] || 0}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {formBlock}

      {total === 0 ? (
        <div className="ztx-reviews-empty">
          <MessageSquare size={30} aria-hidden="true" />
          <b>{t('Отзывов пока нет')}</b>
          <span>{t('Станьте первым, кто поделится впечатлением о товаре.')}</span>
        </div>
      ) : (
        <ul className="ztx-reviews-list">
          {items.map((r) => (
            <li key={r.id} className={`ztx-reviews-item ${r.mine ? 'mine' : ''}`}>
              {editing === r.id ? (
                <ReviewForm
                  initial={r}
                  busy={busy}
                  onCancel={() => setEditing(null)}
                  onSubmit={(d) => run(() => api.updateReview(r.id, d), t('Отзыв обновлён'))}
                />
              ) : (
                <>
                  <div className="ztx-reviews-head">
                    <b>{r.author}</b>
                    {r.mine && <span className="ztx-reviews-tag">{t('Ваш отзыв')}</span>}
                    <Stars value={r.rating} size={14} />
                    <time className="ztx-reviews-date">{fmtDate(r.createdAt)}</time>
                  </div>
                  {r.text && <p className="ztx-reviews-text">{r.text}</p>}
                  {r.reply && (
                    <div className="ztx-reviews-reply">
                      <div><Store size={14} aria-hidden="true" /> <b>{t('Ответ продавца')}</b>{r.repliedAt && <time> · {fmtDate(r.repliedAt)}</time>}</div>
                      <p>{r.reply}</p>
                    </div>
                  )}
                  {r.mine && (
                    <div className="ztx-reviews-actions">
                      {confirmDel === r.id ? (
                        <>
                          <span>{t('Удалить отзыв?')}</span>
                          <button className="ztx-reviews-btn danger" disabled={busy} onClick={() => run(() => api.deleteReview(r.id), t('Отзыв удалён'))}>{t('Да, удалить')}</button>
                          <button className="ztx-reviews-btn" disabled={busy} onClick={() => setConfirmDel(null)}>{t('Отмена')}</button>
                        </>
                      ) : (
                        <>
                          <button className="ztx-reviews-btn" onClick={() => setEditing(r.id)}><Pencil size={14} aria-hidden="true" /> {t('Изменить')}</button>
                          <button className="ztx-reviews-btn" onClick={() => setConfirmDel(r.id)}><Trash2 size={14} aria-hidden="true" /> {t('Удалить')}</button>
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {hasMore && (
        <button className="ztx-reviews-btn more" onClick={more} disabled={loadingMore}>
          {loadingMore ? t('Загрузка…') : t('Показать ещё')}
        </button>
      )}
      {error && <p className="ztx-reviews-err" role="alert">{error}</p>}
    </div>
  );
}
