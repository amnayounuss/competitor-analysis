import { redirect } from 'next/navigation';
import Link from 'next/link';
import { serverClient } from '@/lib/supabase';
import AdminPanel from './admin-panel';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await sb.from('profiles').select('is_admin').eq('id', user.id).single();
  if (!profile?.is_admin) redirect('/dashboard');

  return (
    <main className="max-w-5xl mx-auto p-6">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Admin panel</h1>
          <p className="text-sm text-gray-600">Signed in as {user.email}</p>
        </div>
        <Link href="/dashboard" className="text-sm border rounded px-3 py-1.5 hover:bg-gray-50">
          ← Back to dashboard
        </Link>
      </header>
      <AdminPanel />
    </main>
  );
}
