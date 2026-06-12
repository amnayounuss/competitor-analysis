'use client';
import { useState } from 'react';
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
  const [comps, setComps]       = useState('');
  const [location, setLocation] = useState('');
  const [token, setToken]       = useState('');
  const [email, setEmail]       = useState(defaultEmail);
  const [dateStart, setDateStart] = useState(isoDaysAgo(90));
  const [dateEnd, setDateEnd]     = useState(TODAY_ISO());
  const [scheduleMonthly, setScheduleMonthly] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string|null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const competitors = comps.split(',').map(s => s.trim()).filter(Boolean);

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
          refresh_token: token.trim(), email_to: email.trim(),
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
            refresh_token: token.trim(), email_to: email.trim(),
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
        <label className="block text-sm font-bold text-slate-700 tracking-tight ml-1"><BiInline en="Target / Brand name" /></label>
        <input 
          type="text" 
          required 
          value={target} 
          onChange={e=>setTarget(e.target.value)}
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all" 
          placeholder={t('e.g. your brand name')}
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-bold text-slate-700 tracking-tight ml-1"><BiInline en="Competitor names" /></label>
        <input
          type="text"
          required
          value={comps}
          onChange={e=>setComps(e.target.value)}
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all"
          placeholder={t('e.g. Patchi|باتشي, Bostani|بستاني')}
        />
        <p className="text-[11px] text-slate-400 font-medium ml-1"><BiInline en="Use | to add name variations (English, Arabic). e.g. Tawa|تاوة|حلويات تاوة" /></p>
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-bold text-slate-700 tracking-tight ml-1"><BiInline en="Search location" /></label>
        <input
          type="text"
          value={location}
          onChange={e=>setLocation(e.target.value)}
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all"
          placeholder={t('e.g. Saudi Arabia, Riyadh, Dubai UAE')}
        />
        <p className="text-[11px] text-slate-400 font-medium ml-1"><BiInline en="Narrows Google Maps search to this region. Leave empty for worldwide." /></p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between ml-1">
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
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider ml-1"><BiInline en="From" /></label>
            <input
              type="date"
              value={dateStart}
              max={dateEnd || TODAY_ISO()}
              onChange={e=>setDateStart(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider ml-1"><BiInline en="To" /></label>
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
        <label className="block text-sm font-bold text-slate-700 tracking-tight ml-1"><BiInline en="OAuth Refresh token" /></label>
        <input 
          type="password" 
          required 
          value={token} 
          onChange={e=>setToken(e.target.value)}
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all" 
          placeholder="1//0gK..." 
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-bold text-slate-700 tracking-tight ml-1"><BiInline en="Report destination" /></label>
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
