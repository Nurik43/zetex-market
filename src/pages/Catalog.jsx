import { useState } from 'react';
import { SlidersHorizontal, X, ChevronDown, Star, SearchX, WifiOff } from 'lucide-react';
import { api } from '../api';
import { useQuery } from '../useQuery';
import { navigate, catalogUrl } from '../router';
import { iconFor } from '../icons';
import ProductGrid, { GridSkeleton } from '../components/ProductGrid';
import { t, plural } from '../i18n';
import { num } from '../format';

const PAGE = 24;
const SORTS = [
  { value: 'popular', label: 'Популярные' },
  { value: 'new', label: 'Новинки' },
  { value: 'price_asc', label: 'Сначала дешёвые' },
  { value: 'price_desc', label: 'Сначала дорогие' },
  { value: 'rating', label: 'По рейтингу' },
];
const fmt = num;

function PriceFilter({ min, max, bounds, onApply }) {
  const [lo, setLo] = useState(min || '');
  const [hi, setHi] = useState(max || '');
  const apply = (e) => { e.preventDefault(); onApply(lo, hi); };
  return (
    <form onSubmit={apply} className="ztx-price-filter">
      <input type="number" min="0" inputMode="numeric" placeholder={bounds ? t('от {n}', { n: fmt(bounds.lo) }) : t('от')} value={lo} onChange={(e) => setLo(e.target.value)} aria-label={t('Цена от')} />
      <span>—</span>
      <input type="number" min="0" inputMode="numeric" placeholder={bounds ? t('до {n}', { n: fmt(bounds.hi) }) : t('до')} value={hi} onChange={(e) => setHi(e.target.value)} aria-label={t('Цена до')} />
      <button type="submit" className="ztx-mini-btn">OK</button>
    </form>
  );
}

