import React from 'react';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { serverClient, adminClient } from '@/lib/supabase';
import { getClientDbCreds, clientDbClient } from '@/lib/client-db';
import LiveJobView from './live-job-view';
import DashboardView from '@/app/(authenticated)/dashboard/dashboard-view';
import { BiInline } from '@/lib/bilingual';

export const dynamic = 'force-dynamic';

export default async function JobPage({ params }: { params: { id: string } }) {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');

  const admin = adminClient();
  const { data: job } = await admin
    .from('jobs')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single();

  if (!job) notFound();

  let dashboardData: {
    analytics: any[];
    analyses: any[];
    targetBrand: string | null;
    competitorBrands: string[];
    jobId: string | null;
    dateStart: string | null;
    dateEnd: string | null;
    finishedAt: string | null;
    aiSummary: string | null;
    allJobs: any[];
  } | null = null;

  if (job.status === 'succeeded') {
    try {
      const creds = await getClientDbCreds(user.id);
      const cdb = clientDbClient(creds);

      // Fetch all succeeded jobs for the switcher
      const { data: allSucceededJobs } = await admin
        .from('jobs')
        .select('id, target_name, competitors, date_start, date_end, finished_at, search_location')
        .eq('user_id', user.id)
        .eq('status', 'succeeded')
        .order('finished_at', { ascending: false });

      const [analyticsRes, analysesRes] = await Promise.all([
        cdb.from('branch_analytics').select('*, branches(stars, reviews_count)').eq('job_id', job.id),
        cdb.from('analyses').select('*').eq('job_id', job.id),
      ]);

      const COUNTRY_TO_CODE: Record<string, string> = {
        'saudi arabia': 'sa', 'united arab emirates': 'ae', 'uae': 'ae',
        'bahrain': 'bh', 'kuwait': 'kw', 'qatar': 'qa', 'oman': 'om',
        'egypt': 'eg', 'jordan': 'jo', 'lebanon': 'lb', 'iraq': 'iq',
        'turkey': 'tr', 'pakistan': 'pk', 'india': 'in',
      };
      const searchLoc = job.search_location ? job.search_location.trim().toLowerCase() : '';
      const rawAnalytics = analyticsRes.data || [];
      const filteredAnalytics = rawAnalytics.filter(a => {
        if (!searchLoc) return true;

        const addr = (a.address || '').toLowerCase();
        const city = (a.city || '').toLowerCase();
        const title = (a.branch_name || '').toLowerCase();
        const countryCode = COUNTRY_TO_CODE[searchLoc];
        const countryMatch = countryCode && (addr.endsWith(`, ${countryCode}`) || addr.endsWith(` ${countryCode}`));

        return addr.includes(searchLoc) || city.includes(searchLoc) || title.includes(searchLoc) || countryMatch;
      });

      dashboardData = {
        analytics: filteredAnalytics,
        analyses: analysesRes.data || [],
        targetBrand: job.target_name,
        competitorBrands: Array.isArray(job.competitors) ? job.competitors : [],
        jobId: job.id,
        dateStart: job.date_start || null,
        dateEnd: job.date_end || null,
        finishedAt: job.finished_at || null,
        aiSummary: job.ai_summary || null,
        allJobs: allSucceededJobs || [],
      };
    } catch (err) {
      console.error('[job-dashboard] failed to fetch client data:', err);
    }
  }

  const { data: logs } = await admin
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
            <svg className="w-4 h-4 rtl:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
          </div>
          <BiInline en="Command Center" />
        </Link>
      </div>

      {job.status === 'succeeded' && dashboardData ? (
        <div className="px-4 sm:px-10 py-10 space-y-10">
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight"><BiInline en="Executive Overview" /></h1>
            <p className="text-slate-500 font-medium mt-1 text-sm">
              <BiInline en={job.target_name} />{' '}
              <BiInline en="vs" />{' '}
              {(Array.isArray(job.competitors) ? job.competitors : []).map((c: string, idx: number) => (
                <React.Fragment key={idx}>
                  {idx > 0 && ', '}
                  <BiInline en={c} />
                </React.Fragment>
              ))}
            </p>
          </div>
          <DashboardView data={dashboardData} />
        </div>
      ) : (
        <LiveJobView initialJob={job} initialLogs={logs || []} />
      )}
    </main>
  );
}
