import { Heart } from 'lucide-react';
import { navigate } from '../router';
import ProductGrid from '../components/ProductGrid';
import { t } from '../i18n';

export default function Favorites({ favorites, ...handlers }) {
  return (
    <div>
      <div className="ztx-section-head"><h2>{t('Моё избранное')}</h2></div>
      {favorites.length === 0 ? (
        <div className="ztx-empty">
          <div className="ztx-empty-icon"><Heart size={36} /></div>
          <h3>{t('Внутри пока пусто')}</h3>
          <p>{t('Нажимайте на сердечко в карточке товара, чтобы сохранить его здесь.')}</p>
          <button className="ztx-btn ztx-btn-solid" onClick={() => navigate('/catalog')}>{t('Перейти в каталог')}</button>
        </div>
      ) : (
        <ProductGrid products={favorites} favorites={favorites} {...handlers} />
      )}
    </div>
  );
}
