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

  const { data, error } = await cdb
    .from('branch_analytics')
    .select('job_id, brand');

  if (error) {
    console.error('Error fetching branch analytics:', error);
  } else {
    const counts: Record<string, Record<string, number>> = {};
    for (const row of data || []) {
      const j = row.job_id;
      const b = row.brand;
      if (!counts[j]) counts[j] = {};
      counts[j][b] = (counts[j][b] || 0) + 1;
    }
    console.log('Current branch_analytics counts in DB:', JSON.stringify(counts, null, 2));
  }
}

run();
