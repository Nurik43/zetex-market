import { ArrowRight } from 'lucide-react';
import { api, imgUrl, hideBrokenImg } from '../api';
import { useQuery } from '../useQuery';
import { navigate, catalogUrl } from '../router';
import { iconFor, TILE_TONES } from '../icons';
import Reveal from '../components/Reveal';
import ProductGrid, { GridSkeleton } from '../components/ProductGrid';
import { t, plural } from '../i18n';
import { num, money } from '../format';
import { useConfig } from '../useConfig';

function Row({ title, subtitle, to, children }) {
  return (
    <Reveal as="section" className="ztx-row">
      <div className="ztx-section-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="ztx-sub">{subtitle}</p>}
        </div>
        <button className="ztx-link" onClick={() => navigate(to)}>{t('Смотреть все')} <ArrowRight size={16} /></button>
      </div>
      {children}
    </Reveal>
  );
}

export default function Home({ taxonomy, user, onOpenAuth, favorites, onAddToCart, onToggleFavorite, onOpenDetail }) {
  const popular = useQuery('home-popular', () => api.products({ sort: 'popular', limit: 8 }));
  const fresh = useQuery('home-new', () => api.products({ sort: 'new', limit: 8 }));
  const meta = useQuery('home-meta', () => api.productsMeta());

  const home = useConfig()?.home;
  const featured = (popular.data?.items || []).slice(0, 3);
  const total = meta.data?.total;
  const card = { favorites, onAddToCart, onToggleFavorite, onOpenDetail };

  return (
    <>
      <section className="ztx-hero" aria-label={t('Витрина')}>
        <div className="ztx-hero-text">
          <h1>{home?.title || t('Покупайте напрямую у продавцов')}</h1>
          <p>
            {home?.text ? home.text : <>{total ? t('{n} {unit} в {c} категориях.', { n: num(total), unit: t(plural(total, ['товар', 'товара', 'товаров'])), c: taxonomy.length || 15 }) : t('Широкий каталог товаров.')}{' '}
            {t('Цены и наличие — те, что указал продавец, без накруток.')}</>}
          </p>
          <div className="ztx-hero-actions">
            <button className="ztx-btn ztx-btn-primary" onClick={() => navigate('/catalog')}>{home?.button || t('Открыть каталог')}</button>
            {!user && <button className="ztx-btn ztx-btn-ghost" onClick={onOpenAuth}>{t('Стать продавцом')}</button>}
          </div>
        </div>
        <div className="ztx-mosaic">
          {(featured.length ? featured : [0, 1, 2]).map((p, i) => (
            p.id ? (
              <button key={p.id} className="ztx-tile" style={{ '--f': i }} onClick={() => onOpenDetail(p)} aria-label={p.title}>
                <img src={imgUrl(p.image)} alt="" onError={hideBrokenImg} />
                <span className="ztx-tile-cap"><b>{money(p.price)}</b><small>{p.title}</small></span>
              </button>
            ) : <div key={p} className="ztx-tile ztx-skeleton" />
          ))}
        </div>
      </section>

      {home?.banners?.length > 0 && (
        <div className="ztx-banners" role="list">
          {home.banners.map((b, i) => {
            const Tag = b.link ? 'a' : 'div';
            return (
              <Tag key={i} role="listitem" className={`ztx-banner is-${b.tone}`} {...(b.link ? { href: b.link, ...(b.link.startsWith('http') ? { target: '_blank', rel: 'noreferrer' } : {}) } : {})}>
                <b>{b.title}</b>{b.text && <span>{b.text}</span>}
              </Tag>
            );
          })}
        </div>
      )}

      <Reveal as="section" className="ztx-row">
        <div className="ztx-section-head">
          <h2>{t('Категории')}</h2>
          <button className="ztx-link" onClick={() => navigate('/catalog')}>{t('Весь каталог')} <ArrowRight size={16} /></button>
        </div>
        <div className="ztx-tiles">
          {taxonomy.map((cat, i) => {
            const Icon = iconFor(cat.icon);
            const [bg, fg] = TILE_TONES[i % TILE_TONES.length];
            const count = meta.data?.categories?.[cat.name];
            return (
              <button key={cat.name} className="ztx-cattile" style={{ '--bg': bg, '--fg': fg, '--d': `${i * 35}ms` }} onClick={() => navigate(catalogUrl({ category: cat.name }))}>
                <span className="ztx-cattile-icon"><Icon size={26} /></span>
                <span className="ztx-cattile-name">{t(cat.name)}</span>
                {count != null && <span className="ztx-cattile-count">{num(count)} {t(plural(count, ['товар', 'товара', 'товаров']))}</span>}
              </button>
            );
          })}
        </div>
      </Reveal>

      <Row title={t('Популярное')} subtitle={t('Товары с наибольшим числом оценок')} to={catalogUrl({ sort: 'popular' })}>
        {popular.data ? <ProductGrid products={popular.data.items} {...card} /> : <GridSkeleton count={4} />}
      </Row>

      {!user && (
        <Reveal className="ztx-cta">
          <div>
            <h2>{t('Продавайте на Zetex')}</h2>
            <p>{t('Создайте аккаунт продавца, загрузите фото и цены — товары сразу появятся в каталоге.')}</p>
          </div>
          <button className="ztx-btn ztx-btn-primary" onClick={onOpenAuth}>{t('Создать аккаунт продавца')}</button>
        </Reveal>
      )}

      <Row title={t('Новинки')} subtitle={t('Недавно добавленные товары')} to={catalogUrl({ sort: 'new' })}>
        {fresh.data ? <ProductGrid products={fresh.data.items} {...card} /> : <GridSkeleton count={4} />}
      </Row>
    </>
  );
}
