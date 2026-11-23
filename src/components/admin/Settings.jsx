import { useState } from 'react';
import { Plus, Trash2, Save, ShieldCheck } from 'lucide-react';
import { api } from '../../api';
import { useQuery } from '../../useQuery';
import { useToast } from '../useToast';
import { t } from '../../i18n';
import { Skeleton, ErrorBox, Field, ListState, Badge } from './common';
import { useAct, dt } from './shared';

const MODES = { off: 'Публиковать сразу', new_sellers: 'Проверять товары новых (не проверенных) продавцов', all: 'Проверять все новые товары' };
const SCOPES = { full: 'Полный доступ', moderator: 'Модератор (пользователи, товары, жалобы, чаты)', finance: 'Финансист (заказы, выплаты, выгрузки)' };

export function SiteSettings() {
  const q = useQuery('settings', () => api.admin.settings());
  if (!q.data) return q.loading ? <Skeleton rows={5} /> : <ErrorBox message={q.error} onRetry={q.retry} />;
  return <SettingsForm key={JSON.stringify(q.data)} data={q.data} reload={q.retry} />;
}

function SettingsForm({ data, reload }) {
  const { toast } = useToast();
  const [d, setD] = useState(() => JSON.parse(JSON.stringify(data)));
  const [busy, setBusy] = useState(false);
  const up = (k, v) => setD((s) => ({ ...s, [k]: v }));
  const nest = (k, f, v) => setD((s) => ({ ...s, [k]: { ...s[k], [f]: v } }));
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      await api.admin.saveSettings({
        moderation: d.moderation, commissionDefault: Number(d.commissionDefault),
        commissionCategories: Object.fromEntries(Object.entries(d.commissionCategories).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, Number(v)])),
        deliveryFee: Number(d.deliveryFee), freeDeliveryFrom: Number(d.freeDeliveryFrom), suspiciousTotal: Number(d.suspiciousTotal),
        pickupPoints: d.pickupPoints, company: d.company, announcement: d.announcement, home: d.home,
      });
      toast(t('Настройки сохранены')); reload();
    } catch (ex) { toast(ex.message, 'error'); } finally { setBusy(false); }
  };
  const setBanner = (i, k, v) => nest('home', 'banners', d.home.banners.map((b, j) => (j === i ? { ...b, [k]: v } : b)));
  const setPoint = (i, k, v) => up('pickupPoints', d.pickupPoints.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  return (
    <form className="ztx-admin-stack" onSubmit={save}>
      <section className="ztx-admin-card ztx-admin-form">
        <div className="ztx-admin-card-head"><h3>{t('Объявление над шапкой сайта')}</h3></div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" className="ztx-admin-check" checked={!!d.announcement.active} onChange={(e) => nest('announcement', 'active', e.target.checked)} /> {t('Показывать')}</label>
        <div className="ztx-admin-formgrid">
          <Field label={t('Текст (до 200 символов)')}><input className="ztx-admin-input" maxLength={200} value={d.announcement.text} onChange={(e) => nest('announcement', 'text', e.target.value)} /></Field>
          <Field label={t('Ссылка (/catalog или https://…)')}><input className="ztx-admin-input" value={d.announcement.link || ''} onChange={(e) => nest('announcement', 'link', e.target.value)} /></Field>
        </div>
      </section>
      <section className="ztx-admin-card ztx-admin-form">
        <div className="ztx-admin-card-head"><h3>{t('Главная страница')}</h3></div>
        <p className="ztx-admin-muted">{t('Пустые поля — стандартные тексты сайта.')}</p>
        <div className="ztx-admin-formgrid">
          <Field label={t('Заголовок (до 80)')}><input className="ztx-admin-input" maxLength={80} value={d.home.title} onChange={(e) => nest('home', 'title', e.target.value)} /></Field>
          <Field label={t('Кнопка (до 30)')}><input className="ztx-admin-input" maxLength={30} value={d.home.button} onChange={(e) => nest('home', 'button', e.target.value)} /></Field>
        </div>
        <Field label={t('Подзаголовок (до 300)')}><textarea className="ztx-admin-input" rows={2} maxLength={300} value={d.home.text} onChange={(e) => nest('home', 'text', e.target.value)} /></Field>
        <h4 style={{ margin: '4px 0 0' }}>{t('Баннеры под витриной (до 5)')}</h4>
        {d.home.banners.map((b, i) => (
          <div key={i} className="ztx-admin-formgrid" style={{ alignItems: 'end' }}>
            <Field label={t('Заголовок')}><input className="ztx-admin-input" maxLength={80} value={b.title} onChange={(e) => setBanner(i, 'title', e.target.value)} /></Field>
            <Field label={t('Текст')}><input className="ztx-admin-input" maxLength={200} value={b.text} onChange={(e) => setBanner(i, 'text', e.target.value)} /></Field>
            <Field label={t('Ссылка')}><input className="ztx-admin-input" placeholder="/catalog" value={b.link} onChange={(e) => setBanner(i, 'link', e.target.value)} /></Field>
            <Field label={t('Цвет')}><select className="ztx-admin-select" value={b.tone} onChange={(e) => setBanner(i, 'tone', e.target.value)}>
              <option value="brand">{t('Синий')}</option><option value="accent">{t('Зелёный')}</option><option value="warn">{t('Жёлтый')}</option></select></Field>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 14 }}><input type="checkbox" className="ztx-admin-check" checked={b.active} onChange={(e) => setBanner(i, 'active', e.target.checked)} /> {t('Показывать')}</label>
            <div style={{ marginBottom: 12 }}><button type="button" className="ztx-admin-btn is-danger" onClick={() => nest('home', 'banners', d.home.banners.filter((_, j) => j !== i))} aria-label={t('Удалить баннер')}><Trash2 size={15} /></button></div>
          </div>
        ))}
        {d.home.banners.length < 5 && <div><button type="button" className="ztx-admin-btn" onClick={() => nest('home', 'banners', [...d.home.banners, { id: `b${Date.now() % 100000}`, active: true, title: '', text: '', link: '', tone: 'brand' }])}><Plus size={15} aria-hidden="true" /> {t('Добавить баннер')}</button></div>}
      </section>
      <section className="ztx-admin-card ztx-admin-form">
        <div className="ztx-admin-card-head"><h3>{t('Модерация новых товаров')}</h3></div>
        <Field label={t('Режим')}><select className="ztx-admin-select" value={d.moderation} onChange={(e) => up('moderation', e.target.value)}>
          {d.moderationModes.map((m) => <option key={m} value={m}>{t(MODES[m])}</option>)}</select></Field>
        <Field label={t('Подозрительный заказ — сумма от, сум')} hint={t('Админам придёт уведомление в Telegram')}><input className="ztx-admin-input" type="number" min="1" value={d.suspiciousTotal} onChange={(e) => up('suspiciousTotal', e.target.value)} /></Field>
      </section>
      <section className="ztx-admin-card ztx-admin-form">
        <div className="ztx-admin-card-head"><h3>{t('Комиссия маркетплейса')}</h3></div>
        <Field label={t('Общая, % (0–50)')}><input className="ztx-admin-input" type="number" min="0" max="50" step="0.5" value={d.commissionDefault} onChange={(e) => up('commissionDefault', e.target.value)} /></Field>
        <p className="ztx-admin-muted">{t('Для отдельных категорий можно задать свой процент; пусто — берётся общая. Меняется только для новых заказов.')}</p>
        <div className="ztx-admin-formgrid">{d.categories.map((c) => (
          <Field key={c} label={t(c)}><input className="ztx-admin-input" type="number" min="0" max="50" step="0.5" placeholder={String(d.commissionDefault)} value={d.commissionCategories[c] ?? ''}
            onChange={(e) => up('commissionCategories', { ...d.commissionCategories, [c]: e.target.value })} /></Field>))}</div>
      </section>
      <section className="ztx-admin-card ztx-admin-form">
        <div className="ztx-admin-card-head"><h3>{t('Доставка')}</h3></div>
        <div className="ztx-admin-formgrid">
          <Field label={t('Стоимость доставки, сум')}><input className="ztx-admin-input" type="number" min="0" value={d.deliveryFee} onChange={(e) => up('deliveryFee', e.target.value)} /></Field>
          <Field label={t('Бесплатно от суммы, сум')}><input className="ztx-admin-input" type="number" min="0" value={d.freeDeliveryFrom} onChange={(e) => up('freeDeliveryFrom', e.target.value)} /></Field>
        </div>
        <h4 style={{ margin: '8px 0 0' }}>{t('Пункты выдачи')}</h4>
        {d.pickupPoints.map((p, i) => (
          <div key={i} className="ztx-admin-formgrid" style={{ alignItems: 'end' }}>
            <Field label="ID"><input className="ztx-admin-input" value={p.id} onChange={(e) => setPoint(i, 'id', e.target.value)} /></Field>
            <Field label={t('Город')}><select className="ztx-admin-select" value={p.city} onChange={(e) => setPoint(i, 'city', e.target.value)}>{d.cities.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label={t('Название')}><input className="ztx-admin-input" value={p.name} onChange={(e) => setPoint(i, 'name', e.target.value)} /></Field>
            <Field label={t('Адрес')}><input className="ztx-admin-input" value={p.address} onChange={(e) => setPoint(i, 'address', e.target.value)} /></Field>
            <div style={{ marginBottom: 12 }}><button type="button" className="ztx-admin-btn is-danger" onClick={() => up('pickupPoints', d.pickupPoints.filter((_, j) => j !== i))} aria-label={t('Удалить пункт')}><Trash2 size={15} /></button></div>
          </div>
        ))}
        <div><button type="button" className="ztx-admin-btn" onClick={() => up('pickupPoints', [...d.pickupPoints, { id: `pp${d.pickupPoints.length + 1}`, city: d.cities[0], name: '', address: '' }])}><Plus size={15} aria-hidden="true" /> {t('Добавить пункт')}</button></div>
      </section>
      <section className="ztx-admin-card ztx-admin-form">
        <div className="ztx-admin-card-head"><h3>{t('Контакты и реквизиты (футер, страницы «Контакты» и «Условия»)')}</h3></div>
        <div className="ztx-admin-formgrid">{[['name', 'Название компании'], ['inn', 'ИНН'], ['address', 'Адрес'], ['phone', 'Телефон'], ['email', 'Почта поддержки'], ['hours', 'Часы работы'], ['telegram', 'Telegram'], ['instagram', 'Instagram'], ['youtube', 'YouTube']].map(([k, l]) => (
          <Field key={k} label={t(l)}><input className="ztx-admin-input" value={d.company[k] || ''} onChange={(e) => nest('company', k, e.target.value)} /></Field>))}</div>
      </section>
      <div><button type="submit" className="ztx-admin-btn is-primary" disabled={busy}><Save size={15} aria-hidden="true" /> {t('Сохранить настройки')}</button></div>
    </form>
  );
}

