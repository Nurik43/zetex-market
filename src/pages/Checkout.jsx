import { useEffect, useMemo, useRef, useState } from 'react';
import { ShoppingBag, LogIn, Truck, Store, Banknote, CreditCard, FlaskConical, Minus, Plus, Trash2, Tag, X, AlertCircle, MailWarning } from 'lucide-react';
import { api, imgUrl, hideBrokenImg } from '../api';
import { useConfig } from '../useConfig';
import { useToast } from '../components/useToast';
import { navigate } from '../router';
import { t } from '../i18n';
import { money } from '../format';
import './checkout.css';

const PREFS_KEY = 'ztx_checkout_prefs';
const PAY_METHODS = [
  { id: 'cash', title: 'Наличными при получении', hint: 'Оплата курьеру или в пункте выдачи', Icon: Banknote },
  { id: 'payme', title: 'Payme', hint: 'Оплата картой через Payme', Icon: CreditCard },
  { id: 'click', title: 'Click', hint: 'Оплата картой через Click', Icon: CreditCard },
  { id: 'mock', title: 'Демо-оплата (без списания денег)', hint: 'Тестовый режим: деньги не списываются', Icon: FlaskConical },
];

const readPrefs = () => {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; }
};
const savePrefs = (p) => {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* приватный режим */ }
};

/** Приводит ввод к виду «+998 XX XXX XX XX»; номера других стран остаются как введены. */
function formatPhone(raw) {
  const hasPlus = String(raw).trim().startsWith('+');
  let d = String(raw).replace(/\D/g, '').slice(0, 15);
  if (!d) return '';
  if (!hasPlus && !d.startsWith('998') && d.length <= 9) d = '998' + d;
  if (!d.startsWith('998')) return '+' + d;
  const r = d.slice(3, 12);
  return ['+998', r.slice(0, 2), r.slice(2, 5), r.slice(5, 7), r.slice(7, 9)].filter(Boolean).join(' ');
}
const phoneDigits = (v) => v.replace(/\D/g, '').length;

