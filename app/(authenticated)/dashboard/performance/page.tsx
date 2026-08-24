import { serverClient, adminClient } from '@/lib/supabase';
import { getClientDbCreds, clientDbClient } from '@/lib/client-db';
import PerformanceView from './performance-view';
import Link from 'next/link';
import { Bi, BiInline } from '@/lib/bilingual';

export const dynamic = 'force-dynamic';

/**
 * Google Business Profile Performance dashboard.
 *
 * Data comes from the client's `gbp_metrics` table, populated by Stage P of the
 * analysis pipeline from
 *   businessprofileperformance.googleapis.com/v1/locations/{id}:getDailyMetricsTimeSeries
 *
 * Metrics exist only for the client's OWN locations — the API serves nothing for
 * businesses the account does not manage, so there is no competitor dimension here.
 */
export default async function PerformancePage() {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  const admin = adminClient();
  const { data: profile } = await admin.from('profiles')
    .select('role, parent_user_id, is_admin').eq('id', user.id).maybeSingle();
  const effectiveUserId = profile?.role === 'viewer' && profile.parent_user_id ? profile.parent_user_id : user.id;

  let payload: any = null;
  let dbConnected = false;
  let schemaReady = true;

  try {
    const creds = await getClientDbCreds(effectiveUserId);
    const cdb = clientDbClient(creds);
    dbConnected = true;

    // Metrics are recorded per job. Show the most recent job that actually has
    // metrics — an older job may predate the Performance API stage entirely.
    const { data: latestMetric, error: probeErr } = await cdb
      .from('gbp_metrics')
      .select('job_id, created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (probeErr) {
      // Client schema predates migration 007.
      schemaReady = false;
    } else if (latestMetric?.job_id) {
      const jobId = latestMetric.job_id;
      const [totalsRes, dailyRes, heatRes, jobRes] = await Promise.all([
        cdb.from('gbp_metric_totals').select('*').eq('job_id', jobId),
        cdb.from('gbp_metric_daily').select('*').eq('job_id', jobId).order('metric_date', { ascending: true }),
        cdb.from('gbp_metric_heatmap').select('*').eq('job_id', jobId),
        admin.from('jobs').select('target_name, date_start, date_end, finished_at').eq('id', jobId).maybeSingle(),
      ]);

      payload = {
        jobId,
        totals: totalsRes.data || [],
        daily: dailyRes.data || [],
        heatmap: heatRes.data || [],
        targetBrand: jobRes.data?.target_name || null,
        dateStart: jobRes.data?.date_start || null,
        dateEnd: jobRes.data?.date_end || null,
        finishedAt: jobRes.data?.finished_at || null,
      };
    }
  } catch (err) {
    console.error('[performance] fetch failed:', err);
  }

  if (!dbConnected) {
    return (
      <div className="px-4 sm:px-10 py-10">
        <EmptyCard
          title="Database Not Connected"
          body="Connect your database to see Business Profile performance."
          ctaHref="/connect-database"
          cta="Setup Connection"
        />
      </div>
    );
  }

  if (!schemaReady) {
    return (
      <div className="px-4 sm:px-10 py-10">
        <EmptyCard
          title="Performance Storage Not Ready"
          body="Your database is missing the performance tables. Re-run database setup to add them."
          ctaHref="/connect-database"
          cta="Re-run Setup"
        />
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="px-4 sm:px-10 py-10">
        <EmptyCard
          title="No Performance Data Yet"
          body="Run an analysis with your Google Business Profile connected. Impressions, clicks, calls and direction requests for your own locations will appear here."
          ctaHref="/dashboard/new"
          cta="Start an Analysis"
        />
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-10 py-10 space-y-10">
      <PerformanceView data={payload} />
    </div>
  );
}

function EmptyCard({ title, body, ctaHref, cta }: { title: string; body: string; ctaHref: string; cta: string }) {
  return (
    <div className="max-w-2xl">
      <div className="bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-xl shadow-slate-200/40 text-center">
        <div className="w-20 h-20 bg-indigo-50 rounded-3xl flex items-center justify-center text-indigo-500 mx-auto mb-6">
          <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12h4l2-6 3 12 3-8 2 2h4" />
          </svg>
        </div>
        <Bi en={title} as="h2" className="text-2xl font-black text-slate-900 tracking-tight mb-2" />
        <Bi en={body} as="p" className="text-slate-500 font-medium mb-8 text-balance" />
        <Link href={ctaHref} className="px-8 py-4 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 shadow-lg shadow-indigo-500/20 transition-all active:scale-95 inline-block">
          <BiInline en={cta} />
        </Link>
      </div>
    </div>
  );
}
