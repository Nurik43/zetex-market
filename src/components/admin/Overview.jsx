import { useState } from 'react';
import { BarChart3, Users, Package, ShoppingBag, Flag, RotateCcw, MessageSquare, ShoppingCart, ShieldAlert } from 'lucide-react';
import { api } from '../../api';
import { useQuery } from '../../useQuery';
import { t } from '../../i18n';
import { money, num } from '../../format';
import { ErrorBox, Skeleton, Select } from './common';
import { ORDER_STATUS } from './consts';
import { stat } from './shared';
import RevenueChart from './RevenueChart';

function Stat({ icon: Icon, label, value, sub, tone, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} className={`ztx-admin-stat ${tone ? `is-${tone}` : ''}`} style={onClick ? { cursor: 'pointer', font: 'inherit', textAlign: 'left', color: 'inherit' } : undefined}>
      <span className="ztx-admin-stat-icon"><Icon size={18} aria-hidden="true" /></span>
      <div>
        <div className="ztx-admin-stat-val">{value}</div>
        <div className="ztx-admin-stat-label">{label}</div>
        {sub && <div className="ztx-admin-stat-sub">{sub}</div>}
      </div>
    </Tag>
  );
}

function Delta({ cur, prev }) {
  if (!prev && !cur) return null;
  if (!prev) return <span className="ztx-admin-delta up">{t('новое')}</span>;
  const p = Math.round(((cur - prev) / prev) * 100);
  return <span className={`ztx-admin-delta ${p >= 0 ? 'up' : 'down'}`}>{p >= 0 ? '▲' : '▼'} {Math.abs(p)}%</span>;
}

function Compare({ days }) {
  const q = useQuery(`an${days}`, () => api.admin.analytics(days));
  if (!q.data) return q.loading ? <Skeleton rows={3} /> : <ErrorBox message={q.error} onRetry={q.retry} />;
  const { current: c, previous: p, newUsers, topSellers, topProducts, funnel, carts } = q.data;
  const rows = [
    [t('Заказов'), c.orders, p.orders, num], [t('Оборот'), c.gmv, p.gmv, money], [t('Средний чек'), c.avgOrder, p.avgOrder, money],
    [t('Отмены'), c.cancelled, p.cancelled, num], [t('Возвраты'), c.refunds, p.refunds, num],
    [t('Новые покупатели'), c.newBuyers, p.newBuyers, num], [t('Новые продавцы'), c.newSellers, p.newSellers, num],
  ];
  const maxU = Math.max(1, ...newUsers.map((d) => d.buyers + d.sellers));
  const maxF = Math.max(1, ...funnel.map((x) => x.value));
  const fl = { placed: t('Оформлено'), confirmed: t('Подтверждено'), delivered: t('Доставлено') };
  return (
    <>
      <section className="ztx-admin-card">
        <div className="ztx-admin-card-head"><h3>{t('Сравнение с предыдущим периодом')}</h3></div>
        <div className="ztx-admin-scroll"><table className="ztx-admin-table">
          <thead><tr><th>{t('Показатель')}</th><th className="is-num">{t('Сейчас')}</th><th className="is-num">{t('Раньше')}</th><th className="is-num">{t('Изменение')}</th></tr></thead>
          <tbody>{rows.map(([l, a, b, f]) => (
            <tr key={l}><td data-label={t('Показатель')}>{l}</td><td data-label={t('Сейчас')} className="is-num">{f(a)}</td><td data-label={t('Раньше')} className="is-num">{f(b)}</td><td data-label={t('Изменение')} className="is-num"><Delta cur={a} prev={b} /></td></tr>
          ))}</tbody>
        </table></div>
      </section>
      <div className="ztx-admin-two">
        <section className="ztx-admin-card">
          <div className="ztx-admin-card-head"><h3>{t('Новые пользователи по дням')}</h3></div>
          <div className="ztx-admin-bars" role="img" aria-label={t('Регистрации по дням: покупатели и продавцы')}>
            {newUsers.map((d) => <span key={d.date} className={d.sellers > d.buyers ? 'alt' : ''} title={`${d.date}: ${d.buyers} / ${d.sellers}`} style={{ height: `${Math.max(3, ((d.buyers + d.sellers) / maxU) * 100)}%` }} />)}
          </div>
          <p className="ztx-admin-muted">{t('Покупатели: {b}, продавцы: {s}', { b: c.newBuyers, s: c.newSellers })}</p>
        </section>
        <section className="ztx-admin-card">
          <div className="ztx-admin-card-head"><h3>{t('Воронка заказов')}</h3></div>
          <div className="ztx-admin-funnel">{funnel.map((x) => (
            <div key={x.key}><span style={{ width: 110 }}>{fl[x.key]}</span><i style={{ width: `${(x.value / maxF) * 55}%` }} /><b>{num(x.value)}</b></div>
          ))}</div>
          <p className="ztx-admin-muted">{t('Сейчас в корзинах: {n} покупателей на {sum}', { n: carts.users, sum: money(carts.amount) })}</p>
        </section>
      </div>
      <div className="ztx-admin-two">
        <section className="ztx-admin-card">
          <div className="ztx-admin-card-head"><h3>{t('Топ продавцов')}</h3></div>
          {topSellers.length === 0 ? <p className="ztx-admin-muted">{t('Пока нет продаж')}</p> : (
            <table className="ztx-admin-mini"><tbody>{topSellers.map((s) => <tr key={s.id}><td>{s.name}</td><td className="is-num">{money(s.revenue)}</td></tr>)}</tbody></table>
          )}
        </section>
        <section className="ztx-admin-card">
          <div className="ztx-admin-card-head"><h3>{t('Топ товаров')}</h3></div>
          {topProducts.length === 0 ? <p className="ztx-admin-muted">{t('Пока нет продаж')}</p> : (
            <table className="ztx-admin-mini"><tbody>{topProducts.map((p) => <tr key={p.title}><td>{p.title}</td><td className="is-num">{num(p.qty)} {t('шт.')}</td><td className="is-num">{money(p.revenue)}</td></tr>)}</tbody></table>
          )}
        </section>
      </div>
    </>
  );
}

