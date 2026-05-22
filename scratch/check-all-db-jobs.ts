import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function run() {
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: jobs, error } = await admin
    .from('jobs')
    .select('id, user_id, target_name, status, finished_at');

  if (error) {
    console.error('Error fetching jobs:', error);
  } else {
    console.log('Current jobs in admin database:', JSON.stringify(jobs, null, 2));
  }
}

run();
