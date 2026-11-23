import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Send, ShieldAlert } from 'lucide-react';
import { api } from '../api';
import { navigate } from '../router';
import { t } from '../i18n';
import { useToast } from './useToast';
import './chat.css';

/** Окно «Написать продавцу». target: { productId } или { orderId, sellerId? }. После отправки открывает переписку. */
export default function ComposeDialog({ open, onClose, title, target }) {
  const { toast } = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const area = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    area.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const send = async (e) => {
    e.preventDefault();
    if (busy || !text.trim()) return;
    setBusy(true);
    try {
      const { conversationId } = await api.startChat({ ...target, text: text.trim() });
      setText('');
      onClose();
      navigate(`/chats/${conversationId}`);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="ztx-compose-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="ztx-compose" role="dialog" aria-modal="true" aria-labelledby="ztx-compose-h" onSubmit={send}>
        <button type="button" className="ztx-compose-x" onClick={onClose} aria-label={t('Закрыть')}><X size={18} /></button>
        <h2 id="ztx-compose-h">{t('Написать продавцу')}</h2>
        {title && <p className="ztx-compose-ctx">{title}</p>}
        <textarea
          ref={area} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={5}
          placeholder={t('Ваш вопрос продавцу')} aria-label={t('Сообщение')}
        />
        <p className="ztx-chat-warn"><ShieldAlert size={15} aria-hidden="true" />{t('Не сообщайте данные банковской карты и не переводите деньги вне Zetex: оплата — только на странице оформления заказа.')}</p>
        <div className="ztx-compose-foot">
          <span>{text.length}/2000</span>
          <button type="submit" className="ztx-btn ztx-btn-solid" disabled={busy || !text.trim()}><Send size={16} aria-hidden="true" /> {busy ? t('Отправляем…') : t('Отправить')}</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
