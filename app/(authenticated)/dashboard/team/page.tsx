'use client';
import { useState, useEffect } from 'react';
import { BiInline, useT } from '@/lib/bilingual';
import { useLang } from '@/lib/lang-context';

export default function TeamPage() {
  const [viewers, setViewers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const t = useT();
  const { isAr } = useLang();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    const r = await fetch('/api/team');
    const j = await r.json();
    setViewers(j.viewers || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function create() {
    setMsg(null);
    setCreating(true);
    const r = await fetch('/api/team', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, full_name: fullName }),
    });
    setCreating(false);
    if (!r.ok) {
      const j = await r.json();
      setMsg({ type: 'err', text: typeof j.error === 'string' ? j.error : 'Failed to create' });
      return;
    }
    setMsg({ type: 'ok', text: `Viewer created: ${email}` });
    setEmail('');
    setPassword('');
    setFullName('');
    setShowCreate(false);
    load();
  }

  async function remove(id: string, viewerEmail: string) {
    if (!confirm(`Remove ${viewerEmail}? They will lose access.`)) return;
    const r = await fetch(`/api/team?id=${id}`, { method: 'DELETE' });
    if (!r.ok) {
      const j = await r.json();
      setMsg({ type: 'err', text: j.error || 'Failed to remove' });
      return;
    }
    setMsg({ type: 'ok', text: `Removed ${viewerEmail}` });
    load();
  }

  return (
    <div className="px-4 sm:px-10 py-10 max-w-3xl" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            <BiInline en="Team Members" />
          </h1>
          <p className="text-sm text-slate-500 font-medium mt-1">
            <BiInline en="Add viewers who can see your dashboard but cannot run analyses." />
          </p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-5 py-2.5 bg-indigo-600 text-white font-bold text-sm rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-500/20 transition-all active:scale-95"
        >
          <BiInline en={showCreate ? 'Cancel' : 'Add Viewer'} />
        </button>
      </div>

      {msg && (
        <div className={`mb-6 p-4 rounded-xl text-sm font-medium ${msg.type === 'ok' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-rose-50 text-rose-700 border border-rose-100'}`}>
          {msg.text}
        </div>
      )}

      {showCreate && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-xl shadow-slate-200/40 p-6 mb-8 space-y-4">
          <h3 className="text-base font-black text-slate-900 tracking-tight">
            <BiInline en="New Viewer" />
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1"><BiInline en="Full Name" /></label>
              <input
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="John Doe"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1"><BiInline en="Email" /></label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="viewer@company.com"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-500 mb-1"><BiInline en="Password" /></label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Min 8 characters"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all"
              />
            </div>
          </div>
          <button
            onClick={create}
            disabled={creating || !email || !password || password.length < 8}
            className="px-6 py-2.5 bg-indigo-600 text-white font-bold text-sm rounded-xl hover:bg-indigo-700 shadow-md shadow-indigo-200 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? (
              <span className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <BiInline en="Creating..." />
              </span>
            ) : (
              <BiInline en="Create Viewer" />
            )}
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-16">
          <div className="w-8 h-8 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin mx-auto" />
        </div>
      ) : viewers.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-100">
          <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-300 mx-auto mb-4">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          </div>
          <p className="text-sm font-bold text-slate-400">
            <BiInline en="No team members yet" />
          </p>
          <p className="text-xs text-slate-400 mt-1">
            <BiInline en="Add viewers so they can see your dashboard." />
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-xl shadow-slate-200/40 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="px-6 py-4 text-start text-xs font-black text-slate-400 uppercase tracking-wider"><BiInline en="Name" /></th>
                <th className="px-6 py-4 text-start text-xs font-black text-slate-400 uppercase tracking-wider"><BiInline en="Email" /></th>
                <th className="px-6 py-4 text-start text-xs font-black text-slate-400 uppercase tracking-wider"><BiInline en="Added" /></th>
                <th className="px-6 py-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {viewers.map(v => (
                <tr key={v.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4 text-sm font-bold text-slate-700">{v.full_name || '—'}</td>
                  <td className="px-6 py-4 text-sm text-slate-500">{v.email}</td>
                  <td className="px-6 py-4 text-xs text-slate-400">{new Date(v.created_at).toLocaleDateString()}</td>
                  <td className="px-6 py-4 text-end">
                    <button
                      onClick={() => remove(v.id, v.email)}
                      className="text-xs font-bold text-rose-500 hover:text-rose-700 hover:bg-rose-50 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <BiInline en="Remove" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
