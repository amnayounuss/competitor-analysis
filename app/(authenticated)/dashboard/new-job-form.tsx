'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BiInline, useT } from '@/lib/bilingual';
import { useLang } from '@/lib/lang-context';

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
const TODAY_ISO = () => new Date().toISOString().slice(0, 10);

export default function NewJobForm({ defaultEmail }: { defaultEmail: string }) {
  const t = useT();
  const { isAr } = useLang();
  const router = useRouter();
  const [target, setTarget]     = useState('');
  const [prefilled, setPrefilled] = useState(false);
  const [comps, setComps]       = useState('');
  const [location, setLocation] = useState('');
  const [token, setToken]       = useState('');
  const [email, setEmail]       = useState(defaultEmail);
  const [dateStart, setDateStart] = useState(isoDaysAgo(90));
  const [dateEnd, setDateEnd]     = useState(TODAY_ISO());
  const [scheduleMonthly, setScheduleMonthly] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string|null>(null);

  /**
   * Competitors the client confirmed in the discovery module. Picking from this
   * list beats retyping "Brand|alias|alias" by hand — the aliases came from what
   * Google actually calls each brand, so the scraper matches far more reliably.
   * The free-text field stays, because a client sometimes knows a rival that
   * never turns up near their own branches.
   */
  const [confirmed, setConfirmed] = useState<{ brand_name: string; job_value: string; co_location_count: number; branch_count: number }[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loadingComps, setLoadingComps] = useState(true);

  /**
   * The brand, the token and the cities come from the account.
   *
   * They are properties of the business, not of this run, and retyping them
   * every time is where runs went wrong: a client typed "Shovel" for listings
   * written in Arabic and a location filter then discarded 28 of their 29
   * branches. Prefilled, still editable.
   */
  const [prefill, setPrefill] = useState<{
    brand: string | null; hasToken: boolean; lastLocation: string | null;
    cities: string[]; countryCodes: string[];
  } | null>(null);
  const [editToken, setEditToken] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/advisor/prefill', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (!alive || !j) return;
        setPrefill(j);
        // Only ever fills a blank field, so a half-typed form is never rewritten.
        setTarget(prev => prev || j.brand || '');
        setLocation(prev => prev || j.lastLocation || '');
        setPrefilled(true);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/competitors', { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled) return;
        const rows = (j.candidates || [])
          .filter((c: any) => c.status === 'confirmed')
          .map((c: any) => ({
            brand_name: c.brand_name,
            job_value: [c.brand_name, ...(c.aliases || []).filter((a: string) => a !== c.brand_name)].join('|'),
            co_location_count: c.co_location_count,
            branch_count: c.branch_count,
          }));
        setConfirmed(rows);
      } finally {
        if (!cancelled) setLoadingComps(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    // Picked competitors and hand-typed ones both count; dedup by brand name so
    // choosing one and then typing it does not submit it twice.
    const typed = comps.split(',').map(s => s.trim()).filter(Boolean);
    const seen = new Set<string>();
    const competitors = [...Array.from(picked), ...typed].filter(v => {
      const key = v.split('|')[0].trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // The picker replaced a `required` input, so guard here — the API rejects an
    // empty list and a raw 400 tells the client nothing useful.
    if (competitors.length === 0) {
      setErr('Pick at least one competitor, or type one in the field below.');
      return;
    }

    // Client-side date validation
    if (dateStart && dateEnd) {
      const s = new Date(dateStart);
      const en = new Date(dateEnd);
      const today = new Date(TODAY_ISO());
      if (s > en) { setErr(t('Start date must be before end date.')); return; }
      if (en > today) { setErr(t('End date cannot be in the future.')); return; }
      const months = (en.getFullYear() - s.getFullYear()) * 12 + (en.getMonth() - s.getMonth());
      if (months > 12) { setErr(t('Maximum range is 12 months.')); return; }
    }

    setSubmitting(true);
    try {
      // Always create a manual job
      const r = await fetch('/api/jobs', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          target_name: target.trim(), competitors,
          ...(token.trim() ? { refresh_token: token.trim() } : {}), email_to: email.trim(),
          search_location: location.trim() || undefined,
          date_start: dateStart || undefined,
          date_end: dateEnd || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : 'submit failed');

      // If toggle on, also create a recurring schedule
      if (scheduleMonthly) {
        await fetch('/api/schedules', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({
            enabled: true,
            target_name: target.trim(), competitors,
            ...(token.trim() ? { refresh_token: token.trim() } : {}), email_to: email.trim(),
            day_of_month: 1,
          }),
        });
      }
      router.push(`/jobs/${j.job.id}`);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6" dir={isAr ? 'rtl' : 'ltr'}>
      {err && (
        <div className="bg-rose-50 border border-rose-100 text-rose-700 text-sm font-medium rounded-xl p-4 flex items-center gap-3">
          <div className="w-1.5 h-1.5 rounded-full bg-rose-500" />
          {err}
        </div>
      )}

      <div className="space-y-1.5">
        <label className="block text-sm font-bold text-slate-700 tracking-tight ms-1"><BiInline en="Target / Brand name" /></label>
        <input 
          type="text" 
          required 
          value={target} 
          onChange={e=>setTarget(e.target.value)}
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all" 
          placeholder={t('e.g. your brand name')}
        />
        {prefill?.brand && target === prefill.brand && (
          <p className="text-[11px] font-medium text-slate-400 ms-1">
            <BiInline en="Taken from your Google listings — change it only if your brand is listed under a different name." />
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-bold text-slate-700 tracking-tight ms-1"><BiInline en="Competitors" /></label>

        {loadingComps ? (
          <div className="h-11 rounded-xl bg-slate-50 border border-slate-200 animate-pulse" />
        ) : confirmed.length > 0 ? (
          <>
            <div className="flex flex-wrap gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl">
              {confirmed.map(c => {
                const on = picked.has(c.job_value);
                return (
                  <button
                    key={c.job_value}
                    type="button"
                    onClick={() => setPicked(prev => {
                      const n = new Set(prev);
                      on ? n.delete(c.job_value) : n.add(c.job_value);
                      return n;
                    })}
                    title={`${c.co_location_count} of your locations · ${c.branch_count} branches`}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-95 ${
                      on ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:border-indigo-300'
                    }`}
                  >
                    {c.brand_name}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-400 font-medium ms-1">
              {picked.size > 0
                ? `${picked.size} ${t('selected')}`
                : <BiInline en="Tap the competitors to include in this analysis." />}
            </p>
          </>
        ) : (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
            <p className="text-[11px] font-bold text-amber-800">
              <BiInline en="No confirmed competitors yet." />{' '}
              <Link href="/dashboard/competitors" className="underline">
                <BiInline en="Discover them automatically" />
              </Link>
              {' '}<BiInline en="or type them below." />
            </p>
          </div>
        )}

        <input
          type="text"
          value={comps}
          onChange={e=>setComps(e.target.value)}
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all mt-2"
          placeholder={t('Or add more, comma separated — e.g. Patchi|باتشي')}
        />
        <p className="text-[11px] text-slate-400 font-medium ms-1"><BiInline en="Use | to add name variations (English, Arabic). e.g. Tawa|تاوة|حلويات تاوة" /></p>
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-bold text-slate-700 tracking-tight ms-1"><BiInline en="Search location" /></label>
        <input
          type="text"
          value={location}
          onChange={e=>setLocation(e.target.value)}
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all"
          placeholder={t('e.g. Saudi Arabia, Riyadh, Dubai UAE')}
          list="known-locations"
        />
        {/* Suggested from the branches this client actually has, so the box
            offers real places instead of inviting a guess. */}
        <datalist id="known-locations">
          {(prefill?.cities || []).map(c => <option key={c} value={c} />)}
          {(prefill?.countryCodes || []).includes('SA') && <option value="Saudi Arabia" />}
        </datalist>
        {(prefill?.cities?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5 ms-1">
            {prefill!.cities.slice(0, 6).map(c => (
              <button key={c} type="button" onClick={() => setLocation(c)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                  location === c ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {c}
              </button>
            ))}
            <button type="button" onClick={() => setLocation('')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                location === '' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {t('Everywhere')}
            </button>
          </div>
        )}
        <p className="text-[11px] text-slate-400 font-medium ms-1">
          <BiInline en="Only narrows the search for competitors. Your own branches are always included, wherever they are." />
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between ms-1">
          <label className="block text-sm font-bold text-slate-700 tracking-tight"><BiInline en="Analysis Window" /></label>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => { setDateStart(isoDaysAgo(30)); setDateEnd(TODAY_ISO()); }}
              className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md bg-slate-100 text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 transition">30d</button>
            <button type="button" onClick={() => { setDateStart(isoDaysAgo(90)); setDateEnd(TODAY_ISO()); }}
              className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md bg-slate-100 text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 transition">90d</button>
            <button type="button" onClick={() => { setDateStart(isoDaysAgo(180)); setDateEnd(TODAY_ISO()); }}
              className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md bg-slate-100 text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 transition">6mo</button>
            <button type="button" onClick={() => { setDateStart(isoDaysAgo(365)); setDateEnd(TODAY_ISO()); }}
              className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md bg-slate-100 text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 transition">1yr</button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider ms-1"><BiInline en="From" /></label>
            <input
              type="date"
              value={dateStart}
              max={dateEnd || TODAY_ISO()}
              onChange={e=>setDateStart(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider ms-1"><BiInline en="To" /></label>
            <input
              type="date"
              value={dateEnd}
              min={dateStart}
              max={TODAY_ISO()}
              onChange={e=>setDateEnd(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all"
            />
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-bold text-slate-700 tracking-tight ms-1"><BiInline en="OAuth Refresh token" /></label>
        {prefill?.hasToken && !editToken ? (
          <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl">
            <span className="text-[12px] font-bold text-emerald-800">
              <BiInline en="Your Google account is connected." />
            </span>
            <button type="button" onClick={() => setEditToken(true)}
              className="ms-auto text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-indigo-600 transition-colors">
              {t('Use a different token')}
            </button>
          </div>
        ) : (
          <input
            type="password"
            required={!prefill?.hasToken}
            value={token}
            onChange={e=>setToken(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all"
            placeholder="1//0gK..."
          />
        )}
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-bold text-slate-700 tracking-tight ms-1"><BiInline en="Report destination" /></label>
        <input 
          type="email" 
          required 
          value={email} 
          onChange={e=>setEmail(e.target.value)}
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all" 
          placeholder={t('email@example.com')}
        />
      </div>

      <div 
        onClick={() => setScheduleMonthly(!scheduleMonthly)}
        className={`group relative flex items-start gap-4 p-4 rounded-2xl border transition-all cursor-pointer select-none ${
          scheduleMonthly 
            ? 'bg-indigo-50/50 border-indigo-200 ring-1 ring-indigo-200' 
            : 'bg-white border-slate-100 hover:border-slate-200 hover:bg-slate-50'
        }`}
      >
        <div className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
          scheduleMonthly ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-slate-300'
        }`}>
          {scheduleMonthly && <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M5 13l4 4L19 7" /></svg>}
        </div>
        <div>
          <p className={`font-bold text-sm transition-colors ${scheduleMonthly ? 'text-indigo-900' : 'text-slate-700'}`}><BiInline en="Enable Monthly Recurrence" /></p>
          <p className="text-[11px] font-medium text-slate-400 mt-0.5 leading-relaxed">
            <BiInline en="Automatically generate a fresh analysis on the 1st of every month." />
          </p>
        </div>
      </div>

      <button 
        type="submit" 
        disabled={submitting}
        className="w-full btn-primary py-3 shadow-lg shadow-indigo-600/10"
      >
        {submitting ? <BiInline en="Initializing Process…" /> : <BiInline en="Start Intelligent Analysis" />}
      </button>
    </form>
  );
}