export default function Overview({ go }) {
  const [days, setDays] = useState('30');
  const q = useQuery('stats', () => api.admin.stats());
  if (!q.data) return q.loading ? <Skeleton rows={4} /> : <ErrorBox message={q.error} onRetry={q.retry} />;
  const s = q.data;
  return (
    <div className="ztx-admin-stack">
      <div className="ztx-admin-stats">
        <Stat icon={Users} label={t('Пользователи')} value={num(s.users.total)} sub={t('Покупателей {b}, продавцов {s}', { b: num(s.users.buyer), s: num(s.users.seller) })} onClick={() => go('users')} />
        <Stat icon={Package} label={t('Товары')} value={num(s.products.active)} sub={t('Скрыто: {n}', { n: num(s.products.hidden) })} onClick={() => go('products')} />
        <Stat icon={ShieldAlert} label={t('Ждут проверки')} value={num(s.products.pending)} tone={s.products.pending ? 'warn' : ''} onClick={() => go('products', { status: 'pending' })} />
        <Stat icon={ShoppingBag} label={t('Заказы')} value={num(s.orders.total)} onClick={() => go('orders')} />
        <Stat icon={BarChart3} label={t('Оборот (GMV)')} value={money(s.gmv)} />
        <Stat icon={Flag} label={t('Жалобы на товары')} value={num(s.openReports)} tone={s.openReports ? 'warn' : ''} onClick={() => go('reports')} />
        <Stat icon={MessageSquare} label={t('Жалобы на сообщения')} value={num(s.openChatReports)} tone={s.openChatReports ? 'warn' : ''} onClick={() => go('chats')} />
        <Stat icon={RotateCcw} label={t('Ждут возврата')} value={num(s.pendingRefunds)} tone={s.pendingRefunds ? 'danger' : ''} onClick={() => go('orders', { paymentStatus: 'refund_pending' })} />
      </div>
      <RevenueChart series={s.analytics?.series || []} />
      <section className="ztx-admin-card">
        <div className="ztx-admin-card-head"><h3>{t('Заказы по статусам')}</h3></div>
        <div className="ztx-admin-chips">
          {Object.entries(s.orders.byStatus).map(([k, n]) => <span key={k} className="ztx-admin-chip">{stat(ORDER_STATUS, k)} <b>{num(n)}</b></span>)}
        </div>
      </section>
      <div className="ztx-admin-card-head" style={{ margin: 0 }}>
        <h3><ShoppingCart size={16} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> {t('Аналитика за период')}</h3>
        <Select value={days} onChange={setDays} label={t('Период')} options={[['7', t('7 дней')], ['30', t('30 дней')], ['90', t('90 дней')]]} />
      </div>
      <Compare days={Number(days)} />
    </div>
  );
}
