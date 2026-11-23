import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Send, MessageCircle, ShieldAlert, Package, Receipt } from 'lucide-react';
import { api, imgUrl, hideBrokenImg } from '../api';
import { navigate } from '../router';
import { t, locale } from '../i18n';
import { useToast } from '../components/useToast';
import '../components/chat.css';

// SQLite хранит время в UTC без часового пояса
const toDate = (s) => new Date(`${s.replace(' ', 'T')}Z`);
const sameDay = (a, b) => a.toDateString() === b.toDateString();
const shortTime = (s) => {
  const d = toDate(s);
  return sameDay(d, new Date())
    ? d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
};

function Thread({ id, onChanged }) {
  const { toast } = useToast();
  const [conv, setConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const lastId = useRef(0);
  const box = useRef(null);
  const stick = useRef(true); // прокручивать вниз, пока читатель и так внизу

  const load = useCallback(async (initial) => {
    try {
      const d = await api.chat(id, initial ? 0 : lastId.current);
      setConv(d.conversation);
      setFailed(false);
      if (d.messages.length) {
        lastId.current = d.messages[d.messages.length - 1].id;
        setMessages((prev) => (initial ? d.messages : [...prev, ...d.messages.filter((m) => !prev.some((p) => p.id === m.id))]));
        onChanged?.();
      }
    } catch (e) {
      if (initial) setFailed(true); else if (e.status === 404) setFailed(true);
    }
  }, [id, onChanged]);

  useEffect(() => {
    lastId.current = 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMessages([]); setConv(null); setFailed(false);
    load(true);
    const timer = setInterval(() => { if (!document.hidden) load(false); }, 4000);
    return () => clearInterval(timer);
  }, [id, load]);

  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = async (e) => {
    e?.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      const { message } = await api.sendMessage(id, value);
      setText('');
      stick.current = true;
      lastId.current = Math.max(lastId.current, message.id);
      setMessages((prev) => (prev.some((p) => p.id === message.id) ? prev : [...prev, message]));
      onChanged?.();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (failed) return <div className="ztx-chat-empty"><p>{t('Разговор не найден')}</p></div>;
  if (!conv) return <div className="ztx-chat-empty"><p>{t('Загрузка…')}</p></div>;

  return (
    <div className="ztx-thread">
      <header className="ztx-thread-head">
        <button type="button" className="ztx-thread-back" onClick={() => navigate('/chats')} aria-label={t('К списку разговоров')}><ArrowLeft size={20} /></button>
        <div className="ztx-thread-who">
          <strong>{conv.with.name}</strong>
          <span>{conv.with.role === 'seller' ? t('Продавец') : t('Покупатель')}</span>
        </div>
        {conv.product && (
          <a className="ztx-thread-ctx" href={`/product/${conv.product.id}`}>
            <img src={imgUrl(conv.product.image)} alt="" onError={hideBrokenImg} />
            <span>{conv.product.title}</span>
          </a>
        )}
        {conv.order && <span className="ztx-thread-ctx plain"><Receipt size={15} aria-hidden="true" />{t('Заказ')} {conv.order.code}</span>}
      </header>

      <div
        className="ztx-thread-body" ref={box} aria-live="polite"
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
      >
        <p className="ztx-chat-warn"><ShieldAlert size={15} aria-hidden="true" />{t('Не сообщайте данные банковской карты и не переводите деньги вне Zetex: оплата — только на странице оформления заказа.')}</p>
        {messages.map((m, idx) => {
          const d = toDate(m.at);
          const newDay = idx === 0 || !sameDay(toDate(messages[idx - 1].at), d);
          return (
            <div key={m.id}>
              {newDay && <div className="ztx-msg-day">{d.toLocaleDateString(locale(), { day: 'numeric', month: 'long' })}</div>}
              <div className={`ztx-msg ${m.mine ? 'mine' : ''}`}>
                <p>{m.text}</p>
                <time dateTime={d.toISOString()}>{d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}</time>
              </div>
            </div>
          );
        })}
      </div>

      <form className="ztx-thread-form" onSubmit={send}>
        <textarea
          value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={2000}
          placeholder={t('Напишите сообщение…')} aria-label={t('Сообщение')}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button type="submit" className="ztx-btn ztx-btn-solid" disabled={busy || !text.trim()} aria-label={t('Отправить')}><Send size={18} /></button>
      </form>
    </div>
  );
}

export default function Chats({ id }) {
  const [items, setItems] = useState(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(() => api.chats().then((d) => {
    setItems(d.items); setFailed(false);
    window.dispatchEvent(new Event('ztx:unread')); // значок в шапке
  }).catch(() => setFailed(true)), []);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => { if (!document.hidden) refresh(); }, 15000);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <div className={`ztx-chats ${id ? 'has-thread' : ''}`}>
      <aside className="ztx-chat-list" aria-label={t('Разговоры')}>
        <h1>{t('Сообщения')}</h1>
        {failed && <p className="ztx-chat-note">{t('Не удалось загрузить. Попробуйте обновить страницу.')}</p>}
        {items && items.length === 0 && (
          <div className="ztx-chat-note">
            <MessageCircle size={28} aria-hidden="true" />
            <p>{t('Пока нет разговоров. Задайте вопрос продавцу на странице товара или в разделе «Мои заказы».')}</p>
          </div>
        )}
        <ul>
          {(items || []).map((c) => (
            <li key={c.id}>
              <a href={`/chats/${c.id}`} className={`ztx-chat-item ${String(c.id) === String(id) ? 'on' : ''}`}>
                <span className="ztx-chat-ava" aria-hidden="true">{c.with.name.slice(0, 1).toUpperCase()}</span>
                <span className="ztx-chat-main">
                  <span className="ztx-chat-top">
                    <strong>{c.with.name}</strong>
                    {c.lastMessage && <time>{shortTime(c.lastMessageAt)}</time>}
                  </span>
                  <span className="ztx-chat-sub">
                    {c.product ? <><Package size={12} aria-hidden="true" />{c.product.title}</> : c.order ? <><Receipt size={12} aria-hidden="true" />{t('Заказ')} {c.order.code}</> : ''}
                  </span>
                  <span className="ztx-chat-last">{c.lastMessage ? `${c.lastMessage.mine ? `${t('Вы')}: ` : ''}${c.lastMessage.text}` : ''}</span>
                </span>
                {c.unread > 0 && <span className="ztx-chat-badge" aria-label={t('Непрочитанных: {n}', { n: c.unread })}>{c.unread}</span>}
              </a>
            </li>
          ))}
        </ul>
      </aside>
      <section className="ztx-chat-pane">
        {id ? <Thread id={id} onChanged={refresh} /> : (
          <div className="ztx-chat-empty"><MessageCircle size={36} aria-hidden="true" /><p>{t('Выберите разговор слева')}</p></div>
        )}
      </section>
    </div>
  );
}
