// Dashboard Page
import { serverClient } from '@/lib/supabase';
import { getClientDbCreds, clientDbClient } from '@/lib/client-db';
import DashboardView from './dashboard-view';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function DashboardOverview() {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  // Most-recent succeeded job tells us the user's "focus brand" + competitor set
  const { data: latestJob } = await sb
    .from('jobs')
    .select('target_name, competitors')
    .eq('user_id', user.id)
    .in('status', ['succeeded', 'running'])
    .order('queued_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const targetBrand = latestJob?.target_name || null;
  const competitorBrands: string[] = Array.isArray(latestJob?.competitors) ? latestJob!.competitors : [];

  let dashboardData = null;
  let dbConnected = false;

  try {
    const creds = await getClientDbCreds(user.id);
    const cdb = clientDbClient(creds);
    dbConnected = true;

    // Fetch aggregate data
    const { data: branches } = await cdb.from('branches').select('*');
    const { data: history } = await cdb.from('job_history').select('*').order('finished_at', { ascending: true });
    const { data: analyses } = await cdb.from('analyses').select('*');
    const { data: reviews } = await cdb.from('reviews').select('*').order('published_at', { ascending: false }).limit(2000);

    dashboardData = {
      branches: branches || [],
      history: history || [],
      analyses: analyses || [],
      reviews: reviews || [],
      targetBrand,
      competitorBrands,
    };
  } catch (err) {
    console.error('[dashboard] failed to fetch aggregate data:', err);
  }

  if (!dbConnected) {
    return (
      <div className="p-12 max-w-2xl">
        <div className="bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-xl shadow-slate-200/40 text-center">
          <div className="w-20 h-20 bg-amber-50 rounded-3xl flex items-center justify-center text-amber-500 mx-auto mb-6">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          </div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight mb-2">Database Not Connected</h2>
          <p className="text-slate-500 font-medium mb-8 text-balance">Please connect your Supabase database to unlock global analytics and trend tracking.</p>
          <Link href="/connect-database" className="px-8 py-4 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 shadow-lg shadow-indigo-500/20 transition-all active:scale-95">
            Setup Connection →
          </Link>
        </div>
      </div>
    );
  }

  const finalData = dashboardData || {
    branches: [],
    history: [],
    analyses: [],
    reviews: [],
    targetBrand,
    competitorBrands,
  };

  return (
    <div className="px-4 sm:px-10 py-10 space-y-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Executive Overview</h1>
          <p className="text-slate-500 font-medium mt-1 text-sm">Aggregated market intelligence across your entire portfolio.</p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl border border-emerald-100 shadow-sm">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[10px] font-black uppercase tracking-widest">Real-time Feed Active</span>
        </div>
      </div>

      <DashboardView data={finalData} />
    </div>
  );
}
