'use client';

/**
 * The advisor dashboard.
 *
 * Design rule, applied to every measure on the page: NUMBER -> MEANING ->
 * COMPARISON -> REASON -> ACTION. A figure on its own tells a manager nothing,
 * so nothing here appears without its target, the same figure last period, and a
 * status word. Charts carry the AI's reading of them directly underneath rather
 * than in an essay at the top, because the explanation is only useful next to
 * the thing it explains.
 *
 * Long tables are hidden behind "View all" — the top and bottom five are what
 * anyone acts on, and twenty-three rows of Arabic branch names is how the last
 * version lost people.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BiInline, useT } from '@/lib/bilingual';

/* ────────────── types mirrored from the API ────────────── */

type Status = 'good' | 'attention' | 'critical';

interface Kpi {
  key: string; label: string; definition: string; whyItMatters: string; source: string;
  value: number | null; unit: '' | '%' | 'h' | '★'; target: number;
  previous: number | null; change: number | null; lowerIsBetter: boolean; status: Status;
}
interface BranchRow {
  branchId: number | null; branchName: string; brand: string | null; city: string | null;
  storeName: string | null; address: string | null; mapsUrl: string | null;
  reviews: number; avgSentiment: number | null; avgRating: number | null; ratingScaled: number | null;
  replyRate: number; negativeShare: number | null; healthScore: number | null;
  trendDelta: number | null; topComplaint: string | null; status: Status; rankable: boolean;
}
interface TopicRow {
  topic: string; reviews: number; sharePct: number; previousReviews: number;
  changePct: number | null; negativeShare: number | null; severity: Status;
}
interface Facts {
  period: { from: string; to: string; days: number };
  previousPeriod: { from: string; to: string };
  granularity: 'day' | 'week' | 'month';
  coverage: { reviews: number; withText: number; scored: number; pending: number; noText: number; topicsClassified: number; topicsUnsorted: number };
  kpis: Kpi[];
  sentimentSplit: {
    positive: number; neutral: number; negative: number; scored: number;
    positivePct: number; neutralPct: number; negativePct: number; previousNegativePct: number | null;
  };
  ratings: { star: number; reviews: number; pct: number; previousPct: number | null }[];
  trend: { bucket: string; reviews: number; avgSentiment: number | null; negativeShare: number | null }[];
  branches: BranchRow[];
  topics: TopicRow[];
  response: {
    reviews: number; replied: number; unanswered: number; replyRate: number;
    avgReplyHours: number | null; negativeUnanswered: number;
  };
  benchmark: {
    current: number | null; target: number; previous: number | null; networkAverage: number | null;
    best: { name: string; value: number } | null; worst: { name: string; value: number } | null;
  };
  settings: {
    targets: { sentiment: number; replyRate: number; replyHours: number; negativeShare: number; rating: number };
    weights: { feeling: number; replyRate: number };
    customised: boolean;
  };
  goodNews: Finding[];
  problems: Finding[];
  suggestions: Suggestion[];
  starsVsWords: {
    feeling: number | null; starsScaled: number | null; gap: number | null;
    worst: { name: string; feeling: number; starsScaled: number; gap: number }[];
  };
}
interface Action {
  priority: 'critical' | 'high' | 'medium' | 'low';
  problem: string; evidence: string; branches: string[]; action: string; expectedImpact: string;
}
interface Finding {
  key: string;
  kind: 'onTarget' | 'offTarget' | 'improving' | 'starsGap' | 'branchesCritical';
  label: string;
  value: number | null;
  target: number | null;
  unit: string;
  change: number | null;
  lowerIsBetter: boolean;
}
interface Suggestion {
  key: 'reply' | 'unhappy' | 'topic' | 'branch';
  values: Record<string, string | number>;
  drill: 'unanswered' | 'unhappy' | 'topics' | 'branches' | null;
  priority: Status;
}

interface RunState {
  running: boolean; done: number; total: number;
  step: { key: string; n: number } | null; error: string | null;
}
interface Setup {
  connectedToGoogle: boolean;
  totalReviews: number;
  unscoredReviews: number;
  unsortedReviews: number;
  feelingRequests: number;
  subjectRequests: number;
  reviewRun: RunState | null;
  feelingRun: RunState | null;
}

interface Insights {
  headline: string;
  working: string[];
  attention: string[];
  charts: { trend: string; topics: string; branches: string };
  actions: Action[];
}

/* ────────────── small shared bits ────────────── */

const isoDaysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const TODAY = () => new Date().toISOString().slice(0, 10);
const PRESETS = [
  { days: 30,  label: 'Last 30 days' },
  { days: 90,  label: 'Last 3 months' },
  { days: 180, label: 'Last 6 months' },
  { days: 365, label: 'Last year' },
];

const nf = (n: number) => n.toLocaleString();
const fmt = (v: number | null, unit: string) =>
  v == null ? '—' : `${Number.isInteger(v) ? nf(v) : v.toFixed(1)}${unit === '%' ? '%' : unit === 'h' ? '' : ''}`;

