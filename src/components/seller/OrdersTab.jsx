import { Truck, CheckCircle2, XCircle, MapPin, Phone, User, CreditCard, Tag, Store, MessageSquare } from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../useToast';
import { t, fmtDate } from '../../i18n';
import { money } from '../../format';

const STATUS = {
  pending: { text: 'Новый', cls: 'brand' },
  confirmed: { text: 'Подтверждён', cls: 'brand' },
  shipped: { text: 'Отправлен', cls: 'warn' },
  delivered: { text: 'Доставлен', cls: 'accent' },
  cancelled: { text: 'Отменён', cls: 'danger' },
};
const ACTIONS = {
  pending: [{ to: 'confirmed', label: 'Подтвердить', primary: true }, { to: 'cancelled', label: 'Отклонить' }],
  confirmed: [{ to: 'shipped', label: 'Отправить', primary: true }, { to: 'cancelled', label: 'Отменить' }],
  shipped: [{ to: 'delivered', label: 'Доставлен', primary: true }],
};
const METHOD = { cash: 'Наличными при получении', payme: 'Payme', click: 'Click', mock: 'Тестовая оплата' };
const PAY = {
  cod: { text: 'Оплата при получении', cls: '' },
  pending: { text: 'Ожидает оплаты', cls: 'warn' },
  paid: { text: 'Оплачен', cls: 'accent' },
  unpaid: { text: 'Не оплачен', cls: 'warn' },
  refund_pending: { text: 'Возврат в обработке', cls: 'warn' },
  refunded: { text: 'Возвращён', cls: '' },
};

export default function OrdersTab({ orders, loading, onChanged }) {
  const { toast } = useToast();

  const changeStatus = async (order, to) => {
    if (to === 'cancelled' && !window.confirm(t('Отменить заказ {code}? Товары вернутся на склад.', { code: order.code }))) return;
    try {
      await api.setOrderStatus(order.id, to);
      toast(t('Заказ {code}: {status}', { code: order.code, status: t(STATUS[to].text).toLowerCase() }));
      onChanged();
    } catch (err) {
      toast(err.message, 'error'); // например «Заказ ещё не оплачен покупателем»
      onChanged();
    }
  };

  return (
    <section className="ztx-seller-card" aria-labelledby="orders-h">
      <div className="ztx-seller-card-head"><h3 id="orders-h" style={{ margin: 0, fontSize: 18, color: 'var(--ink)' }}>{t('Заказы покупателей')}</h3></div>
      {orders.length === 0 ? (
        <div className="ztx-seller-empty">{loading ? t('Загрузка…') : t('Заказов пока нет. Они появятся, как только покупатели оформят покупку.')}</div>
      ) : (
        <div>
          {orders.map((o) => {
            const st = STATUS[o.status] || { text: o.status, cls: '' };
            const pay = PAY[o.paymentStatus] || { text: o.paymentStatus, cls: '' };
            const pickup = o.deliveryMethod === 'pickup';
            const unpaidOnline = o.paymentStatus === 'pending' && o.status === 'pending';
            const place = pickup
              ? [o.pickupPoint?.name, o.pickupPoint?.address].filter(Boolean).join(', ')
              : [o.city, o.address].filter(Boolean).join(', ');
            return (
              <article key={o.id} className="ztx-seller-order" aria-label={t('Заказ {code}', { code: o.code })}>
                <div className="ztx-seller-order-main">
                  <div className="ztx-seller-order-top">
                    <b>{o.code}</b>
                    <span className={`ztx-seller-badge ${st.cls}`}>{t(st.text)}</span>
                    <span className="ztx-seller-hint">{fmtDate(o.createdAt)}</span>
                  </div>
                  <div className="ztx-seller-meta">
                    <span><User size={14} aria-hidden="true" />{o.recipient || o.buyer?.name}</span>
                    {(o.phone || o.buyer?.phone) && <span><Phone size={14} aria-hidden="true" /><a href={`tel:${(o.phone || o.buyer.phone).replace(/[^\d+]/g, '')}`} style={{ color: 'inherit' }}>{o.phone || o.buyer.phone}</a></span>}
                  </div>
                  <div className="ztx-seller-meta">
                    <span>{pickup ? <Store size={14} aria-hidden="true" /> : <MapPin size={14} aria-hidden="true" />}
                      <b style={{ fontWeight: 600 }}>{pickup ? t('Самовывоз') : t('Доставка')}</b>{place ? `: ${place}` : ''}
                    </span>
                  </div>
                  <div className="ztx-seller-meta">
                    <span><CreditCard size={14} aria-hidden="true" />{t(METHOD[o.paymentMethod] || o.paymentMethod)}</span>
                    <span className={`ztx-seller-badge ${pay.cls}`}>{t(pay.text)}</span>
                    {o.discount > 0 && (
                      <span><Tag size={14} aria-hidden="true" />{o.promoCode ? t('Промокод {code}', { code: o.promoCode }) : t('Скидка')}: −{money(o.discount)} {t('на весь заказ')}</span>
                    )}
                  </div>
                  {o.comment && <div className="ztx-seller-meta"><span><MessageSquare size={14} aria-hidden="true" />{o.comment}</span></div>}
                  <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 2 }}>{o.items.map((i) => `${i.title} × ${i.qty}`).join(', ')}</div>
                </div>
                <div className="ztx-seller-order-side">
                  <div className="ztx-seller-order-total">{money(o.total)}</div>
                  <div className="ztx-seller-order-actions">
                    {(ACTIONS[o.status] || []).map((a) => (
                      <button
                        key={a.to} type="button"
                        className={`ztx-seller-btn ${a.primary ? 'primary' : 'danger'}`}
                        disabled={a.to === 'confirmed' && unpaidOnline}
                        onClick={() => changeStatus(o, a.to)}
                      >
                        {a.to === 'shipped' ? <Truck size={14} aria-hidden="true" /> : a.to === 'cancelled' ? <XCircle size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
                        {t(a.label)}
                      </button>
                    ))}
                  </div>
                  {unpaidOnline && <div className="ztx-seller-order-wait" role="note">{t('Ждём оплату от покупателя — подтвердить заказ можно после оплаты')}</div>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
