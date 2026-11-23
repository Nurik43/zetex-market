import ProductCard from './ProductCard';
import { t } from '../i18n';

export default function ProductGrid({ products, favorites, onAddToCart, onToggleFavorite, onOpenDetail }) {
  return (
    <div className="ztx-grid">
      {products.map((p, i) => (
        <div key={p.id} className="ztx-cell" style={{ '--i': i % 12 }}>
          <ProductCard
            product={p}
            onAddToCart={onAddToCart}
            onToggleFavorite={onToggleFavorite}
            isFavorite={favorites.some((f) => f.id === p.id)}
            onOpenDetail={onOpenDetail}
          />
        </div>
      ))}
    </div>
  );
}

export function GridSkeleton({ count = 8 }) {
  return (
    <div className="ztx-grid" aria-busy="true" aria-label={t('Загрузка товаров')}>
      {Array.from({ length: count }, (_, i) => <div key={i} className="ztx-skeleton" style={{ height: 380 }} />)}
    </div>
  );
}
