import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function run() {
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const userId = '1a36f301-9ce6-41bc-a313-3a0d53e080a6'; // amnayounus999@gmail.com

  const { data: dbRecs, error: dbErr } = await admin
    .from('client_databases')
    .select('supabase_url, service_role_key')
    .eq('user_id', userId)
    .single();

  if (dbErr || !dbRecs) {
    console.error('Error fetching client DB credentials:', dbErr);
    return;
  }

  const cdb = createClient(dbRecs.supabase_url, dbRecs.service_role_key);

  const { data: rawAnalytics, error: aErr } = await cdb
    .from('branch_analytics')
    .select('brand, branch_name, popular_times_grid')
    .limit(10);

  if (aErr || !rawAnalytics) {
    console.error('Error querying branch_analytics:', aErr);
    return;
  }

  console.log('=== POPULAR TIMES GRID DIAGNOSTIC ===');
  for (const row of rawAnalytics) {
    console.log(`\nBranch: ${row.branch_name} (${row.brand})`);
    if (!row.popular_times_grid) {
      console.log('  ❌ popular_times_grid is null');
      continue;
    }
    
    console.log('  grid keys:', Object.keys(row.popular_times_grid));
    for (const [day, hours] of Object.entries(row.popular_times_grid)) {
      const hArray = hours as (number | null)[];
      const sum = hArray.reduce((acc: number, val: number | null) => acc + (val || 0), 0);
      const nonNullCount = hArray.filter(v => v !== null).length;
      console.log(`    - ${day}: length=${hArray.length}, sum=${sum}, nonNullCount=${nonNullCount}, values (first 12):`, hArray.slice(0, 12));
    }
  }
}

run();
