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

  const sourceJob = '5e35c158-02da-4994-a78d-dffce77721f4';
  const targetJob = '77c2a7db-d9b8-4c12-9c4c-7c088ef3fa49';

  console.log(`Reassigning data from ${sourceJob} to ${targetJob} inside client DB...`);

  // Update branch_analytics
  const { count: baCount, error: baErr } = await cdb
    .from('branch_analytics')
    .update({ job_id: targetJob })
    .eq('job_id', sourceJob);

  if (baErr) {
    console.error('Error updating branch_analytics:', baErr);
  } else {
    console.log(`Updated branch_analytics records.`);
  }

  // Update analyses
  const { count: aCount, error: aErr } = await cdb
    .from('analyses')
    .update({ job_id: targetJob })
    .eq('job_id', sourceJob);

  if (aErr) {
    console.error('Error updating analyses:', aErr);
  } else {
    console.log(`Updated analyses records.`);
  }
}

run();
