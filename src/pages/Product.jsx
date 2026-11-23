import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ShoppingBag, Heart, Scale, Share2, MessageCircle, ChevronLeft, ChevronRight, X, Flag, EyeOff, SearchX, ZoomIn } from 'lucide-react';
import { api, imgUrl, hideBrokenImg } from '../api';
import { useQuery } from '../useQuery';
import { useToast } from '../components/useToast';
import { navigate, catalogUrl } from '../router';
import { compareList, recentlyViewed } from '../localStore';
import { t } from '../i18n';
import { money, monthly } from '../format';
import Stars from '../components/Stars';
import Reviews from '../components/Reviews';
import ProductCard from '../components/ProductCard';
import ComposeDialog from '../components/ComposeDialog';
import './product.css';

const REASONS = [
  ['spam', 'Спам или реклама'],
  ['prohibited', 'Запрещённый товар'],
  ['fake', 'Подделка или обман'],
  ['wrong', 'Неверное описание или цена'],
  ['other', 'Другое'],
];

// Закрытие по Esc и возврат фокуса на элемент, который был активен до открытия
function useDialog(onClose) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      const nodes = ref.current.querySelectorAll('button, textarea, input, select, a[href]');
      const list = [...nodes].filter((n) => !n.disabled);
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return ref;
}

function Lightbox({ photos, index, title, onIndex, onClose }) {
  const ref = useDialog(onClose);
  const n = photos.length;
  const go = useCallback((d) => onIndex((index + d + n) % n), [index, n, onIndex]);
  const touchX = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (n < 2) return;
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, n]);

  useEffect(() => { ref.current?.querySelector('.ztx-product-lb-close')?.focus(); }, [ref]);

  return createPortal(
    <div
      className="ztx-product-lb"
      role="dialog"
      aria-modal="true"
      aria-label={t('Просмотр фотографий')}
      ref={ref}
      onClick={onClose}
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        const dx = e.changedTouches[0].clientX - (touchX.current ?? 0);
        if (n > 1 && Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
      }}
    >
      <button className="ztx-product-lb-close" aria-label={t('Закрыть')} onClick={onClose}><X size={22} /></button>
      {n > 1 && (
        <button className="ztx-product-lb-nav prev" aria-label={t('Предыдущее фото')} onClick={(e) => { e.stopPropagation(); go(-1); }}><ChevronLeft size={28} /></button>
      )}
      <img src={imgUrl(photos[index])} alt={title} onClick={(e) => e.stopPropagation()} onError={hideBrokenImg} />
      {n > 1 && (
        <button className="ztx-product-lb-nav next" aria-label={t('Следующее фото')} onClick={(e) => { e.stopPropagation(); go(1); }}><ChevronRight size={28} /></button>
      )}
      {n > 1 && <span className="ztx-product-lb-count">{index + 1} / {n}</span>}
    </div>,
    document.body,
  );
}

function Gallery({ photos, title }) {
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(false);
  const touchX = useRef(null);
  const n = photos.length;
  const go = (d) => setIndex((i) => (i + d + n) % n);

  const onKey = (e) => {
    if (n < 2) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
  };

  return (
    <div className="ztx-product-gallery" onKeyDown={onKey}>
      <div
        className="ztx-product-main"
        onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          const dx = e.changedTouches[0].clientX - (touchX.current ?? 0);
          if (n > 1 && Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
        }}
      >
        <button className="ztx-product-zoom" aria-label={t('Открыть фото на весь экран')} onClick={() => setZoom(true)}>
          <img src={imgUrl(photos[index])} alt={title} onError={hideBrokenImg} />
          <span className="ztx-product-zoom-icon" aria-hidden="true"><ZoomIn size={18} /></span>
        </button>
        {n > 1 && (
          <>
            <button className="ztx-product-arrow prev" aria-label={t('Предыдущее фото')} onClick={() => go(-1)}><ChevronLeft size={22} /></button>
            <button className="ztx-product-arrow next" aria-label={t('Следующее фото')} onClick={() => go(1)}><ChevronRight size={22} /></button>
          </>
        )}
      </div>
      {n > 1 && (
        <div className="ztx-product-thumbs" role="group" aria-label={t('Фотографии товара')}>
          {photos.map((p, i) => (
            <button
              key={p + i}
              className={i === index ? 'on' : ''}
              aria-label={t('Фото {n} из {total}', { n: i + 1, total: n })}
              aria-current={i === index}
              onClick={() => setIndex(i)}
            >
              <img src={imgUrl(p)} alt="" loading="lazy" onError={hideBrokenImg} />
            </button>
          ))}
        </div>
      )}
      {zoom && <Lightbox photos={photos} index={index} title={title} onIndex={setIndex} onClose={() => setZoom(false)} />}
    </div>
  );
}

