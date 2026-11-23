import { useEffect, useState } from 'react';
import { Send, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../useToast';
import { t } from '../../i18n';
import './seller.css';

/** Уведомления в Telegram: продавцу — о новых заказах, покупателю — о статусе заказа. user.telegramLinked — статус привязки. */
export default function TelegramCard({ user, onUserChanged }) {
  const buyer = user?.role === 'buyer';
  const { toast } = useToast();
  const [cfg, setCfg] = useState(null);
  const [cfgFailed, setCfgFailed] = useState(false);
  const [link, setLink] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let off = false;
    api.config().then((c) => { if (!off) setCfg(c); }).catch(() => { if (!off) setCfgFailed(true); });
    return () => { off = true; };
  }, []);

  const linked = !!user?.telegramLinked;

  const refreshUser = async () => {
    try {
      const { user: u } = await api.me();
      onUserChanged?.(u);
      if (u?.telegramLinked) { setLink(null); toast(t('Telegram привязан')); } else toast(t('Пока не видим вашего сообщения боту. Отправьте код и попробуйте ещё раз.'), 'error');
    } catch (e) { toast(e.message, 'error'); }
  };

  const getCode = async () => {
    setBusy(true);
    try { setLink(await api.telegramLinkCode()); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  const unlink = async () => {
    if (!window.confirm(t('Отвязать Telegram? Уведомления в него приходить перестанут.'))) return;
    setBusy(true);
    try {
      await api.telegramUnlink();
      setLink(null);
      toast(t('Telegram отвязан'));
      const { user: u } = await api.me();
      onUserChanged?.(u);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  const enabled = cfg?.telegram?.enabled;

  return (
    <section className="ztx-seller-card" aria-labelledby="tg-h">
      <div className="ztx-seller-card-head">
        <h3 id="tg-h" style={{ margin: 0, fontSize: 18, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 8 }}><Send size={18} aria-hidden="true" /> {t('Уведомления в Telegram')}</h3>
        {enabled && <span className={`ztx-seller-badge ${linked ? 'accent' : ''}`}>{linked ? t('Привязан') : t('Не привязан')}</span>}
      </div>
      <div className="ztx-seller-card-pad ztx-seller-col">
        {!cfg && !cfgFailed && <p className="ztx-seller-note">{t('Загрузка…')}</p>}
        {cfgFailed && <div className="ztx-seller-banner danger" role="alert"><AlertTriangle size={16} aria-hidden="true" />{t('Не удалось загрузить настройки')}</div>}
        {cfg && !enabled && (
          <div className="ztx-seller-banner" role="note">{buyer ? t('Telegram-уведомления сейчас недоступны. Статусы заказов приходят на почту и видны в разделе «Мои заказы».') : t('Telegram-уведомления сейчас недоступны: бот не настроен на сервере. Новые заказы смотрите на вкладке «Заказы».')}</div>
        )}
        {enabled && linked && (
          <>
            <div className="ztx-seller-banner ok"><CheckCircle2 size={16} aria-hidden="true" />{buyer ? t('Мы будем писать в Telegram, когда статус вашего заказа меняется.') : t('Мы пришлём сообщение в Telegram, когда покупатель оформит заказ на ваш товар.')}</div>
            <div><button type="button" className="ztx-seller-btn danger" onClick={unlink} disabled={busy}>{t('Отвязать')}</button></div>
          </>
        )}
        {enabled && !linked && (
          <>
            <p className="ztx-seller-note">{buyer ? t('Узнавайте о подтверждении, отправке и доставке заказа сразу. Письма на почту приходят в любом случае.') : t('Получайте мгновенные сообщения о новых заказах. Привязка занимает полминуты.')}</p>
            {!link ? (
              <div><button type="button" className="ztx-seller-btn primary" onClick={getCode} disabled={busy}>{busy ? t('Готовим…') : t('Привязать')}</button></div>
            ) : (
              <div className="ztx-seller-col">
                <ol className="ztx-seller-steps">
                  <li>
                    {link.url
                      ? <>{t('Откройте бота')}: <a className="ztx-seller-link" href={link.url} target="_blank" rel="noopener noreferrer">@{link.botUsername}</a> {t('и нажмите «Start».')}</>
                      : t('Найдите в Telegram бота и отправьте ему команду /start с кодом ниже.')}
                  </li>
                  <li>{t('Если бот просит код, отправьте:')} <span className="ztx-seller-code" aria-label={t('Код привязки')}>{link.code}</span></li>
                  <li>{t('Вернитесь сюда и нажмите «Проверить».')}</li>
                </ol>
                <div className="ztx-seller-row">
                  <button type="button" className="ztx-seller-btn primary" onClick={refreshUser}>{t('Проверить')}</button>
                  <button type="button" className="ztx-seller-btn" onClick={getCode} disabled={busy}>{t('Новый код')}</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
