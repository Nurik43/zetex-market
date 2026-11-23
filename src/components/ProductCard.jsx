import { ShoppingBag, Star, Heart, Scale } from 'lucide-react';
import { imgUrl, hideBrokenImg } from '../api';
import { compareList } from '../localStore';
import { t } from '../i18n';
import { money, monthly } from '../format';
import { useToast } from './useToast';

// Бейдж: заданный продавцом → рассрочка → новинка (до 7 дней) → хит (высокий рейтинг)
function getBadge(product) {
  if (product.oldPrice > product.price) return { text: `−${Math.round((1 - product.price / product.oldPrice) * 100)}%`, tone: 'amber' };
  if (product.badge) return { text: t(product.badge), tone: product.badge === 'Распродажа' || product.badge === 'Акция' ? 'amber' : '' };
  if (product.monthlyPrice) return { text: t('Рассрочка 0-0-12'), tone: 'green' };
  if (product.isNew) return { text: t('Новинка'), tone: 'blue' };
  if (product.rating >= 4.8 && product.reviews >= 50) return { text: t('Хит'), tone: 'amber' };
  return null;
}

export default function ProductCard({ product, onAddToCart, onToggleFavorite, isFavorite, onOpenDetail }) {
  const { toast } = useToast();
  const badge = getBadge(product);
  const inCompare = compareList.use().includes(product.id);
  const toggleCompare = (e) => {
    e.stopPropagation();
    if (inCompare) compareList.remove(product.id);
    else if (!compareList.add(product.id)) toast(t('Можно сравнивать до 4 товаров'), 'error');
  };
  const outOfStock = product.stock === 0;

  return (
    <article className="ztx-card" onClick={() => onOpenDetail(product)}>
      <div className="ztx-card-img">
        <img src={imgUrl(product.image)} alt={product.title} loading="lazy" onError={hideBrokenImg} />
        {badge && <span className={`ztx-pill ${badge.tone}`}>{badge.text}</span>}
        <button
          className={`ztx-fav ${isFavorite ? 'on' : ''}`}
          aria-label={isFavorite ? t('Убрать из избранного') : t('В избранное')}
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(product); }}
        >
          <Heart size={17} fill={isFavorite ? 'var(--danger)' : 'none'} color={isFavorite ? 'var(--danger)' : 'var(--ink-2)'} />
        </button>
        <button className={`ztx-fav ztx-cmp ${inCompare ? 'on' : ''}`} aria-pressed={inCompare} aria-label={inCompare ? t('Убрать из сравнения') : t('Сравнить')} title={inCompare ? t('Убрать из сравнения') : t('Сравнить')} onClick={toggleCompare}>
          <Scale size={16} color={inCompare ? 'var(--brand)' : 'var(--ink-2)'} />
        </button>
      </div>

      <div className="ztx-card-body">
        <div className="ztx-price-row">
          <span className="ztx-price">{money(product.price)}</span>
          {product.oldPrice > product.price && <s className="ztx-price-old">{money(product.oldPrice)}</s>}
        </div>
        <h3 className="ztx-card-title">{product.title}</h3>

        <div className="ztx-meta">
          {product.reviews > 0 ? (
            <>
              <Star size={14} fill="#f5a524" color="#f5a524" />
              <b style={{ color: 'var(--ink)' }}>{product.rating}</b>
              <span>· {t('{n} оценок', { n: product.reviews })}</span>
            </>
          ) : (
            <span>{t('Пока без оценок')}</span>
          )}
        </div>

        {product.monthlyPrice && <span className="ztx-installment">{monthly(product.monthlyPrice)}</span>}
        {outOfStock && <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--danger)' }}>{t('Нет в наличии')}</span>}

        <button
          className="ztx-add"
          disabled={outOfStock}
          onClick={(e) => { e.stopPropagation(); onAddToCart(product, e.currentTarget); }}
        >
          <ShoppingBag size={16} /> {t('В корзину')}
        </button>
      </div>
    </article>
  );
}
