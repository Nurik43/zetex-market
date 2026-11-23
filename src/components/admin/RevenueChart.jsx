import { useEffect, useMemo, useRef, useState } from 'react';
import { Table2, LineChart } from 'lucide-react';
import { t, fmtDate } from '../../i18n';
import { money, num } from '../../format';

const H = 240;
const PAD = { l: 56, r: 14, t: 14, b: 28 };

/** Красивый шаг оси: 1, 2, 5 × 10^n */
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}
const short = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)} ${t('млн')}` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)} ${t('тыс')}` : String(n));
const day = (d) => fmtDate(d, { day: 'numeric', month: 'short' });

/** Линейный SVG-график выручки по дням; series: [{date, revenue, orders}] */
export default function RevenueChart({ series }) {
  const wrapRef = useRef(null);
  const [w, setW] = useState(640);
  const [active, setActive] = useState(null);
  const [table, setTable] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [table]);

  const geo = useMemo(() => {
    const max = niceMax(Math.max(0, ...series.map((s) => s.revenue)));
    const iw = w - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
    const n = series.length;
    const x = (i) => PAD.l + (n > 1 ? (i * iw) / (n - 1) : iw / 2);
    const y = (v) => PAD.t + ih - (v / max) * ih;
    const pts = series.map((s, i) => [x(i), y(s.revenue)]);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('');
    const area = pts.length ? `${line}L${pts.at(-1)[0].toFixed(1)} ${y(0)}L${pts[0][0].toFixed(1)} ${y(0)}Z` : '';
    const yTicks = [0, 1, 2, 3, 4].map((k) => (max * k) / 4);
    const step = Math.max(1, Math.round(n / (w < 420 ? 4 : 6)));
    const xTicks = series.map((_, i) => i).filter((i) => i % step === 0 && n - 1 - i >= step / 2 || i === n - 1);
    return { max, pts, line, area, yTicks, xTicks, x, y, n };
  }, [series, w]);

  const total = series.reduce((s, x) => s + x.revenue, 0);
  const move = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * w;
    let best = 0, d = Infinity;
    geo.pts.forEach((p, i) => { const dd = Math.abs(p[0] - px); if (dd < d) { d = dd; best = i; } });
    setActive(best);
  };
  const key = (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      setActive((a) => Math.min(geo.n - 1, Math.max(0, (a ?? (dir > 0 ? -1 : geo.n)) + dir)));
    } else if (e.key === 'Escape') setActive(null);
  };

  const cur = active != null ? series[active] : null;
  const curPt = active != null ? geo.pts[active] : null;
  const tipLeft = curPt ? Math.min(Math.max(curPt[0], 80), w - 80) : 0;

  return (
    <section className="ztx-admin-card">
      <div className="ztx-admin-card-head">
        <div>
          <h3>{t('Выручка за 30 дней')}</h3>
          <p className="ztx-admin-muted">{t('Всего: {sum}', { sum: money(total) })}</p>
        </div>
        <button type="button" className="ztx-admin-btn" onClick={() => setTable((v) => !v)}>
          {table ? <LineChart size={15} aria-hidden="true" /> : <Table2 size={15} aria-hidden="true" />}
          {table ? t('График') : t('Таблица')}
        </button>
      </div>

      {table ? (
        <div className="ztx-admin-scroll ztx-admin-chart-table">
          <table className="ztx-admin-table">
            <thead><tr><th>{t('Дата')}</th><th className="is-num">{t('Заказов')}</th><th className="is-num">{t('Выручка')}</th></tr></thead>
            <tbody>
              {series.map((s) => (
                <tr key={s.date}><td data-label={t("Дата")}>{fmtDate(s.date)}</td><td data-label={t("Заказов")} className="is-num">{num(s.orders)}</td><td data-label={t("Выручка")} className="is-num">{money(s.revenue)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="ztx-admin-chart" ref={wrapRef}>
          <svg
            viewBox={`0 0 ${w} ${H}`} width={w} height={H} role="img" tabIndex={0}
            aria-label={t('График выручки по дням. Стрелки влево и вправо — перейти по дням.')}
            onPointerMove={move} onPointerLeave={() => setActive(null)} onFocus={() => setActive((a) => a ?? geo.n - 1)}
            onBlur={() => setActive(null)} onKeyDown={key}
          >
            {geo.yTicks.map((v) => (
              <g key={v}>
                <line className="ztx-admin-grid" x1={PAD.l} x2={w - PAD.r} y1={geo.y(v)} y2={geo.y(v)} />
                <text className="ztx-admin-axis" x={PAD.l - 8} y={geo.y(v) + 4} textAnchor="end">{short(v)}</text>
              </g>
            ))}
            {geo.xTicks.map((i) => (
              <text key={i} className="ztx-admin-axis" x={geo.x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === geo.n - 1 ? 'end' : 'middle'}>{day(series[i].date)}</text>
            ))}
            <path d={geo.area} className="ztx-admin-area" />
            <path d={geo.line} className="ztx-admin-line" />
            {curPt && (
              <g>
                <line className="ztx-admin-cross" x1={curPt[0]} x2={curPt[0]} y1={PAD.t} y2={H - PAD.b} />
                <circle className="ztx-admin-dot" cx={curPt[0]} cy={curPt[1]} r={5} />
              </g>
            )}
          </svg>
          {cur && (
            <div className="ztx-admin-tip" style={{ left: tipLeft }} role="status">
              <b>{fmtDate(cur.date)}</b>
              <span>{t('Выручка')}: {money(cur.revenue)}</span>
              <span>{t('Заказов')}: {num(cur.orders)}</span>
            </div>
          )}
          {total === 0 && <p className="ztx-admin-chart-note">{t('За этот период продаж не было')}</p>}
        </div>
      )}
    </section>
  );
}
