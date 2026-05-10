import { redirect } from 'next/navigation';
import Link from 'next/link';
import { serverClient, adminClient } from '@/lib/supabase';
import NewJobForm from './new-job-form';
import SignOutButton from './signout-button';
import NotificationBell from './notification-bell';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');

  const admin = adminClient();
  const [profileRes, connRes, jobsRes] = await Promise.all([
    sb.from('profiles').select('is_admin').eq('id', user.id).single(),
    admin.from('client_databases').select('last_test_ok').eq('user_id', user.id).maybeSingle(),
    sb.from('jobs').select('id, target_name, competitors, status, progress_pct, current_stage, queued_at, finished_at, branches_total, kind, excel_url')
      .order('queued_at', { ascending: false }).limit(20),
  ]);
  const isAdmin = profileRes.data?.is_admin === true;
  const dbConnected = connRes.data?.last_test_ok === true;
  const jobs = jobsRes.data || [];

  return (
    <main className="max-w-4xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-gray-600">{user.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <NotificationBell />
          <Link href="/schedules" className="text-sm border rounded px-3 py-1.5 hover:bg-gray-50">Schedules</Link>
          {isAdmin && <Link href="/admin" className="text-sm bg-purple-600 text-white rounded px-3 py-1.5 hover:bg-purple-700">Admin</Link>}
          <SignOutButton />
        </div>
      </header>

      {!dbConnected && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h3 className="font-semibold text-yellow-900">Connect your Supabase first</h3>
          <p className="text-sm text-yellow-800 mt-1">You need to connect your own Supabase database before submitting analyses.</p>
          <Link href="/connect-database" className="inline-block mt-3 bg-yellow-600 text-white text-sm rounded px-4 py-2 hover:bg-yellow-700">
            Connect now →
          </Link>
        </div>
      )}

      {dbConnected && (
        <section className="bg-white border rounded-lg p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-4">New analysis</h2>
          <NewJobForm defaultEmail={user.email || ''} />
        </section>
      )}

      <section className="bg-white border rounded-lg p-6 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">Recent jobs</h2>
        {jobs.length === 0
          ? <p className="text-sm text-gray-500">No jobs yet.</p>
          : <ul className="divide-y">
              {jobs.map(j => (
                <li key={j.id} className="py-3">
                  <Link href={`/jobs/${j.id}`} className="block hover:bg-gray-50 -mx-2 px-2 py-1 rounded">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">
                          {j.target_name}
                          <span className="text-gray-500 font-normal"> vs {j.competitors.join(', ')}</span>
                          {j.kind === 'scheduled' && <span className="ml-2 text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">scheduled</span>}
                        </p>
                        <p className="text-xs text-gray-500">{new Date(j.queued_at).toLocaleString()}</p>
                      </div>
                      <StatusBadge status={j.status} />
                    </div>
                    {j.status === 'running' && (
                      <div className="mt-2">
                        <div className="h-1.5 bg-gray-100 rounded overflow-hidden">
                          <div className="h-full bg-blue-500 transition-all" style={{ width: `${j.progress_pct}%` }} />
                        </div>
                        <p className="text-xs text-gray-500 mt-1">{j.current_stage}</p>
                      </div>
                    )}
                    {j.status === 'succeeded' && j.excel_url && (
                      <p className="text-xs text-blue-600 mt-1">📎 Excel saved to your Supabase storage</p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>}
      </section>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    queued:'bg-gray-100 text-gray-700', running:'bg-blue-100 text-blue-700',
    succeeded:'bg-green-100 text-green-700', failed:'bg-red-100 text-red-700',
    cancelled:'bg-yellow-100 text-yellow-700',
  };
  return <span className={`text-xs font-medium px-2 py-1 rounded ${map[status] || ''}`}>{status}</span>;
}
