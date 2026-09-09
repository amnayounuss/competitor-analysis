'use client';

/**
 * Competitor discovery — token, tuning, and the candidate list.
 *
 * Ranking is by co-location: how many of the client's own locations a brand sits
 * near. That is what separates a competitor from a neighbour, and it puts the
 * chains a client actually competes with at the top.
 *
 * It is not the whole story, though. A smaller rival whose branches do not
 * overlap the client's footprint scores low — Dopamine lands around rank 68 for
 * a 29-location burger chain even though its owner names it as the competitor.
 * So the list is searchable and sortable, and the client's confirm/reject is
 * always the final word.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bi, BiInline, useT } from '@/lib/bilingual';

interface Candidate {
  brand_key: string;
  brand_name: string;
  aliases: string[];
  co_location_count: number;
  branch_count: number;
  avg_rating: number | null;
  total_reviews: number;
  cities: string[];
  primary_type: string | null;
  same_category: boolean;
  nearest_distance_m: number | null;
  status: 'suggested' | 'confirmed' | 'rejected';
}

interface Settings { radiusM: number; maxPerLocation: number; minCoLocation: number; }
type SortKey = 'coloc' | 'reviews' | 'branches' | 'rating' | 'name';
type Filter = 'all' | 'suggested' | 'confirmed' | 'rejected';

const nf = (n: number) => n.toLocaleString();

export default function CompetitorsView({ canEdit }: { canEdit: boolean }) {
  const t = useT();

  const [loading, setLoading]   = useState(true);
  const [running, setRunning]   = useState(false);
  const [err, setErr]          = useState<string | null>(null);
  const [msg, setMsg]          = useState<string | null>(null);

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [hasToken, setHasToken]     = useState(false);
  const [schemaReady, setSchemaReady] = useState(true);
  const [lastRunAt, setLastRunAt]   = useState<string | null>(null);
  const [settings, setSettings]     = useState<Settings>({ radiusM: 5000, maxPerLocation: 20, minCoLocation: 2 });

  const [tokenInput, setTokenInput] = useState('');
  const [query, setQuery]           = useState('');
  const [sortBy, setSortBy]         = useState<SortKey>('coloc');
  const [filter, setFilter]         = useState<Filter>('all');
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/competitors', { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not load competitors');
      setCandidates(j.candidates || []);
      setHasToken(!!j.hasToken);
      setSchemaReady(j.schemaReady !== false);
      setSettings(j.settings);
      setLastRunAt(j.lastRunAt);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveSettings(patch: Partial<Settings> & { refresh_token?: string }) {
    setErr(null); setMsg(null);
    const r = await fetch('/api/competitors', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const j = await r.json();
    if (!r.ok) { setErr(typeof j.error === 'string' ? j.error : 'Could not save'); return false; }
    setMsg(t('Saved'));
    return true;
  }

  async function onSaveToken() {
    if (tokenInput.trim().length < 20) { setErr(t('That does not look like a refresh token.')); return; }
    if (await saveSettings({ refresh_token: tokenInput.trim() })) {
      setTokenInput('');
      setHasToken(true);
    }
  }

  async function runDiscovery() {
    setRunning(true); setErr(null); setMsg(null);
    try {
      const r = await fetch('/api/competitors/discover', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Discovery failed');
      setMsg(`${nf(j.candidatesFound)} ${t('candidates from')} ${j.ownLocationCount} ${t('of your locations')} · ${j.placesCalls} ${t('searches')}`);
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setRunning(false);
    }
  }

  async function decide(keys: string[], status: Candidate['status']) {
    setSavingKeys(prev => new Set([...prev, ...keys]));
    // Optimistic — the list is long and waiting on a round trip per row feels broken.
    setCandidates(prev => prev.map(c => keys.includes(c.brand_key) ? { ...c, status } : c));
    try {
      const r = await fetch('/api/competitors', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand_keys: keys, status }),
      });
      if (!r.ok) { const j = await r.json(); throw new Error(j.error || 'Could not save'); }
    } catch (e: any) {
      setErr(e.message);
      await load();   // put the truth back
    } finally {
      setSavingKeys(prev => { const n = new Set(prev); keys.forEach(k => n.delete(k)); return n; });
    }
  }

  const counts = useMemo(() => ({
    all: candidates.length,
    suggested: candidates.filter(c => c.status === 'suggested').length,
    confirmed: candidates.filter(c => c.status === 'confirmed').length,
    rejected:  candidates.filter(c => c.status === 'rejected').length,
  }), [candidates]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = candidates;
    if (filter !== 'all') list = list.filter(c => c.status === filter);
    if (q) list = list.filter(c =>
      c.brand_name.toLowerCase().includes(q) ||
      c.brand_key.includes(q) ||
      c.aliases.some(a => a.toLowerCase().includes(q)));
    const by: Record<SortKey, (a: Candidate, b: Candidate) => number> = {
      coloc:    (a, b) => b.co_location_count - a.co_location_count || b.total_reviews - a.total_reviews,
      reviews:  (a, b) => b.total_reviews - a.total_reviews,
      branches: (a, b) => b.branch_count - a.branch_count,
      rating:   (a, b) => (b.avg_rating ?? 0) - (a.avg_rating ?? 0),
      name:     (a, b) => a.brand_name.localeCompare(b.brand_name),
    };
    return [...list].sort(by[sortBy]);
  }, [candidates, query, filter, sortBy]);

  return (
    <>
      {/* ── header ── */}
      <div className="relative overflow-hidden p-6 rounded-3xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border border-indigo-500/20 shadow-2xl">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(99,102,241,0.15),transparent_50%)]" />
        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
              <span className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.25em]">
                <BiInline en="Competitor Discovery" />
              </span>
            </div>
            <div className="text-xl font-black text-white tracking-tight">
              {counts.confirmed > 0
                ? `${counts.confirmed} ${t('confirmed competitors')}`
                : t('Find who you compete with')}
            </div>
            <div className="text-xs font-bold text-slate-400 mt-1">
              {lastRunAt
                ? `${t('Last run')} ${new Date(lastRunAt).toLocaleString()}`
                : t('Not run yet')}
            </div>
          </div>
          {canEdit && hasToken && schemaReady && (
            <button
              onClick={runDiscovery}
              disabled={running}
              className="px-6 py-3.5 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 shadow-lg shadow-indigo-500/20 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed text-sm whitespace-nowrap"
            >
              {running ? t('Searching…') : (candidates.length ? t('Run again') : t('Start discovery'))}
            </button>
          )}
        </div>
      </div>

      {err && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-sm font-semibold">{err}</div>
      )}
      {msg && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-semibold">{msg}</div>
      )}

      {!schemaReady && (
        <Card>
          <SectionHeader title={t('Storage not ready')} sub={t('Your database is missing the competitor table')} />
          <p className="mt-4 text-sm text-slate-600">
            <BiInline en="Re-run database setup from Connect Database to add it." />
          </p>
        </Card>
      )}

      {/* ── token ── */}
      <Card>
        <SectionHeader
          title={t('Your Business Profile token')}
          sub={t('Discovery reads your locations through this, so it can search around each one')}
        />
        <div className="mt-5">
          {hasToken ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-[11px] font-black uppercase tracking-wider border border-emerald-200">
                <BiInline en="Token saved" />
              </span>
              <span className="text-xs text-slate-500 font-medium">
                <BiInline en="Stored securely. Paste a new one below to replace it." />
              </span>
            </div>
          ) : (
            <p className="text-sm text-slate-600 mb-4">
              <BiInline en="Paste the refresh token for the Google account that manages your locations. It needs the business.manage scope." />
            </p>
          )}
          {canEdit && (
            <div className="flex flex-col sm:flex-row gap-3 mt-4">
              <input
                type="password"
                value={tokenInput}
                onChange={e => setTokenInput(e.target.value)}
                placeholder="1//0..."
                className="flex-1 px-4 py-3 rounded-xl border border-slate-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                onClick={onSaveToken}
                disabled={!tokenInput.trim()}
                className="px-6 py-3 bg-slate-900 text-white font-bold rounded-xl text-sm hover:bg-slate-800 disabled:opacity-40 transition-all active:scale-95"
              >
                {hasToken ? t('Replace token') : t('Save token')}
              </button>
            </div>
          )}
        </div>
      </Card>

      {/* ── tuning ── */}
      {canEdit && (
        <Card>
          <SectionHeader
            title={t('How wide to search')}
            sub={t('5 km suits a dense city — raise it where your branches are far apart')}
          />
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-5">
            <Tune
              label={t('Search radius')} unit="m" value={settings.radiusM}
              min={500} max={50000} step={500}
              hint={t('Around each of your locations')}
              onChange={v => setSettings(s => ({ ...s, radiusM: v }))}
              onCommit={v => saveSettings({ radiusM: v })}
            />
            <Tune
              label={t('Results per location')} unit="" value={settings.maxPerLocation}
              min={5} max={60} step={5}
              hint={t('More means wider net, more API cost')}
              onChange={v => setSettings(s => ({ ...s, maxPerLocation: v }))}
              onCommit={v => saveSettings({ maxPerLocation: v })}
            />
            <Tune
              label={t('Minimum overlap')} unit="" value={settings.minCoLocation}
              min={1} max={50} step={1}
              hint={t('Must be near at least this many of your locations')}
              onChange={v => setSettings(s => ({ ...s, minCoLocation: v }))}
              onCommit={v => saveSettings({ minCoLocation: v })}
            />
          </div>
          <p className="mt-5 text-xs text-slate-500 font-medium leading-relaxed">
            <BiInline en="Minimum overlap is the setting that matters most. A brand beside many of your branches is competing with you; one beside a single branch is just next door. Lower it to 1 to see smaller rivals whose locations do not follow yours." />
          </p>
        </Card>
      )}

      {/* ── candidates ── */}
      {candidates.length > 0 && (
        <Card>
          <SectionHeader
            title={t('Candidates')}
            sub={t('Confirm the ones you actually compete with — only those appear when you start an analysis')}
          />

          <div className="mt-5 flex flex-col lg:flex-row gap-3 lg:items-center">
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('Search by name…')}
              className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <div className="flex flex-wrap gap-2">
              {(['all', 'suggested', 'confirmed', 'rejected'] as Filter[]).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3.5 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all ${
                    filter === f ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                >
                  {t(f)} {counts[f]}
                </button>
              ))}
            </div>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as SortKey)}
              className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="coloc">{t('Sort: overlap')}</option>
              <option value="reviews">{t('Sort: reviews')}</option>
              <option value="branches">{t('Sort: branches')}</option>
              <option value="rating">{t('Sort: rating')}</option>
              <option value="name">{t('Sort: name')}</option>
            </select>
          </div>

          <p className="mt-3 text-xs text-slate-400 font-semibold">
            {shown.length} {t('of')} {candidates.length} {t('shown')}
          </p>

          <div className="mt-4 space-y-2">
            {shown.map(c => (
              <Row
                key={c.brand_key}
                c={c}
                canEdit={canEdit}
                saving={savingKeys.has(c.brand_key)}
                onDecide={s => decide([c.brand_key], s)}
              />
            ))}
            {shown.length === 0 && (
              <div className="py-12 text-center text-xs font-bold text-slate-300">
                {t('Nothing matches that')}
              </div>
            )}
          </div>
        </Card>
      )}

      {!loading && candidates.length === 0 && hasToken && schemaReady && (
        <Card>
          <div className="py-10 text-center">
            <p className="text-sm font-bold text-slate-600 mb-2">{t('No candidates yet')}</p>
            <p className="text-xs text-slate-400 font-medium">
              <BiInline en="Run discovery and the platform will search around each of your locations." />
            </p>
          </div>
        </Card>
      )}
    </>
  );
}

