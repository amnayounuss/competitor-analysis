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

  console.log('=== ADMIN "jobs" TABLE RECORDS ===');
  const { data: jobs, error: jErr } = await admin
    .from('jobs')
    .select('*');
  
  if (jErr) {
    console.error('Error fetching jobs:', jErr);
  } else {
    console.log(JSON.stringify(jobs, null, 2));
  }

  console.log('\n=== CLIENT "analyses" TABLE RECORDS ===');
  const { data: analyses, error: aErr } = await cdb
    .from('analyses')
    .select('*');

  if (aErr) {
    console.error('Error fetching analyses:', aErr);
  } else {
    console.log(JSON.stringify(analyses, null, 2));
  }
}

run();
