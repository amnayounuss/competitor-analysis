'use client';

/**
 * Google Business Profile performance.
 *
 * Two ways in: figures a full analysis already collected, and a refresh button
 * that pulls straight from Google for whatever dates you pick. The second exists
 * because checking last week should not mean re-running competitor research that
 * takes minutes.
 *
 * Charts are hand-rolled SVG, matching the rest of the dashboard. Copy is written
 * for someone who does not work with data — "how many people saw you", never
 * "impressions".
 *
 * Views and actions are never plotted on one pair of axes: views run in the tens
 * of thousands and actions in the hundreds, so a shared scale would flatten the
 * actions into the baseline.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BiInline, useT } from '@/lib/bilingual';
import { useLang } from '@/lib/lang-context';

interface MetricRow {
  metric: string;
  metric_date: string;
  value: number;
  gmb_location_id: string;
  branch_name: string | null;
  brand: string | null;
}

const isoDaysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const TODAY = () => new Date().toISOString().slice(0, 10);

const PRESETS = [
  { days: 7,   label: 'Last 7 days' },
  { days: 30,  label: 'Last 30 days' },
  { days: 90,  label: 'Last 3 months' },
  { days: 365, label: 'Last year' },
];

/** Where people saw the business. Validated categorical set (CVD ΔE ≥ 17). */
const SEEN_METRICS = [
  { key: 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',  label: 'Google Search, on a phone',    color: '#4F46E5' },
  { key: 'BUSINESS_IMPRESSIONS_MOBILE_MAPS',    label: 'Google Maps, on a phone',      color: '#0EA5E9' },
  { key: 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', label: 'Google Search, on a computer', color: '#10B981' },
  { key: 'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',   label: 'Google Maps, on a computer',   color: '#A855F7' },
];

/** What they did next. Ranked by size, so one hue is enough. */
const ACTION_METRICS = [
  { key: 'BUSINESS_DIRECTION_REQUESTS', label: 'Asked for directions' },
  { key: 'CALL_CLICKS',                 label: 'Tapped to call' },
  { key: 'WEBSITE_CLICKS',              label: 'Visited your website' },
  { key: 'BUSINESS_CONVERSATIONS',      label: 'Sent a message' },
  { key: 'BUSINESS_BOOKINGS',           label: 'Made a booking' },
  { key: 'BUSINESS_FOOD_ORDERS',        label: 'Ordered food' },
];

const LABEL: Record<string, string> = {
  ...Object.fromEntries(SEEN_METRICS.map(m => [m.key, m.label])),
  ...Object.fromEntries(ACTION_METRICS.map(m => [m.key, m.label])),
};

const HEAT = ['#EEF2FF', '#E0E7FF', '#C7D2FE', '#A5B4FC', '#818CF8', '#6366F1', '#4F46E5', '#4338CA'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const nf = (n: number) => n.toLocaleString();
const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(Math.round(n));

export default function PerformanceView({ canEdit }: { canEdit: boolean }) {
  const t = useT();

  const [rows, setRows]         = useState<MetricRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [syncing, setSyncing]   = useState(false);
  const [schemaReady, setReady] = useState(true);
  const [connected, setConnected] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const polling = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [branchFilter, setBranchFilter] = useState('all');
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo]     = useState(TODAY());

  const load = useCallback(async (f: string, t2: string) => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`/api/performance?from=${f}&to=${t2}`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not load the figures');
      setReady(j.schemaReady !== false);
      setRows(j.rows || []);
      setLastSynced(j.lastSyncedAt);
      setConnected(!!j.connected);
      return j;
    } catch (e: any) { setErr(e.message); return null; }
    finally { setLoading(false); }
  }, []);

  /**
   * Watch a background refresh until it finishes.
   *
   * The fetch from Google runs server-side and outlives this request, so the
   * page asks for progress rather than sitting on an open connection — which is
   * what used to fail with a network error on long syncs.
   */
  const watchSync = useCallback(async (f: string, t2: string) => {
    const j = await load(f, t2);
    const sync = j?.sync;

    if (sync?.running) {
      setSyncing(true);
      setProgress(sync.step ? t(sync.step.key).replace('{n}', nf(sync.step.n)) : null);
      polling.current = setTimeout(() => { void watchSync(f, t2); }, 2500);
      return;
    }

    setSyncing(false);
    setProgress(null);
    if (sync?.error) { setErr(sync.error); return; }
    if (sync?.result) {
      const r = sync.result;
      const missing = (r.unavailable || []).length;
      setMsg(`${t('Up to date')} — ${r.locations} ${t('branches')}, ${nf(r.rows)} ${t('daily figures')}`
        + (missing ? ` · ${missing} ${t('things your business type does not report')}` : ''));
    }
  }, [load, t]);

  useEffect(() => {
    void watchSync(from, to);
    return () => { if (polling.current) clearTimeout(polling.current); };
    // watchSync is stable per (load, t); re-running on date change is the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  async function refresh() {
    setErr(null); setMsg(null);
    setSyncing(true);
    setProgress(null);
    try {
      const r = await fetch('/api/performance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to }),
      });
      const j = await r.json();
      // 400/403 are rejections of the request itself; 202 means it is under way.
      if (!r.ok) throw new Error(j.error || 'Could not get the latest figures');
      if (j.alreadyRunning) setMsg(t('A refresh is already running — showing its progress'));
      if (polling.current) clearTimeout(polling.current);
      polling.current = setTimeout(() => { void watchSync(from, to); }, 1500);
    } catch (e: any) {
      setErr(e.message);
      setSyncing(false);
      setProgress(null);
    }
  }

  const branches = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) if (!m.has(r.gmb_location_id)) m.set(r.gmb_location_id, r.branch_name || r.gmb_location_id);
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const scoped = useMemo(
    () => branchFilter === 'all' ? rows : rows.filter(r => r.gmb_location_id === branchFilter),
    [rows, branchFilter]);

  const totalFor = useCallback((keys: string[]) =>
    scoped.filter(r => keys.includes(r.metric)).reduce((s, r) => s + Number(r.value || 0), 0), [scoped]);

  const seenTotal    = totalFor(SEEN_METRICS.map(m => m.key));
  const actionsTotal = totalFor(ACTION_METRICS.map(m => m.key));
  const actionRate   = seenTotal > 0 ? (actionsTotal / seenTotal) * 100 : 0;

  const seenSplit = SEEN_METRICS.map(m => ({ ...m, value: totalFor([m.key]) })).filter(m => m.value > 0);
  const actionBars = ACTION_METRICS.map(m => ({ ...m, value: totalFor([m.key]) }))
    .filter(m => m.value > 0).sort((a, b) => b.value - a.value);

  /** Daily totals for the trend, split into the two scales. */
  const daily = useMemo(() => {
    const seenKeys = SEEN_METRICS.map(m => m.key);
    const actKeys  = ACTION_METRICS.map(m => m.key);
    const byDay = new Map<string, { seen: number; actions: number }>();
    for (const r of scoped) {
      const e = byDay.get(r.metric_date) || { seen: 0, actions: 0 };
      if (seenKeys.includes(r.metric)) e.seen += Number(r.value || 0);
      if (actKeys.includes(r.metric))  e.actions += Number(r.value || 0);
      byDay.set(r.metric_date, e);
    }
    return Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, v]) => ({ day, ...v }));
  }, [scoped]);

  const heat = useMemo(() => {
    const acc = new Map<string, number[]>();
    for (const r of scoped) {
      const dow = new Date(r.metric_date + 'T00:00:00Z').getUTCDay();
      const arr = acc.get(r.metric) || new Array(7).fill(0);
      arr[dow] += Number(r.value || 0);
      acc.set(r.metric, arr);
    }
    return acc;
  }, [scoped]);

  const perBranch = useMemo(() => {
    const seenKeys = SEEN_METRICS.map(m => m.key);
    const actKeys  = ACTION_METRICS.map(m => m.key);
    const acc = new Map<string, { name: string; seen: number; actions: number }>();
    for (const r of rows) {
      const e = acc.get(r.gmb_location_id) || { name: r.branch_name || r.gmb_location_id, seen: 0, actions: 0 };
      if (seenKeys.includes(r.metric)) e.seen += Number(r.value || 0);
      if (actKeys.includes(r.metric))  e.actions += Number(r.value || 0);
      acc.set(r.gmb_location_id, e);
    }
    return Array.from(acc.entries())
      .map(([id, v]) => ({ id, ...v, rate: v.seen > 0 ? (v.actions / v.seen) * 100 : 0 }))
      .sort((a, b) => b.seen - a.seen);
  }, [rows]);

  return (
    <>
      {/* ── header ── */}
      <div className="relative overflow-hidden p-6 rounded-3xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border border-indigo-500/20 shadow-2xl">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(99,102,241,0.15),transparent_50%)]" />
        <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
              <span className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.25em]">
                <BiInline en="Found on Google" />
              </span>
            </div>
            <div className="text-xl font-black text-white tracking-tight">
              {nf(seenTotal)} {t('people saw your business')}
            </div>
            <div className="text-xs font-bold text-slate-400 mt-1">
              {lastSynced
                ? `${t('Last updated')} ${new Date(lastSynced).toLocaleString()}`
                : t('Not updated from Google yet')}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            {branches.length > 1 && (
              <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)}
                className="px-4 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-white text-xs font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500 max-w-[13rem]">
                <option value="all">{t('All branches')} ({branches.length})</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
            <div>
              <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">{t('From')}</label>
              <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}
                className="px-3 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-white text-xs font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">{t('To')}</label>
              <input type="date" value={to} min={from} max={TODAY()} onChange={e => setTo(e.target.value)}
                className="px-3 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-white text-xs font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            {canEdit && (
              <button onClick={refresh} disabled={syncing || !connected}
                title={connected ? '' : t('Connect your Google account first')}
                className="px-5 py-2.5 bg-indigo-600 text-white font-bold rounded-xl text-xs hover:bg-indigo-700 shadow-lg shadow-indigo-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95 whitespace-nowrap">
                {syncing ? t('Getting figures…') : t('Get latest from Google')}
              </button>
            )}
          </div>
        </div>

        <div className="relative flex flex-wrap gap-2 mt-4">
          {PRESETS.map(p => {
            const pf = isoDaysAgo(p.days);
            const on = from === pf && to === TODAY();
            return (
              <button key={p.label} onClick={() => { setFrom(pf); setTo(TODAY()); }}
                className={`px-3.5 py-1.5 rounded-lg text-[11px] font-bold transition-all active:scale-95 ${
                  on ? 'bg-indigo-600 text-white' : 'bg-slate-800/70 text-slate-300 hover:bg-slate-700'
                }`}>
                {t(p.label)}
              </button>
            );
          })}
        </div>
      </div>

      {syncing && (
        <div className="flex items-center gap-3 p-4 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-800 text-sm font-semibold">
          <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse shrink-0" />
          <span>
            {t('Getting figures from Google — this can take a couple of minutes. You can stay on this page.')}
            {progress ? <span className="font-bold"> · {progress}</span> : null}
          </span>
        </div>
      )}
      {err && <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-sm font-semibold">{err}</div>}
      {msg && <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-semibold">{msg}</div>}

      {!schemaReady && (
        <Card>
          <SectionHeader title={t('Not set up yet')} sub={t('Your database is missing the tables this page needs')} />
          <p className="mt-4 text-sm text-slate-600"><BiInline en="Re-run database setup from Connect Database to add them." /></p>
        </Card>
      )}

      {!loading && rows.length === 0 && schemaReady && (
        <Card>
          <div className="py-10 text-center">
            <p className="text-sm font-bold text-slate-600 mb-2">{t('Nothing here for these dates')}</p>
            <p className="text-xs text-slate-400 font-medium max-w-md mx-auto">
              {connected
                ? <BiInline en="Press Get latest from Google above and the figures for these dates will load." />
                : <BiInline en="Connect your Google Business Profile first, then press Get latest from Google." />}
            </p>
          </div>
        </Card>
      )}

      {/* ── the four numbers ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label={t('Saw your business')} value={nf(seenTotal)} sub={t('on Google Search and Maps')} accent="#4F46E5"
          definition={t('How many times your business appeared to someone on Google Search or Google Maps in this period.')} />
        <Stat label={t('Did something')} value={nf(actionsTotal)} sub={t('called, visited site, got directions')} accent="#10B981"
          definition={t('How many of those people then took an action: tapped to call, asked for directions, opened your website, messaged you, booked, or ordered.')} />
        <Stat label={t('Acted after seeing you')} value={`${actionRate.toFixed(1)} ${t('in 100')}`} sub={t('the rest just saw you and moved on')} accent="#A855F7"
          definition={t('Out of every 100 people who saw your business, this many did something about it. It is the actions above divided by the views above. Higher means your listing is persuading people, not just being shown to them.')} />
        <Stat label={t('Branches reporting')} value={String(branches.length)} sub={t('linked to your Google account')} accent="#0EA5E9"
          definition={t('Branches in your Google account that returned figures. Google reports nothing for a branch that is unverified or too new.')} />
      </div>

      {/* ── trend ── */}
      <Card>
        <SectionHeader title={t('Day by day')} sub={t('How many saw you, and how many acted')} />
        <TrendChart data={daily} />
      </Card>

      {/* ── where they saw you ── */}
      <Card>
        <SectionHeader title={t('Where people saw you')} sub={t('Search or Maps, phone or computer')} />
        <SeenSplit slices={seenSplit} total={seenTotal} />
      </Card>

      {/* ── what they did ── */}
      <Card>
        <SectionHeader title={t('What people did next')} sub={t('After they found you')} />
        <RankedBars rows={actionBars} />
      </Card>

      {/* ── weekday ── */}
      <Card>
        <SectionHeader title={t('Busiest days of the week')} sub={t('Darker means busier. Each row compares only against itself.')} />
        <Heatmap heat={heat} />
      </Card>

      {/* ── per branch ── */}
      <Card>
        <SectionHeader title={t('Branch by branch')} sub={t('All branches, whichever one is selected above')} />
        <BranchTable rows={perBranch} />
      </Card>

      {loading && <p className="text-xs font-bold text-slate-400 text-center py-4">{t('Loading…')}</p>}
    </>
  );
}

