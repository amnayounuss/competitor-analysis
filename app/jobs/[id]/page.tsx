import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { serverClient } from '@/lib/supabase';
import { getClientDbCreds, clientDbClient } from '@/lib/client-db';
import LiveJobView from './live-job-view';
import AnalysisDashboard from './analysis-dashboard';

export const dynamic = 'force-dynamic';

export default async function JobPage({ params }: { params: { id: string } }) {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');

  const { data: job } = await sb
    .from('jobs')
    .select('*')
    .eq('id', params.id)
    .single();

  if (!job) notFound();

  // If job is finished, we pull data from the Client DB for the dashboard
  let dashboardData: {
    analytics: any[];
    reviews: any[];
    analyses: any[];
  } | null = null;
  if (job.status === 'succeeded') {
    try {
      const creds = await getClientDbCreds(user.id);
      const cdb = clientDbClient(creds);

      const [analyticsRes, reviewsRes, analysesRes] = await Promise.all([
        cdb.from('branch_analytics').select('*').eq('job_id', job.id),
        cdb.from('reviews')
           .select('id, brand, rating, text, reviewer_name, published_at, branch_id')
           .eq('job_id', job.id)
           .order('published_at', { ascending: false })
           .limit(2000),
        cdb.from('analyses').select('*').eq('job_id', job.id),
      ]);

      dashboardData = {
        analytics: analyticsRes.data || [],
        reviews:   reviewsRes.data   || [],
        analyses:  analysesRes.data  || [],
      };
    } catch (err) {
      console.error('[dashboard] failed to fetch client data:', err);
    }
  }

  const { data: logs } = await sb
    .from('job_logs')
    .select('id, level, message, created_at')
    .eq('job_id', params.id)
    .order('created_at', { ascending: true })
    .limit(500);

  return (
    <main className="max-w-7xl mx-auto p-4 md:p-8 space-y-8 min-h-screen bg-slate-50/50">
      <div className="flex items-center justify-between">
        <Link href="/dashboard" className="group flex items-center gap-2 text-sm font-bold text-slate-400 hover:text-indigo-600 transition-all">
          <div className="p-2 rounded-lg bg-white border border-slate-100 shadow-sm group-hover:border-indigo-100 group-hover:shadow-indigo-500/10 transition-all">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
          </div>
          Command Center
        </Link>
      </div>

      {job.status === 'succeeded' && dashboardData ? (
        <AnalysisDashboard job={job} data={dashboardData} />
      ) : (
        <LiveJobView initialJob={job} initialLogs={logs || []} />
      )}
    </main>
  );
}
