import { redirect } from 'next/navigation';
import Link from 'next/link';
import { serverClient } from '@/lib/supabase';
import AdminPanel from './admin-panel';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await sb.from('profiles').select('role, is_admin').eq('id', user.id).single();
  if (profile?.role !== 'admin' && !profile?.is_admin) redirect('/dashboard');

  return (
    <main className="max-w-6xl mx-auto p-8 space-y-10">
      <header className="flex items-end justify-between border-b border-slate-100 pb-8">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-50 text-indigo-600 rounded-full text-[10px] font-bold uppercase tracking-widest border border-indigo-100 mb-2">
            System Administration
          </div>
          <h1 className="text-4xl font-bold text-slate-900 tracking-tight">Control Center</h1>
          <p className="text-sm font-medium text-slate-500">Root authorization: <span className="text-indigo-600 font-bold">{user.email}</span></p>
        </div>
        <Link href="/dashboard" className="btn-secondary px-5 py-2.5 text-xs">
          ← Dashboard
        </Link>
      </header>
      <AdminPanel />
    </main>
  );
}
