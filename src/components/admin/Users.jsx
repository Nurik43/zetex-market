import { useState } from 'react';
import { Ban, UserCheck, ShieldCheck, BadgeCheck } from 'lucide-react';
import { api } from '../../api';
import { useQuery } from '../../useQuery';
import { t } from '../../i18n';
import { money, num } from '../../format';
import { ReasonDialog, ConfirmDialog, Toolbar, Select, ListState, Badge, Drawer, Skeleton, ErrorBox, CsvLink, ResetFilters } from './common';
import { useList } from './hooks';
import { ORDER_STATUS, PAY_STATUS } from './consts';
import { useAct, useFilters, stat, dt, personName, ROLES } from './shared';

function UserDrawer({ id, me, onClose, onChanged }) {
  const q = useQuery(`u${id}`, () => api.admin.user(id));
  const act = useAct();
  const [ask, setAsk] = useState(null);
  const body = () => {
    if (!q.data) return q.loading ? <Skeleton rows={4} /> : <ErrorBox message={q.error} onRetry={q.retry} />;
    const { user: u, orders, products, balance, logins, history } = q.data;
    const protectedUser = u.role === 'admin' || u.id === me?.id;
    return (
      <>
        <dl className="ztx-admin-kv">
          <dt>{t('Почта')}</dt><dd>{u.email} {u.emailVerified ? <Badge tone="ok">{t('подтверждена')}</Badge> : <Badge tone="warn">{t('не подтверждена')}</Badge>}</dd>
          <dt>{t('Роль')}</dt><dd>{t(ROLES[u.role])}{u.adminScope ? ` · ${u.adminScope}` : ''}</dd>
          <dt>{t('Имя')}</dt><dd>{[u.lastName, u.firstName, u.middleName].filter(Boolean).join(' ') || '—'}</dd>
          <dt>{t('Телефон')}</dt><dd>{u.phone || '—'}</dd>
          {u.companyName && <><dt>{t('Компания')}</dt><dd>{u.companyName}{u.inn ? ` · ИНН ${u.inn}` : ''}</dd></>}
          <dt>{t('Регистрация')}</dt><dd>{dt(u.createdAt)}</dd>
          <dt>Telegram</dt><dd>{u.telegramLinked ? t('привязан') : '—'}</dd>
          <dt>{t('Статус')}</dt><dd>{u.deleted ? <Badge tone="neutral">{t('Удалён')}</Badge> : u.blocked ? <><Badge tone="danger">{t('Заблокирован')}</Badge> {u.blockedReason}</> : <Badge tone="ok">{t('Активен')}</Badge>}</dd>
        </dl>
        {!protectedUser && !u.deleted && (
          <div className="ztx-admin-actions" style={{ justifyContent: 'flex-start' }}>
            <button type="button" className={`ztx-admin-btn ${u.blocked ? '' : 'is-danger'}`} onClick={() => setAsk('block')}>
              {u.blocked ? <UserCheck size={15} aria-hidden="true" /> : <Ban size={15} aria-hidden="true" />} {u.blocked ? t('Разблокировать') : t('Заблокировать')}
            </button>
            {u.role === 'seller' && (
              <button type="button" className="ztx-admin-btn" onClick={() => act(() => api.admin.patchUser(u.id, { trusted: !u.trusted }), u.trusted ? 'Отметка снята' : 'Продавец отмечен как проверенный', () => { q.retry(); onChanged(); })}>
                <BadgeCheck size={15} aria-hidden="true" /> {u.trusted ? t('Снять «проверенный»') : t('Сделать проверенным')}
              </button>
            )}
          </div>
        )}
        {balance && (
          <section><h4>{t('Деньги продавца')}</h4>
            <dl className="ztx-admin-kv">
              <dt>{t('Продано')}</dt><dd>{money(balance.gross)}</dd><dt>{t('Комиссия')}</dt><dd>{money(balance.commission)}</dd>
              <dt>{t('Выплачено')}</dt><dd>{money(balance.paid)}</dd><dt>{t('К выплате')}</dt><dd><b>{money(balance.balance)}</b></dd>
            </dl>
          </section>
        )}
        <section><h4>{t('Сводка')}</h4>
          <dl className="ztx-admin-kv">
            <dt>{t('Заказы покупателя')}</dt><dd>{num(u.orders)}</dd>
            {u.role === 'seller' && <><dt>{t('Товаров')}</dt><dd>{num(u.products)}</dd><dt>{t('Продано заказов')}</dt><dd>{num(q.data.soldOrders)}</dd></>}
            <dt>{t('Жалоб на его товары')}</dt><dd>{num(q.data.reportsAgainst)}</dd><dt>{t('Жалоб подал')}</dt><dd>{num(q.data.reportsBy)}</dd>
            <dt>{t('Разговоров в чате')}</dt><dd>{num(q.data.conversations)}</dd><dt>{t('Жалоб на сообщения')}</dt><dd>{num(q.data.messageReportsAgainst)}</dd>
          </dl>
        </section>
        {orders.length > 0 && <section><h4>{t('Последние заказы')}</h4><table className="ztx-admin-mini"><tbody>{orders.map((o) => (
          <tr key={o.id}><td>{o.code}</td><td>{stat(ORDER_STATUS, o.status)}</td><td>{stat(PAY_STATUS, o.paymentStatus)}</td><td className="is-num">{money(o.total)}</td></tr>))}</tbody></table></section>}
        {products.length > 0 && <section><h4>{t('Товары')}</h4><table className="ztx-admin-mini"><tbody>{products.map((p) => (
          <tr key={p.id}><td>{p.title}{p.statusReason ? <div className="ztx-admin-muted">{p.statusReason}</div> : null}</td><td>{p.status}</td><td className="is-num">{money(p.price)}</td></tr>))}</tbody></table></section>}
        {logins.length > 0 && <section><h4>{t('История входов')}</h4><table className="ztx-admin-mini"><tbody>{logins.map((l, i) => (
          <tr key={i}><td>{dt(l.createdAt)}</td><td>{l.ip}</td><td>{l.ok ? t('успешно') : <span style={{ color: 'var(--danger)' }}>{t('неудачно')}</span>}</td></tr>))}</tbody></table></section>}
        {history.length > 0 && <section><h4>{t('Действия администраторов')}</h4><table className="ztx-admin-mini"><tbody>{history.map((h, i) => (
          <tr key={i}><td>{dt(h.createdAt)}</td><td>{h.action}{h.reason ? ` — ${h.reason}` : ''}</td><td>{h.adminEmail}</td></tr>))}</tbody></table></section>}
        {ask === 'block' && (u.blocked ? (
          <ConfirmDialog title={t('Разблокировать пользователя?')} text={u.email} confirmLabel={t('Разблокировать')} danger={false} onCancel={() => setAsk(null)}
            onConfirm={async () => { await act(() => api.admin.blockUser(u.id, false), 'Пользователь разблокирован', () => { q.retry(); onChanged(); }); setAsk(null); }} />
        ) : (
          <ReasonDialog title={t('Заблокировать пользователя?')} text={t('{email} потеряет доступ к аккаунту. Причина придёт ему на почту.', { email: u.email })} confirmLabel={t('Заблокировать')}
            onCancel={() => setAsk(null)}
            onConfirm={async (reason) => { await api.admin.blockUser(u.id, true, reason); setAsk(null); q.retry(); onChanged(); }} />
        ))}
      </>
    );
  };
  return <Drawer title={q.data ? personName(q.data.user) : t('Пользователь')} onClose={onClose}>{body()}</Drawer>;
}

