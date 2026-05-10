'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function NewJobForm({ defaultEmail }: { defaultEmail: string }) {
  const router = useRouter();
  const [target, setTarget]     = useState('');
  const [comps, setComps]       = useState('');
  const [token, setToken]       = useState('');
  const [email, setEmail]       = useState(defaultEmail);
  const [scheduleMonthly, setScheduleMonthly] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string|null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setSubmitting(true);
    const competitors = comps.split(',').map(s => s.trim()).filter(Boolean);

    try {
      // Always create a manual job
      const r = await fetch('/api/jobs', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          target_name: target.trim(), competitors,
          refresh_token: token.trim(), email_to: email.trim(),
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
    <form onSubmit={submit} className="space-y-4">
      {err && <div className="bg-red-50 text-red-700 text-sm rounded p-3">{err}</div>}

      <div>
        <label className="block text-sm font-medium mb-1">Target / brand name</label>
        <input type="text" required value={target} onChange={e=>setTarget(e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm" placeholder="e.g. Anoosh" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Competitor names (comma-separated)</label>
        <input type="text" required value={comps} onChange={e=>setComps(e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm" placeholder="Patchi, Bostani" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Google OAuth refresh token</label>
        <input type="password" required value={token} onChange={e=>setToken(e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm font-mono" placeholder="1//0gK..." />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Send report to email</label>
        <input type="email" required value={email} onChange={e=>setEmail(e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm" />
      </div>

      <label className="flex items-start gap-3 p-3 border rounded cursor-pointer hover:bg-gray-50">
        <input type="checkbox" className="mt-0.5" checked={scheduleMonthly} onChange={e=>setScheduleMonthly(e.target.checked)} />
        <div>
          <p className="font-medium text-sm">Run monthly</p>
          <p className="text-xs text-gray-500">Auto-create a fresh analysis on the 1st of every month using the same inputs above.</p>
        </div>
      </label>

      <button type="submit" disabled={submitting}
        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded px-5 py-2 text-sm font-medium">
        {submitting ? 'Submitting…' : 'Start analysis'}
      </button>
    </form>
  );
}
