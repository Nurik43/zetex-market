import { useState } from 'react';
import { Download, Trash2, AlertTriangle } from 'lucide-react';
import { api } from '../api';
import { t } from '../i18n';
import './seller/seller.css';

/** «Мои данные»: выгрузка всего, что мы храним, и удаление аккаунта (с подтверждением паролем). */
export default function AccountCard({ user }) {
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const seller = user?.role === 'seller';

  const remove = async (e) => {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError('');
    try {
      await api.deleteAccount(password);
      setDone(true);
      setTimeout(() => window.location.assign('/'), 2000); // начинаем с чистого состояния
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <section className="ztx-seller-card" aria-labelledby="acc-h">
      <div className="ztx-seller-card-head">
        <h3 id="acc-h" style={{ margin: 0, fontSize: 18, color: 'var(--ink)' }}>{t('Мои данные и аккаунт')}</h3>
      </div>
      <div className="ztx-seller-card-pad ztx-seller-col">
        <p className="ztx-seller-note">{t('Вы можете скачать всё, что мы о вас храним (профиль, заказы, избранное, отзывы, переписки), одним файлом.')}</p>
        <div>
          <a className="ztx-seller-btn" href={api.exportUrl} download="zetex-my-data.json"><Download size={14} aria-hidden="true" /> {t('Скачать мои данные')}</a>
        </div>

        <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '8px 0', width: '100%' }} />

        {done ? (
          <div className="ztx-seller-banner ok" role="status">{t('Аккаунт удалён. Сейчас вы вернётесь на главную.')}</div>
        ) : !asking ? (
          <div>
            <button type="button" className="ztx-seller-btn danger" onClick={() => setAsking(true)}><Trash2 size={14} aria-hidden="true" /> {t('Удалить аккаунт')}</button>
          </div>
        ) : (
          <form className="ztx-seller-col" onSubmit={remove}>
            <div className="ztx-seller-banner danger" role="note">
              <AlertTriangle size={16} aria-hidden="true" />
              <div>
                <strong>{t('Это действие необратимо.')}</strong>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  <li>{t('Имя, телефон, почта и другие данные профиля будут стёрты, войти в аккаунт станет нельзя.')}</li>
                  <li>{t('Избранное, корзина и вся переписка удалятся.')}</li>
                  <li>{t('В истории заказов останутся только сами заказы — без вашего имени, телефона и адреса.')}</li>
                  {seller && <li>{t('Все ваши товары и промокоды будут удалены.')}</li>}
                  <li>{t('Удалить аккаунт нельзя, пока есть незавершённые заказы.')}</li>
                </ul>
              </div>
            </div>
            <div className="ztx-seller-field">
              <label htmlFor="acc-pw">{t('Введите пароль для подтверждения')}</label>
              <input id="acc-pw" type="password" className="ztx-seller-input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!error} />
              {error && <p className="ztx-seller-err" role="alert">{error}</p>}
            </div>
            <div className="ztx-seller-row">
              <button type="submit" className="ztx-seller-btn danger" disabled={busy || !password}>{busy ? t('Удаляем…') : t('Удалить навсегда')}</button>
              <button type="button" className="ztx-seller-btn" onClick={() => { setAsking(false); setPassword(''); setError(''); }}>{t('Отмена')}</button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
