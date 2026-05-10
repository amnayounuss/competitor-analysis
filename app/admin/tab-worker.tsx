'use client';
import { useState } from 'react';

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
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Worker & behavior</h2>
        <p className="text-sm text-gray-500">Tuning for the job runner and signup permissions.</p>
      </div>
      {msg && <div className={`${msg.type==='ok'?'bg-green-50 text-green-700':'bg-red-50 text-red-700'} text-sm rounded p-3`}>{msg.text}</div>}

      <Field label="Worker poll interval (ms)" hint="How often the worker checks for new jobs. 5000 = 5 seconds.">
        <input className="input" type="number" min={1000} max={60000} step={500}
          value={pollMs} onChange={e => setPollMs(parseInt(e.target.value, 10))} />
      </Field>

      <label className="flex items-center gap-3 p-3 border rounded cursor-pointer hover:bg-gray-50">
        <input type="checkbox" checked={headless} onChange={e => setHeadless(e.target.checked)} />
        <div>
          <div className="font-medium text-sm">Puppeteer headless mode</div>
          <div className="text-xs text-gray-500">Off = Chrome window opens (debugging only). Always on for production.</div>
        </div>
      </label>

      <label className="flex items-center gap-3 p-3 border rounded cursor-pointer hover:bg-gray-50">
        <input type="checkbox" checked={signup} onChange={e => setSignup(e.target.checked)} />
        <div>
          <div className="font-medium text-sm">Allow public signup</div>
          <div className="text-xs text-gray-500">Off = only admins can create users from the Users tab.</div>
        </div>
      </label>

      <button onClick={save} disabled={saving}
        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded px-4 py-2 font-medium">
        {saving ? 'Saving…' : 'Save changes'}
      </button>

      <div className="border-t pt-4 mt-4 text-xs text-gray-500">
        <p><b>Note:</b> The worker reads settings from the database every 30 seconds, so changes propagate quickly. For poll-interval changes to take effect, restart the worker process.</p>
      </div>

      <style jsx>{`
        .input { width:200px; border:1px solid #d1d5db; border-radius:6px; padding:8px 12px; font-size:14px; outline:none; }
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
