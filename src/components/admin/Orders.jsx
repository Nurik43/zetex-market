import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { api } from '../../api';
import { useQuery } from '../../useQuery';
import { t } from '../../i18n';
import { money } from '../../format';
import { ReasonDialog, Toolbar, Select, ListState, Drawer, Skeleton, ErrorBox, CsvLink, ResetFilters } from './common';
import { useList } from './hooks';
import { ORDER_STATUS, PAY_STATUS } from './consts';
import { useAct, useFilters, stat, dt } from './shared';

const NEXT = { pending: ['confirmed', 'cancelled'], confirmed: ['shipped', 'cancelled'], shipped: ['delivered', 'cancelled'], delivered: [], cancelled: [] };

function OrderDrawer({ id, onClose, onChanged }) {
  const q = useQuery(`o${id}`, () => api.admin.order(id));
  const act = useAct();
  const [ask, setAsk] = useState(null);
  const reload = () => { q.retry(); onChanged(); };
  const body = () => {
    if (!q.data) return q.loading ? <Skeleton rows={4} /> : <ErrorBox message={q.error} onRetry={q.retry} />;
    const { order: o, items, payments, events } = q.data;
    const label = (s) => t(ORDER_STATUS[s][0]);
    return (
      <>
        <dl className="ztx-admin-kv">
          <dt>{t('Статус')}</dt><dd>{stat(ORDER_STATUS, o.status)} {stat(PAY_STATUS, o.paymentStatus)}</dd>
          <dt>{t('Покупатель')}</dt><dd>{o.recipient} · {o.phone}<div className="ztx-admin-muted">{o.buyerEmail}</div></dd>
          <dt>{t('Доставка')}</dt><dd>{o.deliveryMethod === 'pickup' ? `${t('Самовывоз')}: ${o.pickupPoint}` : `${o.city}, ${o.address}`}</dd>
          {o.comment && <><dt>{t('Комментарий')}</dt><dd>{o.comment}</dd></>}
          <dt>{t('Сумма')}</dt><dd>{money(o.subtotal)}{o.discount ? ` − ${money(o.discount)}${o.promoCode ? ` (${o.promoCode})` : ''}` : ''}{o.deliveryFee ? ` + ${money(o.deliveryFee)}` : ''} = <b>{money(o.total)}</b></dd>
          <dt>{t('Создан')}</dt><dd>{dt(o.createdAt)}</dd>
        </dl>
        <section><h4>{t('Состав')}</h4><table className="ztx-admin-mini"><tbody>{items.map((i) => (
          <tr key={i.id}><td>{i.title}<div className="ztx-admin-muted">{i.sellerEmail} · {t('комиссия')} {i.commissionPct}%</div></td><td className="is-num">{i.qty} × {money(i.price)}</td></tr>))}</tbody></table></section>
        {payments.length > 0 && <section><h4>{t('Платежи')}</h4><table className="ztx-admin-mini"><tbody>{payments.map((p) => (
          <tr key={p.id}><td>{p.provider}</td><td>{p.state}</td><td className="is-num">{money(p.amount)}</td></tr>))}</tbody></table></section>}
        <div className="ztx-admin-actions" style={{ justifyContent: 'flex-start' }}>
          {NEXT[o.status].map((s) => (
            <button key={s} type="button" className={`ztx-admin-btn ${s === 'cancelled' ? 'is-danger' : 'is-primary'}`} onClick={() => (s === 'cancelled' ? setAsk(s) : act(() => api.admin.setOrderStatus(o.id, s), 'Статус обновлён', reload))}>
              {s === 'cancelled' ? t('Отменить заказ') : `→ ${label(s)}`}
            </button>
          ))}
          {o.paymentStatus === 'refund_pending' && <button type="button" className="ztx-admin-btn is-primary" onClick={() => act(() => api.admin.refundDone(o.id), 'Возврат отмечен выполненным', reload)}><CheckCircle2 size={15} aria-hidden="true" /> {t('Возврат выполнен')}</button>}
        </div>
        <section><h4>{t('История заказа')}</h4>
          <ul className="ztx-admin-timeline">{events.map((e, i) => <li key={i}><b>{dt(e.createdAt)}</b> · {e.text || e.type}{e.actor ? <span className="ztx-admin-muted"> — {e.actor}</span> : null}</li>)}{events.length === 0 && <li className="ztx-admin-muted">{t('Событий нет')}</li>}</ul>
        </section>
        {ask && <ReasonDialog title={t('Отменить заказ?')} text={`${o.code}. ${t('Товар вернётся на склад, покупатель получит уведомление.')}`} confirmLabel={t('Отменить заказ')}
          onCancel={() => setAsk(null)} onConfirm={async (reason) => { await api.admin.setOrderStatus(o.id, 'cancelled', reason); setAsk(null); reload(); }} />}
      </>
    );
  };
  return <Drawer title={q.data ? `${t('Заказ')} ${q.data.order.code}` : t('Заказ')} onClose={onClose}>{body()}</Drawer>;
}

