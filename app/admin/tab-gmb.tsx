'use client';
import { useState } from 'react';

interface Props { settings: any; reload: () => void; }

export default function GmbTab({ settings, reload }: Props) {
  const [clientId,     setClientId]     = useState(settings.gmb_oauth_client_id || '');
  const [clientSecret, setClientSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg,    setMsg]    = useState<{type:'ok'|'err'; text:string} | null>(null);

  async function save() {
    setMsg(null); setSaving(true);
    const body: any = { gmb_oauth_client_id: clientId };
    if (clientSecret.trim()) body.gmb_oauth_client_secret = clientSecret.trim();
    const r = await fetch('/api/admin/settings', { method:'PATCH',
      headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    setSaving(false);
    if (!r.ok) { const j = await r.json(); setMsg({type:'err', text: typeof j.error === 'string' ? j.error : 'save failed'}); return; }
    setClientSecret('');
    setMsg({type:'ok', text:'Saved'});
    reload();
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Google Business Profile OAuth</h2>
        <p className="text-sm text-gray-500">
          Separate Google Cloud project for the Business Profile API.
        </p>
      </div>

      {msg && <div className={`${msg.type==='ok'?'bg-green-50 text-green-700':'bg-red-50 text-red-700'} text-sm rounded p-3`}>{msg.text}</div>}

      <Field label="Client ID">
        <input className="input font-mono" type="text" value={clientId} onChange={e => setClientId(e.target.value)}
          placeholder="xxxxx.apps.googleusercontent.com" />
      </Field>

      <Field label="Client Secret" hint={`Currently: ${settings.gmb_oauth_client_secret || '(not set)'} — leave blank to keep`}>
        <input className="input font-mono" type="password" value={clientSecret}
          onChange={e => setClientSecret(e.target.value)} placeholder="GOCSPX-..." />
      </Field>

      <div className="bg-blue-50 border border-blue-200 rounded p-4 text-sm">
        <p className="font-medium text-blue-900 mb-1">How clients use this</p>
        <p className="text-xs text-blue-800">
          Required scope: <code className="bg-white px-1">https://www.googleapis.com/auth/business.manage</code>
        </p>
        <p className="text-xs text-blue-800 mt-1">
          Each client generates a refresh token under THIS OAuth app and pastes it into their job submission form.
          You don't need to manage their tokens here.
        </p>
      </div>

      <button onClick={save} disabled={saving}
        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded px-4 py-2 font-medium">
        {saving ? 'Saving…' : 'Save changes'}
      </button>

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
