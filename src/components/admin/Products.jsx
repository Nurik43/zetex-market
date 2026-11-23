import { useState } from 'react';
import { Trash2, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { api, imgUrl, hideBrokenImg } from '../../api';
import { t } from '../../i18n';
import { money } from '../../format';
import { ReasonDialog, Toolbar, Select, ListState, Badge, BulkBar, ResetFilters } from './common';
import { useList, useSelection } from './hooks';
import { useAct, useFilters } from './shared';

const STATUS = { active: ['Активен', 'ok'], hidden: ['Скрыт', 'neutral'], pending: ['На проверке', 'warn'] };

export default function Products({ initial = {} }) {
  const filters = useFilters({ status: '', category: '', sort: 'new' }, 'products', initial);
  const { f, set, page, params } = filters;
  const query = useList(api.admin.products, params);
  const act = useAct();
  const sel = useSelection();
  const [ask, setAsk] = useState(null); // { kind: 'hide'|'delete'|'approve', ids, title }
  const done = () => { sel.clear(); query.retry(); };

  const confirm = async (reason, trustSeller = false) => {
    const { kind, ids } = ask;
    const call = ids.length === 1 && kind !== 'approve' && kind !== 'approve-trust'
      ? (kind === 'hide' ? api.admin.setProductStatus(ids[0], 'hidden', { reason }) : api.admin.deleteProduct(ids[0], reason))
      : api.admin.bulkProducts({ ids, action: kind === 'hide' ? 'hide' : kind === 'delete' ? 'delete' : 'activate', reason, trustSeller });
    await call;
    setAsk(null); done();
  };

  const approve = (ids, trustSeller = false) => act(() => api.admin.bulkProducts({ ids, action: 'activate', trustSeller }), 'Товар опубликован', done);
  const items = query.data?.items || [];
  const allOn = items.length > 0 && items.every((p) => sel.has(p.id));

  return (
    <>
      <Toolbar q={f.q} onQ={(q) => set({ q })} placeholder={t('Поиск по товарам')}>
        <Select value={f.status} onChange={(status) => set({ status })} label={t('Статус')}
          options={[['', t('Все статусы')], ['pending', t('На проверке')], ['active', t('Активные')], ['hidden', t('Скрытые')]]} />
        <Select value={f.sort} onChange={(sort) => set({ sort })} label={t('Сортировка')}
          options={[['new', t('Сначала новые')], ['price_asc', t('Дешевле')], ['price_desc', t('Дороже')], ['stock_asc', t('Мало на складе')]]} />
        <ResetFilters filters={filters} />
      </Toolbar>
      <BulkBar count={sel.count} onClear={sel.clear}>
        <button type="button" className="ztx-admin-btn is-primary" onClick={() => approve(sel.ids)}><CheckCircle2 size={15} aria-hidden="true" /> {t('Опубликовать')}</button>
        <button type="button" className="ztx-admin-btn" onClick={() => setAsk({ kind: 'hide', ids: sel.ids })}><EyeOff size={15} aria-hidden="true" /> {t('Скрыть')}</button>
        <button type="button" className="ztx-admin-btn is-danger" onClick={() => setAsk({ kind: 'delete', ids: sel.ids })}><Trash2 size={15} aria-hidden="true" /> {t('Удалить')}</button>
      </BulkBar>
      <ListState query={query} empty={t('Товары не найдены')} onPage={page}>
        {(rows) => (
          <div className="ztx-admin-scroll">
            <table className="ztx-admin-table">
              <thead><tr>
                <th style={{ width: 36 }}><input type="checkbox" className="ztx-admin-check" checked={allOn} onChange={(e) => sel.setAll(rows.map((p) => p.id), e.target.checked)} aria-label={t('Выбрать все')} /></th>
                <th>{t('Товар')}</th><th>{t('Продавец')}</th><th className="is-num">{t('Цена')}</th><th>{t('Статус')}</th><th><span className="ztx-admin-sr">{t('Действия')}</span></th>
              </tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td><input type="checkbox" className="ztx-admin-check" checked={sel.has(p.id)} onChange={() => sel.toggle(p.id)} aria-label={`${t('Выбрать')}: ${p.title}`} /></td>
                    <td data-label={t('Товар')}>
                      <div className="ztx-admin-prod">
                        {p.image && <img src={imgUrl(p.image)} alt="" loading="lazy" onError={hideBrokenImg} />}
                        <div><a className="ztx-admin-link" href={`/product/${p.id}`} target="_blank" rel="noreferrer">{p.title}</a>{p.statusReason && <div className="ztx-admin-muted">{p.statusReason}</div>}</div>
                      </div>
                    </td>
                    <td data-label={t('Продавец')}>{p.sellerName || '—'}{p.sellerTrusted ? ' ✓' : ''}</td>
                    <td data-label={t('Цена')} className="is-num">{money(p.price)}</td>
                    <td data-label={t('Статус')}><Badge tone={(STATUS[p.status] || STATUS.hidden)[1]}>{t((STATUS[p.status] || STATUS.hidden)[0])}</Badge></td>
                    <td className="ztx-admin-actions">
                      {p.status !== 'active' && <button type="button" className="ztx-admin-btn is-primary" onClick={() => approve([p.id])}><Eye size={15} aria-hidden="true" /> {p.status === 'pending' ? t('Одобрить') : t('Показать')}</button>}
                      {p.status === 'pending' && !p.sellerTrusted && <button type="button" className="ztx-admin-btn" onClick={() => approve([p.id], true)}>{t('Одобрить и доверять')}</button>}
                      {p.status !== 'hidden' && <button type="button" className="ztx-admin-btn" onClick={() => setAsk({ kind: 'hide', ids: [p.id], title: p.title })}><EyeOff size={15} aria-hidden="true" /> {p.status === 'pending' ? t('Отклонить') : t('Скрыть')}</button>}
                      <button type="button" className="ztx-admin-btn is-danger" onClick={() => setAsk({ kind: 'delete', ids: [p.id], title: p.title })} aria-label={`${t('Удалить')}: ${p.title}`}><Trash2 size={15} aria-hidden="true" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ListState>
      {ask && (
        <ReasonDialog
          title={ask.kind === 'delete' ? t('Удалить товары безвозвратно?') : t('Скрыть товары из каталога?')}
          text={ask.title ? `«${ask.title}»` : t('Выбрано товаров: {n}', { n: ask.ids.length })}
          confirmLabel={ask.kind === 'delete' ? t('Удалить') : t('Скрыть')}
          onCancel={() => setAsk(null)} onConfirm={(reason) => confirm(reason)} />
      )}
    </>
  );
}
