'use client';
import { useState } from 'react';

export default function SmtpTab({ settings, reload }: { settings: any, reload: () => void }) {
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{type:'ok'|'err', text:string}|null>(null);

  // Form state
  const [host, setHost]   = useState(settings?.smtp_host || '');
  const [port, setPort]   = useState(settings?.smtp_port || 587);
  const [user, setUser]   = useState(settings?.smtp_user || '');
  const [pass, setPass]   = useState(settings?.smtp_pass || '');
  const [secure, setSecure] = useState(settings?.smtp_secure || false);
  const [fromName, setFromName] = useState(settings?.smtp_from_name || 'Reports');
  const [fromEmail, setFromEmail] = useState(settings?.smtp_from_email || '');

  async function save() {
    setSaving(true); setMsg(null);
    const r = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        smtp_host: host,
        smtp_port: parseInt(port.toString(), 10),
        smtp_user: user,
        smtp_pass: pass,
        smtp_secure: secure,
        smtp_from_name: fromName,
        smtp_from_email: fromEmail
      }),
    });
    setSaving(false);
    if (!r.ok) { setMsg({type:'err', text:'Failed to save SMTP settings'}); return; }
    setMsg({type:'ok', text:'SMTP settings updated successfully'});
    reload();
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-black text-slate-900 tracking-tight">Email Configuration</h2>
        <p className="text-sm text-slate-500 mt-1">Configure SMTP settings to send analysis reports to clients.</p>
      </div>

      {msg && (
        <div className={`p-4 rounded-xl text-sm font-bold border animate-in fade-in slide-in-from-top-2 ${
          msg.type === 'ok' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-rose-50 text-rose-700 border-rose-100'
        }`}>
          {msg.text}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="space-y-6">
          <Field label="SMTP Host">
            <input className="modern-input" placeholder="smtp.gmail.com" value={host} onChange={e => setHost(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Port">
              <input className="modern-input" type="number" placeholder="587" value={port} onChange={e => setPort(e.target.value)} />
            </Field>
            <div className="flex items-end pb-3">
              <label className="flex items-center gap-2 cursor-pointer group">
                <input type="checkbox" className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" checked={secure} onChange={e => setSecure(e.target.checked)} />
                <span className="text-xs font-bold text-slate-600 uppercase tracking-widest group-hover:text-indigo-600 transition-colors">SSL/TLS</span>
              </label>
            </div>
          </div>
          <Field label="SMTP Username">
            <input className="modern-input" placeholder="user@example.com" value={user} onChange={e => setUser(e.target.value)} />
          </Field>
          <Field label="SMTP Password">
            <input className="modern-input" type="password" placeholder="••••••••" value={pass} onChange={e => setPass(e.target.value)} />
          </Field>
        </div>

        <div className="space-y-6">
          <Field label="Sender Name">
            <input className="modern-input" placeholder="Reports" value={fromName} onChange={e => setFromName(e.target.value)} />
          </Field>
          <Field label="Sender Email (Optional)" hint="Leave empty to use SMTP Username">
            <input className="modern-input" placeholder="reports@company.com" value={fromEmail} onChange={e => setFromEmail(e.target.value)} />
          </Field>

          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-6 mt-8">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Pro Tip</h4>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              For Gmail, use an <b>App Password</b> instead of your primary password. Ensure your SMTP provider allows connections from your server's IP address.
            </p>
          </div>
        </div>
      </div>

      <div className="pt-6 border-t border-slate-100 flex justify-end">
        <button onClick={save} disabled={saving} className="btn-primary px-10">
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</label>
      {children}
      {hint && <p className="text-[10px] font-medium text-slate-400 italic">{hint}</p>}
    </div>
  );
}
