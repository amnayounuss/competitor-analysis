import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function run() {
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // 1. Get client database creds
  const { data: dbRecs } = await admin
    .from('client_databases')
    .select('supabase_url, service_role_key');

  if (!dbRecs || dbRecs.length === 0) return;
  const creds = dbRecs[0];
  const cdb = createClient(creds.supabase_url, creds.service_role_key);

  // 2. Query all jobs
  console.log('--- Querying all jobs from admin.jobs table ---');
  const { data: jobs } = await admin
    .from('jobs')
    .select('id, target_name, competitors, finished_at, status')
    .order('finished_at', { ascending: false });

  console.log(`Found ${jobs?.length} total scraping jobs:`);
  console.log(JSON.stringify(jobs, null, 2));

  // 3. For each job, count how many branch_analytics rows it has, and check if any are in Unaizah
  console.log('\n--- Checking Unaizah occurrences per Job ID ---');
  for (const job of jobs || []) {
    const { data: rows } = await cdb
      .from('branch_analytics')
      .select('city, branch_name')
      .eq('job_id', job.id);

    const totalRows = rows?.length || 0;
    const unaizahCount = rows?.filter(r => r.city === 'Unaizah').length || 0;

    console.log(`Job: [${job.id}] (${job.target_name} vs ${job.competitors?.join(', ')})`);
    console.log(`  Finished At: ${job.finished_at}`);
    console.log(`  Status: ${job.status}`);
    console.log(`  Total Branches in Analytics: ${totalRows}`);
    console.log(`  Branches in "Unaizah": ${unaizahCount}`);
  }
}

run();