/* ─────────────── pieces ─────────────── */

function Row({ c, canEdit, saving, onDecide }: {
  c: Candidate; canEdit: boolean; saving: boolean;
  onDecide: (s: Candidate['status']) => void;
}) {
  const t = useT();
  const tone =
    c.status === 'confirmed' ? 'border-emerald-200 bg-emerald-50/40'
    : c.status === 'rejected' ? 'border-slate-200 bg-slate-50/60 opacity-60'
    : 'border-slate-200 bg-white';

  return (
    <div className={`flex flex-col lg:flex-row lg:items-center gap-3 p-4 rounded-2xl border transition-all ${tone} ${saving ? 'animate-pulse' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-black text-slate-900 truncate">{c.brand_name}</span>
          {c.same_category ? (
            <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[9px] font-black uppercase tracking-wider border border-indigo-100">
              <BiInline en="same category" />
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-700 text-[9px] font-black uppercase tracking-wider border border-amber-100">
              <BiInline en="nearby category" />
            </span>
          )}
        </div>
        <div className="text-[11px] font-bold text-slate-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
          <span className="text-slate-900">
            {c.co_location_count} {t('of your locations')}
          </span>
          <span>{c.branch_count} {t('branches')}</span>
          <span>{nf(c.total_reviews)} {t('reviews')}</span>
          {c.avg_rating != null && <span>{c.avg_rating} ★</span>}
          {c.nearest_distance_m != null && <span>{t('nearest')} {c.nearest_distance_m}m</span>}
        </div>
        {c.cities.length > 0 && (
          <div className="text-[10px] text-slate-400 font-medium mt-1 truncate">{c.cities.join(' · ')}</div>
        )}
      </div>

      {canEdit && (
        <div className="flex gap-2 shrink-0">
          {c.status !== 'confirmed' && (
            <button onClick={() => onDecide('confirmed')}
              className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-[11px] font-black uppercase tracking-wider hover:bg-emerald-700 transition-all active:scale-95">
              {t('Competitor')}
            </button>
          )}
          {c.status !== 'rejected' && (
            <button onClick={() => onDecide('rejected')}
              className="px-4 py-2 rounded-xl bg-slate-200 text-slate-600 text-[11px] font-black uppercase tracking-wider hover:bg-slate-300 transition-all active:scale-95">
              {t('Not one')}
            </button>
          )}
          {c.status !== 'suggested' && (
            <button onClick={() => onDecide('suggested')}
              className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-400 text-[11px] font-black uppercase tracking-wider hover:text-slate-600 transition-all active:scale-95">
              {t('Undo')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Tune({ label, unit, value, min, max, step, hint, onChange, onCommit }: {
  label: string; unit: string; value: number; min: number; max: number; step: number;
  hint: string; onChange: (v: number) => void; onCommit: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</span>
        <span className="text-sm font-black text-slate-900 tabular-nums">
          {value.toLocaleString()}{unit}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        onMouseUp={e => onCommit(Number((e.target as HTMLInputElement).value))}
        onTouchEnd={e => onCommit(Number((e.target as HTMLInputElement).value))}
        onKeyUp={e => onCommit(Number((e.target as HTMLInputElement).value))}
        className="w-full accent-indigo-600"
      />
      <p className="text-[10px] text-slate-400 font-medium mt-1">{hint}</p>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-6 md:p-8 bg-white/70 backdrop-blur-xl rounded-3xl border border-white/40 shadow-[0_20px_50px_rgba(0,0,0,0.05)]">
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