export default function Orders({ initial = {} }) {
  const filters = useFilters({ status: '', paymentStatus: '', from: '', to: '', sort: 'new', minTotal: '', maxTotal: '' }, 'orders', initial);
  const { f, set, page, params } = filters;
  const query = useList(api.admin.orders, params);
  const [open, setOpen] = useState(null);
  const { q, page: _p, ...exportParams } = params; // eslint-disable-line no-unused-vars
  return (
    <>
      <Toolbar q={f.q} onQ={(q) => set({ q })} placeholder={t('Номер, email, получатель, телефон')}>
        <Select value={f.status} onChange={(status) => set({ status })} label={t('Статус заказа')} options={[['', t('Все статусы')], ...Object.entries(ORDER_STATUS).map(([k, v]) => [k, t(v[0])])]} />
        <Select value={f.paymentStatus} onChange={(paymentStatus) => set({ paymentStatus })} label={t('Статус оплаты')} options={[['', t('Любая оплата')], ...Object.entries(PAY_STATUS).map(([k, v]) => [k, t(v[0])])]} />
        <Select value={f.sort} onChange={(sort) => set({ sort })} label={t('Сортировка')} options={[['new', t('Сначала новые')], ['old', t('Сначала старые')], ['total_desc', t('Сумма ↓')], ['total_asc', t('Сумма ↑')]]} />
        <input type="date" className="ztx-admin-input" style={{ width: 'auto' }} value={f.from} onChange={(e) => set({ from: e.target.value })} aria-label={t('С даты')} />
        <input type="date" className="ztx-admin-input" style={{ width: 'auto' }} value={f.to} onChange={(e) => set({ to: e.target.value })} aria-label={t('По дату')} />
        <input type="number" min="0" className="ztx-admin-input" style={{ width: 130 }} value={f.minTotal} onChange={(e) => set({ minTotal: e.target.value })} placeholder={t('Сумма от')} aria-label={t('Сумма от')} />
        <input type="number" min="0" className="ztx-admin-input" style={{ width: 130 }} value={f.maxTotal} onChange={(e) => set({ maxTotal: e.target.value })} placeholder={t('Сумма до')} aria-label={t('Сумма до')} />
        <ResetFilters filters={filters} />
        <CsvLink href={api.admin.exportUrl('orders', { ...exportParams, limit: undefined })} />
      </Toolbar>
      <ListState query={query} empty={t('Заказы не найдены')} onPage={page}>
        {(items) => (
          <div className="ztx-admin-scroll">
            <table className="ztx-admin-table">
              <thead><tr><th>{t('Заказ')}</th><th>{t('Покупатель')}</th><th className="is-num">{t('Сумма')}</th><th>{t('Статус')}</th><th>{t('Оплата')}</th><th><span className="ztx-admin-sr">{t('Действия')}</span></th></tr></thead>
              <tbody>
                {items.map((o) => (
                  <tr key={o.id}>
                    <td data-label={t('Заказ')}><button type="button" className="ztx-admin-link" onClick={() => setOpen(o.id)}>{o.code}</button><div className="ztx-admin-muted">{dt(o.createdAt)}</div></td>
                    <td data-label={t('Покупатель')}><div>{o.recipient}</div><div className="ztx-admin-muted">{o.buyerEmail}{o.city ? ` · ${o.city}` : ''}</div></td>
                    <td data-label={t('Сумма')} className="is-num">{money(o.total)}</td>
                    <td data-label={t('Статус')}>{stat(ORDER_STATUS, o.status)}</td>
                    <td data-label={t('Оплата')}>{stat(PAY_STATUS, o.paymentStatus)}</td>
                    <td className="ztx-admin-actions"><button type="button" className="ztx-admin-btn" onClick={() => setOpen(o.id)}>{t('Подробнее')}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ListState>
      {open && <OrderDrawer id={open} onClose={() => setOpen(null)} onChanged={query.retry} />}
    </>
  );
}
