import { api } from '../../api';
import { t } from '../../i18n';
import { Toolbar, Select, ListState, CsvLink, ResetFilters } from './common';
import { useList } from './hooks';
import { useFilters, dt } from './shared';

const GROUPS = [['', 'Все действия'], ['user', 'Пользователи'], ['product', 'Товары'], ['order', 'Заказы'], ['payout', 'Выплаты'], ['report', 'Жалобы'], ['review', 'Отзывы'], ['chat', 'Чаты'], ['message', 'Сообщения'], ['settings', 'Настройки'], ['team', 'Команда'], ['promo', 'Промокоды'], ['export', 'Выгрузки']];

export default function Audit() {
  const filters = useFilters({ action: '', from: '', to: '' }, 'audit');
  const { f, set, page, params } = filters;
  const query = useList(api.admin.audit, params);
  return (
    <>
      <Toolbar q={f.q} onQ={(q) => set({ q })} placeholder={t('Поиск по журналу')}>
        <Select value={f.action} onChange={(action) => set({ action })} label={t('Тип действия')} options={GROUPS.map(([v, l]) => [v, t(l)])} />
        <input type="date" className="ztx-admin-input" style={{ width: 'auto' }} value={f.from} onChange={(e) => set({ from: e.target.value })} aria-label={t('С даты')} />
        <input type="date" className="ztx-admin-input" style={{ width: 'auto' }} value={f.to} onChange={(e) => set({ to: e.target.value })} aria-label={t('По дату')} />
        <ResetFilters filters={filters} />
        <CsvLink href={api.admin.exportUrl('audit')} />
      </Toolbar>
      <ListState query={query} empty={t('Записей нет')} onPage={page}>
        {(items) => (
          <div className="ztx-admin-scroll"><table className="ztx-admin-table">
            <thead><tr><th>{t('Когда')}</th><th>{t('Кто')}</th><th>{t('Действие')}</th><th>{t('Объект')}</th><th>{t('Причина / детали')}</th></tr></thead>
            <tbody>{items.map((r) => (
              <tr key={r.id}>
                <td data-label={t('Когда')}>{dt(r.createdAt)}</td>
                <td data-label={t('Кто')}>{r.adminEmail || '—'}</td>
                <td data-label={t('Действие')}><span className="ztx-admin-mono">{r.action}</span></td>
                <td data-label={t('Объект')}>{r.targetType}{r.targetId ? ` #${String(r.targetId).slice(0, 30)}` : ''}</td>
                <td data-label={t('Причина / детали')}><div>{r.reason}</div><div className="ztx-admin-muted" style={{ overflowWrap: 'anywhere' }}>{r.details}</div></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </ListState>
    </>
  );
}