const TONE: Record<Status, { bg: string; text: string; border: string; dot: string; label: string }> = {
  good:      { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: '#10B981', label: 'Good' },
  attention: { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200',   dot: '#F59E0B', label: 'Needs attention' },
  critical:  { bg: 'bg-rose-50',    text: 'text-rose-700',    border: 'border-rose-200',    dot: '#E11D48', label: 'Critical' },
};

const PRIORITY: Record<Action['priority'], { tone: Status; label: string }> = {
  critical: { tone: 'critical',  label: 'Critical' },
  high:     { tone: 'critical',  label: 'High' },
  medium:   { tone: 'attention', label: 'Medium' },
  low:      { tone: 'good',      label: 'Low' },
};

function StatusPill({ status }: { status: Status }) {
  const t = useT();
  const s = TONE[status];
  return (
    <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider border ${s.bg} ${s.text} ${s.border}`}>
      {t(s.label)}
    </span>
  );
}

/**
 * Direction of travel. The arrow follows whether the business improved, not
 * whether the number rose — for waiting time and unhappy customers, down is up.
 */
function Trend({ change, lowerIsBetter, unit = '' }: { change: number | null; lowerIsBetter?: boolean; unit?: string }) {
  const t = useT();
  if (change == null || Math.abs(change) < 0.05) {
    return <span className="text-[11px] font-bold text-slate-400">→ {t('no change')}</span>;
  }
  const better = lowerIsBetter ? change < 0 : change > 0;
  const arrow = change > 0 ? '↑' : '↓';
  const size = Math.abs(change);
  const amount = unit === '%' ? `${size.toFixed(1)}%`
    : unit === 'h' ? `${size < 10 ? size.toFixed(1) : Math.round(size)} ${t('hours')}`
    : unit === '★' ? `${size.toFixed(1)} ★`
    : size.toFixed(1);
  // A time measure improves by getting shorter, so "better" is the wrong word
  // for it — "115 hours faster" is what actually happened.
  const verdict = unit === 'h' ? (better ? 'faster' : 'slower') : (better ? 'better' : 'worse');
  return (
    <span className={`text-[11px] font-black tabular-nums ${better ? 'text-emerald-600' : 'text-rose-600'}`}>
      {arrow} {amount} {t(verdict)}
    </span>
  );
}

/** The AI's reading of the chart it sits under. */
function AiNote({ text }: { text: string | null | undefined }) {
  const t = useT();
  if (!text) {
    return (
      <p className="mt-5 pt-4 border-t border-slate-100 text-[12px] font-medium text-slate-400">
        <BiInline en="Press Ask the advisor at the top to have this explained." />
      </p>
    );
  }
  return (
    <div className="mt-5 pt-4 border-t border-slate-100">
      <div className="flex items-start gap-2.5">
        <span className="mt-1 px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-600 text-[9px] font-black uppercase tracking-widest shrink-0">
          {t('What this means')}
        </span>
        <p className="text-[13px] text-slate-700 leading-relaxed font-medium">{text}</p>
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="p-6 md:p-7 bg-white/75 backdrop-blur-xl rounded-3xl border border-white/50 shadow-[0_18px_45px_rgba(0,0,0,0.05)]">{children}</div>;
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <Card>
      <h3 className="text-lg font-black text-slate-900 tracking-tight">{title}</h3>
      {sub && <p className="text-xs font-medium text-slate-500 mt-0.5">{sub}</p>}
      {children}
    </Card>
  );
}

/* ────────────── the page ────────────── */

export default function AdvisorView({ canEdit }: { canEdit: boolean }) {
  const t = useT();

  const [facts, setFacts] = useState<Facts | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [brands, setBrands] = useState<string[]>([]);
  const [ai, setAi] = useState<{ configured: boolean; provider: string | null; model: string | null; usingOwnKey?: boolean }>(
    { configured: false, provider: null, model: null });
  const [unsorted, setUnsorted] = useState(0);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [topicRun, setTopicRun] = useState<{ running: boolean; classified: number; total: number; error: string | null } | null>(null);

  const [loading, setLoading] = useState(true);
  const [schemaReady, setSchemaReady] = useState(true);
  const [asking, setAsking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [askErr, setAskErr] = useState<string | null>(null);

  const [keyInput, setKeyInput] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [keyErr, setKeyErr] = useState<string | null>(null);
  const [keyOk, setKeyOk] = useState<string | null>(null);

  const [brand, setBrand] = useState('all');
  const [from, setFrom] = useState(isoDaysAgo(90));
  const [to, setTo] = useState(TODAY());
  const polling = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insightPoll = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [drill, setDrill] = useState<{ filter: 'unanswered' | 'unhappy' | 'topic'; topic?: string } | null>(null);

  const load = useCallback(async (f: string, t2: string, b: string) => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`/api/advisor?from=${f}&to=${t2}&brand=${encodeURIComponent(b)}`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not load your figures');
      setSchemaReady(j.schemaReady !== false);
      setFacts(j.facts);
      setBrands(j.brands || []);
      setAi(j.ai || { configured: false, provider: null, model: null });
      setUnsorted(j.unsortedReviews || 0);
      setSetup(j.setup || null);
      setTopicRun(j.topicRun);

      // A run started before this page load, or by another tab, is still ours
      // to display — but only if it was for the dates now on screen.
      const run = j.insightsRun;
      if (run && run.from === f && run.to === t2) {
        setAsking(!!run.running);
        if (run.insights) setInsights(run.insights);
        if (run.error) setAskErr(run.error);
      }
      return j;
    } catch (e: any) { setErr(e.message); return null; }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void load(from, to, brand);
    return () => {
      if (polling.current) clearTimeout(polling.current);
      if (insightPoll.current) clearTimeout(insightPoll.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, brand]);

  /** Sorting a corpus takes minutes, so the page watches it rather than waiting. */
  const watchTopics = useCallback(async () => {
    const j = await load(from, to, brand);
    const busy = j?.topicRun?.running
      || j?.setup?.reviewRun?.running
      || j?.setup?.feelingRun?.running;
    if (busy) {
      polling.current = setTimeout(() => { void watchTopics(); }, 4000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, from, to, brand]);

  /** Fire a background setup step, then watch it until it finishes. */
  const runStep = useCallback(async (action: 'fetch-reviews' | 'read-feeling' | 'classify') => {
    setErr(null);
    try {
      const r = await fetch('/api/advisor', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, brand, action }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not start that');
      if (polling.current) clearTimeout(polling.current);
      polling.current = setTimeout(() => { void watchTopics(); }, 3000);
    } catch (e: any) { setErr(e.message); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, brand, watchTopics]);

  async function startSorting() {
    setErr(null);
    try {
      const r = await fetch('/api/advisor', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, brand, action: 'classify' }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not start sorting the reviews');
      setTopicRun(j.topicRun);
      if (polling.current) clearTimeout(polling.current);
      polling.current = setTimeout(() => { void watchTopics(); }, 3000);
    } catch (e: any) { setErr(e.message); }
  }

  async function saveKey() {
    setSavingKey(true); setKeyErr(null); setKeyOk(null);
    try {
      const r = await fetch('/api/advisor', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai_api_key: keyInput.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not save the key');
      setKeyOk(`${t('Key verified')} — ${j.provider} · ${j.model}`);
      setKeyInput('');
      await load(from, to, brand);
    } catch (e: any) { setKeyErr(e.message); }
    finally { setSavingKey(false); }
  }

  /**
   * Watch a running advisory until it lands.
   *
   * The model call takes 40-50 seconds and runs server-side, so the page asks
   * for progress rather than sitting on an open connection — which is what used
   * to fail with a network error.
   */
  const watchInsights = useCallback(async (f: string, t2: string, b: string) => {
    try {
      const r = await fetch(`/api/advisor?from=${f}&to=${t2}&brand=${encodeURIComponent(b)}`, { cache: 'no-store' });
      const j = await r.json();
      const run = j.insightsRun;

      if (run?.running) {
        setAsking(true);
        insightPoll.current = setTimeout(() => { void watchInsights(f, t2, b); }, 3000);
        return;
      }
      setAsking(false);
      if (run?.error) { setAskErr(run.error); return; }
      if (run?.insights) setInsights(run.insights);
    } catch {
      // A single failed poll is not a failed run; try once more.
      insightPoll.current = setTimeout(() => { void watchInsights(f, t2, b); }, 5000);
    }
  }, []);

  async function ask() {
    setAsking(true); setAskErr(null); setInsights(null);
    try {
      const r = await fetch('/api/advisor', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, brand, action: 'insights' }),
      });
      const j = await r.json();
      // 202 means it is under way; 400/409 are refusals of the request itself.
      if (!r.ok) throw new Error(j.error || 'Could not write the advice');
      if (insightPoll.current) clearTimeout(insightPoll.current);
      insightPoll.current = setTimeout(() => { void watchInsights(from, to, brand); }, 2000);
    } catch (e: any) {
      setAskErr(e.message);
      setAsking(false);
    }
  }

  const hasData = !!facts && facts.coverage.reviews > 0;
  const ranked = useMemo(() => (facts?.branches || []).filter(b => b.rankable), [facts]);

  return (
    <>
      {/* ── header: period, brand, and the one button that writes everything ── */}
      <div className="relative overflow-hidden p-6 rounded-3xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border border-indigo-500/20 shadow-2xl">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(99,102,241,0.15),transparent_50%)]" />
        <div className="relative flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
              <span className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.25em]">
                <BiInline en="Your business advisor" />
              </span>
            </div>
            <div className="text-xl font-black text-white tracking-tight">
              {hasData
                ? `${nf(facts!.coverage.reviews)} ${t('reviews')} · ${facts!.branches.length} ${t('branches')}`
                : t('No reviews in these dates')}
            </div>
            <div className="text-xs font-bold text-slate-400 mt-1">
              {t('Compared with')} {facts?.previousPeriod.from} → {facts?.previousPeriod.to}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-2 print:hidden">
            {brands.length > 1 && (
              <select value={brand} onChange={e => setBrand(e.target.value)}
                className="px-4 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-white text-xs font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500 max-w-[13rem]">
                <option value="all">{t('All brands')}</option>
                {brands.map(b => <option key={b} value={b}>{b}</option>)}
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
            <a
              href={`/api/advisor/export?from=${from}&to=${to}&brand=${encodeURIComponent(brand)}`}
              className={`px-4 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-white text-xs font-bold hover:bg-slate-700 transition-all active:scale-95 whitespace-nowrap ${hasData ? '' : 'pointer-events-none opacity-40'}`}>
              {t('Export to Excel')}
            </a>
            <button onClick={() => window.print()} disabled={!hasData}
              className="px-4 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-white text-xs font-bold hover:bg-slate-700 disabled:opacity-40 transition-all active:scale-95 whitespace-nowrap">
              {t('Save as PDF')}
            </button>
            {canEdit && (
              <button onClick={ask} disabled={asking || !hasData}
                className="px-5 py-2.5 bg-indigo-600 text-white font-bold rounded-xl text-xs hover:bg-indigo-700 shadow-lg shadow-indigo-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95 whitespace-nowrap">
                {asking ? t('Thinking…') : (insights ? t('Ask again') : t('Ask the advisor'))}
              </button>
            )}
          </div>
        </div>
        <div className="relative flex flex-wrap gap-2 mt-4 print:hidden">
          {PRESETS.map(p => {
            const pf = isoDaysAgo(p.days);
            const on = from === pf && to === TODAY();
            return (
              <button key={p.label} onClick={() => { setFrom(pf); setTo(TODAY()); }}
                className={`px-3.5 py-1.5 rounded-lg text-[11px] font-bold transition-all active:scale-95 ${
                  on ? 'bg-indigo-600 text-white' : 'bg-slate-800/70 text-slate-300 hover:bg-slate-700'}`}>
                {t(p.label)}
              </button>
            );
          })}
        </div>
      </div>

      {err && <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-sm font-semibold">{err}</div>}

      {!schemaReady && (
        <Section title={t('Not set up yet')} sub={t('Your database is missing the tables this page needs')}>
          <p className="mt-4 text-sm text-slate-600">
            <BiInline en="Re-run database setup from Connect Database to add them." />
          </p>
        </Section>
      )}

      {loading && !facts && (
        <Card><p className="py-10 text-center text-xs font-bold text-slate-400">{t('Loading…')}</p></Card>
      )}

      {!hasData && !loading && schemaReady && setup && (
        <SetupPanel
          setup={setup} coverage={null} canEdit={canEdit}
          topicRun={topicRun} onRun={runStep}
        />
      )}

      {hasData && (
        <>
          {setup && (
            <SetupPanel
              setup={setup} coverage={facts!.coverage} canEdit={canEdit}
              topicRun={topicRun} onRun={runStep}
            />
          )}

          {/* 1 — overall status: one short line, then the number, large */}
          <Status
            insights={insights} asking={asking} askErr={askErr}
            kpis={facts!.kpis} gap={facts!.starsVsWords}
          />

          {/* 2 — the four numbers that matter */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {['sentiment', 'negativeShare', 'replyRate', 'rating']
              .map(k => facts!.kpis.find(x => x.key === k))
              .filter((k): k is Kpi => !!k)
              .map(k => <KpiCard key={k.key} kpi={k} />)}
          </div>

          {/* 3 & 4 — good news beside problems, so the contrast is the message */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <FindingList kind="good" items={facts!.goodNews} extra={insights?.working ?? []} />
            <FindingList kind="bad" items={facts!.problems} extra={insights?.attention ?? []} />
          </div>

          {/* 5 — branches, brought up: this is where an owner acts */}
          <Section title={t('Branches needing attention')} sub={t('The five that need you most, worst first')}>
            <BranchTable rows={[...ranked].reverse().slice(0, 5)} all={ranked} mode="worst" />
            <AiNote text={insights?.charts.branches} />
          </Section>

          <Section title={t('Your best branches')} sub={t('What good looks like in your own business')}>
            <BranchTable rows={ranked.slice(0, 5)} all={ranked} mode="best" />
          </Section>

          {/* 6 — why is this happening */}
          <div id="advisor-complaints">
            <Section title={t('What customers complain about')} sub={t('The subjects behind the numbers above')}>
              <TopicDonut
                rows={facts!.topics} unsorted={unsorted} canEdit={canEdit}
                onSort={startSorting} running={!!topicRun?.running}
                onOpen={topic => setDrill({ filter: 'topic', topic })}
              />
              <AiNote text={insights?.charts.topics} />
            </Section>
          </div>

          {/* 7 — what to do next */}
          <NextSteps
            suggestions={facts!.suggestions}
            aiActions={insights?.actions ?? []}
            onDrill={setDrill}
          />

          {/* 8 — trend, last: it is context for everything above */}
          <Section title={t('Is it getting better or worse?')} sub={t('See how customer sentiment and review volume changed over time.')}>
            <TrendChart points={facts!.trend} />
            <AiNote text={insights?.charts.trend} />
          </Section>

          <div className="print:hidden">
            <ScoringCard
              settings={facts!.settings} canEdit={canEdit}
              onSaved={() => load(from, to, brand)}
              example={ranked[0] ?? null}
            />
          </div>
          <div className="print:hidden">
            <KeyCard
              ai={ai} canEdit={canEdit} keyInput={keyInput} setKeyInput={setKeyInput}
              saving={savingKey} onSave={saveKey} err={keyErr} ok={keyOk}
            />
          </div>

          {drill && (
            <ReviewDrawer
              filter={drill.filter} topic={drill.topic}
              from={from} to={to} brand={brand}
              onClose={() => setDrill(null)}
            />
          )}
        </>
      )}
    </>
  );
}

/* ────────────── 2. KPI cards ────────────── */

function KpiCard({ kpi }: { kpi: Kpi }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const s = TONE[kpi.status];
  const unitSuffix = kpi.unit === '%' ? '%' : kpi.unit === 'h' ? ` ${t('hours')}` : kpi.unit === '★' ? ' ★' : '';

  return (
    <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm">
      {/* Label wraps rather than truncating: "REVIEWS YOU A…" told nobody
          anything. */}
      <p className="text-[11px] font-black uppercase tracking-wider text-slate-500 leading-tight">{t(kpi.label)}</p>
      <p className="mt-2.5 text-3xl font-black text-slate-900 tabular-nums leading-none">
        {kpi.value == null ? '—' : (Number.isInteger(kpi.value) ? nf(kpi.value) : kpi.value.toFixed(1))}
        <span className="text-base font-bold text-slate-400">{kpi.key === 'sentiment' ? ' / 100' : unitSuffix}</span>
      </p>

      {/* A measure with no target does not get a fake one. Review volume used
          to show last period's count as a "target", and the advisor quoted it
          as one. */}
      <div className="mt-3 space-y-1">
        {kpi.target > 0 && (
          <p className="text-[11px] font-bold text-slate-500">
            {t('Target')}: <span className="text-slate-900 tabular-nums">{kpi.target}{unitSuffix}</span>
            {kpi.value != null && kpi.status !== 'good' && (
              <span className="text-slate-400">
                {' · '}{t(kpi.lowerIsBetter ? 'still above it' : 'still below it')}
              </span>
            )}
          </p>
        )}
        <div><Trend change={kpi.change} lowerIsBetter={kpi.lowerIsBetter} unit={kpi.unit} /></div>
      </div>

      <div className="mt-3"><StatusPill status={kpi.status} /></div>

      {/* Definition on demand: on screen for whoever needs it, out of the way
          for whoever does not. */}
      <button onClick={() => setOpen(o => !o)}
        className="mt-3 text-[10px] font-black uppercase tracking-widest text-indigo-500 hover:text-indigo-700 transition-colors">
        {open ? t('Hide') : t('What does this mean?')}
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-[12.5px] text-slate-700 font-medium leading-relaxed">{t(kpi.definition)}</p>
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">{t('Why it matters')}</p>
            <p className="text-[11.5px] text-slate-600 font-medium leading-relaxed">{t(kpi.whyItMatters)}</p>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">{t('How we work it out')}</p>
            <p className="text-[11.5px] text-slate-600 font-medium leading-relaxed">{kpi.source}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ────────────── 5. trend ────────────── */

function TrendChart({ points }: { points: Facts['trend'] }) {
  const t = useT();
  const [hover, setHover] = useState<number | null>(null);
  const usable = points.filter(p => p.avgSentiment != null);
  if (usable.length < 2) {
    return <p className="mt-6 py-10 text-center text-xs font-bold text-slate-300">{t('Not enough history to draw a trend')}</p>;
  }

  const W = 900, H = 240, PL = 42, PR = 16, PT = 16, PB = 30;
  const maxReviews = Math.max(1, ...usable.map(p => p.reviews));
  const x = (i: number) => PL + (i / (usable.length - 1)) * (W - PL - PR);
  const y = (v: number) => PT + (1 - v / 100) * (H - PT - PB);

  const pts = usable.map((p, i) => [x(i), y(p.avgSentiment!)] as [number, number]);
  let line = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const T = 0.35;
    line += ` C${p1[0] + ((p2[0] - p0[0]) / 6) * T * 2},${p1[1] + ((p2[1] - p0[1]) / 6) * T * 2}`
          + ` ${p2[0] - ((p3[0] - p1[0]) / 6) * T * 2},${p2[1] - ((p3[1] - p1[1]) / 6) * T * 2}`
          + ` ${p2[0]},${p2[1]}`;
  }
  const step = Math.max(1, Math.ceil(usable.length / 8));
  const barW = Math.max(3, (W - PL - PR) / usable.length * 0.5);

  return (
    <div className="mt-6">
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[560px]" style={{ height: H }}
          onMouseLeave={() => setHover(null)}>
          {[0, 25, 50, 75, 100].map(v => (
            <g key={v}>
              <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke={v === 75 ? '#c7d2fe' : '#eef2f7'}
                strokeWidth={1} strokeDasharray={v === 75 ? '4 4' : undefined} />
              <text x={PL - 8} y={y(v) + 4} textAnchor="end" fontSize={10} fontWeight={700} fill="#cbd5e1">{v}</text>
            </g>
          ))}
          {usable.map((p, i) => (
            <rect key={`b${p.bucket}`} x={x(i) - barW / 2} y={H - PB - (p.reviews / maxReviews) * (H - PT - PB) * 0.35}
              width={barW} height={(p.reviews / maxReviews) * (H - PT - PB) * 0.35}
              fill="#e0e7ff" rx={2} />
          ))}
          <path d={line} fill="none" stroke="#4F46E5" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          {hover != null && (
            <circle cx={x(hover)} cy={y(usable[hover].avgSentiment!)} r={4.5} fill="#4F46E5" stroke="#fff" strokeWidth={2.5} />
          )}
          {usable.map((p, i) => i % step === 0 && (
            <text key={`x${p.bucket}`} x={x(i)} y={H - 8} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="#94a3b8">
              {p.bucket.slice(5)}
            </text>
          ))}
          {usable.map((p, i) => (
            <rect key={`h${p.bucket}`} x={x(i) - (W - PL - PR) / usable.length / 2} y={PT}
              width={Math.max(4, (W - PL - PR) / usable.length)} height={H - PT - PB}
              fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] font-bold text-slate-500">
        <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-indigo-600 rounded" />{t('Customer sentiment, out of 100')}</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-2.5 bg-indigo-100 rounded-sm" />{t('How many reviews arrived')}</span>
        <span className="flex items-center gap-1.5">
          {/* letterSpacing is left off: it cuts the joins between Arabic glyphs */}
          <span className="w-3 border-t border-dashed border-indigo-300" />{t('Target')} 75
        </span>
        {hover != null && (
          <span className="ms-auto text-slate-900">
            {usable[hover].bucket} · {usable[hover].avgSentiment} · {nf(usable[hover].reviews)} {t('reviews')}
          </span>
        )}
      </div>
    </div>
  );
}

/* ────────────── 6 & 7. branches ────────────── */

function BranchTable({ rows, all, mode }: { rows: BranchRow[]; all: BranchRow[]; mode: 'best' | 'worst' }) {
  const t = useT();
  const [showAll, setShowAll] = useState(false);
  const list = showAll ? all : rows;

  if (all.length === 0) {
    return <p className="mt-6 py-10 text-center text-xs font-bold text-slate-300">{t('No branches with enough reviews to rank')}</p>;
  }

  return (
    <div className="mt-5">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="px-3 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest text-start">{t('Branch')}</th>
              <th className="px-3 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest text-end">{t('Health')}</th>
              <th className="px-3 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest text-end">{t('Feeling')}</th>
              <th className="px-3 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest text-end">{t('Stars')}</th>
              <th className="px-3 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest text-end">{t('Reviews')}</th>
              {mode === 'worst' && (
                <>
                  <th className="px-3 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest text-end">{t('Unhappy')}</th>
                  <th className="px-3 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest text-start">{t('Main complaint')}</th>
                </>
              )}
              <th className="px-3 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest text-end">{t('Moved')}</th>
              <th className="px-3 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest text-end">{t('Status')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.map((b, i) => (
              <tr key={`${b.branchId}-${i}`} className="hover:bg-slate-50/60 transition-colors">
                <td className="px-3 py-3.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-black text-slate-900">{b.branchName}</span>
                    {b.mapsUrl && (
                      <a href={b.mapsUrl} target="_blank" rel="noopener noreferrer"
                        title={t('Open this branch on Google Maps')}
                        className="shrink-0 text-slate-300 hover:text-indigo-600 transition-colors print:hidden">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round"
                            d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </a>
                    )}
                  </div>
                  {/* Branch name is the city, so several rows read alike. The
                      store and street are what tell them apart. */}
                  {(b.storeName || b.address) && (
                    <div className="text-[10px] font-bold text-slate-400 max-w-[15rem] truncate"
                      title={[b.storeName, b.address].filter(Boolean).join(' · ')}>
                      {[b.storeName, b.address].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </td>
                <td className="px-3 py-3.5 text-[12px] font-bold text-slate-600 text-end tabular-nums">{b.healthScore ?? '—'}</td>
                <td className="px-3 py-3.5 text-[12px] font-black text-slate-900 text-end tabular-nums">{b.avgSentiment ?? '—'}</td>
                <td className="px-3 py-3.5 text-[12px] font-bold text-slate-600 text-end tabular-nums">{b.avgRating?.toFixed(1) ?? '—'}</td>
                <td className="px-3 py-3.5 text-[12px] font-bold text-slate-600 text-end tabular-nums">{nf(b.reviews)}</td>
                {mode === 'worst' && (
                  <>
                    <td className="px-3 py-3.5 text-[12px] font-bold text-end tabular-nums text-rose-600">
                      {b.negativeShare == null ? '—' : `${b.negativeShare}%`}
                    </td>
                    <td className="px-3 py-3.5 text-[11px] font-bold text-slate-600 text-start">
                      {b.topComplaint ? t(b.topComplaint) : <span className="text-slate-300">{t('not sorted yet')}</span>}
                    </td>
                  </>
                )}
                <td className="px-3 py-3.5 text-end">
                  <Trend change={b.trendDelta} />
                </td>
                <td className="px-3 py-3.5 text-end"><StatusPill status={b.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {all.length > rows.length && (
        <button onClick={() => setShowAll(v => !v)}
          className="mt-4 px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-black uppercase tracking-widest hover:bg-slate-200 transition-colors">
          {showAll ? t('Show top 5 only') : `${t('View all')} (${all.length})`}
        </button>
      )}
    </div>
  );
}

/* ────────────── getting the data in ────────────── */

/**
 * The three steps that fill an empty dashboard.
 *
 * Shown as a checklist because they are ordered and each one gates the next:
 * no reviews means nothing to read, unread reviews means no feeling score, and
 * unsorted reviews means the complaints section stays blank. A client used to
 * see "this read covers 0%" with no way to act on it.
 *
 * Each AI step states its cost in requests before it runs. The reviews are read
 * once and the result is stored, so this is a one-off per review, not a charge
 * that repeats every time the page opens.
 */
function SetupPanel({ setup, coverage, canEdit, topicRun, onRun }: {
  setup: Setup;
  coverage: Facts['coverage'] | null;
  canEdit: boolean;
  topicRun: { running: boolean; classified: number; total: number; error: string | null } | null;
  onRun: (action: 'fetch-reviews' | 'read-feeling' | 'classify') => void;
}) {
  const t = useT();
  // Measured against reviews that contain words: a star-only review has nothing
  // to read, so counting it here would put a ceiling below 100% that no amount
  // of work could lift.
  const readablePct = coverage && coverage.withText > 0
    ? Math.round((coverage.scored / coverage.withText) * 100) : 100;

  const outstanding = setup.unscoredReviews > 0 || setup.unsortedReviews > 0 || !setup.connectedToGoogle;

  const steps = [
    {
      key: 'fetch-reviews' as const,
      n: 1,
      recurring: true,
      title: t('Sync reviews'),
      body: setup.totalReviews > 0
        ? `${nf(setup.totalReviews)} ${t('reviews stored. A sync asks Google only for what arrived after your newest one, branch by branch.')}`
        : t('Reads every review from every location on your Google account. Later syncs only fetch what is new.'),
      cost: t('No AI cost — this is a straight copy from Google.'),
      // Never "done": new reviews keep arriving, so this stays available.
      done: false,
      run: setup.reviewRun,
      cta: t('Sync reviews'),
      blocked: !setup.connectedToGoogle,
      blockedWhy: t('Connect your Google Business Profile first, under Competitors.'),
    },
    {
      key: 'read-feeling' as const,
      n: 2,
      recurring: false,
      title: t('Read them for feeling'),
      body: setup.unscoredReviews > 0
        ? `${nf(setup.unscoredReviews)} ${t('reviews have not been read yet.')}`
        : coverage && coverage.noText > 0
          ? `${t('Every review with words has been read.')} ${nf(coverage.noText)} ${t('are a star rating only, with nothing written to read.')}`
          : t('Every review has been read.'),
      cost: setup.unscoredReviews > 0
        ? `${t('About')} ${nf(setup.feelingRequests)} ${t('AI requests, once. Already-read reviews are never charged again.')}`
        : '',
      done: setup.unscoredReviews === 0 && setup.totalReviews > 0,
      run: setup.feelingRun,
      cta: t('Read my reviews'),
      blocked: setup.totalReviews === 0,
      blockedWhy: t('Bring in your reviews first.'),
    },
    {
      key: 'classify' as const,
      n: 3,
      recurring: false,
      title: t('Sort them by subject'),
      body: setup.unsortedReviews > 0
        ? `${nf(setup.unsortedReviews)} ${t('reviews have not been sorted yet. Until they are, the complaints section stays empty.')}`
        : t('Every review has been sorted.'),
      cost: setup.unsortedReviews > 0
        ? `${t('About')} ${nf(setup.subjectRequests)} ${t('AI requests, once. Already-sorted reviews are never charged again.')}`
        : '',
      done: setup.unsortedReviews === 0 && setup.totalReviews > 0,
      run: topicRun ? { running: topicRun.running, done: topicRun.classified, total: topicRun.total, step: null, error: topicRun.error } : null,
      cta: t('Sort my reviews'),
      blocked: setup.totalReviews === 0,
      blockedWhy: t('Bring in your reviews first.'),
    },
  ];

  return (
    <div className={`p-6 md:p-7 rounded-3xl bg-white border-2 ${
      outstanding ? 'border-amber-200 shadow-[0_18px_45px_rgba(245,158,11,0.08)]' : 'border-slate-200 shadow-sm'}`}>
      <div className="flex flex-wrap items-center gap-3 mb-1">
        <span className={`px-2.5 py-1 rounded-lg text-white text-[9px] font-black uppercase tracking-widest ${
          outstanding ? 'bg-amber-500' : 'bg-slate-400'}`}>
          {outstanding ? t('Set up') : t('Nothing is waiting')}
        </span>
        <h3 className="text-lg font-black text-slate-900 tracking-tight">
          {setup.totalReviews > 0 ? t('Your data') : t('Your dashboard is empty')}
        </h3>
      </div>
      <p className="text-xs font-medium text-slate-500 mb-5">
        <BiInline en="Everything below runs in the background and only ever touches what is new, so nothing is fetched or paid for twice." />
      </p>

      <div className="space-y-3">
        {steps.filter(st => st.recurring || !st.done || outstanding).map(st => (
          <div key={st.key}
            className={`p-4 rounded-2xl border ${st.done ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-slate-50/60'}`}>
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div className="flex gap-3 min-w-0">
                <span className={`shrink-0 w-6 h-6 rounded-lg text-[11px] font-black flex items-center justify-center tabular-nums ${
                  st.done ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-white'}`}>
                  {st.done ? '✓' : st.recurring ? '↻' : st.n}
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-black text-slate-900">{st.title}</p>
                  <p className="text-[11.5px] font-medium text-slate-600 mt-0.5">{st.body}</p>
                  {st.cost && <p className="text-[10.5px] font-bold text-slate-400 mt-1">{st.cost}</p>}
                  {st.run?.error && <p className="text-[11px] font-bold text-rose-600 mt-1.5">{st.run.error}</p>}
                  {st.blocked && !st.done && (
                    <p className="text-[11px] font-bold text-amber-700 mt-1.5">{st.blockedWhy}</p>
                  )}
                </div>
              </div>

              {canEdit && !st.done && (
                <button onClick={() => onRun(st.key)} disabled={st.blocked || !!st.run?.running}
                  className="shrink-0 px-4 py-2.5 bg-slate-900 text-white font-bold rounded-xl text-[11px] hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95 whitespace-nowrap">
                  {st.run?.running
                    ? (st.run.total > 0
                        ? `${t('Working…')} ${nf(st.run.done)}/${nf(st.run.total)}`
                        : t('Working…'))
                    : st.cta}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ────────────── chart helpers ────────────── */

/** Polar coordinate on a circle, with 0 at twelve o'clock. */
function polar(cx: number, cy: number, r: number, angle: number): [number, number] {
  const a = angle - Math.PI / 2;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

/** An annular sector — the building block of every radial chart here. */
function arcPath(cx: number, cy: number, rInner: number, rOuter: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = polar(cx, cy, rOuter, a0);
  const [x1, y1] = polar(cx, cy, rOuter, a1);
  const [x2, y2] = polar(cx, cy, rInner, a1);
  const [x3, y3] = polar(cx, cy, rInner, a0);
  return `M${x0},${y0} A${rOuter},${rOuter} 0 ${large} 1 ${x1},${y1} `
       + `L${x2},${y2} A${rInner},${rInner} 0 ${large} 0 ${x3},${y3} Z`;
}

/* ────────────── What customers complain about — donut ────────────── */

function TopicDonut({ rows, unsorted, canEdit, onSort, running, onOpen }: {
  rows: TopicRow[]; unsorted: number; canEdit: boolean; onSort: () => void; running: boolean;
  onOpen: (topic: string) => void;
}) {
  const t = useT();
  const [showAll, setShowAll] = useState(false);

  if (rows.length === 0) {
    return (
      <div className="mt-6 py-10 text-center">
        <p className="text-sm font-bold text-slate-600">{t('Reviews have not been sorted into subjects yet')}</p>
        <p className="mt-1.5 text-xs font-medium text-slate-400 max-w-md mx-auto">
          <BiInline en="Sorting reads every review once and files it under Food Quality, Service, Waiting Time and the rest. It runs in the background." />
        </p>
        {canEdit && unsorted > 0 && (
          <button onClick={onSort} disabled={running}
            className="mt-5 px-5 py-2.5 bg-slate-900 text-white font-bold rounded-xl text-xs hover:bg-slate-800 disabled:opacity-50 transition-all active:scale-95">
            {running ? t('Sorting…') : t('Sort reviews by subject')}
          </button>
        )}
      </div>
    );
  }

  const comparable = unsorted === 0;
  const total = rows.reduce((s, r) => s + r.reviews, 0) || 1;
  const S = 240, C = S / 2, R = C - 12, r = R - 32;

  let angle = 0;
  const arcs = rows.map(row => {
    const frac = row.reviews / total;
    const a0 = angle, a1 = angle + frac * Math.PI * 2;
    angle = a1;
    const pad = frac > 0.02 ? 0.012 : 0;
    return { row, d: arcPath(C, C, r, R, a0 + pad, Math.max(a1 - pad, a0 + pad + 0.004)) };
  });

  const list = showAll ? rows : rows.slice(0, 5);

  return (
    <div className="mt-6">
      <div className="flex flex-col lg:flex-row lg:items-center gap-6 lg:gap-10">
        <svg viewBox={`0 0 ${S} ${S}`} className="w-[240px] h-[240px] shrink-0 self-center" role="img">
          {arcs.map(a => (
            <path key={a.row.topic} d={a.d} fill={TONE[a.row.severity].dot}>
              <title>{`${t(a.row.topic)} — ${nf(a.row.reviews)} (${a.row.sharePct}%)`}</title>
            </path>
          ))}
          <text x={C} y={C - 4} textAnchor="middle" fontSize={22} fontWeight={900} fill="#0f172a">{nf(total)}</text>
          <text x={C} y={C + 14} textAnchor="middle" fontSize={9} fontWeight={800} fill="#94a3b8">{t('mentions')}</text>
        </svg>

        <div className="flex-1 space-y-2">
          {list.map(row => (
            <button key={row.topic} onClick={() => onOpen(row.topic)}
              className="w-full flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-100 hover:border-indigo-300 hover:bg-white transition-colors text-start">
              <span className="flex items-center gap-2 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: TONE[row.severity].dot }} />
                <span className="text-[12px] font-black text-slate-900 truncate">{t(row.topic)}</span>
              </span>
              <span className="text-[11px] font-bold text-slate-500 tabular-nums shrink-0">
                {row.sharePct}% · {row.negativeShare == null ? '—' : `${row.negativeShare}% ${t('complaints')}`}
                {comparable && row.changePct != null && Math.abs(row.changePct) >= 1 && (
                  <span className={`ms-2 font-black ${row.changePct > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                    {row.changePct > 0 ? '↑' : '↓'} {Math.abs(row.changePct)}%
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      </div>

      {!comparable && (
        <p className="mt-4 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <BiInline en="Comparison with last period appears once every review has been sorted." />
        </p>
      )}
      {rows.length > 5 && (
        <button onClick={() => setShowAll(v => !v)}
          className="mt-4 px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-black uppercase tracking-widest hover:bg-slate-200 transition-colors">
          {showAll ? t('Show top 5 only') : `${t('View all')} (${rows.length})`}
        </button>
      )}
    </div>
  );
}

/* ────────────── targets and the health formula ────────────── */

const TARGET_FIELDS = [
  { key: 'sentiment'     as const, label: 'How customers feel', unit: '', min: 1, max: 100, step: 1 },
  { key: 'rating'        as const, label: 'Star rating', unit: '★', min: 1, max: 5, step: 0.1 },
  { key: 'negativeShare' as const, label: 'Unhappy customers', unit: '%', min: 1, max: 100, step: 1 },
  { key: 'replyRate'     as const, label: 'Reviews you answered', unit: '%', min: 1, max: 100, step: 1 },
  { key: 'replyHours'    as const, label: 'Time to answer', unit: 'h', min: 1, max: 720, step: 1 },
];

const WEIGHT_FIELDS = [
  { key: 'feeling'   as const, label: 'How customers feel' },
  { key: 'replyRate' as const, label: 'Reviews you answered' },
];

/**
 * Whose targets these are, and how the health score is worked out.
 *
 * "Target 24 hours · Critical" told a client they were failing a standard with
 * no author and no arithmetic behind it. Both are theirs to set, and the formula
 * is written out so a score can be checked by hand rather than trusted.
 */
function ScoringCard({ settings, canEdit, onSaved, example }: {
  settings: Facts['settings'];
  canEdit: boolean;
  onSaved: () => void;
  /** A real branch, so the score can be followed rather than trusted. */
  example: BranchRow | null;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState(settings.targets);
  const [weights, setWeights] = useState(settings.weights);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setTargets(settings.targets); setWeights(settings.weights); }, [settings]);

  // Shown as a percentage of the whole, and normalised on save, so the numbers
  // the client types never have to add up to exactly 1.
  const weightSum = WEIGHT_FIELDS.reduce((s, f) => s + (Number(weights[f.key]) || 0), 0);
  const share = (v: number) => (weightSum > 0 ? Math.round((v / weightSum) * 100) : 0);

  async function save(reset = false) {
    setSaving(true); setErr(null); setMsg(null);
    try {
      const r = await fetch('/api/advisor', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reset ? { reset: true } : { targets, weights }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not save');
      setMsg(reset ? t('Back to the standard targets') : t('Saved. The scores above now use your numbers.'));
      onSaved();
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  }

  return (
    <Section title={t('Targets and how health is scored')} sub={t('These are yours to set. Nothing here is an industry standard.')}>
      <div className="mt-5 space-y-5">
        <div className={`p-4 rounded-2xl border ${settings.customised ? 'border-indigo-200 bg-indigo-50/60' : 'border-slate-200 bg-slate-50'}`}>
          <p className="text-[12px] font-bold text-slate-800">
            {settings.customised ? t('These targets are the ones you set.') : t('These are our starting targets — change any of them.')}
          </p>
        </div>

        {/* Written as a sentence and a bar rather than an equation.
            "health = 0.55 × feeling + 0.2 × answered%" is checkable but nobody
            outside a spreadsheet reads it; the worked example below does the
            same job without algebra. */}
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">{t('How health is worked out')}</p>
          <p className="text-[13.5px] font-bold text-slate-800 leading-relaxed">
            {t('Health is how customers feel')} ({share(weights.feeling)}%){' '}
            {t('plus how often you answer them')} ({share(weights.replyRate)}%). {t('That is all.')}
          </p>

          {/* The same four numbers as a single bar: what matters is their
              relative size, and a bar shows that without arithmetic. */}
          <div className="mt-4 flex h-7 rounded-xl overflow-hidden bg-slate-100">
            {WEIGHT_FIELDS.map((f, i) => {
              const pct = share(weights[f.key]);
              const colours = ['#4F46E5', '#0EA5E9'];
              return pct > 0 ? (
                <div key={f.key} className="flex items-center justify-center"
                  style={{ width: `${pct}%`, backgroundColor: colours[i] }} title={`${t(f.label)} — ${pct}%`}>
                  {pct >= 12 && <span className="text-[10px] font-black text-white tabular-nums">{pct}%</span>}
                </div>
              ) : null;
            })}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
            {WEIGHT_FIELDS.map((f, i) => {
              const colours = ['#4F46E5', '#0EA5E9'];
              return (
                <span key={f.key} className="flex items-center gap-1.5 text-[10.5px] font-bold text-slate-500">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colours[i] }} />
                  {t(f.label)}
                </span>
              );
            })}
          </div>

          {/* One real branch, worked through. This is what makes the score
              checkable without asking anyone to read an equation. */}
          {example && (
            <div className="mt-4 p-4 rounded-2xl bg-slate-50 border border-slate-100">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">{t('For example')}</p>
              <p className="text-[12.5px] font-bold text-slate-800">{example.branchName}</p>
              <ul className="mt-2 space-y-1">
                {[
                  { label: t('How customers feel'), v: example.avgSentiment, w: share(weights.feeling) },
                  { label: t('Reviews you answered'), v: example.replyRate, w: share(weights.replyRate) },
                ].map(x => (
                  <li key={x.label} className="text-[11.5px] font-medium text-slate-600 tabular-nums">
                    {x.label}: <span className="font-black text-slate-900">{x.v ?? '—'}</span>
                    <span className="text-slate-400"> · {t('counts for')} {x.w}%</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 text-[12.5px] font-black text-slate-900">
                {t('Health score')}: {example.healthScore ?? '—'}
              </p>
            </div>
          )}

          <p className="mt-3 text-[11px] font-medium text-slate-500 leading-relaxed">
            <BiInline en="Both parts are out of 100, so the score is too. A branch with no reviews read yet falls back to its stars, converted so 1 star is 0 and 5 stars is 100." />
          </p>
        </div>

        {canEdit && (
          <button onClick={() => setOpen(o => !o)}
            className="text-[10px] font-black uppercase tracking-widest text-indigo-500 hover:text-indigo-700 transition-colors">
            {open ? t('Close') : t('Change targets and weights')}
          </button>
        )}

        {open && canEdit && (
          <div className="space-y-6 pt-2">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">{t('Targets')}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {TARGET_FIELDS.map(f => (
                  <label key={f.key} className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-slate-50 border border-slate-100">
                    <span className="text-[11.5px] font-bold text-slate-700">{t(f.label)}</span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      <input type="number" value={targets[f.key]} min={f.min} max={f.max} step={f.step}
                        onChange={e => setTargets({ ...targets, [f.key]: Number(e.target.value) })}
                        className="w-20 px-2 py-1.5 rounded-lg border border-slate-200 text-[12px] font-bold text-end tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                      <span className="text-[11px] font-bold text-slate-400 w-10">
                        {f.unit === 'h' ? t('hours') : f.unit}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">{t('What health should weigh most')}</p>
              <p className="text-[11px] font-medium text-slate-500 mb-3">
                <BiInline en="Any numbers will do — they are turned into shares of the whole, so they need not add up to anything in particular." />
              </p>
              <div className="space-y-2.5">
                {WEIGHT_FIELDS.map(f => (
                  <div key={f.key} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-50 border border-slate-100">
                    <span className="text-[11.5px] font-bold text-slate-700 flex-1 min-w-0 truncate">{t(f.label)}</span>
                    <input type="range" min={0} max={1} step={0.05} value={weights[f.key]}
                      onChange={e => setWeights({ ...weights, [f.key]: Number(e.target.value) })}
                      className="w-32 sm:w-44 accent-indigo-600" />
                    <span className="text-[11px] font-black text-slate-900 tabular-nums w-10 text-end">{share(weights[f.key])}%</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button onClick={() => save(false)} disabled={saving}
                className="px-6 py-3 bg-slate-900 text-white font-bold rounded-xl text-sm hover:bg-slate-800 disabled:opacity-40 transition-all active:scale-95">
                {saving ? t('Saving…') : t('Save')}
              </button>
              <button onClick={() => save(true)} disabled={saving}
                className="px-6 py-3 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl text-sm hover:bg-slate-50 disabled:opacity-40 transition-all active:scale-95">
                {t('Back to standard')}
              </button>
            </div>
          </div>
        )}

        {err && <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-sm font-bold text-rose-800">{err}</div>}
        {msg && <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-sm font-bold text-emerald-800">{msg}</div>}
      </div>
    </Section>
  );
}

/* ────────────── the AI account ────────────── */

/**
 * Where a client puts their own key.
 *
 * There is no shared fallback key: a dead one reported someone else's billing
 * problem as if it were the client's, which cost a lot of time to diagnose.
 */
function KeyCard({ ai, canEdit, keyInput, setKeyInput, saving, onSave, err, ok }: {
  ai: { configured: boolean; provider: string | null; model: string | null; usingOwnKey?: boolean };
  canEdit: boolean; keyInput: string; setKeyInput: (v: string) => void;
  saving: boolean; onSave: () => void; err: string | null; ok: string | null;
}) {
  const t = useT();
  return (
    <Section title={t('Your AI account')} sub={t('The advisor runs on this. Claude or OpenAI, whichever key you paste.')}>
      <div className="mt-5">
        {ai.configured ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-[11px] font-black uppercase tracking-wider border border-emerald-200">
              {ai.provider}
            </span>
            <span className="text-xs text-slate-500 font-mono">{ai.model}</span>
            <span className={`px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider border ${
              ai.usingOwnKey ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
              {ai.usingOwnKey ? t('Your own key') : t('Shared account')}
            </span>
          </div>
        ) : (
          <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200">
            <p className="text-sm font-bold text-amber-800">{t('No AI key yet')}</p>
            <p className="mt-1 text-[12px] font-semibold text-amber-700">
              <BiInline en="Paste one below and the advisor starts working. Claude keys start sk-ant-, OpenAI keys start sk-." />
            </p>
          </div>
        )}

        {canEdit && (
          <div className="flex flex-col sm:flex-row gap-3 mt-4">
            <input type="password" value={keyInput} onChange={e => setKeyInput(e.target.value)}
              placeholder="sk-ant-… / sk-…"
              className="flex-1 px-4 py-3 rounded-xl border border-slate-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <button onClick={onSave} disabled={!keyInput.trim() || saving}
              className="px-6 py-3 bg-slate-900 text-white font-bold rounded-xl text-sm hover:bg-slate-800 disabled:opacity-40 transition-all active:scale-95">
              {saving ? t('Verifying…') : (ai.configured ? t('Replace key') : t('Save key'))}
            </button>
          </div>
        )}

        {/* The outcome belongs beside the input: reporting it at the top of a
            long page made a rejected key look like nothing happening. */}
        {err && <div className="mt-4 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-sm font-bold text-rose-800">{err}</div>}
        {ok && <div className="mt-4 p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-sm font-bold text-emerald-800">{ok}</div>}
      </div>
    </Section>
  );
}

/* ────────────── 1. overall status ────────────── */

/**
 * The five-second answer.
 *
 * A sentence and a number, not a sentence containing numbers. The previous
 * version read "How customers feel is 69.7, five points short of your 75
 * target, but you're moving the right way—sentiment rose 2.6 points since last
 * quarter", which nobody can take in at a glance. The verdict is one short
 * line; the figures sit beside it at a size you can read across a desk.
 *
 * The verdict is worked out here, so the page says something useful before
 * anyone presses Ask the advisor.
 */
function Status({ insights, asking, askErr, kpis, gap }: {
  insights: Insights | null;
  asking: boolean;
  askErr: string | null;
  kpis: Kpi[];
  gap: Facts['starsVsWords'];
}) {
  const t = useT();
  const main = kpis.find(k => k.key === 'sentiment');
  const gapValue = gap.gap ?? 0;

  const verdict = (() => {
    if (!main || main.value == null) return t('Not enough reviews read yet to judge.');
    const improving = main.change != null && main.change > 0.05;
    const falling = main.change != null && main.change < -0.05;
    if (main.status === 'good') {
      return improving
        ? t('Customers are happy, and getting happier.')
        : t('Customers are happy and holding steady.');
    }
    if (improving) return t('Customer sentiment is improving, but still below your target.');
    if (falling) return t('Customer sentiment is falling and is below your target.');
    return t('Customer sentiment is below your target.');
  })();

  const tone: Status = main?.status ?? 'attention';

  return (
    <div className="p-6 md:p-8 rounded-3xl bg-white border-2 border-indigo-100 shadow-[0_20px_50px_rgba(79,70,229,0.08)]">
      {askErr && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 mb-5">
          <p className="text-sm font-bold text-rose-800">{askErr}</p>
          <p className="mt-1 text-[11px] font-semibold text-rose-600">
            <BiInline en="If this is about the API key, scroll down to Your AI account and paste a working one." />
          </p>
        </div>
      )}

      <div className="flex flex-col lg:flex-row lg:items-center gap-6 lg:gap-10">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">
            {t('How are customers feeling?')}
          </p>
          <p className="text-xl md:text-2xl font-black text-slate-900 tracking-tight leading-snug">
            {verdict}
          </p>
          {insights?.headline && (
            <p className="mt-3 text-[13px] font-medium text-slate-600 leading-relaxed">{insights.headline}</p>
          )}
          {asking && (
            <div className="mt-3 flex items-center gap-3 text-[13px] font-bold text-indigo-700">
              <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse shrink-0" />
              <BiInline en="Reading your figures — this usually takes under a minute." />
            </div>
          )}
        </div>

        {/* The number, big, with its target and direction underneath. */}
        {main?.value != null && (
          <div className={`shrink-0 p-5 rounded-2xl border ${TONE[tone].border} ${TONE[tone].bg} min-w-[190px]`}>
            <div className="flex items-baseline gap-1.5">
              <span className="text-4xl font-black text-slate-900 tabular-nums leading-none">{main.value}</span>
              <span className="text-base font-bold text-slate-400">/ 100</span>
            </div>
            <p className="mt-2.5 text-[11px] font-bold text-slate-600">
              {t('Target')}: <span className="tabular-nums text-slate-900">{main.target}</span>
            </p>
            <div className="mt-1">
              <Trend change={main.change} lowerIsBetter={main.lowerIsBetter} unit={main.unit} />
            </div>
            <div className="mt-3"><StatusPill status={tone} /></div>
          </div>
        )}
      </div>

      {/* The one thing a star average cannot tell you, said without arithmetic. */}
      {gap.feeling != null && gap.starsScaled != null && gapValue >= 4 && (
        <div className="mt-5 flex gap-3 p-4 rounded-2xl bg-amber-50 border border-amber-200">
          <span className="text-base leading-none shrink-0">⚠</span>
          <p className="text-[12.5px] font-bold text-amber-900 leading-relaxed">
            <BiInline en="Your star rating looks good, but customer comments are less positive. Check the written feedback to understand the real customer experience." />
          </p>
        </div>
      )}
    </div>
  );
}

/* ────────────── 3 & 4. good news / needs attention ────────────── */

/**
 * Two lists, side by side.
 *
 * Separating them is the whole point: mixed into one paragraph, a reader has to
 * work out the sign of every sentence before they know whether to worry.
 * Findings come from the figures; anything the advisor added is appended, capped
 * so the AI cannot flood the list.
 */
function FindingList({ kind, items, extra }: {
  kind: 'good' | 'bad';
  items: Finding[];
  extra: string[];
}) {
  const t = useT();
  const good = kind === 'good';

  /**
   * Build the sentence in the reader's language.
   *
   * The server sends parts, not prose: a sentence assembled there never passes
   * through t(), and an Arabic page was showing "Customer Sentiment is 69.7,
   * below your target of 75." in English.
   */
  const say = (f: Finding): string => {
    const unit = f.unit === '%' ? '%' : f.unit === 'h' ? t('hours') : f.unit === '★' ? '★' : '';
    const num = (v: number | null) => (v == null ? '—' : Number.isInteger(v) ? nf(v) : v.toFixed(1));
    const val = `${num(f.value)}${unit ? (f.unit === 'h' ? ' ' + unit : unit) : ''}`;
    const tgt = `${num(f.target)}${unit ? (f.unit === 'h' ? ' ' + unit : unit) : ''}`;

    switch (f.kind) {
      case 'onTarget':
        return `${t(f.label)} — ${t('on target at')} ${val}.`;
      case 'offTarget':
        return `${t(f.label)} — ${val}, ${t(f.lowerIsBetter ? 'above your target of' : 'below your target of')} ${tgt}.`;
      case 'improving': {
        const size = f.unit === 'h' ? Math.round(f.change ?? 0) : Number((f.change ?? 0).toFixed(1));
        const verb = f.unit === 'h' ? t('faster') : t('better');
        return `${t(f.label)} — ${size}${f.unit === '%' ? '%' : f.unit === 'h' ? ' ' + t('hours') : ''} ${verb} ${t('than last period')}.`;
      }
      case 'starsGap':
        return `${t('Your stars look better than what customers write, by')} ${num(f.value)} ${t('points')}.`;
      case 'branchesCritical':
        return `${num(f.value)} ${t('branches need attention right now')}.`;
    }
  };

  const lines = [...items.map(say), ...extra].slice(0, 5);

  return (
    <div className={`p-6 rounded-3xl border-2 ${good ? 'bg-emerald-50/40 border-emerald-200' : 'bg-rose-50/40 border-rose-200'}`}>
      <div className="flex items-center gap-2 mb-4">
        <span className={`text-sm ${good ? 'text-emerald-600' : 'text-rose-600'}`}>{good ? '✓' : '⚠'}</span>
        <h3 className={`text-[11px] font-black uppercase tracking-[0.18em] ${good ? 'text-emerald-700' : 'text-rose-700'}`}>
          {t(good ? 'Good news' : 'Needs attention')}
        </h3>
      </div>
      {lines.length === 0 ? (
        <p className="text-[12.5px] font-medium text-slate-500">
          {t(good ? 'Nothing on target yet.' : 'Nothing needs your attention right now.')}
        </p>
      ) : (
        <ul className="space-y-3">
          {lines.map((line, i) => (
            <li key={i} className="flex gap-2.5">
              <span className={`shrink-0 text-[13px] font-black ${good ? 'text-emerald-600' : 'text-rose-600'}`}>
                {good ? '✓' : '⚠'}
              </span>
              <span className="text-[13px] font-medium text-slate-700 leading-relaxed">{line}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ────────────── 7. what to do next ────────────── */

function NextSteps({ suggestions, aiActions, onDrill }: {
  suggestions: Facts['suggestions'];
  aiActions: Action[];
  onDrill: (d: { filter: 'unanswered' | 'unhappy' | 'topic'; topic?: string }) => void;
}) {
  const t = useT();
  const DRILL_LABEL: Record<string, string> = {
    unanswered: 'View unanswered reviews',
    unhappy: 'View unhappy reviews',
    topics: 'See top complaints',
    branches: 'See the branches',
  };

  if (suggestions.length === 0 && aiActions.length === 0) {
    return (
      <Section title={t('What to do next')} sub={t('Everything is on target')}>
        <p className="mt-4 text-[13px] font-medium text-slate-500">
          <BiInline en="Nothing is off target, so there is nothing urgent to chase." />
        </p>
      </Section>
    );
  }

  return (
    <Section title={t('What to do next')} sub={t('Start at the top')}>
      <ol className="mt-5 space-y-3">
        {suggestions.map((sg, i) => {
          const tone = TONE[sg.priority];
          const v = sg.values;
          const title =
            sg.key === 'reply'   ? t('Answer the reviews still waiting')
          : sg.key === 'unhappy' ? t('Find out what is upsetting people')
          : sg.key === 'topic'   ? `${t('Fix the complaints about')} ${t(String(v.topic))}`
          :                        `${t('Visit')} ${v.branch}`;
          const detail =
            sg.key === 'reply'   ? `${nf(Number(v.waiting))} ${t('reviews have no reply yet, and')} ${nf(Number(v.unhappyWaiting))} ${t('of those are unhappy customers')}.`
          : sg.key === 'unhappy' ? `${v.share}% ${t('of the reviews we read sound unhappy, against your target of')} ${v.target}%.`
          : sg.key === 'topic'   ? `${nf(Number(v.mentions))} ${t('reviews mention it')}${v.complaintShare !== '' ? `, ${t('and')} ${v.complaintShare}% ${t('of those are complaints')}` : ''}.`
          :                        `${t('Its customers score')} ${v.feeling} ${t('out of 100')}${v.complaint ? `, ${t('mostly about')} ${t(String(v.complaint))}` : ''}.`;
          return (
            <li key={sg.key} className={`p-4 rounded-2xl border ${tone.border} ${tone.bg}`}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex gap-3 min-w-0">
                  <span className="shrink-0 w-6 h-6 rounded-lg bg-slate-900 text-white text-[11px] font-black flex items-center justify-center tabular-nums">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-black text-slate-900">{title}</p>
                    <p className="mt-0.5 text-[12px] font-medium text-slate-600 leading-relaxed">{detail}</p>
                  </div>
                </div>
                {sg.drill && (
                  <button
                    onClick={() => {
                      if (sg.drill === 'unanswered' || sg.drill === 'unhappy') onDrill({ filter: sg.drill });
                      else document.getElementById(sg.drill === 'topics' ? 'advisor-complaints' : 'advisor-complaints')
                        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    className="shrink-0 px-4 py-2.5 bg-white border border-slate-200 text-slate-800 font-bold rounded-xl text-[11px] hover:bg-slate-50 transition-all active:scale-95 whitespace-nowrap">
                    {t(DRILL_LABEL[sg.drill])}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {/* Anything the advisor thought of that the rules did not. */}
      {aiActions.length > 0 && (
        <div className="mt-5 pt-5 border-t border-slate-100 space-y-3">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{t('The advisor also suggests')}</p>
          {aiActions.map((a, i) => (
            <div key={i} className="flex gap-2.5">
              <span className="shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full bg-indigo-500" />
              <p className="text-[12.5px] font-medium text-slate-700 leading-relaxed">
                <span className="font-bold text-slate-900">{a.action}</span>
                {a.evidence ? ` — ${a.evidence}` : ''}
              </p>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

/* ────────────── the reviews behind a number ────────────── */

interface DrillReview {
  id: number; rating: number | null; text: string; publishedAt: string | null;
  answered: boolean; feeling: number | null; topics: string[];
  branch: string | null; store: string | null;
}

/**
 * The actual reviews behind an instruction.
 *
 * "31.9% of reviews still need a response" is a statistic; this is the list you
 * work through. Without it the action buttons would point at nothing, which is
 * worse than not having them.
 */
function ReviewDrawer({ filter, topic, from, to, brand, onClose }: {
  filter: 'unanswered' | 'unhappy' | 'topic';
  topic?: string;
  from: string; to: string; brand: string;
  onClose: () => void;
}) {
  const t = useT();
  const [rows, setRows] = useState<DrillReview[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const qs = new URLSearchParams({ from, to, filter, brand });
    if (topic) qs.set('topic', topic);
    fetch(`/api/advisor/reviews?${qs}`, { cache: 'no-store' })
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!alive) return;
        if (!ok) setErr(j.error || 'Could not load those reviews');
        else setRows(j.reviews || []);
      })
      .catch(() => alive && setErr('Could not load those reviews'));
    return () => { alive = false; };
  }, [filter, topic, from, to, brand]);

  const title = filter === 'unanswered' ? t('Reviews still waiting for a reply')
    : filter === 'unhappy' ? t('Unhappy customers')
    : `${t('Reviews about')} ${topic ? t(topic) : ''}`;

  // Escape closes it, because a panel with only a small × is a trap on a phone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6 print:hidden">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-3xl max-h-[85vh] bg-white rounded-t-3xl sm:rounded-3xl border border-slate-200 shadow-2xl flex flex-col">
        <div className="flex items-start justify-between gap-4 p-6 border-b border-slate-100">
          <div className="min-w-0">
            <h3 className="text-lg font-black text-slate-900 tracking-tight">{title}</h3>
            <p className="text-xs font-medium text-slate-500 mt-0.5">
              {rows == null ? t('Loading…') : `${rows.length} ${t('shown')} · ${from} → ${to}`}
            </p>
          </div>
          <button onClick={onClose}
            className="shrink-0 px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-black uppercase tracking-widest hover:bg-slate-200 transition-colors">
            {t('Close')}
          </button>
        </div>

        <div className="overflow-y-auto p-6 space-y-3">
          {err && <p className="text-sm font-bold text-rose-700">{err}</p>}
          {rows != null && rows.length === 0 && (
            <p className="py-8 text-center text-xs font-bold text-slate-400">{t('Nothing here — good news.')}</p>
          )}
          {(rows || []).map(r => (
            <div key={r.id} className="p-4 rounded-2xl border border-slate-100 bg-slate-50/60">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="text-[12px] font-black text-slate-900">{r.rating ?? '—'} ★</span>
                {r.feeling != null && (
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${
                    r.feeling <= 40 ? 'bg-rose-100 text-rose-700'
                    : r.feeling <= 60 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    {r.feeling}/100
                  </span>
                )}
                {!r.answered && (
                  <span className="px-2 py-0.5 rounded-md bg-slate-200 text-slate-700 text-[10px] font-black uppercase tracking-wider">
                    {t('No reply yet')}
                  </span>
                )}
                <span className="text-[10px] font-bold text-slate-400 ms-auto">
                  {[r.store, r.branch].filter(Boolean).join(' · ')}
                  {r.publishedAt ? ` · ${r.publishedAt.slice(0, 10)}` : ''}
                </span>
              </div>
              <p className="text-[12.5px] text-slate-700 font-medium leading-relaxed">{r.text}</p>
              {r.topics.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.topics.map(x => (
                    <span key={x} className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-[10px] font-bold text-slate-500">
                      {t(x)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
