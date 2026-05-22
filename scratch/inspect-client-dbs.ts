import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function run() {
  const admin = createClient(supabaseUrl, serviceRoleKey);

  console.log('=== ADMIN "client_databases" CONNECTIONS ===');
  const { data: dbs, error: dbErr } = await admin
    .from('client_databases')
    .select('user_id, supabase_url, last_test_ok');

  if (dbErr) {
    console.error('Error fetching client databases:', dbErr);
  } else {
    console.log(JSON.stringify(dbs, null, 2));
  }
}

run();
