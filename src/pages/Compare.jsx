import { useMemo, useState } from 'react';
import { Scale, ShoppingBag, X, AlertCircle } from 'lucide-react';
import { api, imgUrl, hideBrokenImg } from '../api';
import { useQuery } from '../useQuery';
import { compareList } from '../localStore';
import { navigate, catalogUrl } from '../router';
import { t } from '../i18n';
import { money } from '../format';
import Stars from '../components/Stars';
import './compare.css';

const DASH = '—';

export default function Compare({ onAddToCart }) {
  const ids = compareList.use();
  const [onlyDiff, setOnlyDiff] = useState(false);
  const key = ids.join(',');
  const { data, error, loading, retry } = useQuery(`compare-${key}`, () => (
    ids.length ? api.products({ ids: key, limit: 10 }) : Promise.resolve({ items: [] })
  ));

  // порядок как в списке сравнения; убранные товары исчезают сразу, не дожидаясь ответа
  const products = useMemo(() => {
    const byId = new Map((data?.items || []).map((p) => [p.id, p]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  }, [data, ids]);

  const rows = useMemo(() => {
    const map = new Map();
    products.forEach((p, col) => {
      (p.specs || []).filter((s) => s.name && s.value).forEach((s) => {
        if (!map.has(s.name)) map.set(s.name, Array(products.length).fill(DASH));
        map.get(s.name)[col] = s.value;
      });
    });
    return [...map].map(([name, values]) => {
      const full = values.length === products.length ? values : [...values, ...Array(products.length - values.length).fill(DASH)];
      return { name, values: full, differs: new Set(full).size > 1 };
    });
  }, [products]);

  if (!ids.length) {
    return (
      <div className="ztx-empty ztx-page">
        <div className="ztx-empty-icon"><Scale size={36} /></div>
        <h3>{t('Нечего сравнивать')}</h3>
        <p>{t('Добавьте в сравнение до 4 товаров, чтобы увидеть их характеристики рядом.')}</p>
        <button type="button" className="ztx-btn ztx-btn-solid" onClick={() => navigate('/catalog')}>{t('Перейти в каталог')}</button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ztx-empty ztx-page" role="alert">
        <div className="ztx-empty-icon"><AlertCircle size={36} /></div>
        <h3>{t('Не удалось загрузить товары')}</h3>
        <p>{error}</p>
        <button type="button" className="ztx-btn ztx-btn-solid" onClick={retry}>{t('Повторить')}</button>
      </div>
    );
  }

  if (loading && !data) return <p className="ztx-compare-muted" role="status">{t('Загрузка…')}</p>;

  if (!products.length) {
    return (
      <div className="ztx-empty ztx-page">
        <div className="ztx-empty-icon"><Scale size={36} /></div>
        <h3>{t('Товары недоступны')}</h3>
        <p>{t('Выбранные товары сняты с продажи или удалены.')}</p>
        <button type="button" className="ztx-btn ztx-btn-ghost-dark" onClick={() => compareList.clear()}>{t('Очистить сравнение')}</button>
        <button type="button" className="ztx-btn ztx-btn-solid" onClick={() => navigate(catalogUrl())}>{t('Перейти в каталог')}</button>
      </div>
    );
  }

  const shown = onlyDiff ? rows.filter((r) => r.differs) : rows;

  return (
    <div className="ztx-compare ztx-page">
      <div className="ztx-compare-head">
        <h1>{t('Сравнение товаров')}</h1>
        <label className="ztx-compare-toggle">
          <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
          <span>{t('Только отличия')}</span>
        </label>
        <button type="button" className="ztx-compare-clear" onClick={() => compareList.clear()}>{t('Очистить')}</button>
      </div>

      <div className="ztx-compare-scroll" tabIndex={0} role="region" aria-label={t('Таблица сравнения')}>
        <table className="ztx-compare-table">
          <thead>
            <tr>
              <td className="ztx-compare-corner" />
              {products.map((p) => (
                <th key={p.id} scope="col" className="ztx-compare-prod">
                  <button type="button" className="ztx-compare-remove" onClick={() => compareList.remove(p.id)} aria-label={t('Убрать из сравнения: {name}', { name: p.title })}>
                    <X size={16} />
                  </button>
                  <a href={'/product/' + p.id} className="ztx-compare-img">
                    <img src={imgUrl(p.image)} alt="" loading="lazy" onError={hideBrokenImg} />
                  </a>
                  <a href={'/product/' + p.id} className="ztx-compare-title">{p.title}</a>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">{t('Цена')}</th>
              {products.map((p) => (
                <td key={p.id}>
                  <b className="ztx-compare-price">{money(p.price)}</b>
                  {p.oldPrice && <s className="ztx-compare-old">{money(p.oldPrice)}</s>}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">{t('Рейтинг')}</th>
              {products.map((p) => (
                <td key={p.id}>
                  {p.reviews > 0 ? (
                    <span className="ztx-compare-rate"><Stars value={p.rating} size={14} /> {t('Отзывов: {n}', { n: p.reviews })}</span>
                  ) : t('Пока без оценок')}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">{t('Наличие')}</th>
              {products.map((p) => (
                <td key={p.id} className={p.stock === 0 ? 'ztx-compare-out' : ''}>
                  {p.stock === 0 ? t('Нет в наличии') : p.stock <= 5 ? t('Мало: осталось {n} шт.', { n: p.stock }) : t('В наличии')}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">{t('Продавец')}</th>
              {products.map((p) => <td key={p.id}>{p.sellerId ? t('Продавец №{n}', { n: p.sellerId }) : DASH}</td>)}
            </tr>
            <tr>
              <th scope="row">{t('Категория')}</th>
              {products.map((p) => <td key={p.id}>{[p.category, p.subcategory].filter(Boolean).map((x) => t(x)).join(' › ') || DASH}</td>)}
            </tr>
            <tr className="ztx-compare-section"><th scope="colgroup" colSpan={products.length + 1}>{t('Характеристики')}</th></tr>
            {shown.map((r) => (
              <tr key={r.name} className={r.differs ? 'diff' : ''}>
                <th scope="row">{r.name}{r.differs && <span className="ztx-compare-sr"> ({t('отличается')})</span>}</th>
                {r.values.map((v, i) => <td key={i} className={v === DASH ? 'ztx-compare-na' : ''}>{v}</td>)}
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td className="ztx-compare-na" colSpan={products.length + 1}>
                {rows.length ? t('Все характеристики совпадают') : t('Характеристики не указаны')}
              </td></tr>
            )}
            <tr className="ztx-compare-actions">
              <th scope="row" />
              {products.map((p) => (
                <td key={p.id}>
                  <button type="button" className="ztx-btn ztx-btn-solid" disabled={p.stock === 0} onClick={() => onAddToCart(p)}>
                    <ShoppingBag size={16} /> {t('В корзину')}
                  </button>
                  <button type="button" className="ztx-compare-link" onClick={() => compareList.remove(p.id)}>{t('Убрать')}</button>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