export default function Users({ me }) {
  const filters = useFilters({ role: '', status: '', sort: 'new' }, 'users');
  const { f, set, page, params } = filters;
  const query = useList(api.admin.users, params);
  const [open, setOpen] = useState(null);
  return (
    <>
      <Toolbar q={f.q} onQ={(q) => set({ q })} placeholder={t('Поиск по email, имени, компании')}>
        <Select value={f.role} onChange={(role) => set({ role })} label={t('Роль')} options={[['', t('Все роли')], ...Object.entries(ROLES).map(([k, v]) => [k, t(v)])]} />
        <Select value={f.status} onChange={(status) => set({ status })} label={t('Статус')} options={[['', t('Любой статус')], ['active', t('Активные')], ['blocked', t('Заблокированные')]]} />
        <Select value={f.sort} onChange={(sort) => set({ sort })} label={t('Сортировка')} options={[['new', t('Сначала новые')], ['old', t('Сначала старые')], ['orders', t('По заказам')], ['products', t('По товарам')]]} />
        <ResetFilters filters={filters} />
        <CsvLink href={api.admin.exportUrl('users')} />
      </Toolbar>
      <ListState query={query} empty={t('Пользователи не найдены')} onPage={page}>
        {(items) => (
          <div className="ztx-admin-scroll">
            <table className="ztx-admin-table">
              <thead><tr><th>{t('Пользователь')}</th><th>{t('Роль')}</th><th>{t('Телефон')}</th><th className="is-num">{t('Товаров')}</th><th className="is-num">{t('Заказов')}</th><th>{t('Регистрация')}</th><th>{t('Статус')}</th><th><span className="ztx-admin-sr">{t('Действия')}</span></th></tr></thead>
              <tbody>
                {items.map((u) => {
                  const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.companyName;
                  return (
                    <tr key={u.id}>
                      <td data-label={t('Пользователь')}><button type="button" className="ztx-admin-link" onClick={() => setOpen(u.id)}>{name || u.email}</button>{name && <div className="ztx-admin-muted">{u.email}</div>}</td>
                      <td data-label={t('Роль')}>{t(ROLES[u.role] || u.role)}{u.role === 'admin' && u.adminScope && u.adminScope !== 'full' ? ` · ${u.adminScope}` : ''}{u.trusted ? <> <BadgeCheck size={14} aria-label={t('проверенный')} style={{ verticalAlign: '-2px', color: 'var(--accent)' }} /></> : null}</td>
                      <td data-label={t('Телефон')}>{u.phone || '—'}</td>
                      <td data-label={t('Товаров')} className="is-num">{num(u.products)}</td>
                      <td data-label={t('Заказов')} className="is-num">{num(u.orders)}</td>
                      <td data-label={t('Регистрация')}>{dt(u.createdAt).slice(0, 10)}</td>
                      <td data-label={t('Статус')}>{u.blocked ? <Badge tone="danger">{t('Заблокирован')}</Badge> : <Badge tone="ok">{t('Активен')}</Badge>}</td>
                      <td className="ztx-admin-actions">
                        {u.role === 'admin' || u.id === me?.id
                          ? <span className="ztx-admin-muted"><ShieldCheck size={14} aria-hidden="true" /> {t('Защищён')}</span>
                          : <button type="button" className="ztx-admin-btn" onClick={() => setOpen(u.id)}>{t('Подробнее')}</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </ListState>
      {open && <UserDrawer id={open} me={me} onClose={() => setOpen(null)} onChanged={query.retry} />}
    </>
  );
}
