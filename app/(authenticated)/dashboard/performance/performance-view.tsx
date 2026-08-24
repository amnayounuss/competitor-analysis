'use client';

/**
 * Business Profile Performance dashboard.
 *
 * Charts are hand-rolled SVG to match the rest of this dashboard (Recharts is a
 * dependency but nothing in the app imports it).
 *
 * Form choices, by the job each number does:
 *   impressions over time  → stacked area (composition of one total, same unit)
 *   impressions split      → donut (part-of-whole, exactly 4 parts)
 *   actions by type        → horizontal bars, single hue (magnitude ranking, so
 *                            identity carries no meaning and a categorical
 *                            palette would be noise)
 *   weekday pattern        → heatmap, one hue light→dark (magnitude on a grid)
 *
 * Impressions and actions differ by orders of magnitude, so they are never
 * plotted on one pair of axes — separate charts, each with its own scale.
 */

import React, { useMemo, useState } from 'react';
import { Bi, BiInline, useT } from '@/lib/bilingual';

interface Total { branch_id: string | null; gmb_location_id: string; branch_name: string | null; metric: string; total: number; daily_avg: number; peak_value: number; days: number; }
interface Daily { metric: string; metric_date: string; value: number; branches: number; }
interface Heat { metric: string; dow: number; total: number; avg_value: number; days: number; }

interface Props {
  data: {
    jobId: string;
    totals: Total[];
    daily: Daily[];
    heatmap: Heat[];
    targetBrand: string | null;
    dateStart: string | null;
    dateEnd: string | null;
    finishedAt: string | null;
  };
}

