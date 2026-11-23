import { useEffect, useState } from 'react';
import { api } from '../../api';
import { useToast } from '../useToast';
import { t } from '../../i18n';
import { money, num } from '../../format';
import RevenueChart from '../admin/RevenueChart';

const PERIODS = [7, 30, 90];
const STATUS_LABEL = { pending: 'Новый', confirmed: 'Подтверждён', shipped: 'Отправлен', delivered: 'Доставлен', cancelled: 'Отменён' };

export default function AnalyticsTab() {
  const { toast } = useToast();
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let off = false;
    api.sellerAnalytics(days)
      .then((d) => { if (!off) { setData(d); setFailed(false); } })
      .catch((e) => { if (!off) { setFailed(true); toast(e.message, 'error'); } });
    return () => { off = true; };
  }, [days, toast]);

  const loading = !failed && data?.days !== days;
  const top = data?.top || [];
  const maxTop = Math.max(1, ...top.map((x) => x.revenue));

  return (
    <div aria-busy={loading}>
      <div className="ztx-seller-row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, color: 'var(--ink)' }}>{t('Аналитика продаж')}</h2>
        <div className="ztx-seller-seg" role="group" aria-label={t('Период')}>
          {PERIODS.map((p) => (
            <button key={p} type="button" aria-pressed={days === p} onClick={() => setDays(p)}>{t('{n} дней', { n: p })}</button>
          ))}
        </div>
      </div>

      {failed && !data && <div className="ztx-seller-banner danger" role="alert">{t('Не удалось загрузить аналитику')}</div>}
      {!data && !failed && <div className="ztx-seller-empty">{t('Загрузка…')}</div>}

      {data && (
        <div className={`ztx-seller-chart-wrap ${loading ? 'loading' : ''}`} style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .2s' }}>
          <div className="ztx-seller-kpis">
            <div className="ztx-seller-kpi"><span>{t('Выручка за период')}</span><strong>{money(data.totals.revenue)}</strong></div>
            <div className="ztx-seller-kpi"><span>{t('Заказов')}</span><strong>{num(data.totals.orders)}</strong></div>
            <div className="ztx-seller-kpi"><span>{t('Средний чек')}</span><strong>{money(data.totals.avgOrder)}</strong></div>
          </div>

          <div className="ztx-seller-charts">
            <div className="wide" style={{ gridColumn: '1 / -1', minWidth: 0 }}>
              <RevenueChart series={data.series} />
            </div>

            <section className="ztx-seller-chart" aria-labelledby="an-top">
              <h3 id="an-top">{t('Топ товаров по выручке')}</h3>
              {top.length === 0 ? <p className="ztx-seller-note">{t('За этот период продаж не было')}</p> : (
                <ol className="ztx-seller-hbars">
                  {top.map((x) => (
                    <li key={x.title} className="ztx-seller-hbar">
                      <div className="ztx-seller-hbar-top"><span title={x.title}>{x.title}</span><span>{money(x.revenue)} · {t('{n} шт.', { n: x.qty })}</span></div>
                      <div className="ztx-seller-hbar-track"><div className="ztx-seller-hbar-fill" style={{ width: `${(x.revenue / maxTop) * 100}%` }} /></div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="ztx-seller-chart" aria-labelledby="an-st">
              <h3 id="an-st">{t('Заказы по статусам')}</h3>
              <div className="ztx-seller-stats">
                {Object.entries(STATUS_LABEL).map(([k, label]) => (
                  <div key={k} className="ztx-seller-stat"><b>{num(data.byStatus?.[k] ?? 0)}</b><span>{t(label)}</span></div>
                ))}
              </div>
              <p className="ztx-seller-hint" style={{ marginTop: 12 }}>{t('Отменённые заказы в выручку не входят.')}</p>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
