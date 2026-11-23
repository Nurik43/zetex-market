import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle, Clock, CreditCard, FlaskConical, AlertCircle, Lock } from 'lucide-react';
import { api } from '../api';
import { useToast } from '../components/useToast';
import { navigate } from '../router';
import { t } from '../i18n';
import { money } from '../format';
import './pay.css';

const POLL_MS = 5000;
const HOLD_MIN = 30; // по умолчанию сервер держит заказ 30 минут (PAYMENT_HOLD_MINUTES)
const PROVIDERS = { payme: 'Payme', click: 'Click', mock: 'Демо-оплата' };

const parseDate = (s) => (s ? Date.parse(String(s).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z')) : NaN);

function Result({ icon: Icon, tone, title, children }) {
  return (
    <div className={`ztx-pay-card ${tone}`}>
      <div className="ztx-pay-icon"><Icon size={40} /></div>
      <h1>{title}</h1>
      {children}
    </div>
  );
}

function Links() {
  return (
    <div className="ztx-pay-actions">
      <button type="button" className="ztx-btn ztx-btn-solid" onClick={() => navigate('/orders')}>{t('Мои заказы')}</button>
      <button type="button" className="ztx-btn ztx-pay-ghost" onClick={() => navigate('/catalog')}>{t('В каталог')}</button>
    </div>
  );
}

export default function Pay({ id, user, onPaid }) {
  const { toast } = useToast();
  const [state, setState] = useState({ id: null, order: null, status: 0, message: '' });
  const [link, setLink] = useState({ id: null, url: '', error: '' });
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const prevPending = useRef(false);
  const onPaidRef = useRef(onPaid);
  useEffect(() => { onPaidRef.current = onPaid; });

  const load = useCallback(() => api.order(id).then(
    ({ order }) => {
      if (prevPending.current && (order.paymentStatus === 'paid')) onPaidRef.current?.(order);
      prevPending.current = order.paymentStatus === 'pending' && order.status !== 'cancelled';
      setState({ id, order, status: 0, message: '' });
    },
    (e) => setState((s) => ({ id, order: s.id === id ? s.order : null, status: e.status ?? 0, message: e.message || '' })),
  ), [id]);

  // загрузка + опрос, пока заказ ждёт оплаты
  const order = state.id === id ? state.order : null;
  const waiting = !!order && order.paymentStatus === 'pending' && order.status !== 'cancelled';
  useEffect(() => { prevPending.current = false; load(); }, [load, user?.id]);
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, load]);
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, [waiting]);

  const method = order?.paymentMethod;
  const needLink = waiting && (method === 'payme' || method === 'click');
  useEffect(() => {
    if (!needLink) return undefined;
    let alive = true;
    api.paymentLink(id).then(
      (r) => { if (alive) setLink({ id, url: r.url || '', error: '' }); },
      (e) => { if (alive) setLink({ id, url: '', error: e.message || '' }); },
    );
    return () => { alive = false; };
  }, [needLink, id]);

  const mockPay = async () => {
    setBusy(true);
    try {
      await api.mockPay(id);
      toast(t('Оплата прошла успешно'), 'success');
      await load();
    } catch (e) {
      toast(e.message || t('Не удалось провести оплату'), 'error');
      await load();
    } finally { setBusy(false); }
  };

  if (state.id !== id || (!order && !state.status && !state.message)) {
    return <p className="ztx-pay-muted" role="status">{t('Загрузка…')}</p>;
  }

  if (!order) {
    const { status, message } = state;
    const text = status === 401 ? t('Войдите в аккаунт покупателя, чтобы увидеть этот заказ.')
      : status === 403 ? t('У вас нет доступа к этому заказу. Войдите в аккаунт покупателя.')
        : status === 404 ? t('Заказ не найден. Возможно, он принадлежит другому аккаунту.')
          : message;
    return (
      <Result icon={status === 401 || status === 403 ? Lock : AlertCircle} tone="warn" title={t('Заказ недоступен')}>
        <p role="alert">{text}</p>
        {status !== 401 && status !== 403 && status !== 404 && (
          <button type="button" className="ztx-btn ztx-btn-solid" onClick={load}>{t('Повторить')}</button>
        )}
        {status === 404 && <Links />}
      </Result>
    );
  }

  const summary = (
    <dl className="ztx-pay-sum">
      <div><dt>{t('Заказ')}</dt><dd>№ {order.code}</dd></div>
      <div><dt>{t('Итого')}</dt><dd><b>{money(order.total)}</b></dd></div>
    </dl>
  );

  if (order.status === 'cancelled') {
    const refund = order.paymentStatus === 'refund_pending';
    return (
      <Result icon={XCircle} tone="danger" title={t('Заказ отменён')}>
        {summary}
        <p>{refund
          ? t('Возврат средств в обработке. Деньги вернутся на карту в ближайшее время.')
          : order.paymentStatus === 'refunded'
            ? t('Деньги за заказ возвращены.')
            : t('Заказ отменён или время на оплату истекло. Оформите заказ заново.')}</p>
        <Links />
      </Result>
    );
  }

  if (order.paymentStatus === 'paid' || order.paymentStatus === 'cod') {
    return (
      <Result icon={CheckCircle2} tone="ok" title={t('Заказ оформлен')}>
        {summary}
        <p>{order.paymentStatus === 'cod' ? t('Оплата при получении. Мы свяжемся с вами для подтверждения.') : t('Оплата получена. Спасибо за покупку!')}</p>
        <Links />
      </Result>
    );
  }

  if (order.paymentStatus !== 'pending') {
    return (
      <Result icon={AlertCircle} tone="warn" title={t('Заказ не ожидает оплаты')}>
        {summary}
        <Links />
      </Result>
    );
  }

  // ждёт оплаты
  const deadline = parseDate(order.createdAt) + HOLD_MIN * 60000;
  const left = Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - now) / 60000)) : null;
  const provider = t(PROVIDERS[method] || 'Онлайн-оплата');

  return (
    <Result icon={Clock} tone="info" title={t('Ожидает оплаты')}>
      {summary}
      <dl className="ztx-pay-sum">
        <div><dt>{t('Способ оплаты')}</dt><dd>{provider}</dd></div>
      </dl>
      {left !== null && (
        <p className="ztx-pay-hold">
          {left > 0 ? t('Заказ зарезервирован примерно на {n} мин. Оплатите его, иначе он будет отменён.', { n: left })
            : t('Время резерва истекает — заказ может быть отменён в любой момент.')}
        </p>
      )}

      {method === 'mock' ? (
        <div className="ztx-pay-demo">
          <p><FlaskConical size={16} aria-hidden="true" /> {t('Это демо-страница оплаты: деньги не списываются.')}</p>
          <button type="button" className="ztx-btn ztx-btn-solid" onClick={mockPay} disabled={busy}>
            {busy ? t('Оплата…') : t('Оплатить (демо)')} · {money(order.total)}
          </button>
        </div>
      ) : (
        <div className="ztx-pay-demo">
          {link.id === id && link.error && <p className="ztx-pay-err" role="alert">{link.error}</p>}
          {link.id === id && link.url ? (
            <a className="ztx-btn ztx-btn-solid ztx-pay-go" href={link.url} onClick={(e) => { e.preventDefault(); window.location.href = link.url; }}>
              <CreditCard size={18} /> {t('Перейти к оплате')}
            </a>
          ) : !link.error && <p className="ztx-pay-muted" role="status">{t('Готовим ссылку на оплату…')}</p>}
        </div>
      )}

      <p className="ztx-pay-note" role="status">{t('Статус обновляется автоматически, страницу можно не перезагружать.')}</p>
      <Links />
    </Result>
  );
}