export default function Catalog({ params, taxonomy, favorites, onAddToCart, onToggleFavorite, onOpenDetail }) {
  const f = {
    q: params.q || '', category: params.category || '', subcategory: params.subcategory || '',
    sort: params.sort || 'popular', min: params.min || '', max: params.max || '',
    rating: params.rating || '', stock: params.stock || '', p: Math.max(1, Number(params.p) || 1),
  };
  const [drawer, setDrawer] = useState(false);

  const go = (patch) => navigate(catalogUrl({ ...f, p: '', ...patch }));
  const reset = () => navigate(catalogUrl({ q: f.q }));

  const list = useQuery(JSON.stringify(f), () => api.products({
    q: f.q, category: f.category, subcategory: f.subcategory, sort: f.sort,
    minPrice: f.min, maxPrice: f.max, minRating: f.rating, inStock: f.stock ? 1 : '',
    limit: f.p * PAGE,
  }));
  const meta = useQuery(`meta|${f.q}|${f.category}`, () => api.productsMeta({ q: f.q, category: f.category }));

  const items = list.data?.items || [];
  const total = list.data?.total ?? 0;
  const activeCat = taxonomy.find((c) => c.name === f.category);
  const title = f.q ? t('Результаты по запросу «{q}»', { q: f.q }) : t(f.subcategory || f.category || 'Все товары');

  const chips = [
    f.category && { label: t(f.category), clear: { category: '', subcategory: '' } },
    f.subcategory && { label: t(f.subcategory), clear: { subcategory: '' } },
    (f.min || f.max) && { label: t('Цена: {min} – {max}', { min: f.min ? fmt(f.min) : '0', max: f.max ? fmt(f.max) : '∞' }), clear: { min: '', max: '' } },
    f.rating && { label: t('Рейтинг от {n}', { n: f.rating }), clear: { rating: '' } },
    f.stock && { label: t('В наличии'), clear: { stock: '' } },
  ].filter(Boolean);

  const sidebar = (
    <aside className={`ztx-filters ${drawer ? 'open' : ''}`} aria-label={t('Фильтры')}>
      <div className="ztx-filters-head">
        <b>{t('Фильтры')}</b>
        <button onClick={() => setDrawer(false)} aria-label={t('Закрыть фильтры')}><X size={20} /></button>
      </div>

      <div className="ztx-fgroup">
        <h4>{t('Категории')}</h4>
        <button className="ztx-fcat" aria-current={!f.category} onClick={() => go({ category: '', subcategory: '' })}>
          <span>{t('Все товары')}</span><em>{meta.data?.total ?? ''}</em>
        </button>
        {taxonomy.map((cat) => {
          const open = f.category === cat.name;
          const Icon = iconFor(cat.icon);
          return (
            <div key={cat.name}>
              <button className="ztx-fcat" aria-current={open && !f.subcategory} aria-expanded={open} onClick={() => go({ category: cat.name, subcategory: '' })}>
                <span><Icon size={16} />{t(cat.name)}</span>
                <em>{meta.data?.categories?.[cat.name] ?? ''}</em>
                <ChevronDown size={14} className="ztx-chev" />
              </button>
              <div className={`ztx-fsubs ${open ? 'open' : ''}`}>
                <div>
                  {cat.groups.flatMap((g) => g.items).map((sub) => {
                    const n = meta.data?.subcategories?.[`${cat.name}|${sub}`] ?? 0;
                    return (
                      <button key={sub} className="ztx-fsub" tabIndex={open ? 0 : -1} aria-current={f.subcategory === sub} disabled={n === 0 && f.subcategory !== sub} onClick={() => go({ category: cat.name, subcategory: sub })}>
                        <span>{t(sub)}</span><em>{n}</em>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="ztx-fgroup">
        <h4>{t('Цена, сум')}</h4>
        <PriceFilter key={`${f.min}|${f.max}`} min={f.min} max={f.max} bounds={meta.data ? { lo: meta.data.minPrice, hi: meta.data.maxPrice } : null} onApply={(lo, hi) => go({ min: lo, max: hi })} />
      </div>

      <div className="ztx-fgroup">
        <h4>{t('Рейтинг')}</h4>
        <div className="ztx-seg">
          {[['', t('Любой')], ['4', '4+'], ['4.5', '4,5+']].map(([v, label]) => (
            <button key={v} aria-pressed={f.rating === v} onClick={() => go({ rating: v })}>
              {v && <Star size={13} fill="currentColor" />}{label}
            </button>
          ))}
        </div>
      </div>

      <label className="ztx-check">
        <input type="checkbox" checked={!!f.stock} onChange={(e) => go({ stock: e.target.checked ? '1' : '' })} />
        <span>{t('Только в наличии')}</span>
      </label>

      {chips.length > 0 && <button className="ztx-reset" onClick={reset}>{t('Сбросить фильтры')}</button>}
      <button className="ztx-btn ztx-btn-solid ztx-filters-done" onClick={() => setDrawer(false)}>{t('Показать {n} {unit}', { n: num(total), unit: t(plural(total, ['товар', 'товара', 'товаров'])) })}</button>
    </aside>
  );

  return (
    <div className="ztx-catalog">
      <nav className="ztx-crumbs" aria-label={t('Навигация')}>
        <button onClick={() => navigate('/')}>{t('Главная')}</button>
        <span>/</span>
        <button onClick={() => navigate('/catalog')} aria-current={!f.category}>{t('Каталог')}</button>
        {activeCat && (<><span>/</span><button onClick={() => go({ category: f.category, subcategory: '' })} aria-current={!f.subcategory}>{t(activeCat.name)}</button></>)}
        {f.subcategory && (<><span>/</span><b>{t(f.subcategory)}</b></>)}
      </nav>

      <div className="ztx-catalog-layout">
        {sidebar}
        {drawer && <div className="ztx-scrim" onClick={() => setDrawer(false)} />}

        <section className="ztx-catalog-main">
          <div className="ztx-section-head">
            <div>
              <h2 key={title} className="ztx-title-anim">{title}</h2>
              <p className="ztx-sub">{list.data ? `${fmt(total)} ${t(plural(total, ['товар', 'товара', 'товаров']))}` : t('Загружаем…')}</p>
            </div>
            <div className="ztx-toolbar">
              <button className="ztx-filter-btn" onClick={() => setDrawer(true)}><SlidersHorizontal size={16} /> {t('Фильтры')}{chips.length ? ` · ${chips.length}` : ''}</button>
              <label className="ztx-sort">
                <span>{t('Сортировка')}</span>
                <select className="ztx-select" value={f.sort} onChange={(e) => go({ sort: e.target.value })}>
                  {SORTS.map((s) => <option key={s.value} value={s.value}>{t(s.label)}</option>)}
                </select>
              </label>
            </div>
          </div>

          {chips.length > 0 && (
            <div className="ztx-chips">
              {chips.map((c) => (
                <button key={c.label} className="ztx-chip" onClick={() => go(c.clear)}>{c.label} <X size={14} /></button>
              ))}
              <button className="ztx-chip-reset" onClick={reset}>{t('Сбросить всё')}</button>
            </div>
          )}

          {list.error ? (
            <div className="ztx-empty">
              <div className="ztx-empty-icon"><WifiOff size={36} /></div>
              <h3>{t('Не удалось загрузить товары')}</h3>
              <p>{list.error}</p>
              <button className="ztx-btn ztx-btn-solid" onClick={list.retry}>{t('Повторить')}</button>
            </div>
          ) : !list.data ? (
            <GridSkeleton />
          ) : items.length === 0 ? (
            <div className="ztx-empty">
              <div className="ztx-empty-icon"><SearchX size={36} /></div>
              <h3>{t('Ничего не нашлось')}</h3>
              <p>{t('Попробуйте убрать часть фильтров или изменить запрос.')}</p>
              <button className="ztx-btn ztx-btn-solid" onClick={reset}>{t('Сбросить фильтры')}</button>
            </div>
          ) : (
            <div style={{ opacity: list.loading ? 0.55 : 1, transition: 'opacity .2s' }}>
              <ProductGrid products={items} favorites={favorites} onAddToCart={onAddToCart} onToggleFavorite={onToggleFavorite} onOpenDetail={onOpenDetail} />
              {items.length < total && (
                <div className="ztx-more">
                  <button className="ztx-btn ztx-btn-solid" onClick={() => navigate(catalogUrl({ ...f, p: f.p + 1 }), { replace: true })}>
                    {t('Показать ещё {n}', { n: Math.min(PAGE, total - items.length) })}
                  </button>
                  <span>{t('Показано {a} из {b}', { a: num(items.length), b: num(total) })}</span>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