/* ────────────── charts ────────────── */

/** Two lines, two scales, drawn as two stacked panels rather than a dual axis. */
function TrendChart({ data }: { data: { day: string; seen: number; actions: number }[] }) {
  const t = useT();
  const [hover, setHover] = useState<number | null>(null);
  if (data.length === 0) return <Empty label={t('No days with figures in this range')} />;

  const W = 900, H = 220, PL = 46, PR = 16, PT = 14, PB = 28;
  const x = (i: number) => PL + (data.length === 1 ? (W - PL - PR) / 2 : (i / (data.length - 1)) * (W - PL - PR));

  const smooth = (pts: [number, number][]) => {
    if (pts.length < 2) return '';
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const T = 0.35;
      d += ` C${p1[0] + ((p2[0] - p0[0]) / 6) * T * 2},${p1[1] + ((p2[1] - p0[1]) / 6) * T * 2}` +
           ` ${p2[0] - ((p3[0] - p1[0]) / 6) * T * 2},${p2[1] - ((p3[1] - p1[1]) / 6) * T * 2}` +
           ` ${p2[0]},${p2[1]}`;
    }
    return d;
  };

  const panel = (key: 'seen' | 'actions', color: string, title: string) => {
    const max = Math.max(1, ...data.map(d => d[key]));
    const y = (v: number) => PT + (1 - v / max) * (H - PT - PB);
    const pts = data.map((d, i) => [x(i), y(d[key])] as [number, number]);
    const line = smooth(pts);
    const area = pts.length >= 2 ? `${line} L${pts[pts.length - 1][0]},${H - PB} L${pts[0][0]},${H - PB} Z` : null;
    const step = Math.max(1, Math.ceil(data.length / 8));

    return (
      <div className="mb-4 last:mb-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-[11px] font-bold text-slate-600">{title}</span>
          <span className="text-[10px] font-bold text-slate-400 ms-auto tabular-nums">{t('peak')} {nf(max)}</span>
        </div>
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[540px]" style={{ height: H }} onMouseLeave={() => setHover(null)}>
            {[0, max / 2, max].map((v, i) => (
              <g key={i}>
                <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="#eef2f7" strokeWidth={1} />
                <text x={PL - 8} y={y(v) + 4} textAnchor="end" fontSize={10} fontWeight={700} fill="#cbd5e1">{compact(v)}</text>
              </g>
            ))}
            {area && <path d={area} fill={color} fillOpacity={0.10} />}
            <path d={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            {hover != null && (
              <circle cx={x(hover)} cy={y(data[hover][key])} r={4.5} fill={color} stroke="#fff" strokeWidth={2.5} />
            )}
            {data.map((d, i) => i % step === 0 && (
              <text key={d.day} x={x(i)} y={H - 8} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="#94a3b8">{d.day.slice(5)}</text>
            ))}
            {data.map((d, i) => (
              <rect key={`h${d.day}`} x={x(i) - (W - PL - PR) / Math.max(data.length, 1) / 2} y={PT}
                width={Math.max(4, (W - PL - PR) / Math.max(data.length, 1))} height={H - PT - PB}
                fill="transparent" onMouseEnter={() => setHover(i)} />
            ))}
            {hover != null && <line x1={x(hover)} x2={x(hover)} y1={PT} y2={H - PB} stroke="#cbd5e1" strokeWidth={1} />}
          </svg>
        </div>
      </div>
    );
  };

  return (
    <div className="mt-6">
      {panel('seen', '#4F46E5', t('People who saw you'))}
      {panel('actions', '#10B981', t('People who did something'))}
      {hover != null && (
        <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1 px-4 py-3 rounded-2xl bg-slate-50 border border-slate-100 text-[11px] font-bold text-slate-600">
          <span className="text-slate-900">{data[hover].day}</span>
          <span>{t('Saw you')}: <span className="text-slate-900">{nf(data[hover].seen)}</span></span>
          <span>{t('Acted')}: <span className="text-slate-900">{nf(data[hover].actions)}</span></span>
        </div>
      )}
    </div>
  );
}