function Stub({ icon: Icon, title, text, children }) {
  return (
    <div className="ztx-empty ztx-page">
      <div className="ztx-empty-icon"><Icon size={36} /></div>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}

export default function Checkout({ cart, user, onOpenAuth, onUpdateCount, onRemove, onOrderPlaced }) {
  const cfg = useConfig();
  const { toast } = useToast();
  const prefs = useMemo(() => readPrefs(), []);

  const [name, setName] = useState(() => [user?.firstName, user?.lastName].filter(Boolean).join(' '));
  const [phone, setPhone] = useState(() => formatPhone(prefs.phone || user?.phone || ''));
  const [method, setMethod] = useState('delivery');
  const [city, setCity] = useState(prefs.city || '');
  const [address, setAddress] = useState(prefs.address || '');
  const [pickupPoint, setPickupPoint] = useState('');
  const [payment, setPayment] = useState('');
  const [comment, setComment] = useState('');
  const [promoInput, setPromoInput] = useState('');
  const [promo, setPromo] = useState(null); // ответ validatePromo + ключ корзины, для которого он получен
  const [promoError, setPromoError] = useState('');
  const [promoBusy, setPromoBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef(null);
  const promoReq = useRef(0);

  const items = useMemo(() => cart.map((c) => ({ productId: c.id, qty: c.count })), [cart]);
  const curKey = items.map((i) => `${i.productId}x${i.qty}`).join(',') + '|' + method;
  const promoCode = promo?.code || '';
  const subtotal = cart.reduce((s, c) => s + c.price * c.count, 0);

  const cities = cfg?.delivery.cities || [];
  const points = (cfg?.delivery.pickupPoints || []).filter((p) => p.city === city);
  const payMethods = PAY_METHODS.filter((m) => cfg?.payments?.[m.id]);
  const paySelected = payMethods.some((m) => m.id === payment) ? payment : payMethods[0]?.id || '';
  const pointSelected = points.some((p) => p.id === pickupPoint) ? pickupPoint : points.length === 1 ? points[0].id : '';

  // Повторная проверка применённого промокода при смене корзины или способа получения
  useEffect(() => {
    if (!promoCode || !items.length) return undefined;
    const counter = promoReq;
    const id = ++counter.current;
    api.validatePromo({ code: promoCode, deliveryMethod: method, items })
      .then((r) => { if (id === promoReq.current) setPromo({ ...r, key: curKey }); })
      .catch((e) => {
        if (id !== promoReq.current) return;
        setPromo(null);
        setPromoError(e.message);
      });
    return () => { counter.current++; };
    // curKey включает items и method
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curKey, promoCode]);

  if (!cart.length) {
    return (
      <Stub icon={ShoppingBag} title={t('Корзина пуста')} text={t('Добавьте товары из каталога, чтобы оформить заказ.')}>
        <button className="ztx-btn ztx-btn-solid" onClick={() => navigate('/catalog')}>{t('Перейти в каталог')}</button>
      </Stub>
    );
  }
  if (!user) {
    return (
      <Stub icon={LogIn} title={t('Войдите, чтобы оформить заказ')} text={t('Корзина сохранится. После входа вы сможете выбрать доставку и оплату.')}>
        <button className="ztx-btn ztx-btn-solid" onClick={onOpenAuth}>{t('Войти или зарегистрироваться')}</button>
      </Stub>
    );
  }
  if (user.role !== 'buyer') {
    return (
      <Stub icon={Store} title={t('Заказы доступны покупателям')} text={t('Вы вошли как продавец или администратор. Чтобы оформить заказ, войдите в аккаунт покупателя.')}>
        <button className="ztx-btn ztx-btn-solid" onClick={() => navigate('/')}>{t('На главную')}</button>
      </Stub>
    );
  }

  // Сумма: после проверки промокода берём ответ сервера, иначе считаем так же, как сервер
  const fresh = promo && promo.key === curKey ? promo : null;
  const freeFrom = cfg?.delivery.freeFrom ?? 0;
  const baseFee = cfg?.delivery.fee ?? 0;
  const discount = fresh ? fresh.discount : 0;
  const goods = subtotal - discount;
  const fee = fresh ? fresh.deliveryFee : method === 'pickup' || goods >= freeFrom ? 0 : baseFee;
  const total = fresh ? fresh.total : goods + fee;
  const toFree = method === 'delivery' && fee > 0 ? freeFrom - goods : 0;

  const applyPromo = async (e) => {
    e.preventDefault();
    const code = promoInput.trim();
    if (!code || promoBusy) return;
    setPromoBusy(true);
    setPromoError('');
    try {
      const r = await api.validatePromo({ code, deliveryMethod: method, items });
      promoReq.current++;
      setPromo({ ...r, key: curKey });
      setPromoInput('');
    } catch (err) {
      setPromoError(err.message);
    } finally {
      setPromoBusy(false);
    }
  };
  const removePromo = () => { setPromo(null); setPromoError(''); };

  const validate = () => {
    const er = {};
    if (name.trim().length < 2) er.name = t('Укажите имя получателя');
    if (phoneDigits(phone) < 9) er.phone = t('Введите корректный номер телефона');
    if (method === 'delivery') {
      if (!city) er.city = t('Выберите город');
      if (address.trim().length < 5) er.address = t('Укажите адрес доставки');
    } else {
      if (!city) er.city = t('Выберите город');
      else if (!pointSelected) er.point = points.length ? t('Выберите пункт выдачи') : t('В этом городе нет пунктов выдачи');
    }
    if (!paySelected) er.payment = t('Нет доступных способов оплаты');
    return er;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    const er = validate();
    setErrors(er);
    setFormError('');
    if (Object.keys(er).length) {
      formRef.current?.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const { order } = await api.createOrder({
        items,
        deliveryMethod: method,
        city,
        address: method === 'delivery' ? address.trim() : '',
        pickupPoint: method === 'pickup' ? pointSelected : '',
        recipient: name.trim(),
        phone,
        paymentMethod: paySelected,
        promoCode,
        comment: comment.trim(),
      });
      savePrefs({ phone, city, address: address.trim() || prefs.address || '' });
      onOrderPlaced(order);
      if (order.paymentMethod === 'cash') {
        toast(t('Заказ {code} оформлен', { code: order.code }));
        navigate('/orders');
      } else {
        navigate('/pay/' + order.id);
      }
    } catch (err) {
      setFormError(err.message);
      toast(err.message, 'error');
      setSubmitting(false);
    }
  };

  const err = (k) => errors[k] && <span className="ztx-checkout-err" role="alert">{errors[k]}</span>;
  const unverified = cfg?.requireVerifiedEmail && !user.emailVerified;

  return (
    <div className="ztx-page ztx-checkout">
      <div className="ztx-section-head"><h2>{t('Оформление заказа')}</h2></div>
      {!cfg ? (
        <p className="ztx-checkout-muted">{t('Загрузка…')}</p>
      ) : (
        <form className="ztx-checkout-layout" onSubmit={submit} ref={formRef} noValidate>
          <div className="ztx-checkout-main">
            {unverified && (
              <div className="ztx-checkout-note warn" role="status">
                <MailWarning size={18} />
                <span>{t('Чтобы оформить заказ, подтвердите почту {email}. Письмо со ссылкой уже отправлено.', { email: user.email })}</span>
              </div>
            )}

            <section className="ztx-checkout-card" aria-labelledby="co-s1">
              <h3 id="co-s1"><b>1</b>{t('Получатель')}</h3>
              <div className="ztx-checkout-row">
                <label className="ztx-checkout-field">
                  <span>{t('Имя и фамилия')}</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={100} aria-invalid={!!errors.name} />
                  {err('name')}
                </label>
                <label className="ztx-checkout-field">
                  <span>{t('Телефон')}</span>
                  <input value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} inputMode="tel" autoComplete="tel"
                    placeholder={t('+998 XX XXX XX XX')} aria-invalid={!!errors.phone} />
                  {err('phone')}
                </label>
              </div>
            </section>

            <section className="ztx-checkout-card" aria-labelledby="co-s2">
              <h3 id="co-s2"><b>2</b>{t('Получение')}</h3>
              <div className="ztx-checkout-seg" role="radiogroup" aria-label={t('Способ получения')}>
                {[['delivery', Truck, 'Доставка курьером'], ['pickup', Store, 'Самовывоз']].map(([id, Icon, label]) => (
                  <label key={id} className={method === id ? 'on' : ''}>
                    <input type="radio" name="method" checked={method === id} onChange={() => { setMethod(id); setErrors({}); }} />
                    <Icon size={18} />{t(label)}
                  </label>
                ))}
              </div>
              <label className="ztx-checkout-field">
                <span>{t('Город')}</span>
                <select value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" aria-invalid={!!errors.city}>
                  <option value="">{t('Выберите город')}</option>
                  {cities.map((c) => <option key={c} value={c}>{t(c)}</option>)}
                </select>
                {err('city')}
              </label>
              {method === 'delivery' ? (
                <label className="ztx-checkout-field">
                  <span>{t('Адрес доставки')}</span>
                  <input value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="street-address" maxLength={300}
                    placeholder={t('Улица, дом, квартира')} aria-invalid={!!errors.address} />
                  {err('address')}
                </label>
              ) : city && (
                <div className="ztx-checkout-field">
                  <span id="co-points">{t('Пункт выдачи')}</span>
                  {points.length ? (
                    <div className="ztx-checkout-points" role="radiogroup" aria-labelledby="co-points">
                      {points.map((p) => (
                        <label key={p.id} className={pointSelected === p.id ? 'on' : ''}>
                          <input type="radio" name="point" checked={pointSelected === p.id} onChange={() => setPickupPoint(p.id)} aria-invalid={!!errors.point} />
                          <span><b>{p.name}</b><small>{p.address}</small></span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="ztx-checkout-note"><AlertCircle size={16} />{t('В этом городе пока нет пунктов выдачи. Выберите другой город или доставку курьером.')}</p>
                  )}
                  {err('point')}
                </div>
              )}
            </section>

            <section className="ztx-checkout-card" aria-labelledby="co-s3">
              <h3 id="co-s3"><b>3</b>{t('Оплата')}</h3>
              {payMethods.length ? (
                <div className="ztx-checkout-pay" role="radiogroup" aria-label={t('Способ оплаты')}>
                  {payMethods.map(({ id, title, hint, Icon }) => (
                    <label key={id} className={paySelected === id ? 'on' : ''}>
                      <input type="radio" name="payment" checked={paySelected === id} onChange={() => setPayment(id)} />
                      <Icon size={20} />
                      <span><b>{t(title)}</b><small>{t(hint)}</small></span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="ztx-checkout-note"><AlertCircle size={16} />{t('Нет доступных способов оплаты. Попробуйте позже.')}</p>
              )}
              {err('payment')}
            </section>

            <section className="ztx-checkout-card" aria-labelledby="co-s4">
              <h3 id="co-s4"><b>4</b>{t('Промокод и комментарий')}</h3>
              {promo ? (
                <div className="ztx-checkout-promo-ok">
                  <Tag size={16} />
                  <span>{t('Промокод {code} применён', { code: promo.code })}</span>
                  <button type="button" onClick={removePromo} aria-label={t('Убрать промокод')}><X size={16} /></button>
                </div>
              ) : (
                <div className="ztx-checkout-promo">
                  <input value={promoInput} onChange={(e) => { setPromoInput(e.target.value); setPromoError(''); }} maxLength={30}
                    placeholder={t('Промокод')} aria-label={t('Промокод')} autoCapitalize="characters"
                    onKeyDown={(e) => { if (e.key === 'Enter') applyPromo(e); }} />
                  <button type="button" className="ztx-btn ztx-checkout-apply" onClick={applyPromo} disabled={promoBusy || !promoInput.trim()}>
                    {promoBusy ? t('Проверяем…') : t('Применить')}
                  </button>
                </div>
              )}
              {promoError && <span className="ztx-checkout-err" role="alert">{promoError}</span>}
              <label className="ztx-checkout-field">
                <span>{t('Комментарий к заказу')}</span>
                <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} rows={3}
                  placeholder={t('Например: позвоните за час до доставки')} />
              </label>
            </section>
          </div>

          <aside className="ztx-checkout-side" aria-label={t('Ваш заказ')}>
            <div className="ztx-checkout-card">
              <h3>{t('Ваш заказ')}</h3>
              <ul className="ztx-checkout-items">
                {cart.map((c) => (
                  <li key={c.id}>
                    <img src={imgUrl(c.image)} alt="" onError={hideBrokenImg} loading="lazy" />
                    <div>
                      <span className="ztx-checkout-title">{c.title}</span>
                      <span className="ztx-checkout-price">{money(c.price)}</span>
                      <div className="ztx-checkout-qty">
                        <button type="button" onClick={() => onUpdateCount(c.id, c.count - 1)} disabled={c.count <= 1} aria-label={t('Уменьшить количество')}><Minus size={14} /></button>
                        <output aria-live="polite">{c.count}</output>
                        <button type="button" onClick={() => onUpdateCount(c.id, c.count + 1)} disabled={c.count >= (c.stock ?? 999)} aria-label={t('Увеличить количество')}><Plus size={14} /></button>
                        <button type="button" className="rm" onClick={() => onRemove(c.id)} aria-label={t('Удалить из корзины')}><Trash2 size={15} /></button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              <dl className="ztx-checkout-sum">
                <div><dt>{t('Товары')}</dt><dd>{money(subtotal)}</dd></div>
                {discount > 0 && <div className="disc"><dt>{t('Скидка')}</dt><dd>−{money(discount)}</dd></div>}
                <div><dt>{t('Доставка')}</dt><dd>{fee ? money(fee) : t('Бесплатно')}</dd></div>
                {toFree > 0 && <p className="ztx-checkout-free">{t('До бесплатной доставки осталось {sum}', { sum: money(toFree) })}</p>}
                <div className="total"><dt>{t('Итого')}</dt><dd>{money(total)}</dd></div>
              </dl>
              {formError && <p className="ztx-checkout-note err" role="alert"><AlertCircle size={16} />{formError}</p>}
              <button type="submit" className="ztx-btn ztx-btn-solid ztx-checkout-submit" disabled={submitting || unverified}>
                {submitting ? t('Оформляем…') : t('Подтвердить заказ')}
              </button>
              <p className="ztx-checkout-muted small">{t('Окончательную цену и наличие проверяет сервер при оформлении.')}</p>
              <p className="ztx-checkout-muted small">{t('Подтверждая заказ, вы соглашаетесь с')} <a href="/terms" target="_blank" rel="noopener noreferrer">{t('пользовательским соглашением')}</a> {t('и условиями')} <a href="/returns" target="_blank" rel="noopener noreferrer">{t('возврата')}</a>.</p>
            </div>
          </aside>
        </form>
      )}
    </div>
  );
}
