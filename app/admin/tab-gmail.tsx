'use client';
import { useState } from 'react';

interface Props { settings: any; reload: () => void; }

export default function GmailTab({ settings, reload }: Props) {
  const [user,         setUser]         = useState(settings.gmail_user || '');
  const [fromName,     setFromName]     = useState(settings.gmail_from_name || '');
  const [clientId,     setClientId]     = useState(settings.gmail_oauth_client_id || '');
  const [clientSecret, setClientSecret] = useState('');
  const [refreshToken, setRefreshToken] = useState('');

  const [saving,  setSaving]  = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTo,  setTestTo]  = useState('');
  const [msg,     setMsg]     = useState<{type:'ok'|'err'; text:string} | null>(null);

  async function save() {
    setMsg(null); setSaving(true);
    const body: any = {
      gmail_user: user,
      gmail_from_name: fromName,
      gmail_oauth_client_id: clientId,
    };
    if (clientSecret.trim()) body.gmail_oauth_client_secret = clientSecret.trim();
    if (refreshToken.trim()) body.gmail_refresh_token = refreshToken.trim();

    const r = await fetch('/api/admin/settings', { method: 'PATCH',
      headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    setSaving(false);
    if (!r.ok) { const j = await r.json(); setMsg({type:'err', text: typeof j.error === 'string' ? j.error : 'save failed'}); return; }
    setClientSecret(''); setRefreshToken('');
    setMsg({type:'ok', text:'Saved'});
    reload();
  }

  async function sendTest() {
    if (!testTo) return;
    setMsg(null); setTesting(true);
    const r = await fetch('/api/admin/test-email', { method: 'POST',
      headers: {'Content-Type':'application/json'}, body: JSON.stringify({ to: testTo }) });
    setTesting(false);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) setMsg({type:'err', text: j.error || 'send failed'});
    else setMsg({type:'ok', text: `Test email sent to ${testTo}`});
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Gmail OAuth</h2>
        <p className="text-sm text-slate-500 mt-1">Configure the outbound mail server for automated report delivery.</p>
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
        <Field label="Gmail address">
          <input 
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all" 
            type="email" 
            value={user} 
            onChange={e => setUser(e.target.value)} 
          />
        </Field>

        <Field label="From display name">
          <input 
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all" 
            type="text" 
            value={fromName} 
            onChange={e => setFromName(e.target.value)} 
          />
        </Field>

        <Field label="OAuth Client ID">
          <input 
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all" 
            type="text" 
            value={clientId} 
            onChange={e => setClientId(e.target.value)}
            placeholder="xxxxx.apps.googleusercontent.com" 
          />
        </Field>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Field label="OAuth Client Secret" hint={settings.gmail_oauth_client_secret ? 'Secret is securely stored' : 'Not set yet'}>
            <input 
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all" 
              type="password" 
              value={clientSecret} 
              onChange={e => setClientSecret(e.target.value)}
              placeholder="••••••••••••" 
            />
          </Field>

          <Field label="Refresh Token" hint={settings.gmail_refresh_token ? 'Token is securely stored' : 'Not set yet'}>
            <input 
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all" 
              type="password" 
              value={refreshToken} 
              onChange={e => setRefreshToken(e.target.value)}
              placeholder="••••••••••••" 
            />
          </Field>
        </div>
      </div>

      <div className="flex items-center justify-between pt-4">
        <p className="text-xs text-slate-400">
          Obtain tokens from <a className="text-indigo-600 font-semibold hover:underline" target="_blank" rel="noreferrer" href="https://developers.google.com/oauthplayground">OAuth Playground</a>
        </p>
        <button 
          onClick={save} 
          disabled={saving}
          className="btn-primary shadow-xl shadow-indigo-600/20"
        >
          {saving ? 'Synchronizing…' : 'Save Configuration'}
        </button>
      </div>

      <div className="pt-10 border-t border-slate-100">
        <div className="mb-4">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-widest">Connectivity Test</h3>
          <p className="text-xs text-slate-400">Send a verification email to confirm settings.</p>
        </div>
        <div className="flex gap-3">
          <input 
            className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:bg-white focus:border-indigo-500 transition-all" 
            type="email" 
            value={testTo} 
            onChange={e => setTestTo(e.target.value)}
            placeholder="Recipient email address" 
          />
          <button 
            onClick={sendTest} 
            disabled={testing || !testTo}
            className="btn-secondary px-6"
          >
            {testing ? 'Sending…' : 'Run Test'}
          </button>
        </div>
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
