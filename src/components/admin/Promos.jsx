import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../api';
import { useQuery } from '../../useQuery';
import { t, fmtDate } from '../../i18n';
import { money, num } from '../../format';
import { ConfirmDialog, ListState, Badge } from './common';
import { useAct } from './shared';

const EMPTY_PROMO = { code: '', type: 'percent', value: '', minTotal: '', maxUses: '', expiresAt: '' };

function PromoForm({ onDone }) {
  const [d, setD] = useState(EMPTY_PROMO);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setD((s) => ({ ...s, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await api.admin.createPromo({
        code: d.code, type: d.type, value: Number(d.value), minTotal: Number(d.minTotal) || 0,
        maxUses: d.maxUses ? Number(d.maxUses) : null, expiresAt: d.expiresAt || null, active: true,
      });
      setD(EMPTY_PROMO); onDone();
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  return (
    <form className="ztx-admin-card ztx-admin-form" onSubmit={submit}>
      <div className="ztx-admin-card-head"><h3>{t('Новый общий промокод')}</h3></div>
      <div className="ztx-admin-formgrid">
        <label>{t('Код')}<input className="ztx-admin-input" required value={d.code} onChange={set('code')} maxLength={20} placeholder="SALE10" autoCapitalize="characters" /></label>
        <label>{t('Тип скидки')}
          <select className="ztx-admin-select" value={d.type} onChange={set('type')}>
            <option value="percent">{t('Процент')}</option><option value="fixed">{t('Фиксированная сумма')}</option>
          </select>
        </label>
        <label>{d.type === 'percent' ? t('Скидка, % (до 90)') : t('Скидка, сум')}<input className="ztx-admin-input" required type="number" min="1" max={d.type === 'percent' ? 90 : undefined} value={d.value} onChange={set('value')} /></label>
        <label>{t('Мин. сумма заказа')}<input className="ztx-admin-input" type="number" min="0" value={d.minTotal} onChange={set('minTotal')} /></label>
        <label>{t('Лимит использований')}<input className="ztx-admin-input" type="number" min="1" value={d.maxUses} onChange={set('maxUses')} placeholder={t('Без лимита')} /></label>
        <label>{t('Действует до')}<input className="ztx-admin-input" type="date" value={d.expiresAt} onChange={set('expiresAt')} /></label>
      </div>
      {err && <p className="ztx-admin-formerr" role="alert">{err}</p>}
      <div><button type="submit" className="ztx-admin-btn is-primary" disabled={busy}><Plus size={15} aria-hidden="true" /> {t('Создать')}</button></div>
    </form>
  );
}

export default function Promos() {
  const query = useQuery('promos', () => api.admin.promos());
  const act = useAct();
  const [ask, setAsk] = useState(null);
  const data = query.data && { ...query.data, total: query.data.items.length, page: 1, pages: 1 };
  return (
    <div className="ztx-admin-stack">
      <PromoForm onDone={query.retry} />
      <ListState query={{ ...query, data }} empty={t('Общих промокодов пока нет')} onPage={() => {}}>
        {(items) => (
          <div className="ztx-admin-scroll">
            <table className="ztx-admin-table">
              <thead><tr><th>{t('Код')}</th><th>{t('Скидка')}</th><th className="is-num">{t('Мин. сумма')}</th><th className="is-num">{t('Использовано')}</th><th>{t('Срок')}</th><th>{t('Статус')}</th><th><span className="ztx-admin-sr">{t('Действия')}</span></th></tr></thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id}>
                    <td data-label={t('Код')}><span className="ztx-admin-main ztx-admin-mono">{p.code}</span></td>
                    <td data-label={t('Скидка')}>{p.type === 'percent' ? `${p.value}%` : money(p.value)}</td>
                    <td data-label={t('Мин. сумма')} className="is-num">{p.minTotal ? money(p.minTotal) : '—'}</td>
                    <td data-label={t('Использовано')} className="is-num">{num(p.usedCount)}{p.maxUses ? ` / ${num(p.maxUses)}` : ''}</td>
                    <td data-label={t('Срок')}>{p.expiresAt ? fmtDate(p.expiresAt) : t('Бессрочно')}</td>
                    <td data-label={t('Статус')}>{p.active ? <Badge tone="ok">{t('Включён')}</Badge> : <Badge tone="neutral">{t('Выключен')}</Badge>}</td>
                    <td className="ztx-admin-actions">
                      <button type="button" className="ztx-admin-btn" onClick={() => act(() => api.admin.updatePromo(p.id, { active: !p.active }), p.active ? 'Промокод выключен' : 'Промокод включён', query.retry)}>
                        {p.active ? t('Выключить') : t('Включить')}
                      </button>
                      <button type="button" className="ztx-admin-btn is-danger" onClick={() => setAsk(p)} aria-label={`${t('Удалить')}: ${p.code}`}><Trash2 size={15} aria-hidden="true" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ListState>
      {ask && (
        <ConfirmDialog title={t('Удалить промокод?')} text={ask.code} confirmLabel={t('Удалить')}
          onCancel={() => setAsk(null)}
          onConfirm={async () => { await act(() => api.admin.deletePromo(ask.id), 'Промокод удалён', query.retry); setAsk(null); }} />
      )}
    </div>
  );
}

