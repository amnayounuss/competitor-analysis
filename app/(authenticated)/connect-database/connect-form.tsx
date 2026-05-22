'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BiInline, useT } from '@/lib/bilingual';
import { useLang } from '@/lib/lang-context';

export default function ConnectDbForm({ existingUrl }: { existingUrl: string }) {
  const router = useRouter();
  const t = useT();
  const { isAr } = useLang();
  const [url, setUrl] = useState(existingUrl);
  const [key, setKey] = useState('');
  const [schemaConfirmed, setSchemaConfirmed] = useState(false);

  const [testing, setTesting] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [test, setTest] = useState<{ok: boolean; error?: string; schemaReady?: boolean} | null>(null);
  const [msg,  setMsg]  = useState<string | null>(null);

  async function runTest() {
    setMsg(null); setTest(null); setTesting(true);
    const r = await fetch('/api/client-db', {
      method: 'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ supabase_url: url.trim(), service_role_key: key.trim() }),
    });
    const j = await r.json();
    setTesting(false);
    setTest(j);
  }

  async function save() {
    setMsg(null); setSaving(true);
    const r = await fetch('/api/client-db', {
      method: 'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ supabase_url: url.trim(), service_role_key: key.trim() }),
    });
    setSaving(false);
    const j = await r.json();
    if (!r.ok) { setMsg(t('Save failed: ') + (j.error || 'unknown')); return; }
    
    // Use window.location.href to ensure a full refresh so middleware 
    // picks up the new 'last_test_ok' status immediately.
    setMsg(t('Success! Redirecting...'));
    setTimeout(() => {
      window.location.href = '/dashboard';
    }, 800);
  }

  const canTest = url.startsWith('https://') && key.length > 40;
  const canSave = test?.ok && test?.schemaReady && schemaConfirmed;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="space-y-6">
        <div className="space-y-1.5">
          <label className="block text-sm font-bold text-slate-700 tracking-tight ml-1"><BiInline en="Supabase URL" /></label>
          <input 
            type="text" 
            value={url} 
            onChange={e => setUrl(e.target.value)}
            placeholder="https://xxxxx.supabase.co"
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-mono outline-none focus:bg-white focus:border-indigo-500 transition-all placeholder:text-slate-300 shadow-sm" 
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-bold text-slate-700 tracking-tight ml-1"><BiInline en="Service Role Key" /></label>
          <div className="relative group">
            <input 
              type="password" 
              value={key} 
              onChange={e => setKey(e.target.value)}
              placeholder="eyJhbGc..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-mono outline-none focus:bg-white focus:border-indigo-500 transition-all placeholder:text-slate-300 shadow-sm" 
            />
          </div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">
            <BiInline en="Settings → API → 'service_role' (secret)" />
          </p>
        </div>

        <div 
          onClick={() => setSchemaConfirmed(!schemaConfirmed)}
          className={`group relative flex items-start gap-4 p-5 rounded-2xl border transition-all cursor-pointer select-none ${
            schemaConfirmed 
              ? 'bg-indigo-50/50 border-indigo-200 ring-1 ring-indigo-200' 
              : 'bg-white border-slate-100 hover:border-slate-200 hover:bg-slate-50'
          }`}
        >
          <div className={`mt-0.5 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${
            schemaConfirmed ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-slate-300'
          }`}>
            {schemaConfirmed && <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M5 13l4 4L19 7" /></svg>}
          </div>
          <div>
            <p className={`font-bold text-sm transition-colors ${schemaConfirmed ? 'text-indigo-900' : 'text-slate-700'}`}><BiInline en="Schema Verification" /></p>
            <p className="text-[11px] font-medium text-slate-400 mt-0.5 leading-relaxed">
              <BiInline en="I have executed the required SQL schema in my Supabase SQL editor to prepare the database." />
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-slate-50">
        <button 
          onClick={runTest} 
          disabled={!canTest || testing}
          className="btn-secondary flex-1 py-3 flex items-center justify-center gap-2 group disabled:opacity-50"
        >
          {testing ? (
            <svg className="animate-spin h-4 w-4 text-indigo-600" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
          ) : (
            <svg className="w-4 h-4 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          )}
          <span>{testing ? <BiInline en="Verifying..." /> : <BiInline en="Test Connection" />}</span>
        </button>
        
        <button 
          onClick={save} 
          disabled={!canSave || saving}
          className="btn-primary flex-1 py-3 shadow-xl shadow-indigo-600/20 flex items-center justify-center gap-2 group disabled:opacity-50"
        >
          {saving ? (
            <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
          ) : (
            <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
          )}
          <span>{saving ? <BiInline en="Initializing..." /> : <BiInline en="Save & Continue" />}</span>
        </button>
      </div>

      {test && (
        <div className={`rounded-2xl p-4 flex items-start gap-3 border animate-in zoom-in-95 duration-500 ${
          test.ok && test.schemaReady ? 'bg-emerald-50 border-emerald-100 text-emerald-800' :
          test.ok ? 'bg-amber-50 border-amber-100 text-amber-800' :
          'bg-rose-50 border-rose-100 text-rose-800'
        }`}>
          <div className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
            test.ok && test.schemaReady ? 'bg-emerald-500 text-white' :
            test.ok ? 'bg-amber-500 text-white' :
            'bg-rose-500 text-white'
          }`}>
            {test.ok && test.schemaReady ? (
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>
            ) : test.ok ? (
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            ) : (
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" /></svg>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-xs font-bold uppercase tracking-widest">
              {test.ok && test.schemaReady ? t('Verification Successful') : test.ok ? t('Schema Error') : t('Connection Failed')}
            </p>
            <p className="text-sm font-medium leading-relaxed opacity-90">
              {test.ok && test.schemaReady && t('Connection established and database schema is ready for use.')}
              {!test.schemaReady && test.error}
            </p>
          </div>
        </div>
      )}

      {msg && (
        <div className="bg-rose-50 border border-rose-100 text-rose-700 text-sm font-medium rounded-2xl p-4 flex items-center gap-3 animate-in shake duration-500">
          <div className="w-1.5 h-1.5 rounded-full bg-rose-500" />
          {msg}
        </div>
      )}
    </div>
  );
}
