import { useState } from 'react';
import { BarChart3, Users as UsersIcon, Package, ShoppingBag, Flag, Ticket, Star, Wallet, MessagesSquare, ScrollText, Settings as Cog, UserCog, ShieldCheck } from 'lucide-react';
import { t } from '../../i18n';
import Overview from './Overview';
import Users from './Users';
import Products from './Products';
import Orders from './Orders';
import Finance from './Finance';
import Promos from './Promos';
import Audit from './Audit';
import { Reports, Reviews, Chats } from './Moderation';
import { SiteSettings, Team, Security } from './Settings';
import TelegramCard from '../seller/TelegramCard';
import './admin.css';

// Вкладки и права: full видит всё, moderator — модерацию, finance — деньги (повторяет проверки на сервере).
const TABS = [
  ['overview', 'Обзор', BarChart3, ['full', 'moderator', 'finance']],
  ['users', 'Пользователи', UsersIcon, ['full', 'moderator']],
  ['products', 'Товары', Package, ['full', 'moderator']],
  ['orders', 'Заказы', ShoppingBag, ['full', 'finance']],
  ['finance', 'Выплаты', Wallet, ['full', 'finance']],
  ['reports', 'Жалобы', Flag, ['full', 'moderator']],
  ['reviews', 'Отзывы', Star, ['full', 'moderator']],
  ['chats', 'Чаты', MessagesSquare, ['full', 'moderator']],
  ['promos', 'Промокоды', Ticket, ['full']],
  ['team', 'Команда', UserCog, ['full']],
  ['audit', 'Журнал', ScrollText, ['full']],
  ['settings', 'Настройки', Cog, ['full']],
  ['security', 'Безопасность', ShieldCheck, ['full', 'moderator', 'finance']],
];
const SCOPE_NAME = { full: 'полный доступ', moderator: 'модератор', finance: 'финансист' };

export default function AdminDashboard({ user, onUserChanged }) {
  const scope = user?.adminScope || 'full';
  const tabs = TABS.filter((x) => x[3].includes(scope));
  const [tab, setTab] = useState('overview');
  const [preset, setPreset] = useState({}); // фильтры, с которыми открыта вкладка (по клику на карточку обзора)
  const go = (k, filters = {}) => { setPreset(filters); setTab(k); };
  const onKey = (e) => {
    const i = tabs.findIndex(([k]) => k === tab);
    const n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
    if (n == null) return;
    e.preventDefault();
    const k = tabs[(n + tabs.length) % tabs.length][0];
    go(k);
    document.getElementById(`ztx-admin-tab-${k}`)?.focus();
  };
  return (
    <main className="ztx-admin">
      <header className="ztx-admin-head">
        <h1>{t('Администрирование')}</h1>
        {user?.email && <p className="ztx-admin-muted">{user.email} · {t(SCOPE_NAME[scope])}{user.totpEnabled ? '' : ` · ${t('2FA выключена')}`}</p>}
      </header>
      <div className="ztx-admin-tabs" role="tablist" aria-label={t('Разделы администрирования')} onKeyDown={onKey}>
        {tabs.map(([k, label, Icon]) => (
          <button key={k} id={`ztx-admin-tab-${k}`} type="button" role="tab" aria-selected={tab === k} aria-controls="ztx-admin-panel"
            tabIndex={tab === k ? 0 : -1} className="ztx-admin-tab" onClick={() => go(k)}>
            <Icon size={16} aria-hidden="true" /> {t(label)}
          </button>
        ))}
      </div>
      <div id="ztx-admin-panel" role="tabpanel" aria-labelledby={`ztx-admin-tab-${tab}`}>
        {tab === 'overview' && <Overview go={go} />}
        {tab === 'users' && <Users me={user} />}
        {tab === 'products' && <Products key={JSON.stringify(preset)} initial={preset} />}
        {tab === 'orders' && <Orders key={JSON.stringify(preset)} initial={preset} />}
        {tab === 'finance' && <Finance />}
        {tab === 'reports' && <Reports />}
        {tab === 'reviews' && <Reviews />}
        {tab === 'chats' && <Chats />}
        {tab === 'promos' && <Promos />}
        {tab === 'team' && <Team me={user} />}
        {tab === 'audit' && <Audit />}
        {tab === 'settings' && <SiteSettings />}
        {tab === 'security' && (
          <div className="ztx-admin-stack">
            <Security me={user} onChanged={onUserChanged} />
            <div style={{ maxWidth: 560 }}><TelegramCard user={user} onUserChanged={onUserChanged} /></div>
          </div>
        )}
      </div>
    </main>
  );
}