function SeenSplit({ slices, total }: { slices: { key: string; label: string; color: string; value: number }[]; total: number }) {
  const t = useT();
  const { isAr } = useLang();
  if (total === 0) return <Empty label={t('No figures yet for these dates')} />;

  const R = 76, r = 47, CX = 100, CY = 100;
  let angle = -Math.PI / 2;
  const arcs = slices.map(s => {
    const frac = s.value / total;
    const a0 = angle, a1 = angle + frac * Math.PI * 2;
    angle = a1;
    const pad = frac > 0.02 ? 0.014 : 0;
    const p0 = a0 + pad, p1 = a1 - pad;
    const large = p1 - p0 > Math.PI ? 1 : 0;
    const d = [
      `M${CX + R * Math.cos(p0)},${CY + R * Math.sin(p0)}`,
      `A${R},${R} 0 ${large} 1 ${CX + R * Math.cos(p1)},${CY + R * Math.sin(p1)}`,
      `L${CX + r * Math.cos(p1)},${CY + r * Math.sin(p1)}`,
      `A${r},${r} 0 ${large} 0 ${CX + r * Math.cos(p0)},${CY + r * Math.sin(p0)}`, 'Z',
    ].join(' ');
    return { ...s, d, pct: Number((frac * 100).toFixed(1)) };
  });

  return (
    <div className="mt-6 flex flex-col lg:flex-row lg:items-center gap-6 lg:gap-10">
      <svg viewBox="0 0 200 200" className="w-[168px] h-[168px] shrink-0 self-center" role="img">
        {arcs.map(a => (
          <path key={a.key} d={a.d} fill={a.color}><title>{`${t(a.label)} — ${nf(a.value)} (${a.pct}%)`}</title></path>
        ))}
        <text x={100} y={96} textAnchor="middle" fontSize={22} fontWeight={900} fill="#0f172a">{compact(total)}</text>
        {/* Letter-spacing pulls Arabic glyphs apart and breaks their joins, so it
            is applied only to the Latin label. */}
        <text x={100} y={114} textAnchor="middle" fontSize={8} fontWeight={800} fill="#94a3b8"
          letterSpacing={isAr ? 0 : 1.3}>{isAr ? t('Saw you') : 'SAW YOU'}</text>
      </svg>
      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {arcs.map(a => (
          <div key={a.key} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: a.color }} />
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider truncate">{t(a.label)}</span>
            </div>
            <div className="text-lg font-black text-slate-900 tabular-nums leading-none">{a.pct}%</div>
            <div className="text-[10px] font-bold text-slate-400 mt-1 tabular-nums">{nf(a.value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RankedBars({ rows }: { rows: { key: string; label: string; value: number }[] }) {
  const t = useT();
  if (rows.length === 0) return <Empty label={t('Nobody has acted in this period')} />;
  const max = Math.max(...rows.map(r => r.value));
  return (
    <div className="mt-6 space-y-3.5">
      {rows.map(r => (
        <div key={r.key}>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-[11px] font-bold text-slate-600">{t(r.label)}</span>
            <span className="text-[11px] font-black text-slate-900 tabular-nums">{nf(r.value)}</span>
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

function Heatmap({ heat }: { heat: Map<string, number[]> }) {
  const t = useT();
  const order = [...SEEN_METRICS.map(m => m.key), ...ACTION_METRICS.map(m => m.key)].filter(k => heat.has(k));
  if (order.length === 0) return <Empty label={t('No figures yet for these dates')} />;

  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full min-w-[560px] border-separate" style={{ borderSpacing: '3px' }}>
        <thead>
          <tr>
            <th className="text-start text-[9px] font-black text-slate-400 uppercase tracking-widest px-2">{t('What')}</th>
            {DAYS.map(d => <th key={d} className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{t(d)}</th>)}
          </tr>
        </thead>
        <tbody>
          {order.map(key => {
            const vals = heat.get(key) || new Array(7).fill(0);
            // Each row against its own peak: views run in the thousands and
            // actions in the tens, so one shared scale would leave every action
            // row the palest shade.
            const rowMax = Math.max(1, ...vals);
            return (
              <tr key={key}>
                <td className="text-[10px] font-bold text-slate-600 px-2 whitespace-nowrap">{t(LABEL[key] || key)}</td>
                {vals.map((v, i) => {
                  const step = v === 0 ? 0 : Math.min(HEAT.length - 1, Math.ceil((v / rowMax) * (HEAT.length - 1)));
                  return (
                    <td key={i} className="p-0">
                      <div className="h-9 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: HEAT[step] }}
                        title={`${t(LABEL[key] || key)} · ${DAYS[i]} — ${nf(Math.round(v))}`}>
                        <span className={`text-[10px] font-black ${step >= 5 ? 'text-white' : 'text-slate-500'}`}>
                          {v === 0 ? '' : compact(v)}
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
        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{t('Quiet')}</span>
        {HEAT.map(c => <span key={c} className="w-6 h-2.5 rounded" style={{ backgroundColor: c }} />)}
        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{t('Busy')}</span>
      </div>
    </div>
  );
}

function BranchTable({ rows }: { rows: { id: string; name: string; seen: number; actions: number; rate: number }[] }) {
  const t = useT();
  if (rows.length === 0) return <Empty label={t('No branches reporting yet')} />;
  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full min-w-[520px]">
        <thead>
          <tr className="border-b border-slate-100">
            <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-start">{t('Branch')}</th>
            <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-end">{t('Saw you')}</th>
            <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-end">{t('Acted')}</th>
            <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-end">{t('Per 100')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map(r => (
            <tr key={r.id} className="hover:bg-slate-50/50 transition-colors">
              <td className="px-4 py-4 text-[11px] font-black text-slate-900">{r.name}</td>
              <td className="px-4 py-4 text-[11px] font-bold text-slate-600 text-end tabular-nums">{nf(r.seen)}</td>
              <td className="px-4 py-4 text-[11px] font-bold text-slate-600 text-end tabular-nums">{nf(r.actions)}</td>
              <td className="px-4 py-4 text-[11px] font-black text-slate-900 text-end tabular-nums">{r.rate.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ────────────── shell ────────────── */

function Card({ children }: { children: React.ReactNode }) {
  return <div className="p-6 md:p-8 bg-white/70 backdrop-blur-xl rounded-3xl border border-white/40 shadow-[0_20px_50px_rgba(0,0,0,0.05)]">{children}</div>;
}
function SectionHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <h3 className="text-lg font-black text-slate-900 tracking-tight">{title}</h3>
      <p className="text-xs font-medium text-slate-500 mt-0.5">{sub}</p>
    </div>
  );
}
function Stat({ label, value, sub, accent, definition }: {
  label: string; value: string; sub: string; accent: string; definition?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: accent }} />
        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{label}</span>
      </div>
      <div className="text-3xl font-black text-white tracking-tight tabular-nums">{value}</div>
      <div className="text-[10px] font-bold text-slate-500 mt-2">{sub}</div>
      {/* On screen for whoever needs it, out of the way for whoever does not. */}
      {definition && (
        <>
          <button onClick={() => setOpen(o => !o)}
            className="mt-3 text-[9px] font-black uppercase tracking-widest text-indigo-400 hover:text-indigo-300 transition-colors">
            {open ? t('Hide meaning') : t('What is this?')}
          </button>
          {open && <p className="mt-2 text-[11px] font-medium text-slate-400 leading-relaxed">{definition}</p>}
        </>
      )}
    </div>
  );
}
function Empty({ label }: { label: string }) {
  return <div className="mt-6 py-14 text-center text-xs font-bold text-slate-300">{label}</div>;
}
