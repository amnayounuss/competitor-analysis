'use client';
import { useState } from 'react';
import { BiInline } from '@/lib/bilingual';

interface Props { settings: any; reload: () => void; }

export default function WorkerTab({ settings, reload }: Props) {
  const [pollMs,   setPollMs]   = useState(settings.worker_poll_ms);
  const [headless, setHeadless] = useState(settings.puppeteer_headless);
  const [signup,   setSignup]   = useState(settings.signup_allowed);
  const [saving,   setSaving]   = useState(false);
  const [msg,      setMsg]      = useState<{type:'ok'|'err'; text:string} | null>(null);

  async function save() {
    setMsg(null); setSaving(true);
    const r = await fetch('/api/admin/settings', { method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        worker_poll_ms: parseInt(String(pollMs), 10),
        puppeteer_headless: headless,
        signup_allowed: signup,
      }) });
    setSaving(false);
    if (!r.ok) { const j = await r.json(); setMsg({type:'err', text: typeof j.error === 'string' ? j.error : 'save failed'}); return; }
    setMsg({type:'ok', text:'Saved'});
    reload();
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight"><BiInline en="System behavior" /></h2>
        <p className="text-sm text-slate-500 mt-1"><BiInline en="Fine-tune the engine and platform-wide permissions." /></p>
      </div>

      {msg && (
        <div className={`text-sm font-medium rounded-xl p-4 flex items-center gap-3 border ${
          msg.type === 'ok' 
            ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
            : 'bg-rose-50 text-rose-700 border-rose-100'
        }`}>
          <div className={`w-2 h-2 rounded-full ${msg.type === 'ok' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
          {msg.text}
        </div>
      )}

      <div className="grid gap-8">
        <Field label="Engine polling frequency (ms)" hint="Determines how aggressively the runner checks for queued sessions.">
          <input 
            className="w-[200px] bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:bg-white focus:border-indigo-500 transition-all" 
            type="number" 
            min={1000} 
            max={60000} 
            step={500}
            value={pollMs} 
            onChange={e => setPollMs(parseInt(e.target.value, 10))} 
          />
        </Field>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div 
            onClick={() => setHeadless(!headless)}
            className={`group relative flex items-start gap-4 p-4 rounded-2xl border transition-all cursor-pointer select-none ${
              headless 
                ? 'bg-indigo-50/50 border-indigo-200 ring-1 ring-indigo-200' 
                : 'bg-white border-slate-100 hover:border-slate-200 hover:bg-slate-50'
            }`}
          >
            <div className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
              headless ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-slate-300'
            }`}>
              {headless && <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M5 13l4 4L19 7" /></svg>}
            </div>
            <div>
              <p className={`font-bold text-sm transition-colors ${headless ? 'text-indigo-900' : 'text-slate-700'}`}><BiInline en="Production Engine" /></p>
              <p className="text-[11px] font-medium text-slate-400 mt-0.5 leading-relaxed italic">
                Enable headless mode for high-performance scraping.
              </p>
            </div>
          </div>

          <div 
            onClick={() => setSignup(!signup)}
            className={`group relative flex items-start gap-4 p-4 rounded-2xl border transition-all cursor-pointer select-none ${
              signup 
                ? 'bg-indigo-50/50 border-indigo-200 ring-1 ring-indigo-200' 
                : 'bg-white border-slate-100 hover:border-slate-200 hover:bg-slate-50'
            }`}
          >
            <div className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
              signup ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-slate-300'
            }`}>
              {signup && <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M5 13l4 4L19 7" /></svg>}
            </div>
            <div>
              <p className={`font-bold text-sm transition-colors ${signup ? 'text-indigo-900' : 'text-slate-700'}`}><BiInline en="Public Registrations" /></p>
              <p className="text-[11px] font-medium text-slate-400 mt-0.5 leading-relaxed">
                Allow new users to create accounts without invitation.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between pt-6 border-t border-slate-50">
        <p className="text-xs text-slate-400 italic">
          <b><BiInline en="Note:" /></b> Changes propagate within 30s. Some parameters may require a runner restart.
        </p>
        <button 
          onClick={save} 
          disabled={saving}
          className="btn-primary shadow-xl shadow-indigo-600/20"
        >
          {saving ? 'Synchronizing…' : 'Apply System Changes'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-bold text-slate-700 tracking-tight">{label}</label>
      {children}
      {hint && <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">{hint}</p>}
    </div>
  );
}
