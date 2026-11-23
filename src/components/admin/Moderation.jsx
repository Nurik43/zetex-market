import { useState } from 'react';
import { Trash2, Star, CheckCircle2, XCircle, RotateCcw, EyeOff, MessageSquare, Ban } from 'lucide-react';
import { api, imgUrl, hideBrokenImg } from '../../api';
import { useQuery } from '../../useQuery';
import { t } from '../../i18n';
import { ReasonDialog, Toolbar, Select, ListState, Drawer, Skeleton, ErrorBox, BulkBar, Badge } from './common';
import { useList, useSelection } from './hooks';
import { useAct, useFilters, stat, dt } from './shared';

const REPORT_STATUS = { open: ['Открыта', 'warn'], resolved: ['Решена', 'ok'], dismissed: ['Отклонена', 'neutral'] };

export function Reports() {
  const { f, set, page, params } = useFilters({ status: 'open' }, 'reports');
  const query = useList(api.admin.reports, params);
  const act = useAct();
  const sel = useSelection();
  const [ask, setAsk] = useState(null);
  const done = () => { sel.clear(); query.retry(); };
  const setStatus = (id, status, msg) => act(() => api.admin.setReportStatus(id, status), msg, done);
  const bulk = (status) => act(() => api.admin.bulkReports({ ids: sel.ids, status }), status === 'resolved' ? 'Жалобы закрыты' : 'Жалобы отклонены', done);
  return (
    <>
      <Toolbar><Select value={f.status} onChange={(status) => set({ status })} label={t('Статус жалобы')} options={[['open', t('Открытые')], ['resolved', t('Решённые')], ['dismissed', t('Отклонённые')], ['', t('Все')]]} /></Toolbar>
      <BulkBar count={sel.count} onClear={sel.clear}>
        <button type="button" className="ztx-admin-btn is-primary" onClick={() => bulk('resolved')}><CheckCircle2 size={15} aria-hidden="true" /> {t('Решены')}</button>
        <button type="button" className="ztx-admin-btn" onClick={() => bulk('dismissed')}><XCircle size={15} aria-hidden="true" /> {t('Отклонить')}</button>
      </BulkBar>
      <ListState query={query} empty={t('Жалоб нет')} onPage={page}>
        {(items) => (
          <ul className="ztx-admin-list">
            {items.map((r) => (
              <li key={r.id} className="ztx-admin-item">
                <input type="checkbox" className="ztx-admin-check" checked={sel.has(r.id)} onChange={() => sel.toggle(r.id)} aria-label={`${t('Выбрать')}: ${r.productTitle}`} />
                {r.productImage && <img src={imgUrl(r.productImage)} alt="" loading="lazy" onError={hideBrokenImg} />}
                <div className="ztx-admin-item-body">
                  <div className="ztx-admin-item-head"><a className="ztx-admin-link" href={`/product/${r.productId}`} target="_blank" rel="noreferrer">{r.productTitle}</a> {stat(REPORT_STATUS, r.status)}{r.productStatus === 'hidden' && <Badge>{t('скрыт')}</Badge>}</div>
                  <div><b>{r.reason}</b>{r.text ? ` — ${r.text}` : ''}</div>
                  <div className="ztx-admin-muted">{r.reporter || t('Аноним')} · {dt(r.createdAt)}</div>
                </div>
                <div className="ztx-admin-actions">
                  {r.status === 'open' ? (
                    <>
                      {r.productStatus !== 'hidden' && <button type="button" className="ztx-admin-btn is-danger" onClick={() => setAsk(r)}><EyeOff size={15} aria-hidden="true" /> {t('Скрыть товар')}</button>}
                      <button type="button" className="ztx-admin-btn is-primary" onClick={() => setStatus(r.id, 'resolved', 'Жалоба решена')}><CheckCircle2 size={15} aria-hidden="true" /> {t('Решена')}</button>
                      <button type="button" className="ztx-admin-btn" onClick={() => setStatus(r.id, 'dismissed', 'Жалоба отклонена')}><XCircle size={15} aria-hidden="true" /> {t('Отклонить')}</button>
                    </>
                  ) : <button type="button" className="ztx-admin-btn" onClick={() => setStatus(r.id, 'open', 'Жалоба открыта снова')}><RotateCcw size={15} aria-hidden="true" /> {t('Открыть снова')}</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </ListState>
      {ask && <ReasonDialog title={t('Скрыть товар и закрыть жалобу?')} text={`«${ask.productTitle}»`} confirmLabel={t('Скрыть товар')}
        onCancel={() => setAsk(null)} onConfirm={async (reason) => { await api.admin.patchReport(ask.id, { status: 'resolved', hideProduct: true, reason }); setAsk(null); done(); }} />}
    </>
  );
}

export function Reviews() {
  const { f, set, page, params } = useFilters({ rating: '' }, 'reviews');
  const query = useList(api.admin.reviews, params);
  const sel = useSelection();
  const [ask, setAsk] = useState(null); // массив id
  const items = query.data?.items || [];
  const allOn = items.length > 0 && items.every((r) => sel.has(r.id));
  return (
    <>
      <Toolbar q={f.q} onQ={(q) => set({ q })} placeholder={t('Поиск по отзывам')}>
        <Select value={f.rating} onChange={(rating) => set({ rating })} label={t('Оценка')} options={[['', t('Любая оценка')], ...[1, 2, 3, 4, 5].map((n) => [String(n), `${n} ★`])]} />
        {items.length > 0 && <label className="ztx-admin-btn"><input type="checkbox" className="ztx-admin-check" checked={allOn} onChange={(e) => sel.setAll(items.map((r) => r.id), e.target.checked)} /> {t('Выбрать все')}</label>}
      </Toolbar>
      <BulkBar count={sel.count} onClear={sel.clear}><button type="button" className="ztx-admin-btn is-danger" onClick={() => setAsk(sel.ids)}><Trash2 size={15} aria-hidden="true" /> {t('Удалить выбранные')}</button></BulkBar>
      <ListState query={query} empty={t('Отзывов нет')} onPage={page}>
        {(rows) => (
          <ul className="ztx-admin-list">
            {rows.map((r) => (
              <li key={r.id} className="ztx-admin-item">
                <input type="checkbox" className="ztx-admin-check" checked={sel.has(r.id)} onChange={() => sel.toggle(r.id)} aria-label={`${t('Выбрать')}: ${r.productTitle}`} />
                <div className="ztx-admin-item-body">
                  <div className="ztx-admin-item-head"><span className="ztx-admin-main">{r.productTitle}</span>
                    <span className="ztx-admin-rating" role="img" aria-label={t('Оценка: {n} из 5', { n: r.rating })}><Star size={14} aria-hidden="true" /> {r.rating}</span></div>
                  {r.text && <div>{r.text}</div>}
                  <div className="ztx-admin-muted">{r.author} · {dt(r.createdAt)}</div>
                </div>
                <div className="ztx-admin-actions"><button type="button" className="ztx-admin-btn is-danger" onClick={() => setAsk([r.id])}><Trash2 size={15} aria-hidden="true" /> {t('Удалить')}</button></div>
              </li>
            ))}
          </ul>
        )}
      </ListState>
      {ask && <ReasonDialog title={t('Удалить отзывы?')} text={t('Выбрано: {n}. Рейтинг товаров пересчитается.', { n: ask.length })} confirmLabel={t('Удалить')} required={false}
        onCancel={() => setAsk(null)} onConfirm={async (reason) => { await api.admin.bulkReviews({ ids: ask, reason }); setAsk(null); sel.clear(); query.retry(); }} />}
    </>
  );
}

function ChatDrawer({ id, onClose, onChanged }) {
  const q = useQuery(`c${id}`, () => api.admin.conversation(id));
  const [ask, setAsk] = useState(null);
  const body = () => {
    if (!q.data) return q.loading ? <Skeleton rows={4} /> : <ErrorBox message={q.error} onRetry={q.retry} />;
    const { conversation: c, messages } = q.data;
    return (
      <>
        <p className="ztx-admin-muted">{t('Доступ к переписке записывается в журнал действий.')}</p>
        <dl className="ztx-admin-kv"><dt>{t('Покупатель')}</dt><dd>{c.buyerEmail}</dd><dt>{t('Продавец')}</dt><dd>{c.sellerEmail}</dd></dl>
        <div className="ztx-admin-chat">
          {messages.length === 0 && <p className="ztx-admin-muted">{t('Сообщений нет')}</p>}
          {messages.map((m) => (
            <div key={m.id} className={`ztx-admin-msg is-${m.sender}`}>
              {m.text}
              <small>{m.sender === 'buyer' ? t('покупатель') : t('продавец')} · {dt(m.createdAt)}{m.reports ? ` · ⚠ ${m.reports}` : ''} · <button type="button" className="ztx-admin-link" style={{ color: 'var(--danger)', fontWeight: 500 }} onClick={() => setAsk(m)}>{t('удалить')}</button></small>
            </div>
          ))}
        </div>
        {ask && <ReasonDialog title={t('Удалить сообщение?')} text={ask.text.slice(0, 120)} confirmLabel={t('Удалить')} required={false} onCancel={() => setAsk(null)}
          onConfirm={async (reason) => { await api.admin.deleteMessage(ask.id, reason); setAsk(null); q.retry(); onChanged(); }} />}
      </>
    );
  };
  return <Drawer title={t('Переписка')} onClose={onClose}>{body()}</Drawer>;
}

export function Chats() {
  const [mode, setMode] = useState('reports');
  const { f, set, page, params } = useFilters({ status: 'open' }, 'chats');
  const reports = useList(api.admin.chatReports, params);
  const convs = useList(api.admin.conversations, { q: f.q, page: f.page });
  const act = useAct();
  const [open, setOpen] = useState(null);
  const [block, setBlock] = useState(null);
  return (
    <>
      <div className="ztx-admin-subtabs" role="group" aria-label={t('Раздел чатов')}>
        <button type="button" className="ztx-admin-btn" aria-pressed={mode === 'reports'} onClick={() => setMode('reports')}><MessageSquare size={15} aria-hidden="true" /> {t('Жалобы на сообщения')}</button>
        <button type="button" className="ztx-admin-btn" aria-pressed={mode === 'all'} onClick={() => setMode('all')}>{t('Все переписки')}</button>
      </div>
      {mode === 'reports' ? (
        <>
          <Toolbar><Select value={f.status} onChange={(status) => set({ status })} label={t('Статус')} options={[['open', t('Открытые')], ['resolved', t('Решённые')], ['dismissed', t('Отклонённые')], ['', t('Все')]]} /></Toolbar>
          <ListState query={reports} empty={t('Жалоб на сообщения нет')} onPage={page}>
            {(items) => (
              <ul className="ztx-admin-list">{items.map((r) => (
                <li key={r.id} className="ztx-admin-item">
                  <div className="ztx-admin-item-body">
                    <div className="ztx-admin-item-head"><span className="ztx-admin-main">{r.senderEmail}</span> {stat(REPORT_STATUS, r.status)}{r.senderBlocked && <Badge tone="danger">{t('заблокирован')}</Badge>}</div>
                    <div>«{r.text}»</div>
                    <div className="ztx-admin-muted">{t('Пожаловался')}: {r.reporter} · {r.reason} · {dt(r.createdAt)}</div>
                  </div>
                  <div className="ztx-admin-actions">
                    <button type="button" className="ztx-admin-btn" onClick={() => setOpen(r.conversationId)}>{t('Переписка')}</button>
                    {!r.senderBlocked && <button type="button" className="ztx-admin-btn is-danger" onClick={() => setBlock(r)}><Ban size={15} aria-hidden="true" /> {t('Блок')}</button>}
                    {r.status === 'open' ? <>
                      <button type="button" className="ztx-admin-btn is-primary" onClick={() => act(() => api.admin.patchChatReport(r.id, 'resolved'), 'Жалоба решена', reports.retry)}>{t('Решена')}</button>
                      <button type="button" className="ztx-admin-btn" onClick={() => act(() => api.admin.patchChatReport(r.id, 'dismissed'), 'Жалоба отклонена', reports.retry)}>{t('Отклонить')}</button></>
                      : <button type="button" className="ztx-admin-btn" onClick={() => act(() => api.admin.patchChatReport(r.id, 'open'), 'Жалоба открыта снова', reports.retry)}>{t('Открыть снова')}</button>}
                  </div>
                </li>))}</ul>
            )}
          </ListState>
        </>
      ) : (
        <>
          <Toolbar q={f.q} onQ={(q) => set({ q })} placeholder={t('Поиск по почте участников')} />
          <ListState query={convs} empty={t('Переписок нет')} onPage={page}>
            {(items) => (
              <ul className="ztx-admin-list">{items.map((c) => (
                <li key={c.id} className="ztx-admin-item">
                  <div className="ztx-admin-item-body"><div className="ztx-admin-main">{c.buyerEmail} ↔ {c.sellerEmail}</div><div className="ztx-admin-muted">{c.messages} {t('сообщ.')} · {dt(c.lastMessageAt)}</div><div>{c.lastMessage}</div></div>
                  <div className="ztx-admin-actions"><button type="button" className="ztx-admin-btn" onClick={() => setOpen(c.id)}>{t('Открыть')}</button></div>
                </li>))}</ul>
            )}
          </ListState>
        </>
      )}
      {open && <ChatDrawer id={open} onClose={() => setOpen(null)} onChanged={() => { reports.retry(); convs.retry(); }} />}
      {block && <ReasonDialog title={t('Заблокировать за нарушение в чате?')} text={block.senderEmail} confirmLabel={t('Заблокировать')} onCancel={() => setBlock(null)}
        onConfirm={async (reason) => { await api.admin.blockUser(block.senderId, true, reason); await api.admin.patchChatReport(block.id, 'resolved'); setBlock(null); reports.retry(); }} />}
    </>
  );
}