export function Team({ me }) {
  const q = useQuery('team', () => api.admin.team());
  const act = useAct();
  const [form, setForm] = useState({ email: '', password: '', firstName: '', lastName: '', scope: 'moderator' });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));
  const add = async (e) => {
    e.preventDefault(); setErr('');
    try { await api.admin.createStaff(form); setForm({ email: '', password: '', firstName: '', lastName: '', scope: 'moderator' }); q.retry(); } catch (ex) { setErr(ex.message); }
  };
  return (
    <div className="ztx-admin-stack">
      <form className="ztx-admin-card ztx-admin-form" onSubmit={add}>
        <div className="ztx-admin-card-head"><h3>{t('Новый сотрудник')}</h3></div>
        <div className="ztx-admin-formgrid">
          <Field label={t('Имя')}><input className="ztx-admin-input" required value={form.firstName} onChange={set('firstName')} /></Field>
          <Field label={t('Фамилия')}><input className="ztx-admin-input" value={form.lastName} onChange={set('lastName')} /></Field>
          <Field label={t('Почта')}><input className="ztx-admin-input" type="email" required value={form.email} onChange={set('email')} autoComplete="off" /></Field>
          <Field label={t('Пароль (10+ символов, A-a-1)')}><input className="ztx-admin-input" type="password" required value={form.password} onChange={set('password')} autoComplete="new-password" /></Field>
          <Field label={t('Роль')}><select className="ztx-admin-select" value={form.scope} onChange={set('scope')}>{Object.entries(SCOPES).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</select></Field>
        </div>
        {err && <p className="ztx-admin-formerr" role="alert">{err}</p>}
        <div><button type="submit" className="ztx-admin-btn is-primary"><Plus size={15} aria-hidden="true" /> {t('Создать')}</button></div>
      </form>
      <ListState query={{ ...q, data: q.data && { ...q.data, total: q.data.items.length, page: 1, pages: 1 } }} empty={t('Сотрудников нет')} onPage={() => {}}>
        {(items) => (
          <div className="ztx-admin-scroll"><table className="ztx-admin-table">
            <thead><tr><th>{t('Сотрудник')}</th><th>{t('Роль')}</th><th>2FA</th><th>{t('Создан')}</th><th><span className="ztx-admin-sr">{t('Действия')}</span></th></tr></thead>
            <tbody>{items.map((u) => (
              <tr key={u.id}>
                <td data-label={t('Сотрудник')}><div className="ztx-admin-main">{[u.firstName, u.lastName].filter(Boolean).join(' ')}</div><div className="ztx-admin-muted">{u.email}</div></td>
                <td data-label={t('Роль')}>{u.id === me?.id ? t(SCOPES[u.scope]) : (
                  <select className="ztx-admin-select" value={u.scope} aria-label={t('Роль')} onChange={(e) => act(() => api.admin.patchStaff(u.id, { scope: e.target.value }), 'Роль изменена', q.retry)}>
                    {Object.entries(SCOPES).map(([k, v]) => <option key={k} value={k}>{t(v.split(' (')[0])}</option>)}</select>)}</td>
                <td data-label="2FA">{u.totpEnabled ? <Badge tone="ok">{t('включена')}</Badge> : <Badge tone="warn">{t('нет')}</Badge>}</td>
                <td data-label={t('Создан')}>{dt(u.createdAt).slice(0, 10)}</td>
                <td className="ztx-admin-actions">{u.id === me?.id ? <span className="ztx-admin-muted">{t('Это вы')}</span> : (
                  <button type="button" className={`ztx-admin-btn ${u.blocked ? '' : 'is-danger'}`} onClick={() => act(() => api.admin.patchStaff(u.id, { blocked: !u.blocked }), u.blocked ? 'Доступ возвращён' : 'Доступ закрыт', q.retry)}>{u.blocked ? t('Вернуть доступ') : t('Закрыть доступ')}</button>)}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </ListState>
    </div>
  );
}

/** Двухфакторная защита текущего администратора. */
export function Security({ me, onChanged }) {
  const { toast } = useToast();
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [off, setOff] = useState(false);
  const [err, setErr] = useState('');
  const run = async (fn, ok) => { setErr(''); try { await fn(); toast(t(ok)); await onChanged?.(); } catch (e) { setErr(e.message); } };
  return (
    <section className="ztx-admin-card ztx-admin-form" style={{ maxWidth: 560 }}>
      <div className="ztx-admin-card-head"><h3><ShieldCheck size={17} aria-hidden="true" style={{ verticalAlign: '-3px' }} /> {t('Двухфакторная защита')}</h3>
        {me?.totpEnabled ? <Badge tone="ok">{t('включена')}</Badge> : <Badge tone="warn">{t('выключена')}</Badge>}</div>
      <p className="ztx-admin-muted">{t('При входе, кроме пароля, нужен 6-значный код из приложения (Google Authenticator, Microsoft Authenticator, Authy). Рекомендуем включить: администратор — самый ценный аккаунт на сайте.')}</p>
      {!me?.totpEnabled && !setup && <div><button type="button" className="ztx-admin-btn is-primary" onClick={() => run(async () => setSetup(await api.twoFaSetup()), 'Отсканируйте код в приложении')}>{t('Включить 2FA')}</button></div>}
      {!me?.totpEnabled && setup && (
        <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api.twoFaEnable(code); setSetup(null); setCode(''); }, 'Двухфакторная защита включена'); }}>
          <img className="ztx-admin-qr" src={setup.qr} alt={t('QR-код для приложения-аутентификатора')} />
          <p className="ztx-admin-muted">{t('Или введите ключ вручную')}: <span className="ztx-admin-mono">{setup.secret}</span></p>
          <Field label={t('Код из приложения')}><input className="ztx-admin-input" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" /></Field>
          <button type="submit" className="ztx-admin-btn is-primary">{t('Подтвердить и включить')}</button>
        </form>
      )}
      {me?.totpEnabled && !off && <div><button type="button" className="ztx-admin-btn is-danger" onClick={() => setOff(true)}>{t('Выключить 2FA')}</button></div>}
      {me?.totpEnabled && off && (
        <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api.twoFaDisable(password, code); setOff(false); setPassword(''); setCode(''); }, 'Двухфакторная защита выключена'); }}>
          <Field label={t('Пароль')}><input className="ztx-admin-input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
          <Field label={t('Код из приложения')}><input className="ztx-admin-input" inputMode="numeric" maxLength={7} required value={code} onChange={(e) => setCode(e.target.value)} /></Field>
          <div className="ztx-admin-actions" style={{ justifyContent: 'flex-start' }}>
            <button type="submit" className="ztx-admin-btn is-danger-solid">{t('Выключить')}</button>
            <button type="button" className="ztx-admin-btn" onClick={() => setOff(false)}>{t('Отмена')}</button>
          </div>
        </form>
      )}
      {err && <p className="ztx-admin-formerr" role="alert">{err}</p>}
    </section>
  );
}
