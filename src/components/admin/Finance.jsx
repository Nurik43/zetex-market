import { useState } from 'react';
import { Wallet } from 'lucide-react';
import { api } from '../../api';
import { useQuery } from '../../useQuery';
import { t } from '../../i18n';
import { money } from '../../format';
import { ReasonDialog, ListState, Skeleton, ErrorBox, CsvLink, Field } from './common';
import { useList } from './hooks';
import { useFilters, dt } from './shared';

export default function Finance() {
  const sellers = useQuery('fin', () => api.admin.financeSellers());
  const f = useFilters({});
  const payouts = useList(api.admin.payouts, f.params);
  const [pay, setPay] = useState(null);
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState({ from: '', to: '' });
  const reload = () => { sellers.retry(); payouts.retry(); };
  if (!sellers.data) return sellers.loading ? <Skeleton rows={4} /> : <ErrorBox message={sellers.error} onRetry={sellers.retry} />;
  const { items, totals } = sellers.data;
  return (
    <div className="ztx-admin-stack">
      <div className="ztx-admin-stats">
        {[['Продано (доставлено)', totals.gross], ['Комиссия маркетплейса', totals.commission], ['Заработано продавцами', totals.net], ['Уже выплачено', totals.paid], ['К выплате', totals.balance]].map(([l, v]) => (
          <div key={l} className="ztx-admin-stat"><span className="ztx-admin-stat-icon"><Wallet size={18} aria-hidden="true" /></span><div><div className="ztx-admin-stat-val">{money(v)}</div><div className="ztx-admin-stat-label">{t(l)}</div></div></div>
        ))}
      </div>
      <section className="ztx-admin-card ztx-admin-form">
        <div className="ztx-admin-card-head"><h3>{t('Выгрузка за период')}</h3></div>
        <div className="ztx-admin-toolbar" style={{ margin: 0 }}>
          <label className="ztx-admin-field" style={{ margin: 0 }}>{t('С даты')}<input type="date" className="ztx-admin-input" value={period.from} onChange={(e) => setPeriod((p) => ({ ...p, from: e.target.value }))} /></label>
          <label className="ztx-admin-field" style={{ margin: 0 }}>{t('По дату')}<input type="date" className="ztx-admin-input" value={period.to} onChange={(e) => setPeriod((p) => ({ ...p, to: e.target.value }))} /></label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
            <CsvLink href={api.admin.exportUrl('revenue', period)}>{t('Выручка по дням (CSV)')}</CsvLink>
            <CsvLink href={api.admin.exportUrl('finance', period)}>{t('Продавцы за период (CSV)')}</CsvLink>
          </div>
        </div>
        <p className="ztx-admin-muted">{t('Без дат выручка выгружается за последние 30 дней, а продавцы — за всё время. Даты считаются по заказу.')}</p>
      </section>
      <section className="ztx-admin-card">
        <div className="ztx-admin-card-head"><h3>{t('Продавцы: баланс и выплаты')}</h3></div>
        <p className="ztx-admin-muted" style={{ marginBottom: 12 }}>{t('Комиссия и её размер по категориям задаются в «Настройки». Деньги считаются по доставленным заказам; «в работе» — по ещё не доставленным.')}</p>
        <div className="ztx-admin-scroll"><table className="ztx-admin-table">
          <thead><tr><th>{t('Продавец')}</th><th className="is-num">{t('Продано')}</th><th className="is-num">{t('Комиссия')}</th><th className="is-num">{t('Выплачено')}</th><th className="is-num">{t('К выплате')}</th><th className="is-num">{t('В работе')}</th><th><span className="ztx-admin-sr">{t('Действия')}</span></th></tr></thead>
          <tbody>{items.length === 0 && <tr><td colSpan={7} className="ztx-admin-muted">{t('Продавцов пока нет')}</td></tr>}
            {items.map((s) => (
              <tr key={s.id}>
                <td data-label={t('Продавец')}><div className="ztx-admin-main">{s.name}</div><div className="ztx-admin-muted">{s.email}</div></td>
                <td data-label={t('Продано')} className="is-num">{money(s.gross)}</td>
                <td data-label={t('Комиссия')} className="is-num">{money(s.commission)}</td>
                <td data-label={t('Выплачено')} className="is-num">{money(s.paid)}</td>
                <td data-label={t('К выплате')} className="is-num"><b>{money(s.balance)}</b></td>
                <td data-label={t('В работе')} className="is-num">{money(s.pendingNet)}</td>
                <td className="ztx-admin-actions"><button type="button" className="ztx-admin-btn is-primary" disabled={s.balance <= 0} onClick={() => { setPay(s); setAmount(String(s.balance)); }}>{t('Выплатить')}</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>
      <section>
        <div className="ztx-admin-card-head"><h3>{t('История выплат')}</h3><CsvLink href={api.admin.exportUrl('payouts')} /></div>
        <ListState query={payouts} empty={t('Выплат пока не было')} onPage={f.page}>
          {(rows) => (
            <div className="ztx-admin-scroll"><table className="ztx-admin-table">
              <thead><tr><th>{t('Дата')}</th><th>{t('Продавец')}</th><th className="is-num">{t('Сумма')}</th><th>{t('Комментарий')}</th><th>{t('Выплатил')}</th></tr></thead>
              <tbody>{rows.map((p) => (
                <tr key={p.id}><td data-label={t('Дата')}>{dt(p.createdAt)}</td><td data-label={t('Продавец')}>{p.sellerName}</td><td data-label={t('Сумма')} className="is-num">{money(p.amount)}</td><td data-label={t('Комментарий')}>{p.note || '—'}</td><td data-label={t('Выплатил')}>{p.adminEmail || '—'}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </ListState>
      </section>
      {pay && (
        <ReasonDialog title={t('Выплата продавцу')} text={`${pay.name}. ${t('К выплате: {sum}', { sum: money(pay.balance) })}`} confirmLabel={t('Записать выплату')} danger={false} required={false} label={t('Комментарий (номер платежа и т. п.)')}
          extra={<Field label={t('Сумма, сум')}><input className="ztx-admin-input" type="number" min="1" max={pay.balance} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>}
          onCancel={() => setPay(null)}
          onConfirm={async (note) => { await api.admin.createPayout({ sellerId: pay.id, amount: Number(amount), note }); setPay(null); reload(); }} />
      )}
    </div>
  );
}
