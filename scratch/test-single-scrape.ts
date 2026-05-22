import 'dotenv/config';
import { scrapePopularTimes } from '../scrapers/index';
import { buildJobConfig } from '../scrapers/build-config';
import { createClient } from '@supabase/supabase-js';
import * as path from 'path';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function run() {
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const userId = '1a36f301-9ce6-41bc-a313-3a0d53e080a6';

  const { data: dbRecs } = await admin
    .from('client_databases')
    .select('supabase_url, service_role_key')
    .eq('user_id', userId)
    .single();

  if (!dbRecs) return;
  const cdb = createClient(dbRecs.supabase_url, dbRecs.service_role_key);

  // Fetch the latest successful job to get real brands/competitors
  const { data: jobs } = await admin
    .from('jobs')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'succeeded')
    .limit(1);

  if (!jobs || jobs.length === 0) {
    console.log('No successful jobs found');
    return;
  }
  const job = jobs[0];

  const { data: branches } = await cdb
    .from('branch_analytics')
    .select('branch_name, google_maps_link')
    .eq('job_id', job.id)
    .not('google_maps_link', 'is', null)
    .limit(1);

  if (!branches || branches.length === 0) {
    console.log('No branches found');
    return;
  }

  const branch = branches[0];
  const inputBranch = {
    title: branch.branch_name,
    url: branch.google_maps_link,
    popularTimes: undefined
  };

  console.log(`Building job config for job: ${job.id}`);
  const cfg = await buildJobConfig({
    jobId: job.id,
    targetName: job.target_name,
    competitors: job.competitors,
    refreshToken: job.refresh_token,
    searchLocation: job.search_location ?? undefined
  });

  console.log(`Running scrapePopularTimes on branch: "${inputBranch.title}" at URL: ${inputBranch.url}`);
  const results = await scrapePopularTimes([inputBranch], cfg);

  console.log('\n=== SCRAPE RESULT ===');
  const resultBranch = results[0];
  console.log('Available:', resultBranch.popularTimes?.available);
  console.log('Peak Day:', resultBranch.popularTimes?.peakDay);
  console.log('Peak Hour:', resultBranch.popularTimes?.peakHour);
  console.log('Peak Busyness:', resultBranch.popularTimes?.peakBusyness);
  console.log('Summary:', resultBranch.popularTimes?.summary);
  
  if (resultBranch.popularTimes?.grid) {
    console.log('\nGrid Days Data:');
    for (const [day, hours] of Object.entries(resultBranch.popularTimes.grid)) {
      const hArray = hours as any[];
      const sum = hArray.reduce((a, b) => a + (b || 0), 0);
      console.log(`  - ${day}: sum=${sum}, values (first 12):`, hArray.slice(0, 12));
    }
  }
}

run();
