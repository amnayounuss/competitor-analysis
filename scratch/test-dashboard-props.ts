import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function run() {
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const userId = '1a36f301-9ce6-41bc-a313-3a0d53e080a6'; // amnayounus999@gmail.com

  console.log(`[Diagnostic] Simulating unified aggregation for user ID: ${userId}...`);

  // 1. Fetch all successful jobs
  const { data: allSucceededJobs, error: jobsErr } = await admin
    .from('jobs')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'succeeded')
    .order('finished_at', { ascending: false });

  if (jobsErr) {
    console.error('Error fetching jobs:', jobsErr);
    return;
  }

  console.log(`Found ${allSucceededJobs?.length} successful jobs.`);
  if (!allSucceededJobs || allSucceededJobs.length === 0) return;

  const jobIds = allSucceededJobs.map(j => j.id);
  const latestJob = allSucceededJobs[0];
  const targetBrand = latestJob.target_name;

  // 2. Fetch client DB credentials
  const { data: dbRecs, error: dbErr } = await admin
    .from('client_databases')
    .select('supabase_url, service_role_key')
    .eq('user_id', userId)
    .single();

  if (dbErr) {
    console.error('Error fetching client DB credentials:', dbErr);
    return;
  }

  const cdb = createClient(dbRecs.supabase_url, dbRecs.service_role_key);

  // 3. Fetch analytics across all jobs
  console.log(`Querying branch_analytics across all jobs: ${JSON.stringify(jobIds)}...`);
  const { data: rawAnalytics, error: aErr } = await cdb
    .from('branch_analytics')
    .select('*')
    .in('job_id', jobIds);

  if (aErr) {
    console.error('Error querying branch_analytics:', aErr);
    return;
  }

  // Deduplicate target brand
  const aggregatedAnalytics = (rawAnalytics || []).filter(a => {
    if (a.brand === targetBrand) {
      return a.job_id === latestJob.id;
    }
    return true;
  });

  // Extract all distinct competitor brands across all jobs
  const competitorBrandsSet = new Set<string>();
  allSucceededJobs.forEach(j => {
    if (Array.isArray(j.competitors)) {
      j.competitors.forEach((c: any) => competitorBrandsSet.add(c));
    }
  });
  const competitorBrands = Array.from(competitorBrandsSet);

  console.log('=== AGGREGATION RESULT ===');
  console.log('Target Brand:', targetBrand);
  console.log('Competitor Brands Across All Runs:', competitorBrands);
  console.log('Raw branch_analytics count:', rawAnalytics?.length);
  console.log('Aggregated branch_analytics count (deduplicated):', aggregatedAnalytics.length);

  // Brand-wise branch counts
  const counts: Record<string, number> = {};
  aggregatedAnalytics.forEach(a => {
    counts[a.brand] = (counts[a.brand] || 0) + 1;
  });
  console.log('Aggregated Brand Counts:', counts);
}

run();
