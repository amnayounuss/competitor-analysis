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
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Gmail OAuth (sender)</h2>
        <p className="text-sm text-gray-500">Account that sends report emails. Uses OAuth2 with refresh token.</p>
      </div>
      {msg && <div className={`${msg.type==='ok'?'bg-green-50 text-green-700':'bg-red-50 text-red-700'} text-sm rounded p-3`}>{msg.text}</div>}

      <Field label="Gmail address">
        <input className="input" type="email" value={user} onChange={e => setUser(e.target.value)} />
      </Field>

      <Field label="From display name">
        <input className="input" type="text" value={fromName} onChange={e => setFromName(e.target.value)} />
      </Field>

      <Field label="OAuth Client ID">
        <input className="input font-mono" type="text" value={clientId} onChange={e => setClientId(e.target.value)}
          placeholder="xxxxx.apps.googleusercontent.com" />
      </Field>

      <Field label="OAuth Client Secret" hint={`Currently: ${settings.gmail_oauth_client_secret || '(not set)'} — leave blank to keep`}>
        <input className="input font-mono" type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)}
          placeholder="GOCSPX-..." />
      </Field>

      <Field label="Refresh Token" hint={`Currently: ${settings.gmail_refresh_token || '(not set)'} — leave blank to keep`}>
        <input className="input font-mono" type="password" value={refreshToken} onChange={e => setRefreshToken(e.target.value)}
          placeholder="1//0gK..." />
        <p className="text-xs text-gray-500 mt-1">
          Get from <a className="underline text-blue-600" target="_blank" href="https://developers.google.com/oauthplayground">OAuth Playground</a> with scope <code className="bg-gray-100 px-1">https://mail.google.com</code>
        </p>
      </Field>

      <div className="flex gap-3">
        <button onClick={save} disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded px-4 py-2 font-medium">
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>

      <div className="border-t pt-5">
        <h3 className="font-medium text-sm mb-2">Send test email</h3>
        <div className="flex gap-2">
          <input className="input flex-1" type="email" value={testTo} onChange={e => setTestTo(e.target.value)}
            placeholder="[email protected]" />
          <button onClick={sendTest} disabled={testing || !testTo}
            className="border text-sm rounded px-4 py-2 hover:bg-gray-50 disabled:opacity-50">
            {testing ? 'Sending…' : 'Send test'}
          </button>
        </div>
      </div>

      <style jsx>{`
        .input { width:100%; border:1px solid #d1d5db; border-radius:6px; padding:8px 12px; font-size:14px; outline:none; }
        .input:focus { border-color:#3b82f6; box-shadow:0 0 0 2px rgba(59,130,246,.2); }
      `}</style>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  );
}
