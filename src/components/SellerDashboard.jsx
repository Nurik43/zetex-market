import { useState, useEffect, useCallback } from 'react';
import { Package, Wallet, ShoppingBag } from 'lucide-react';
import { api } from '../api';
import { useToast } from './useToast';
import { t } from '../i18n';
import { money, num } from '../format';
import OrdersTab from './seller/OrdersTab';
import ProductsTab from './seller/ProductsTab';
import AnalyticsTab from './seller/AnalyticsTab';
import PromosTab from './seller/PromosTab';
import ImportTab from './seller/ImportTab';
import TelegramCard from './seller/TelegramCard';
import AccountCard from './AccountCard';
import './seller/seller.css';

const TABS = [
  { id: 'products', label: 'Мои товары' },
  { id: 'orders', label: 'Заказы' },
  { id: 'analytics', label: 'Аналитика' },
  { id: 'promos', label: 'Промокоды' },
  { id: 'import', label: 'Импорт CSV' },
  { id: 'settings', label: 'Уведомления' },
];

/** Кабинет продавца. user — текущий пользователь; onUserChanged(user) — вызывается после перезагрузки профиля (привязка Telegram). */
export default function SellerDashboard({ user, taxonomy = [], onUserChanged }) {
  const { toast } = useToast();
  const [tab, setTab] = useState('products');
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [stats, setStats] = useState({ products: 0, revenue: 0, activeOrders: 0, itemsSold: 0 });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [p, o, s] = await Promise.all([api.myProducts(), api.sellerOrders(), api.sellerStats()]);
      setProducts(p.items);
      setOrders(o.items);
      setStats(s);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // первичная загрузка данных кабинета
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refresh(); }, [refresh]);

  const sellerName = user?.companyName || [user?.firstName, user?.lastName].filter(Boolean).join(' ') || t('Продавец');
  const newOrders = orders.filter((o) => o.status === 'pending').length;

  const widgets = [
    { label: t('Всего товаров'), value: t('{n} шт.', { n: num(stats.products) }), icon: <Package size={24} aria-hidden="true" />, bg: 'var(--brand-tint)', color: 'var(--brand)' },
    { label: t('Выручка (доставленные)'), value: money(stats.revenue), icon: <Wallet size={24} aria-hidden="true" />, bg: 'var(--accent-tint)', color: 'var(--accent)' },
    { label: t('Активные заказы'), value: t('{n} шт.', { n: num(stats.activeOrders) }), icon: <ShoppingBag size={24} aria-hidden="true" />, bg: 'var(--warn-tint)', color: 'var(--warn-ink)' },
  ];

  const onKey = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = TABS.findIndex((x) => x.id === tab);
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length].id;
    setTab(next);
    document.getElementById(`seller-tab-${next}`)?.focus();
  };

  return (
    <div className="ztx-seller">
      <div className="ztx-seller-head">
        <h1>{t('Панель продавца: {name}', { name: sellerName })}</h1>
        <p className="ztx-seller-sub">{t('Управляйте своими товарами и следите за продажами магазина')}</p>
      </div>

      <div className="ztx-seller-kpis">
        {widgets.map((w) => (
          <div key={w.label} className="ztx-seller-kpi" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: w.bg, color: w.color, display: 'grid', placeItems: 'center', flex: 'none' }}>{w.icon}</div>
            <div style={{ minWidth: 0 }}><span>{w.label}</span><strong style={{ fontSize: 20 }}>{w.value}</strong></div>
          </div>
        ))}
      </div>

      <div className="ztx-seller-tabs" role="tablist" aria-label={t('Разделы кабинета')} onKeyDown={onKey}>
        {TABS.map((x) => (
          <button
            key={x.id} type="button" role="tab" id={`seller-tab-${x.id}`} className="ztx-seller-tab"
            aria-selected={tab === x.id} aria-controls={`seller-panel-${x.id}`} tabIndex={tab === x.id ? 0 : -1}
            onClick={() => setTab(x.id)}
          >
            {t(x.label)}
            {x.id === 'products' && products.length > 0 && <span className="ztx-seller-count neutral">{products.length}</span>}
            {x.id === 'orders' && newOrders > 0 && <span className="ztx-seller-count" aria-label={t('новых: {n}', { n: newOrders })}>{newOrders}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`seller-panel-${tab}`} aria-labelledby={`seller-tab-${tab}`}>
        {tab === 'orders' && <OrdersTab orders={orders} loading={loading} onChanged={refresh} />}
        {tab === 'products' && <ProductsTab products={products} loading={loading} taxonomy={taxonomy} onChanged={refresh} />}
        {tab === 'analytics' && <AnalyticsTab />}
        {tab === 'promos' && <PromosTab />}
        {tab === 'import' && <ImportTab onImported={refresh} />}
        {tab === 'settings' && (<><TelegramCard user={user} onUserChanged={onUserChanged} /><AccountCard user={user} /></>)}
      </div>
    </div>
  );
}
