import { serverClient, adminClient } from '@/lib/supabase';
import { getClientDbCreds, clientDbClient } from '@/lib/client-db';
import DashboardView from './dashboard-view';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function DashboardOverview() {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  const admin = adminClient();
  const { data: latestJob } = await admin
    .from('jobs')
    .select('id, target_name, competitors, date_start, date_end, search_location, finished_at')
    .eq('user_id', user.id)
    .eq('status', 'succeeded')
    .order('finished_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const targetBrand = latestJob?.target_name || null;
  const competitorBrands: string[] = Array.isArray(latestJob?.competitors) ? latestJob!.competitors : [];
  const jobId = latestJob?.id || null;

  let dashboardData = null;
  let dbConnected = false;

  try {
    const creds = await getClientDbCreds(user.id);
    const cdb = clientDbClient(creds);
    dbConnected = true;

    if (jobId) {
      const [analyticsRes, analysesRes] = await Promise.all([
        cdb.from('branch_analytics').select('*').eq('job_id', jobId),
        cdb.from('analyses').select('*').eq('job_id', jobId),
      ]);

      dashboardData = {
        analytics: analyticsRes.data || [],
        analyses: analysesRes.data || [],
        targetBrand,
        competitorBrands,
        jobId,
        dateStart: latestJob?.date_start || null,
        dateEnd: latestJob?.date_end || null,
        finishedAt: latestJob?.finished_at || null,
      };
    }
  } catch (err) {
    console.error('[dashboard] failed to fetch data:', err);
  }

  if (!dbConnected) {
    return (
      <div className="p-12 max-w-2xl">
        <div className="bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-xl shadow-slate-200/40 text-center">
          <div className="w-20 h-20 bg-amber-50 rounded-3xl flex items-center justify-center text-amber-500 mx-auto mb-6">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          </div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight mb-2">Database Not Connected</h2>
          <p className="text-slate-500 font-medium mb-8 text-balance">Connect your Supabase database to see analytics.</p>
          <Link href="/connect-database" className="px-8 py-4 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 shadow-lg shadow-indigo-500/20 transition-all active:scale-95">
            Setup Connection
          </Link>
        </div>
      </div>
    );
  }

  const finalData = dashboardData || {
    analytics: [],
    analyses: [],
    targetBrand,
    competitorBrands,
    jobId: null,
    dateStart: null,
    dateEnd: null,
    finishedAt: null,
  };

  return (
    <div className="px-4 sm:px-10 py-10 space-y-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Executive Overview</h1>
          <p className="text-slate-500 font-medium mt-1 text-sm">
            {targetBrand ? `${targetBrand} vs ${competitorBrands.join(', ')}` : 'Run an analysis to see results'}
          </p>
        </div>
      </div>

      <DashboardView data={finalData} />
    </div>
  );
}