function ReportModal({ product, onClose }) {
  const { toast } = useToast();
  const ref = useDialog(onClose);
  const [reason, setReason] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!reason) { setErr(t('Выберите причину')); return; }
    setBusy(true);
    try {
      await api.reportProduct(product.id, { reason, text: text.trim() });
      toast(t('Спасибо! Жалоба отправлена модераторам'));
      onClose();
    } catch (ex) {
      setErr(ex.message);
      setBusy(false);
    }
  };

  return createPortal(
    <div className="ztx-product-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="ztx-product-modal" role="dialog" aria-modal="true" aria-labelledby="ztx-product-report-h" ref={ref} onSubmit={submit} noValidate>
        <div className="ztx-product-modal-head">
          <h3 id="ztx-product-report-h">{t('Пожаловаться на товар')}</h3>
          <button type="button" className="ztx-product-iconbtn" aria-label={t('Закрыть')} onClick={onClose}><X size={20} /></button>
        </div>
        <p className="ztx-product-modal-sub">{product.title}</p>
        <fieldset>
          <legend>{t('Причина')}</legend>
          {REASONS.map(([v, label]) => (
            <label key={v} className="ztx-product-radio">
              <input type="radio" name="reason" value={v} checked={reason === v} onChange={() => { setReason(v); setErr(''); }} />
              <span>{t(label)}</span>
            </label>
          ))}
        </fieldset>
        <label className="ztx-product-field">
          <span>{t('Подробности (необязательно)')}</span>
          <textarea rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
          <small>{text.length} / 1000</small>
        </label>
        {err && <p className="ztx-product-err" role="alert">{err}</p>}
        <div className="ztx-product-modal-foot">
          <button type="button" className="ztx-product-btn" onClick={onClose} disabled={busy}>{t('Отмена')}</button>
          <button type="submit" className="ztx-product-btn primary" disabled={busy}>{t('Отправить')}</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function NotFound() {
  return (
    <div className="ztx-product-empty">
      <div className="ztx-product-empty-icon"><SearchX size={34} /></div>
      <h2>{t('Товар не найден или скрыт')}</h2>
      <p>{t('Возможно, он удалён продавцом или больше не продаётся.')}</p>
      <a className="ztx-product-btn primary" href={catalogUrl()}>{t('Перейти в каталог')}</a>
    </div>
  );
}

export default function Product({ id, user, favorites = [], onAddToCart, onToggleFavorite, onOpenAuth }) {
  const { toast } = useToast();
  const { data, error, loading, retry } = useQuery(`product-${id}`, () => api.product(id));
  const related = useQuery(`related-${id}`, () => api.related(id));
  const compare = compareList.use();
  const [report, setReport] = useState(false);
  const [compose, setCompose] = useState(false);
  const addRef = useRef(null);
  const product = data?.product && String(data.product.id) === String(id) ? data.product : null;

  // Просмотр и заголовок вкладки
  useEffect(() => {
    if (!product) return undefined;
    recentlyViewed.add(product.id, { evict: true });
    const prev = document.title;
    document.title = `${product.title} — Zetex Market`;
    return () => { document.title = prev; };
  }, [product?.id, product?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { window.scrollTo(0, 0); }, [id]);

  if (!product) {
    if (loading) return <div className="ztx-product-loading" aria-busy="true" aria-label={t('Загрузка…')}><div /><div /></div>;
    if (error === 'Товар не найден' || /^Ошибка 404/.test(error)) return <NotFound />;
    return (
      <div className="ztx-product-empty">
        <h2>{t('Не удалось загрузить товар')}</h2>
        <p>{error}</p>
        <button className="ztx-product-btn primary" onClick={retry}>{t('Повторить')}</button>
      </div>
    );
  }

  const outOfStock = product.stock === 0;
  const hidden = product.status === 'hidden';
  const isFav = favorites.some((f) => f.id === product.id);
  const inCompare = compare.includes(product.id);
  const discount = product.oldPrice ? Math.round((1 - product.price / product.oldPrice) * 100) : 0;
  const specs = (product.specs || []).filter((s) => s.name && s.value);
  const cat = product.category;
  const sub = product.subcategory;

  const toggleCompare = () => {
    if (inCompare) { compareList.remove(product.id); return; }
    if (!compareList.add(product.id)) toast(t('Можно сравнивать до 4 товаров'), 'error');
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast(t('Ссылка скопирована'));
    } catch {
      toast(t('Не удалось скопировать ссылку'), 'error');
    }
  };

  const scrollToReviews = (e) => {
    e.preventDefault();
    document.getElementById('ztx-product-reviews')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  };

  const openReport = () => (user ? setReport(true) : onOpenAuth());
  const canWrite = user?.role !== 'seller' && user?.role !== 'admin';
  const openCompose = () => (user ? setCompose(true) : onOpenAuth());

  return (
    <div className="ztx-product">
      <nav className="ztx-product-crumbs" aria-label={t('Навигация')}>
        <a href="/">{t('Главная')}</a>
        {cat && <><span aria-hidden="true">›</span><a href={catalogUrl({ category: cat })}>{t(cat)}</a></>}
        {sub && <><span aria-hidden="true">›</span><a href={catalogUrl({ category: cat, subcategory: sub })}>{t(sub)}</a></>}
      </nav>

      {hidden && (
        <div className="ztx-product-hidden" role="status">
          <EyeOff size={18} aria-hidden="true" /> {t('Товар скрыт модератором и не виден покупателям')}
        </div>
      )}

      <div className="ztx-product-top">
        <Gallery key={product.id} photos={product.gallery?.length ? product.gallery : [product.image]} title={product.title} />

        <div className="ztx-product-buy">
          <h1>{product.title}</h1>
          <div className="ztx-product-rating">
            {product.reviews > 0 ? (
              <a href="#ztx-product-reviews" onClick={scrollToReviews}>
                <Stars value={product.rating} size={16} />
                <b>{product.rating}</b>
                <span>{t('Отзывов: {n}', { n: product.reviews })}</span>
              </a>
            ) : (
              <a href="#ztx-product-reviews" onClick={scrollToReviews} className="muted">{t('Пока без оценок')}</a>
            )}
          </div>

          <div className="ztx-product-priceblock">
            <span className="ztx-product-price">{money(product.price)}</span>
            {product.oldPrice && (
              <>
                <s className="ztx-product-old">{money(product.oldPrice)}</s>
                <span className="ztx-product-discount">−{discount}%</span>
              </>
            )}
          </div>
          {product.monthlyPrice && <div className="ztx-product-installment">{monthly(product.monthlyPrice)}</div>}

          <div className={`ztx-product-stock ${outOfStock ? 'out' : product.stock <= 5 ? 'low' : 'ok'}`}>
            {outOfStock ? t('Нет в наличии') : product.stock <= 5 ? t('Мало: осталось {n} шт.', { n: product.stock }) : t('В наличии: {n} шт.', { n: product.stock })}
          </div>

          <div className="ztx-product-actions">
            <button
              ref={addRef}
              className="ztx-product-btn primary big"
              disabled={outOfStock || hidden}
              onClick={() => onAddToCart(product, addRef.current)}
            >
              <ShoppingBag size={18} /> {t('В корзину')}
            </button>
            <button
              className={`ztx-product-btn big icon ${isFav ? 'on' : ''}`}
              aria-pressed={isFav}
              aria-label={isFav ? t('Убрать из избранного') : t('В избранное')}
              title={isFav ? t('Убрать из избранного') : t('В избранное')}
              onClick={() => onToggleFavorite(product)}
            >
              <Heart size={20} fill={isFav ? 'var(--danger)' : 'none'} color={isFav ? 'var(--danger)' : 'currentColor'} />
            </button>
          </div>

          <div className="ztx-product-secondary">
            <button className={`ztx-product-link ${inCompare ? 'on' : ''}`} aria-pressed={inCompare} onClick={toggleCompare}>
              <Scale size={16} /> {inCompare ? t('В сравнении') : t('Сравнить')}
            </button>
            {compare.length >= 2 && (
              <a className="ztx-product-link" href="/compare">{t('К сравнению: {n}', { n: compare.length })}</a>
            )}
            <button className="ztx-product-link" onClick={share}><Share2 size={16} /> {t('Поделиться')}</button>
            {canWrite && <button className="ztx-product-link" onClick={openCompose}><MessageCircle size={16} /> {t('Написать продавцу')}</button>}
          </div>

          {user?.id !== product.sellerId && (
            <button className="ztx-product-report" onClick={openReport}><Flag size={13} /> {t('Пожаловаться на товар')}</button>
          )}
        </div>
      </div>

      <section className="ztx-product-section" aria-labelledby="ztx-product-desc-h">
        <h2 id="ztx-product-desc-h">{t('Описание')}</h2>
        {product.description ? <p className="ztx-product-desc">{product.description}</p> : <p className="ztx-product-muted">{t('Продавец не добавил описание.')}</p>}
      </section>

      {specs.length > 0 && (
        <section className="ztx-product-section" aria-labelledby="ztx-product-specs-h">
          <h2 id="ztx-product-specs-h">{t('Характеристики')}</h2>
          <table className="ztx-product-specs">
            <tbody>
              {specs.map((s, i) => <tr key={i}><th scope="row">{s.name}</th><td>{s.value}</td></tr>)}
            </tbody>
          </table>
        </section>
      )}

      <section className="ztx-product-section" id="ztx-product-reviews" aria-labelledby="ztx-product-rev-h">
        <h2 id="ztx-product-rev-h">{t('Отзывы')}{product.reviews > 0 && <span className="ztx-product-count">{product.reviews}</span>}</h2>
        <Reviews productId={product.id} user={user} onOpenAuth={onOpenAuth} onChanged={retry} />
      </section>

      {related.data?.items?.length > 0 && (
        <section className="ztx-product-section" aria-labelledby="ztx-product-rel-h">
          <h2 id="ztx-product-rel-h">{t('Похожие товары')}</h2>
          <div className="ztx-product-related">
            {related.data.items.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                onAddToCart={onAddToCart}
                onToggleFavorite={onToggleFavorite}
                isFavorite={favorites.some((f) => f.id === p.id)}
                onOpenDetail={(x) => navigate('/product/' + x.id)}
              />
            ))}
          </div>
        </section>
      )}

      {report && <ReportModal product={product} onClose={() => setReport(false)} />}
      <ComposeDialog open={compose} onClose={() => setCompose(false)} title={product.title} target={{ productId: product.id }} />
    </div>
  );
}
