import { X, Trash2, Plus, Minus, ShoppingBag } from 'lucide-react';
import { t } from '../i18n';
import { money } from '../format';

import { imgUrl } from '../api';

export default function CartModal({ isOpen, onClose, cart, onRemove, onUpdateCount, totalPrice, onCheckout, busy = false }) {
  if (!isOpen) return null;

  return (
    <div style={{ 
      position: 'fixed', 
      top: 0, 
      left: 0, 
      width: '100vw', 
      height: '100vh', 
      backgroundColor: 'rgba(16, 24, 40, 0.45)', 
      zIndex: 3000, 
      display: 'flex', 
      justifyContent: 'flex-end',
      animation: 'fadeIn 0.2s ease-out'
    }}>
      <div onClick={onClose} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: -1 }} />

      <div style={{ 
        width: '420px', 
        maxWidth: '100vw',
        height: '100%', 
        backgroundColor: 'var(--surface)', 
        display: 'flex', 
        flexDirection: 'column', 
        boxShadow: '-8px 0 26px rgba(0,0,0,0.1)',
        animation: 'ztxSlideLeft .3s cubic-bezier(.2,.8,.2,1)',
        position: 'relative'
      }}>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid var(--soft)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 style={{ fontSize: '20px', fontWeight: '800', margin: 0, color: 'var(--ink)' }}>{t('Корзина')}</h2>
            <span style={{ backgroundColor: 'var(--brand-tint)', color: 'var(--brand)', padding: '2px 8px', borderRadius: '12px', fontSize: '13px', fontWeight: '700' }}>
              {cart.reduce((total, item) => total + item.count, 0)}
            </span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink)', padding: '4px', display: 'flex', alignItems: 'center' }}>
            <X size={24} />
          </button>
        </div>

        <div style={{ flexGrow: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {cart.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--ink-3)', marginTop: '120px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
              <div style={{ width: '80px', height: '80px', backgroundColor: 'var(--soft)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ShoppingBag size={36} color="var(--brand)" />
              </div>
              <span style={{ fontWeight: '700', color: 'var(--ink)', fontSize: '16px' }}>{t('Корзина пуста')}</span>
              <span style={{ fontSize: '14px', color: 'var(--ink-2)', maxWidth: '240px' }}>{t('Добавьте товары со страницы каталога, чтобы начать покупки.')}</span>
            </div>
          ) : (
            cart.map((item) => (
              <div key={item.id} style={{ display: 'flex', gap: '16px', borderBottom: '1px solid var(--soft)', paddingBottom: '20px' }}>
                <img src={imgUrl(item.image)} loading="lazy" style={{ width: '80px', height: '100px', objectFit: 'cover', borderRadius: '8px', backgroundColor: 'var(--soft)' }} alt="" />
                
                <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <span style={{ fontSize: '14px', color: 'var(--ink)', fontWeight: '500', lineHeight: '1.4', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {item.title}
                    </span>
                  </div>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--line)', borderRadius: '8px', height: '32px' }}>
                      <button onClick={() => onUpdateCount(item.id, item.count - 1)} style={{ background: 'none', border: 'none', width: '32px', height: '100%', cursor: 'pointer', color: 'var(--ink-2)' }}>
                        <Minus size={14} />
                      </button>
                      <span style={{ fontSize: '14px', minWidth: '24px', textAlign: 'center', fontWeight: '700', color: 'var(--ink)' }}>
                        {item.count}
                      </span>
                      <button onClick={() => onUpdateCount(item.id, item.count + 1)} style={{ background: 'none', border: 'none', width: '32px', height: '100%', cursor: 'pointer', color: 'var(--ink-2)' }}>
                        <Plus size={14} />
                      </button>
                    </div>
                    
                    <button onClick={() => onRemove(item.id)} style={{ background: 'none', border: 'none', color: 'var(--ink-3)', cursor: 'pointer', padding: '6px' }}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                
                <div style={{ fontWeight: '700', fontSize: '15px', color: 'var(--ink)', minWidth: '95px', textAlign: 'right' }}>
                  {money(item.price * item.count)}
                </div>
              </div>
            ))
          )}
        </div>

        {cart.length > 0 && (
          <div style={{ borderTop: '1px solid var(--line)', padding: '20px 24px', backgroundColor: 'var(--surface)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '18px', alignItems: 'flex-end' }}>
              <span style={{ color: 'var(--ink-2)', fontSize: '15px', fontWeight: '500' }}>{t('Итого к оплате:')}</span>
              <span style={{ color: 'var(--brand)', fontWeight: '800', fontSize: '22px' }}>
                {money(totalPrice)}
              </span>
            </div>
            
            {/* Навесили событие onClick={onCheckout} */}
            <button 
              onClick={onCheckout}
              disabled={busy}
              style={{ opacity: busy ? 0.6 : 1, 
                width: '100%', 
                backgroundColor: 'var(--brand)', 
                color: 'var(--on-brand)', 
                border: 'none', 
                padding: '16px', 
                borderRadius: '12px', 
                fontSize: '16px', 
                fontWeight: '700', 
                cursor: busy ? 'wait' : 'pointer',
                boxShadow: '0 4px 12px rgba(31, 79, 224, 0.15)'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--brand-deep)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--brand)'}
            >
              {busy ? 'Оформляем…' : 'Оформить заказ'}
            </button>
          </div>
        )}

      </div>
    </div>
  );
}