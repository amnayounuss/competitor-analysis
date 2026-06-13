'use client';
import { useState } from 'react';

interface Props { settings: any; reload: () => void; }

export default function GmbTab({ settings, reload }: Props) {
  const [clientId,     setClientId]     = useState(settings.gmb_oauth_client_id || '');
  const [clientSecret, setClientSecret] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg,    setMsg]    = useState<{type:'ok'|'err'; text:string} | null>(null);

  async function save() {
    setMsg(null); setSaving(true);
    const body: any = { gmb_oauth_client_id: clientId };
    if (clientSecret.trim()) body.gmb_oauth_client_secret = clientSecret.trim();
    if (anthropicKey.trim()) body.anthropic_api_key = anthropicKey.trim();
    const r = await fetch('/api/admin/settings', { method:'PATCH',
      headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    setSaving(false);
    if (!r.ok) { const j = await r.json(); setMsg({type:'err', text: typeof j.error === 'string' ? j.error : 'save failed'}); return; }
    setClientSecret('');
    setAnthropicKey('');
    setMsg({type:'ok', text:'Saved'});
    reload();
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Business Profile API</h2>
        <p className="text-sm text-slate-500 mt-1">Configure the Google Cloud project for local search data extraction.</p>
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

      <div className="grid gap-6">
        <Field label="Client ID">
          <input 
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all" 
            type="text" 
            value={clientId} 
            onChange={e => setClientId(e.target.value)}
            placeholder="xxxxx.apps.googleusercontent.com" 
          />
        </Field>

        <Field label="Client Secret" hint={settings.gmb_oauth_client_secret ? 'Secret is securely stored' : 'Not set yet'}>
          <input 
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all" 
            type="password" 
            value={clientSecret}
            onChange={e => setClientSecret(e.target.value)} 
            placeholder="••••••••••••" 
          />
        </Field>
      </div>

      <div className="border-t border-slate-100 pt-6 mt-2">
        <h3 className="text-lg font-bold text-slate-900 tracking-tight mb-4">AI Address Parser (Anthropic)</h3>
        <Field label="Anthropic API Key" hint={settings.anthropic_api_key ? 'Key is securely stored' : 'Not set — AI branch naming will be skipped'}>
          <input
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all"
            type="password"
            value={anthropicKey}
            onChange={e => setAnthropicKey(e.target.value)}
            placeholder="sk-ant-api03-••••••••"
          />
        </Field>
      </div>

      <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-6">
        <h3 className="font-bold text-indigo-900 text-sm mb-2 flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          Implementation Notes
        </h3>
        <p className="text-xs text-indigo-800/80 leading-relaxed">
          Required scope: <code className="bg-white/60 px-1.5 py-0.5 rounded text-indigo-900 font-bold">.../auth/business.manage</code>
        </p>
        <p className="text-xs text-indigo-800/80 mt-2 leading-relaxed italic">
          Clients will generate refresh tokens under this OAuth app. These tokens are then used in the job submission flow to authorize data retrieval.
        </p>
      </div>

      <div className="flex justify-end">
        <button 
          onClick={save} 
          disabled={saving}
          className="btn-primary shadow-xl shadow-indigo-600/20"
        >
          {saving ? 'Synchronizing…' : 'Update Project Settings'}
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
