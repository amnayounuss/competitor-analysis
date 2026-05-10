'use client';
import { useState, useEffect } from 'react';

export default function UsersTab() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [msg, setMsg] = useState<{type:'ok'|'err';text:string}|null>(null);

  // Create form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [makeAdmin, setMakeAdmin] = useState(false);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    const r = await fetch('/api/admin/users');
    const j = await r.json();
    setUsers(j.users || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function create() {
    setMsg(null); setCreating(true);
    const r = await fetch('/api/admin/users', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ email, password, full_name: fullName, is_admin: makeAdmin }),
    });
    setCreating(false);
    if (!r.ok) { const j = await r.json(); setMsg({type:'err', text: typeof j.error === 'string' ? j.error : 'create failed'}); return; }
    setMsg({type:'ok', text:`Created ${email}`});
    setEmail(''); setPassword(''); setFullName(''); setMakeAdmin(false); setShowCreate(false);
    load();
  }

  async function remove(id: string, email: string) {
    if (!confirm(`Delete user ${email}? All their jobs and logs will also be deleted.`)) return;
    const r = await fetch(`/api/admin/users?id=${id}`, { method:'DELETE' });
    if (!r.ok) { const j = await r.json(); setMsg({type:'err', text: j.error || 'delete failed'}); return; }
    setMsg({type:'ok', text: `Deleted ${email}`});
    load();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Users</h2>
          <p className="text-sm text-gray-500">{users.length} total</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)}
          className="text-sm bg-blue-600 hover:bg-blue-700 text-white rounded px-4 py-2 font-medium">
          {showCreate ? 'Cancel' : '+ Add user'}
        </button>
      </div>

      {msg && <div className={`${msg.type==='ok'?'bg-green-50 text-green-700':'bg-red-50 text-red-700'} text-sm rounded p-3`}>{msg.text}</div>}

      {showCreate && (
        <div className="border rounded-lg p-4 bg-gray-50 space-y-3">
          <h3 className="font-medium text-sm">Create new user</h3>
          <input className="input" type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
          <input className="input" type="password" placeholder="Password (8+ chars)" value={password} onChange={e => setPassword(e.target.value)} minLength={8} />
          <input className="input" type="text" placeholder="Full name (optional)" value={fullName} onChange={e => setFullName(e.target.value)} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={makeAdmin} onChange={e => setMakeAdmin(e.target.checked)} />
            Make this user an admin
          </label>
          <button onClick={create} disabled={creating || !email.includes('@') || password.length < 8}
            className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm rounded px-4 py-2 font-medium">
            {creating ? 'Creating…' : 'Create user'}
          </button>
        </div>
      )}

      {loading ? <p className="text-sm text-gray-500">Loading…</p> : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2 text-center">Jobs</th>
                <th className="px-4 py-2 text-center">Active</th>
                <th className="px-4 py-2">Joined</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.map(u => (
                <tr key={u.id}>
                  <td className="px-4 py-2">
                    {u.email}
                    {u.is_admin && <span className="ml-2 text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">admin</span>}
                  </td>
                  <td className="px-4 py-2 text-gray-600">{u.full_name || '—'}</td>
                  <td className="px-4 py-2 text-center">{u.jobs_total}</td>
                  <td className="px-4 py-2 text-center">{u.jobs_active > 0 && <span className="text-blue-600 font-medium">{u.jobs_active}</span>}</td>
                  <td className="px-4 py-2 text-gray-500 text-xs">{new Date(u.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => remove(u.id, u.email)}
                      className="text-xs text-red-600 hover:text-red-800">delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <style jsx>{`
        .input { width:100%; border:1px solid #d1d5db; border-radius:6px; padding:8px 12px; font-size:14px; outline:none; }
        .input:focus { border-color:#3b82f6; box-shadow:0 0 0 2px rgba(59,130,246,.2); }
      `}</style>
    </div>
  );
}
