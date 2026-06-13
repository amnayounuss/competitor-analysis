import { serverClient, adminClient } from '@/lib/supabase';
import { getClientDbCreds, clientDbClient } from '@/lib/client-db';
import DashboardView from './dashboard-view';
import Link from 'next/link';
import { Bi, BiInline } from '@/lib/bilingual';

export const dynamic = 'force-dynamic';

export default async function DashboardOverview() {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  const admin = adminClient();
  const { data: profile } = await admin.from('profiles').select('role, parent_user_id, is_admin').eq('id', user.id).maybeSingle();
  const effectiveUserId = profile?.role === 'viewer' && profile.parent_user_id ? profile.parent_user_id : user.id;

  const { data: latestJob } = await admin
    .from('jobs')
    .select('*')
    .eq('user_id', effectiveUserId)
    .eq('status', 'succeeded')
    .order('finished_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: allSucceededJobs } = await admin
    .from('jobs')
    .select('*')
    .eq('user_id', effectiveUserId)
    .eq('status', 'succeeded')
    .order('finished_at', { ascending: false });

  const targetBrand = latestJob?.target_name || null;
  const competitorBrands: string[] = Array.isArray(latestJob?.competitors) ? latestJob!.competitors : [];
  const jobId = latestJob?.id || null;

  let dashboardData = null;
  let dbConnected = false;

  try {
    const creds = await getClientDbCreds(effectiveUserId);
    const cdb = clientDbClient(creds);
    dbConnected = true;

    if (allSucceededJobs && allSucceededJobs.length > 0) {
      const jobIds = allSucceededJobs.map(j => j.id);

      // Fetch analytics and analyses across ALL successful jobs combined!
      const [analyticsRes, analysesRes] = await Promise.all([
        cdb.from('branch_analytics').select('*, branches(stars, reviews_count)').in('job_id', jobIds),
        cdb.from('analyses').select('*').in('job_id', jobIds),
      ]);

      const latestJobId = latestJob?.id || allSucceededJobs[0].id;
      const targetBrandName = latestJob?.target_name || allSucceededJobs[0].target_name;

      // Deduplicate branches across jobs by branch_name+brand — keep the latest job's entry
      const rawAnalytics = analyticsRes.data || [];
      const branchMap = new Map<string, any>();
      const jobOrder = new Map(allSucceededJobs.map((j: any, i: number) => [j.id, i]));
      for (const a of rawAnalytics) {
        const key = `${a.brand}::${a.branch_name}::${a.city || ''}`;
        const existing = branchMap.get(key);
        if (!existing || (jobOrder.get(a.job_id) ?? 999) < (jobOrder.get(existing.job_id) ?? 999)) {
          branchMap.set(key, a);
        }
      }
      const aggregatedAnalytics = Array.from(branchMap.values());

      const COUNTRY_TO_CODE: Record<string, string> = {
        'saudi arabia': 'sa', 'united arab emirates': 'ae', 'uae': 'ae',
        'bahrain': 'bh', 'kuwait': 'kw', 'qatar': 'qa', 'oman': 'om',
        'egypt': 'eg', 'jordan': 'jo', 'lebanon': 'lb', 'iraq': 'iq',
        'turkey': 'tr', 'pakistan': 'pk', 'india': 'in',
      };
      const filteredAnalytics = aggregatedAnalytics.filter(a => {
        const jobRecord = allSucceededJobs.find(j => j.id === a.job_id);
        const searchLoc = jobRecord?.search_location ? jobRecord.search_location.trim().toLowerCase() : '';
        if (!searchLoc) return true;

        const addr = (a.address || '').toLowerCase();
        const city = (a.city || '').toLowerCase();
        const title = (a.branch_name || '').toLowerCase();
        const countryCode = COUNTRY_TO_CODE[searchLoc];
        const countryMatch = countryCode && (addr.endsWith(`, ${countryCode}`) || addr.endsWith(` ${countryCode}`));

        return addr.includes(searchLoc) || city.includes(searchLoc) || title.includes(searchLoc) || countryMatch;
      });

      // Extract all distinct competitor brands across all jobs
      const competitorBrandsSet = new Set<string>();
      allSucceededJobs.forEach(j => {
        if (Array.isArray(j.competitors)) {
          j.competitors.forEach((c: any) => competitorBrandsSet.add(c));
        }
      });
      const competitorBrands = Array.from(competitorBrandsSet);

      dashboardData = {
        analytics: filteredAnalytics,
        analyses: analysesRes.data || [],
        targetBrand: targetBrandName,
        competitorBrands,
        jobId: latestJobId,
        dateStart: latestJob?.date_start || null,
        dateEnd: latestJob?.date_end || null,
        finishedAt: latestJob?.finished_at || null,
        aiSummary: latestJob?.ai_summary || null,
        allJobs: allSucceededJobs,
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
          <Bi en="Database Not Connected" as="h2" className="text-2xl font-black text-slate-900 tracking-tight mb-2" />
          <Bi en="Connect your Supabase database to see analytics." as="p" className="text-slate-500 font-medium mb-8 text-balance" />
          <Link href="/connect-database" className="px-8 py-4 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 shadow-lg shadow-indigo-500/20 transition-all active:scale-95">
            <BiInline en="Setup Connection" />
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
    aiSummary: null,
    allJobs: allSucceededJobs || [],
  };

  return (
    <div className="px-4 sm:px-10 py-10 space-y-10">
      <DashboardView data={finalData} isGlobalDashboard={true} />
    </div>
  );
}