/** Four impression sources. Validated categorical set (CVD ΔE ≥ 17, all PASS). */
const IMPRESSION_METRICS = [
  { key: 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',  label: 'Mobile Search',  color: '#4F46E5' },
  { key: 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', label: 'Desktop Search', color: '#0EA5E9' },
  { key: 'BUSINESS_IMPRESSIONS_MOBILE_MAPS',    label: 'Mobile Maps',    color: '#10B981' },
  { key: 'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',   label: 'Desktop Maps',   color: '#A855F7' },
];

const ACTION_METRICS = [
  { key: 'WEBSITE_CLICKS',              label: 'Website Clicks' },
  { key: 'CALL_CLICKS',                 label: 'Calls' },
  { key: 'BUSINESS_DIRECTION_REQUESTS', label: 'Direction Requests' },
  { key: 'BUSINESS_CONVERSATIONS',      label: 'Messages' },
  { key: 'BUSINESS_BOOKINGS',           label: 'Bookings' },
  { key: 'BUSINESS_FOOD_ORDERS',        label: 'Food Orders' },
];

const METRIC_LABEL: Record<string, string> = {
  ...Object.fromEntries(IMPRESSION_METRICS.map(m => [m.key, m.label])),
  ...Object.fromEntries(ACTION_METRICS.map(m => [m.key, m.label])),
};

/** Sequential indigo ramp, light→dark. Monotonic in lightness by construction. */
const HEAT_RAMP = ['#EEF2FF', '#E0E7FF', '#C7D2FE', '#A5B4FC', '#818CF8', '#6366F1', '#4F46E5', '#4338CA'];
const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const nf = (n: number) => n.toLocaleString();
const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);

export default function PerformanceView({ data }: Props) {
  const t = useT();
  const [branchFilter, setBranchFilter] = useState<string>('all');

  const branches = useMemo(() => {
    const m = new Map<string, string>();
    for (const row of data.totals) {
      if (!m.has(row.gmb_location_id)) m.set(row.gmb_location_id, row.branch_name || row.gmb_location_id);
    }
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [data.totals]);

  const totals = useMemo(
    () => branchFilter === 'all' ? data.totals : data.totals.filter(r => r.gmb_location_id === branchFilter),
    [data.totals, branchFilter],
  );

  const totalFor = (keys: string[]) =>
    totals.filter(r => keys.includes(r.metric)).reduce((s, r) => s + Number(r.total || 0), 0);

  const impressionsTotal = totalFor(IMPRESSION_METRICS.map(m => m.key));
  const actionsTotal = totalFor(ACTION_METRICS.map(m => m.key));
  const actionRate = impressionsTotal > 0 ? (actionsTotal / impressionsTotal) * 100 : 0;

  const impressionSplit = IMPRESSION_METRICS
    .map(m => ({ ...m, value: totalFor([m.key]) }))
    .filter(m => m.value > 0);

  const actionBars = ACTION_METRICS
    .map(m => ({ ...m, value: totalFor([m.key]) }))
    .filter(m => m.value > 0)
    .sort((a, b) => b.value - a.value);

  const periodLabel = data.dateStart && data.dateEnd
    ? `${data.dateStart} → ${data.dateEnd}`
    : `${t('Last 90 days')}`;

  const branchLabel = branchFilter === 'all'
    ? `${branches.length} ${t('locations')}`
    : (branches.find(b => b.id === branchFilter)?.name || branchFilter);

  return (
    <>
      {/* ── Header ── */}
      <div className="relative overflow-hidden p-6 rounded-3xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border border-indigo-500/20 shadow-2xl shadow-indigo-500/10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(99,102,241,0.15),transparent_50%)]" />
        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
              <span className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.25em]">
                <BiInline en="Google Business Profile Performance" />
              </span>
            </div>
            <div className="text-xl font-black text-white tracking-tight">{data.targetBrand || t('Your Brand')}</div>
            <div className="text-xs font-bold text-slate-400 mt-1">{periodLabel} · {branchLabel}</div>
          </div>

          {/* Filters sit in one row above the charts. */}
          {branches.length > 1 && (
            <select
              value={branchFilter}
              onChange={e => setBranchFilter(e.target.value)}
              className="px-4 py-3 rounded-xl bg-slate-800/80 border border-slate-700 text-white text-xs font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500 max-w-[16rem]"
            >
              <option value="all">{t('All locations')} ({branches.length})</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* ── KPI tiles — hero numbers, no plot ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label={t('Total Impressions')} value={nf(impressionsTotal)} sub={t('Times your profile was seen')} accent="#4F46E5" />
        <Stat label={t('Total Actions')} value={nf(actionsTotal)} sub={t('Clicks, calls, directions')} accent="#10B981" />
        <Stat label={t('Action Rate')} value={`${actionRate.toFixed(2)}%`} sub={t('Actions per impression')} accent="#A855F7" />
        <Stat label={t('Locations Reporting')} value={String(branches.length)} sub={t('With Performance API data')} accent="#0EA5E9" />
      </div>

      {/* ── Impressions over time ── */}
      <Card>
        <SectionHeader title={t('Impressions Over Time')} sub={`${t('Where people saw you')} — ${periodLabel}`} />
        <StackedArea daily={data.daily} series={IMPRESSION_METRICS} />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Impressions split ── */}
        <Card>
          <SectionHeader title={t('Search vs Maps, Mobile vs Desktop')} sub={t('Share of all impressions')} />
          <Donut slices={impressionSplit} />
        </Card>

        {/* ── Actions ranked ── */}
        <Card>
          <SectionHeader title={t('What People Did')} sub={t('Actions taken on your profile')} />
          <RankedBars rows={actionBars} />
        </Card>
      </div>

      {/* ── Weekday heatmap ── */}
      <Card>
        <SectionHeader title={t('Weekday Pattern')} sub={t('Daily average per metric — darker means busier')} />
        <Heatmap rows={data.heatmap} />
      </Card>

      {/* ── Per-location table (also the accessible view of the charts above) ── */}
      <Card>
        <SectionHeader title={t('By Location')} sub={t('Impressions and actions per branch')} />
        <LocationTable totals={data.totals} branches={branches} />
      </Card>
    </>
  );
}

/* ────────────────────────── charts ────────────────────────── */

/** Composition over time. One unit, one axis, 4 stacked bands. */
function StackedArea({ daily, series }: { daily: Daily[]; series: typeof IMPRESSION_METRICS }) {
  const t = useT();
  const [hover, setHover] = useState<number | null>(null);

  const { dates, stacks, max } = useMemo(() => {
    const byDate = new Map<string, Record<string, number>>();
    for (const d of daily) {
      if (!series.some(s => s.key === d.metric)) continue;
      if (!byDate.has(d.metric_date)) byDate.set(d.metric_date, {});
      byDate.get(d.metric_date)![d.metric] = Number(d.value || 0);
    }
    const dates = Array.from(byDate.keys()).sort();
    const stacks = dates.map(date => {
      const row = byDate.get(date)!;
      let acc = 0;
      const bands = series.map(s => {
        const v = row[s.key] || 0;
        const band = { key: s.key, color: s.color, y0: acc, y1: acc + v, value: v };
        acc += v;
        return band;
      });
      return { date, bands, total: acc };
    });
    return { dates, stacks, max: Math.max(1, ...stacks.map(s => s.total)) };
  }, [daily, series]);

  if (dates.length === 0) return <Empty label={t('No impression data for this period')} />;

  const W = 900, H = 260, PL = 52, PR = 12, PT = 12, PB = 28;
  const x = (i: number) => PL + (dates.length === 1 ? (W - PL - PR) / 2 : (i / (dates.length - 1)) * (W - PL - PR));
  const y = (v: number) => PT + (1 - v / max) * (H - PT - PB);

  const ticks = [0, max / 2, max];
  const labelEvery = Math.max(1, Math.ceil(dates.length / 7));

  return (
    <div className="mt-6">
      <Legend items={series.map(s => ({ label: s.label, color: s.color }))} />
      <div className="mt-4 overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[560px]" style={{ height: H }}
             onMouseLeave={() => setHover(null)}>
          {ticks.map((tk, i) => (
            <g key={i}>
              <line x1={PL} x2={W - PR} y1={y(tk)} y2={y(tk)} stroke="#e2e8f0" strokeWidth={1} />
              <text x={PL - 8} y={y(tk) + 4} textAnchor="end" fontSize={10} fontWeight={700} fill="#94a3b8">{compact(Math.round(tk))}</text>
            </g>
          ))}

          {/* Bands are drawn back-to-front so the topmost series sits on top. */}
          {series.map((s, si) => {
            const up = stacks.map((st, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(st.bands[si].y1)}`).join(' ');
            const down = stacks.slice().reverse().map((st, ri) => {
              const i = stacks.length - 1 - ri;
              return `L${x(i)},${y(st.bands[si].y0)}`;
            }).join(' ');
            return <path key={s.key} d={`${up} ${down} Z`} fill={s.color} fillOpacity={0.85} stroke="#ffffff" strokeWidth={0.75} />;
          })}

          {dates.map((d, i) => i % labelEvery === 0 && (
            <text key={d} x={x(i)} y={H - 8} textAnchor="middle" fontSize={9} fontWeight={700} fill="#94a3b8">
              {d.slice(5)}
            </text>
          ))}

          {/* Hover crosshair — hit targets are full-height columns, wider than the marks. */}
          {dates.map((d, i) => (
            <rect key={`h${d}`} x={x(i) - (W - PL - PR) / Math.max(dates.length, 1) / 2} y={PT}
                  width={Math.max(4, (W - PL - PR) / Math.max(dates.length, 1))} height={H - PT - PB}
                  fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}
          {hover !== null && (
            <line x1={x(hover)} x2={x(hover)} y1={PT} y2={H - PB} stroke="#475569" strokeWidth={1} strokeDasharray="3 3" />
          )}
        </svg>
      </div>

      {hover !== null && (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 px-4 py-3 rounded-2xl bg-slate-50 border border-slate-100">
          <span className="text-[11px] font-black text-slate-900">{stacks[hover].date}</span>
          {series.map((s, si) => (
            <span key={s.key} className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}: <span className="text-slate-900">{nf(stacks[hover].bands[si].value)}</span>
            </span>
          ))}
          <span className="text-[11px] font-black text-slate-900 ms-auto">{t('Total')}: {nf(stacks[hover].total)}</span>
        </div>
      )}
    </div>
  );
}

/** Part-of-whole, exactly four parts, every slice directly labelled. */
function Donut({ slices }: { slices: { key: string; label: string; color: string; value: number }[] }) {
  const t = useT();
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total === 0) return <Empty label={t('No impression data yet')} />;

  const R = 78, r = 50, CX = 110, CY = 110;
  let angle = -Math.PI / 2;

  const arcs = slices.map(s => {
    const frac = s.value / total;
    const a0 = angle;
    const a1 = angle + frac * Math.PI * 2;
    angle = a1;
    // 2px surface gap between fills — a hair of padding on each side.
    const pad = frac > 0.02 ? 0.012 : 0;
    const p0 = a0 + pad, p1 = a1 - pad;
    const large = p1 - p0 > Math.PI ? 1 : 0;
    const d = [
      `M${CX + R * Math.cos(p0)},${CY + R * Math.sin(p0)}`,
      `A${R},${R} 0 ${large} 1 ${CX + R * Math.cos(p1)},${CY + R * Math.sin(p1)}`,
      `L${CX + r * Math.cos(p1)},${CY + r * Math.sin(p1)}`,
      `A${r},${r} 0 ${large} 0 ${CX + r * Math.cos(p0)},${CY + r * Math.sin(p0)}`,
      'Z',
    ].join(' ');
    return { ...s, d, frac };
  });

  return (
    <div className="mt-6 flex flex-col sm:flex-row items-center gap-8">
      <svg viewBox="0 0 220 220" className="w-[220px] h-[220px] shrink-0">
        {arcs.map(a => (
          <path key={a.key} d={a.d} fill={a.color}>
            <title>{`${a.label} — ${nf(a.value)} (${(a.frac * 100).toFixed(1)}%)`}</title>
          </path>
        ))}
        <text x={110} y={104} textAnchor="middle" fontSize={22} fontWeight={900} fill="#0f172a">{compact(total)}</text>
        <text x={110} y={124} textAnchor="middle" fontSize={9} fontWeight={800} fill="#94a3b8" letterSpacing={1.4}>
          IMPRESSIONS
        </text>
      </svg>

      {/* Direct labels — required relief for the sub-3:1 contrast of these fills. */}
      <div className="flex-1 w-full space-y-2.5">
        {arcs.map(a => (
          <div key={a.key} className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: a.color }} />
            <span className="text-[11px] font-bold text-slate-600 flex-1 truncate">{a.label}</span>
            <span className="text-[11px] font-black text-slate-900">{nf(a.value)}</span>
            <span className="text-[10px] font-bold text-slate-400 w-12 text-end">{(a.frac * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Magnitude ranking — identity carries no meaning here, so one hue only. */
function RankedBars({ rows }: { rows: { key: string; label: string; value: number }[] }) {
  const t = useT();
  if (rows.length === 0) return <Empty label={t('No actions recorded yet')} />;
  const max = Math.max(...rows.map(r => r.value));

  return (
    <div className="mt-6 space-y-3.5">
      {rows.map(r => (
        <div key={r.key}>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-[11px] font-bold text-slate-600">{r.label}</span>
            <span className="text-[11px] font-black text-slate-900">{nf(r.value)}</span>
          </div>
          <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500"
                 style={{ width: `${(r.value / max) * 100}%`, backgroundColor: '#4F46E5' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Magnitude on a grid — one hue, light→dark. */
function Heatmap({ rows }: { rows: Heat[] }) {
  const t = useT();
  const metrics = useMemo(() => {
    const present = new Set(rows.map(r => r.metric));
    return [...IMPRESSION_METRICS.map(m => m.key), ...ACTION_METRICS.map(m => m.key)].filter(k => present.has(k));
  }, [rows]);

  if (metrics.length === 0) return <Empty label={t('No weekday data yet')} />;

  const lookup = new Map(rows.map(r => [`${r.metric}|${r.dow}`, Number(r.avg_value || 0)]));

  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full min-w-[560px] border-separate" style={{ borderSpacing: '3px' }}>
        <thead>
          <tr>
            <th className="text-start text-[9px] font-black text-slate-400 uppercase tracking-widest px-2">{t('Metric')}</th>
            {DOW_LABELS.map(d => (
              <th key={d} className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{t(d)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {metrics.map(metric => {
            // Each row is scaled to its own max: metrics differ by orders of
            // magnitude, so a shared scale would flatten every action row to
            // the palest step.
            const vals = DOW_LABELS.map((_, dow) => lookup.get(`${metric}|${dow}`) || 0);
            const rowMax = Math.max(1, ...vals);
            return (
              <tr key={metric}>
                <td className="text-[10px] font-bold text-slate-600 px-2 whitespace-nowrap">{METRIC_LABEL[metric] || metric}</td>
                {vals.map((v, dow) => {
                  const step = v === 0 ? 0 : Math.min(HEAT_RAMP.length - 1, Math.ceil((v / rowMax) * (HEAT_RAMP.length - 1)));
                  return (
                    <td key={dow} className="p-0">
                      <div className="h-9 rounded-lg flex items-center justify-center transition-transform hover:scale-105"
                           style={{ backgroundColor: HEAT_RAMP[step] }}
                           title={`${METRIC_LABEL[metric] || metric} · ${DOW_LABELS[dow]} — ${nf(Math.round(v))} ${t('daily avg')}`}>
                        <span className={`text-[10px] font-black ${step >= 5 ? 'text-white' : 'text-slate-500'}`}>
                          {v === 0 ? '' : compact(Math.round(v))}
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex items-center gap-2 mt-4 px-2">
        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{t('Low')}</span>
        {HEAT_RAMP.map(c => <span key={c} className="w-6 h-2.5 rounded" style={{ backgroundColor: c }} />)}
        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{t('High')}</span>
        <span className="text-[9px] font-bold text-slate-400 ms-3">{t('Each row scaled to its own maximum')}</span>
      </div>
    </div>
  );
}

/** The table view — the accessible counterpart to every chart above. */
function LocationTable({ totals, branches }: { totals: Total[]; branches: { id: string; name: string }[] }) {
  const t = useT();
  const impKeys = IMPRESSION_METRICS.map(m => m.key);
  const actKeys = ACTION_METRICS.map(m => m.key);

  const rows = branches.map(b => {
    const mine = totals.filter(r => r.gmb_location_id === b.id);
    const imp = mine.filter(r => impKeys.includes(r.metric)).reduce((s, r) => s + Number(r.total || 0), 0);
    const act = mine.filter(r => actKeys.includes(r.metric)).reduce((s, r) => s + Number(r.total || 0), 0);
    return { ...b, imp, act, rate: imp > 0 ? (act / imp) * 100 : 0 };
  }).sort((a, b) => b.imp - a.imp);

  if (rows.length === 0) return <Empty label={t('No locations reporting yet')} />;

  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full min-w-[520px]">
        <thead>
          <tr className="border-b border-slate-100">
            <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-start">{t('Location')}</th>
            <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-end">{t('Impressions')}</th>
            <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-end">{t('Actions')}</th>
            <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-end">{t('Action Rate')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map(r => (
            <tr key={r.id} className="hover:bg-slate-50/50 transition-colors">
              <td className="px-4 py-4 text-[11px] font-black text-slate-900">{r.name}</td>
              <td className="px-4 py-4 text-[11px] font-bold text-slate-600 text-end">{nf(r.imp)}</td>
              <td className="px-4 py-4 text-[11px] font-bold text-slate-600 text-end">{nf(r.act)}</td>
              <td className="px-4 py-4 text-[11px] font-black text-slate-900 text-end">{r.rate.toFixed(2)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ────────────────────────── shell bits ────────────────────────── */

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-6 md:p-8 bg-white/70 backdrop-blur-xl rounded-3xl border border-white/40 shadow-[0_20px_50px_rgba(0,0,0,0.05)] relative overflow-hidden">
      {children}
    </div>
  );
}

function SectionHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <h3 className="text-lg font-black text-slate-900 tracking-tight">{title}</h3>
      <p className="text-xs font-medium text-slate-500 mt-0.5">{sub}</p>
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: accent }} />
        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{label}</span>
      </div>
      <div className="text-3xl font-black text-white tracking-tight">{value}</div>
      <div className="text-[10px] font-bold text-slate-500 mt-2">{sub}</div>
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {items.map(i => (
        <span key={i.label} className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="mt-6 py-14 text-center text-xs font-bold text-slate-300">{label}</div>;
}
