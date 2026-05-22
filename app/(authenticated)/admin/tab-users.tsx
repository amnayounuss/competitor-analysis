'use client';
import { useState, useEffect } from 'react';
import { Bi, BiInline, useT } from '@/lib/bilingual';
import { useLang } from '@/lib/lang-context';

export default function UsersTab() {
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [msg, setMsg] = useState<{type:'ok'|'err';text:string}|null>(null);
  const t = useT();
  const { isAr } = useLang();

  // Create form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    const r = await fetch('/api/admin/users');
    const j = await r.json();
    setClients(j.clients || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function create() {
    setMsg(null); setCreating(true);
    const r = await fetch('/api/admin/users', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ email, password, full_name: fullName, is_admin: false }),
    });
    setCreating(false);
    if (!r.ok) { const j = await r.json(); setMsg({type:'err', text: typeof j.error === 'string' ? j.error : t('create failed')}); return; }
    setMsg({type:'ok', text: t('Provisioned client: {email}').replace('{email}', email)});
    setEmail(''); setPassword(''); setFullName(''); setShowCreate(false);
    load();
  }

  async function remove(id: string, email: string) {
    if (!confirm(t('Revoke access for {email}? All their data will be deleted.').replace('{email}', email))) return;
    const r = await fetch(`/api/admin/users?id=${id}`, { method:'DELETE' });
    if (!r.ok) { const j = await r.json(); setMsg({type:'err', text: j.error || t('revoke failed')}); return; }
    setMsg({type:'ok', text: t('Access revoked for {email}').replace('{email}', email)});
    load();
  }

  return (
    <div className="space-y-8" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight"><BiInline en="Client Management" /></h2>
          <p className="text-sm text-slate-500 mt-1">
            {isAr ? (
              <><span className="font-bold">{clients.length}</span> حساب عميل تم إنشاؤه</>
            ) : (
              <><span className="font-bold">{clients.length}</span> provisioned client accounts</>
            )}
          </p>
        </div>
        <button 
          onClick={() => setShowCreate(!showCreate)}
          className={showCreate ? 'btn-secondary px-6' : 'btn-primary px-6 shadow-xl shadow-indigo-600/20'}
        >
          {showCreate ? t('Dismiss Form') : t('+ Provision New Client')}
        </button>
      </div>

      {msg && (
        <div className={`text-sm font-medium rounded-xl p-4 flex items-center gap-3 border animate-in fade-in slide-in-from-top-2 ${
          msg.type === 'ok' 
            ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
            : 'bg-rose-50 text-rose-700 border-rose-100'
        }`}>
          <div className={`w-2 h-2 rounded-full ${msg.type === 'ok' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
          {msg.text}
        </div>
      )}

      {showCreate && (
        <div className="bg-slate-50 border border-slate-100 rounded-2xl p-8 space-y-6 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Field label={<BiInline en="Client Email" />}>
              <input className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all" type="email" placeholder={t('client@company.com')} value={email} onChange={e => setEmail(e.target.value)} />
            </Field>
            <Field label={<BiInline en="Initial Password" />}>
              <input className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all" type="password" placeholder={t('••••••••')} value={password} onChange={e => setPassword(e.target.value)} minLength={8} />
            </Field>
          </div>
          <Field label={<BiInline en="Client Name" />}>
            <input className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all" type="text" placeholder={t('Acme Corp')} value={fullName} onChange={e => setFullName(e.target.value)} />
          </Field>
          
          <div className="flex justify-end pt-2">
            <button 
              onClick={create} 
              disabled={creating || !email.includes('@') || password.length < 8}
              className="btn-primary bg-emerald-600 hover:bg-emerald-700 shadow-xl shadow-emerald-600/20 px-8"
            >
              {creating ? t('Provisioning…') : t('Create Client Account')}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 space-y-4">
          <div className="w-10 h-10 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="border border-slate-100 rounded-2xl overflow-hidden bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100 text-start">
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest text-start"><BiInline en="Client / Subscriber" /></th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest text-center"><BiInline en="Database" /></th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest text-center"><BiInline en="Jobs (Active)" /></th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest text-start"><BiInline en="Registration" /></th>
                <th className="px-6 py-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {clients.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400 font-medium"><BiInline en="No clients provisioned yet." /></td>
                </tr>
              ) : clients.map(u => (
                <tr key={u.id} className="group hover:bg-slate-50/30 transition-all">
                  <td className="px-6 py-4 text-start">
                    <div className="flex flex-col">
                      <span className="font-bold text-slate-900 text-sm tracking-tight">{u.email}</span>
                      <span className="text-xs font-medium text-slate-400 mt-0.5">{u.full_name || '—'}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-center">
                    {u.db_connected ? (
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-600 rounded-full border border-emerald-100">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        <span className="text-[10px] font-bold uppercase tracking-widest"><BiInline en="Connected" /></span>
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 text-slate-400 rounded-full border border-slate-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                        <span className="text-[10px] font-bold uppercase tracking-widest"><BiInline en="Pending" /></span>
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <span className="font-bold text-slate-700">{u.jobs_total}</span>
                      {u.jobs_active > 0 && (
                        <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded animate-pulse">
                          {isAr ? (
                            <>{u.jobs_active} نشط</>
                          ) : (
                            <>{u.jobs_active} active</>
                          )}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-start">
                    <div className="flex flex-col">
                      <span className="text-[11px] font-bold text-slate-600 uppercase tracking-tight">
                        {new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                      <span className="text-[9px] font-medium text-slate-400 uppercase tracking-widest mt-0.5"><BiInline en="Joined" /></span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-end">
                    <button 
                      onClick={() => remove(u.id, u.email)}
                      className="text-xs font-bold text-slate-300 hover:text-rose-600 transition-colors uppercase tracking-tighter"
                    >
                      <BiInline en="Revoke Access" />
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

function Field({ label, hint, children }: { label: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 text-start">
      <label className="block text-sm font-bold text-slate-700 tracking-tight">{label}</label>
      {children}
      {hint && <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">{hint}</p>}
    </div>
  );
}
