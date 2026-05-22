import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function run() {
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // 1. Fetch client database credentials
  const { data: dbRecs } = await admin
    .from('client_databases')
    .select('supabase_url, service_role_key');

  if (!dbRecs || dbRecs.length === 0) return;
  const creds = dbRecs[0];
  const cdb = createClient(creds.supabase_url, creds.service_role_key);

  const sourceJob = '77c2a7db-d9b8-4c12-9c4c-7c088ef3fa49';
  const targetJob = '5e35c158-02da-4994-a78d-dffce77721f4';

  console.log(`Copying data from ${sourceJob} to target job ${targetJob} in client DB so BOTH have complete records...`);

  // 2. Duplicate branch_analytics
  const { data: branchAnalytics } = await cdb
    .from('branch_analytics')
    .select('*')
    .eq('job_id', sourceJob);

  if (branchAnalytics && branchAnalytics.length > 0) {
    const recordsToInsert = branchAnalytics.map(row => {
      const { id, created_at, updated_at, ...rest } = row;
      return {
        ...rest,
        job_id: targetJob
      };
    });

    // Delete any existing records in targetJob first to avoid duplicates
    await cdb.from('branch_analytics').delete().eq('job_id', targetJob);

    const { error: baErr } = await cdb.from('branch_analytics').insert(recordsToInsert);
    if (baErr) {
      console.error('Error inserting copied branch_analytics:', baErr);
    } else {
      console.log(`Successfully copied ${recordsToInsert.length} branch_analytics records to target job.`);
    }
  }

  // 3. Duplicate analyses
  const { data: analyses } = await cdb
    .from('analyses')
    .select('*')
    .eq('job_id', sourceJob);

  if (analyses && analyses.length > 0) {
    const analysesToInsert = analyses.map(row => {
      const { id, created_at, updated_at, ...rest } = row;
      return {
        ...rest,
        job_id: targetJob
      };
    });

    // Delete any existing records in targetJob first to avoid duplicates
    await cdb.from('analyses').delete().eq('job_id', targetJob);

    const { error: aErr } = await cdb.from('analyses').insert(analysesToInsert);
    if (aErr) {
      console.error('Error inserting copied analyses:', aErr);
    } else {
      console.log(`Successfully copied ${analysesToInsert.length} analyses records to target job.`);
    }
  }
}

run();
