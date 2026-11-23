import { useState, useRef, useEffect } from 'react';
import { useToast } from './useToast';
import { Package, CheckCircle2, Clock, ChevronRight, User, MessageSquare, Ticket, LogOut, Truck, Store, Phone, CreditCard, Tag, Star } from 'lucide-react';

import { imgUrl } from '../api';
import { navigate } from '../router';
import { t, locale } from '../i18n';
import { money } from '../format';
import TelegramCard from './seller/TelegramCard';
import AccountCard from './AccountCard';
import ComposeDialog from './ComposeDialog';

export default function OrdersList({ orders = [], onProductClick, setActiveTab, user, onUpdateUser, onCancelOrder, onLogout, onUserChanged }) {
  const { toast } = useToast();
  // Состояние активного раздела левого меню
  const [leftMenuTab, setLeftMenuTab] = useState('Заказы');
  
  // Состояние фильтра заказов
  const [activeSubTab, setActiveSubTab] = useState('Все заказы');
  const [composeFor, setComposeFor] = useState(null); // { orderId, sellerId, title } — кому пишем из заказа

  // Данные профиля берутся из аккаунта (без «зашитых» значений)
  const [profile, setProfile] = useState({
    lastName: user?.lastName || '',
    firstName: user?.firstName || '',
    middleName: user?.middleName || '',
    birthDate: user?.birthDate || '',
    gender: user?.gender || '',
    email: user?.email || '',
    phone: user?.phone || ''
  });

  // Состояние для промокода
  const [promoCode, setPromoCode] = useState('');

  // Изменения профиля сохраняются на сервере с задержкой (не на каждую букву)
  const saveTimer = useRef(null);
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const handleProfileChange = (field, value) => {
    const updated = { ...profile, [field]: value };
    setProfile(updated);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (!onUpdateUser) return;
      const { firstName, lastName, middleName, birthDate, gender, phone } = updated; // почта не меняется
      if (firstName.trim() && lastName.trim()) onUpdateUser({ firstName, lastName, middleName, birthDate, gender, phone });
    }, 700);
  };

  // Фильтрация заказов
  const ACTIVE = ['pending', 'confirmed', 'shipped'];
  const filteredOrders = orders.filter(order => {
    if (activeSubTab === 'Активные') return ACTIVE.includes(order.status);
    if (activeSubTab === 'Неоплаченные') return order.paymentStatus === 'pending' && order.status !== 'cancelled';
    return true;
  });

  const getStatusStyles = (status) => {
    switch (status) {
      case 'delivered':
        return { text: t('Доставлено'), color: 'var(--accent)', bg: 'var(--accent-tint)', icon: <CheckCircle2 size={14} /> };
      case 'cancelled':
        return { text: t('Отменён'), color: 'var(--danger)', bg: 'var(--danger-tint)', icon: <Clock size={14} /> };
      case 'confirmed':
        return { text: t('Подтверждён'), color: 'var(--brand)', bg: 'var(--brand-tint)', icon: <Clock size={14} /> };
      case 'shipped':
        return { text: t('В пути'), color: 'var(--warn-ink)', bg: 'var(--warn-tint)', icon: <Clock size={14} /> };
      default:
        return { text: t('В обработке'), color: 'var(--brand)', bg: 'var(--brand-tint)', icon: <Clock size={14} /> };
    }
  };

  const PAY_METHODS = { cash: t('Наличными при получении'), payme: 'Payme', click: 'Click', mock: t('Демо-оплата') };
  const getPayment = (o) => {
    switch (o.paymentStatus) {
      case 'paid': return { text: t('Оплачен'), color: 'var(--accent)' };
      case 'cod': return { text: t('Оплата при получении'), color: 'var(--ink-2)' };
      case 'pending': return { text: t('Ожидает оплаты'), color: 'var(--warn-ink)' };
      case 'refund_pending': return { text: t('Возврат средств в обработке'), color: 'var(--warn-ink)' };
      case 'refunded': return { text: t('Средства возвращены'), color: 'var(--ink-2)' };
      default: return { text: t('Не оплачен'), color: 'var(--danger)' };
    }
  };
  const detailRow = { display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '13px', color: 'var(--ink-2)', lineHeight: 1.4, minWidth: 0, overflowWrap: 'anywhere' };

  const displayName = `${profile.firstName} ${profile.lastName}`.trim() || t('Мой профиль');

  return (
    <div style={{ maxWidth: '1240px', margin: '0 auto', padding: '40px 20px',  }}>
      
      {/* Имя пользователя сверху */}
      <h1 style={{ fontSize: '28px', fontWeight: '700', color: 'var(--ink)', margin: '0 0 32px 0', letterSpacing: '-0.5px' }}>
        {displayName}
      </h1>

      {/* Сетка личного кабинета */}
      <div className="ztx-account-grid" style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '40px', alignItems: 'start' }}>
        
        {/* ЛЕВОЕ БОКОВОЕ МЕНЮ (UZUM STYLE) */}
        <div className="ztx-account-menu" style={{ display: 'flex', flexDirection: 'column', backgroundColor: 'var(--soft)', padding: '8px', borderRadius: '12px', gap: '4px' }}>
          <button 
            onClick={() => setLeftMenuTab('Заказы')}
            style={{
              display: 'flex', alignItems: 'center', gap: '12px', width: '100%', padding: '14px 16px', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: '500', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
              backgroundColor: leftMenuTab === 'Заказы' ? 'var(--line)' : 'transparent',
              color: 'var(--ink)'
            }}
          >
            <Package size={18} color="var(--ink-2)" /> {t('Заказы')}
          </button>
          
          <button 
            onClick={() => setLeftMenuTab('Отзывы')}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '14px 16px', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: '500', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
              backgroundColor: leftMenuTab === 'Отзывы' ? 'var(--line)' : 'transparent',
              color: 'var(--ink)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <MessageSquare size={18} color="var(--ink-2)" /> {t('Отзывы')}
            </div>
            <span style={{ width: '6px', height: '6px', backgroundColor: 'var(--brand)', borderRadius: '50%' }}></span>
          </button>

          <button 
            onClick={() => setLeftMenuTab('Профиль')}
            style={{
              display: 'flex', alignItems: 'center', gap: '12px', width: '100%', padding: '14px 16px', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: '500', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
              backgroundColor: leftMenuTab === 'Профиль' ? 'var(--line)' : 'transparent',
              color: 'var(--ink)'
            }}
          >
            <User size={18} color="var(--ink-2)" /> {t('Профиль')}
          </button>

          <button 
            onClick={() => setLeftMenuTab('Промокоды')}
            style={{
              display: 'flex', alignItems: 'center', gap: '12px', width: '100%', padding: '14px 16px', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: '500', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
              backgroundColor: leftMenuTab === 'Промокоды' ? 'var(--line)' : 'transparent',
              color: 'var(--ink)'
            }}
          >
            <Ticket size={18} color="var(--ink-2)" /> {t('Социальные промокоды')}
          </button>
        </div>

        {/* ПРАВАЯ ИНТЕРАКТИВНАЯ ЧАСТЬ */}
        <div style={{ backgroundColor: 'var(--surface)', minHeight: '400px' }}>
          
          {/* В К Л А Д К А : З А К А З Ы */}
          {leftMenuTab === 'Заказы' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', borderBottom: '1px solid var(--line)', paddingBottom: '16px' }}>
                {['Все заказы', 'Неоплаченные', 'Активные'].map((tab) => {
                  const isSelected = activeSubTab === tab;
                  return (
                    <button
                      key={tab}
                      onClick={() => setActiveSubTab(tab)}
                      style={{
                        padding: '8px 18px', borderRadius: '20px', border: 'none', fontSize: '14px', fontWeight: '600', cursor: 'pointer', transition: 'all 0.2s',
                        backgroundColor: isSelected ? 'var(--ink)' : 'var(--soft)',
                        color: isSelected ? 'var(--surface)' : 'var(--ink-2)'
                      }}
                    >
                      {t(tab)}
                    </button>
                  );
                })}
              </div>

              {filteredOrders.length === 0 ? (
                /* Пустой экран заказов */
                <div style={{ textAlign: 'center', padding: '60px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <h3 style={{ fontSize: '24px', fontWeight: '700', color: 'var(--ink)', margin: '0 0 12px 0' }}>{t('Здесь пусто')}</h3>
                  <p style={{ color: 'var(--ink-2)', fontSize: '14px', margin: '0 0 24px 0', maxWidth: '400px', lineHeight: '1.5' }}>
                    {activeSubTab === 'Все заказы' ? t('У вас нет заказов!') : activeSubTab === 'Активные' ? t('У вас нет активных заказов!') : t('У вас нет неоплаченных заказов!')}<br />
                    {t('Воспользуйтесь поиском, чтобы найти всё что нужно.')}
                  </p>
                  <button 
                    onClick={() => setActiveTab && setActiveTab('home')}
                    style={{ backgroundColor: 'var(--brand)', color: 'var(--on-brand)', border: 'none', padding: '12px 28px', borderRadius: '10px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', boxShadow: '0 4px 12px rgba(31, 79, 224, 0.15)' }}
                  >
                    {t('Начать покупки')}
                  </button>
                  <span onClick={() => setActiveTab && setActiveTab('home')} style={{ color: 'var(--ink)', fontSize: '14px', fontWeight: '600', marginTop: '16px', cursor: 'pointer', textDecoration: 'underline' }}>
                    {t('Вернуться на главную')}
                  </span>
                </div>
              ) : (
                /* Карточки заказов */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {filteredOrders.map((order) => {
                    const currentStatus = getStatusStyles(order.status);
                    return (
                      <div key={order.id} style={{ borderRadius: '14px', border: '1px solid var(--line)', overflow: 'hidden' }}>
                        <div style={{ backgroundColor: 'var(--soft)', padding: '14px 20px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 24px', fontSize: '13px' }}>
                            <div>
                              <span style={{ color: 'var(--ink-2)', display: 'block' }}>{t('Заказ')}</span>
                              <span style={{ fontWeight: '700' }}>№ {order.code}</span>
                            </div>
                            <div>
                              <span style={{ color: 'var(--ink-2)', display: 'block' }}>{t('Дата')}</span>
                              <span style={{ fontWeight: '700' }}>{new Date(order.createdAt.replace(' ', 'T') + 'Z').toLocaleDateString(locale())}</span>
                            </div>
                            <div>
                              <span style={{ color: 'var(--ink-2)', display: 'block' }}>{t('Сумма')}</span>
                              <span style={{ fontWeight: '700' }}>{money(order.total)}</span>
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: currentStatus.bg, color: currentStatus.color, padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: '700' }}>
                            {currentStatus.icon} {currentStatus.text}
                          </div>
                        </div>
                        <div style={{ padding: '14px 20px', display: 'grid', gap: '8px', borderBottom: '1px solid var(--line)' }}>
                          <div style={detailRow}>
                            {order.deliveryMethod === 'pickup' ? <Store size={15} style={{ flex: 'none', marginTop: 2 }} /> : <Truck size={15} style={{ flex: 'none', marginTop: 2 }} />}
                            <span>
                              <b style={{ color: 'var(--ink)' }}>{order.deliveryMethod === 'pickup' ? t('Самовывоз') : t('Доставка')}</b>
                              {order.deliveryMethod === 'pickup'
                                ? <>: {order.pickupPoint ? `${order.pickupPoint.name}, ${order.pickupPoint.city}, ${order.pickupPoint.address}` : [order.city, order.address].filter(Boolean).join(', ')}</>
                                : <>: {[order.city, order.address].filter(Boolean).join(', ')}</>}
                            </span>
                          </div>
                          {order.phone && (
                            <div style={detailRow}><Phone size={15} style={{ flex: 'none', marginTop: 2 }} /><span>{order.recipient ? `${order.recipient}, ` : ''}{order.phone}</span></div>
                          )}
                          <div style={detailRow}>
                            <CreditCard size={15} style={{ flex: 'none', marginTop: 2 }} />
                            <span>
                              {PAY_METHODS[order.paymentMethod] || order.paymentMethod}
                              {' · '}<b style={{ color: getPayment(order).color }}>{getPayment(order).text}</b>
                            </span>
                          </div>
                          {(order.discount > 0 || order.promoCode) && (
                            <div style={detailRow}>
                              <Tag size={15} style={{ flex: 'none', marginTop: 2 }} />
                              <span>
                                {t('Скидка')}{order.discount > 0 ? `: −${money(order.discount)}` : ''}
                                {order.promoCode ? ` (${t('промокод')} ${order.promoCode})` : ''}
                              </span>
                            </div>
                          )}
                          <div style={detailRow}>
                            <Truck size={15} style={{ flex: 'none', marginTop: 2, visibility: 'hidden' }} />
                            <span>{t('Доставка')}: {order.deliveryFee > 0 ? money(order.deliveryFee) : t('бесплатно')}</span>
                          </div>
                        </div>
                        <div style={{ padding: '0 20px' }}>
                          {order.items.map((item, idx) => (
                            <div key={idx} onClick={() => onProductClick && onProductClick(item)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '14px 0', cursor: 'pointer' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0, flexWrap: 'wrap' }}>
                                <img src={imgUrl(item.image)} alt="" style={{ width: '48px', height: '48px', objectFit: 'contain', border: '1px solid var(--line)', borderRadius: '6px' }} />
                                <div style={{ minWidth: 0 }}>
                                  <h4 style={{ margin: 0, fontSize: '13px', fontWeight: '600' }}>{item.title}</h4>
                                  <span style={{ fontSize: '12px', color: 'var(--ink-3)' }}>{t('{n} шт.', { n: item.qty })} × {money(item.price)}</span>
                                </div>
                                {order.status === 'delivered' && item.productId && !item.reviewed && (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); navigate(`/product/${item.productId}?section=reviews`); }}
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--brand-tint)', color: 'var(--brand)', border: 'none', padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                                  >
                                    <Star size={13} /> {t('Оставить отзыв')}
                                  </button>
                                )}
                              </div>
                              <ChevronRight size={16} color="var(--ink-3)" style={{ flex: 'none' }} />
                            </div>
                          ))}
                        </div>
                        {order.paymentStatus === 'refund_pending' && (
                          <div role="status" style={{ margin: '0 20px 16px', padding: '10px 14px', borderRadius: 10, background: 'var(--warn-tint)', color: 'var(--warn-ink)', fontSize: 13, fontWeight: 600 }}>
                            {t('Возврат средств в обработке')}
                          </div>
                        )}
                        {(() => {
                          // у заказа может быть несколько продавцов — по кнопке на каждого
                          const sellers = [...new Map(order.items.filter((i) => i.sellerId).map((i) => [i.sellerId, i])).values()];
                          return sellers.length > 0 && (
                            <div style={{ padding: '0 20px 14px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                              {sellers.map((i) => (
                                <button
                                  key={i.sellerId}
                                  type="button"
                                  onClick={() => setComposeFor({ orderId: order.id, sellerId: i.sellerId, title: `${t('Заказ')} ${order.code}${sellers.length > 1 ? ` · ${i.title}` : ''}` })}
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: '1px solid var(--line-2)', color: 'var(--ink)', padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                                >
                                  <MessageSquare size={14} aria-hidden="true" /> {sellers.length > 1 ? `${t('Написать продавцу')}: ${i.title.slice(0, 24)}` : t('Написать продавцу')}
                                </button>
                              ))}
                            </div>
                          );
                        })()}
                        {((order.paymentStatus === 'pending' && order.status !== 'cancelled') || (order.status === 'pending' && onCancelOrder)) && (
                          <div style={{ padding: '0 20px 16px', display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 }}>
                            {order.paymentStatus === 'pending' && order.status !== 'cancelled' && (
                              <button
                                type="button"
                                onClick={() => navigate('/pay/' + order.id)}
                                style={{ background: 'var(--brand)', color: 'var(--on-brand)', border: 'none', padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                              >
                                {t('Оплатить')}
                              </button>
                            )}
                            {order.status === 'pending' && onCancelOrder && (
                              <button
                                type="button"
                                onClick={() => { if (window.confirm(t('Отменить заказ {code}?', { code: order.code }))) onCancelOrder(order.id); }}
                                style={{ background: 'none', border: '1px solid var(--danger-line)', color: 'var(--danger)', padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                              >
                                {t('Отменить заказ')}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* В К Л А Д К А : П Р О Ф И Л Ь (МОИ ДАННЫЕ С КАРТИНКИ) */}
          {leftMenuTab === 'Профиль' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
              <h2 style={{ fontSize: '22px', fontWeight: '700', color: 'var(--ink)', margin: 0 }}>{t('Мои данные')}</h2>
              
              {/* Сетка полей ввода (Uzum Style) */}
              <div className="ztx-profile-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px 16px' }}>
                
                {/* Фамилия */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--ink-2)', fontWeight: '500' }}>{t('Фамилия')} <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input 
                    type="text" 
                    value={profile.lastName}
                    onChange={(e) => handleProfileChange('lastName', e.target.value)}
                    style={{ padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--line-2)', fontSize: '15px', outline: 'none', backgroundColor: 'var(--surface)' }}
                  />
                </div>

                {/* Имя */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--ink-2)', fontWeight: '500' }}>{t('Имя')} <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input 
                    type="text" 
                    value={profile.firstName}
                    onChange={(e) => handleProfileChange('firstName', e.target.value)}
                    style={{ padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--line-2)', fontSize: '15px', outline: 'none' }}
                  />
                </div>

                {/* Отчество */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--ink-2)', fontWeight: '500' }}>{t('Отчество')}</label>
                  <input 
                    type="text" 
                    value={profile.middleName}
                    placeholder={t('Не указано')}
                    onChange={(e) => handleProfileChange('middleName', e.target.value)}
                    style={{ padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--line-2)', fontSize: '15px', outline: 'none' }}
                  />
                </div>

                {/* Дата рождения */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--ink-2)', fontWeight: '500' }}>{t('Дата рождения')}</label>
                  <input 
                    type="date" 
                    value={profile.birthDate}
                    onChange={(e) => handleProfileChange('birthDate', e.target.value)}
                    style={{ padding: '11px 14px', borderRadius: '10px', border: '1px solid var(--line-2)', fontSize: '15px', outline: 'none', color: 'var(--ink)' }}
                  />
                </div>

                {/* Пол */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--ink-2)', fontWeight: '500' }}>{t('Пол')}</label>
                  <div style={{ display: 'flex', backgroundColor: 'var(--soft)', padding: '3px', borderRadius: '10px', height: '100%', alignItems: 'center' }}>
                    <button 
                      onClick={() => handleProfileChange('gender', 'Мужской')}
                      style={{ flex: 1, padding: '8px 0', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '500', cursor: 'pointer', transition: 'all 0.1s',
                        backgroundColor: profile.gender === 'Мужской' ? 'var(--surface)' : 'transparent',
                        boxShadow: profile.gender === 'Мужской' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
                        color: profile.gender === 'Мужской' ? 'var(--ink)' : 'var(--ink-2)'
                      }}
                    >
                      {t('Мужской')}
                    </button>
                    <button 
                      onClick={() => handleProfileChange('gender', 'Женский')}
                      style={{ flex: 1, padding: '8px 0', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '500', cursor: 'pointer', transition: 'all 0.1s',
                        backgroundColor: profile.gender === 'Женский' ? 'var(--surface)' : 'transparent',
                        boxShadow: profile.gender === 'Женский' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
                        color: profile.gender === 'Женский' ? 'var(--ink)' : 'var(--ink-2)'
                      }}
                    >
                      {t('Женский')}
                    </button>
                  </div>
                </div>

                <div /> {/* Пустая ячейка для выравнивания строки */}

                {/* Электронная почта */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', gridColumn: 'span 2' }}>
                  <label style={{ fontSize: '13px', color: 'var(--ink-2)', fontWeight: '500' }}>{t('Электронная почта')} <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input 
                    type="email" 
                    value={profile.email}
                    placeholder={t('Например: info@zetex.uz')}
                    readOnly
                    style={{ padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--line-2)', fontSize: '15px', outline: 'none' }}
                  />
                </div>

                {/* Номер телефона */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--ink-2)', fontWeight: '500' }}>{t('Номер телефона')} <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <span style={{ position: 'absolute', left: '14px', fontSize: '15px' }}>🇺🇿</span>
                    <input 
                      type="text" 
                      value={profile.phone}
                      onChange={(e) => handleProfileChange('phone', e.target.value)}
                      style={{ padding: '12px 14px 12px 42px', borderRadius: '10px', border: '1px solid var(--line-2)', fontSize: '15px', outline: 'none', width: '100%' }}
                    />
                  </div>
                </div>

              </div>

              <TelegramCard user={user} onUserChanged={onUserChanged} />
              <AccountCard user={user} />

              {/* Кнопка Выйти из системы */}
              <button 
                onClick={() => {
                  if (onLogout) onLogout();
                  else alert(t('Вы вышли из аккаунта'));
                }}
                style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'none', border: 'none', color: 'var(--ink)', fontSize: '15px', fontWeight: '600', cursor: 'pointer', width: 'fit-content', marginTop: '16px', padding: '8px 0' }}
              >
                <LogOut size={18} /> {t('Выйти из системы')}
              </button>
            </div>
          )}

          {/* В К Л А Д К А : О T З Ы В Ы */}
          {leftMenuTab === 'Отзывы' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', textAlign: 'center', padding: '40px 20px' }}>
              <div style={{ fontSize: '40px' }}>💬</div>
              <h3 style={{ fontSize: '20px', fontWeight: '700', color: 'var(--ink)', margin: 0 }}>{t('У вас пока нет отзывов')}</h3>
              <p style={{ color: 'var(--ink-2)', fontSize: '14px', margin: 0 }}>{t('Поделитесь мнением о купленных товарах, чтобы помочь другим покупателям сделать правильный выбор.')}</p>
            </div>
          )}

          {/* В К Л А Д К А : П Р О М О К О Д Ы */}
          {leftMenuTab === 'Промокоды' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <h2 style={{ fontSize: '22px', fontWeight: '700', color: 'var(--ink)', margin: 0 }}>{t('Социальные промокоды')}</h2>
              <p style={{ color: 'var(--ink-2)', fontSize: '14px', margin: 0 }}>{t('Введите секретный промокод от Zetex Market, чтобы получить моментальные купоны или повышенный кешбэк.')}</p>
              
              <div style={{ display: 'flex', gap: '12px', maxWidth: '460px' }}>
                <input 
                  type="text" 
                  placeholder={t('Введите промокод')} 
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value)}
                  style={{ flexGrow: 1, minWidth: 0, padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--line-2)', fontSize: '15px', outline: 'none' }}
                />
                <button 
                  onClick={() => {
                    toast(t('Промокоды пока недоступны — скоро появятся'), 'info');
                    setPromoCode('');
                  }}
                  style={{ flexShrink: 0, backgroundColor: 'var(--brand)', color: 'var(--on-brand)', border: 'none', padding: '12px 20px', borderRadius: '10px', fontWeight: '600', cursor: 'pointer' }}
                >
                  {t('Применить')}
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
      <ComposeDialog open={!!composeFor} onClose={() => setComposeFor(null)} title={composeFor?.title} target={composeFor ? { orderId: composeFor.orderId, sellerId: composeFor.sellerId } : {}} />
    </div>
  );
}