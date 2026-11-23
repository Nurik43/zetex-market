import { useCallback, useMemo, useRef, useState } from 'react';
import { ToastContext } from './useToast';
import { t } from '../i18n';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

const STYLES = {
  success: { bg: 'var(--accent-tint)', border: 'var(--accent-line)', color: 'var(--accent)', Icon: CheckCircle2 },
  error: { bg: 'var(--danger-tint)', border: 'var(--danger-line)', color: 'var(--danger)', Icon: AlertCircle },
  info: { bg: 'var(--brand-tint)', border: 'var(--line-2)', color: 'var(--brand)', Icon: Info },
};

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => setItems((xs) => xs.filter((x) => x.id !== id)), []);

  const toast = useCallback((message, type = 'success') => {
    const id = nextId.current++;
    setItems((xs) => [...xs.slice(-3), { id, message, type }]);
    setTimeout(() => dismiss(id), type === 'error' ? 6000 : 3500);
  }, [dismiss]);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        style={{ position: 'fixed', top: 20, right: 20, zIndex: 20000, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 'calc(100vw - 40px)' }}
      >
        {items.map(({ id, message, type }) => {
          const { bg, border, color, Icon } = STYLES[type] || STYLES.info;
          return (
            <div key={id} role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: bg, border: `1px solid ${border}`, color, borderRadius: 12, fontSize: 14, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,0.08)', minWidth: 260, animation: 'ztxSlideIn .2s ease-out' }}>
              <Icon size={18} />
              <span style={{ flexGrow: 1 }}>{t(message)}</span>
              <button onClick={() => dismiss(id)} aria-label={t('Закрыть')} style={{ background: 'none', border: 'none', cursor: 'pointer', color, display: 'flex', padding: 0 }}>
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
