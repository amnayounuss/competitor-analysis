import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function run() {
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const userId = '1a36f301-9ce6-41bc-a313-3a0d53e080a6';

  const { data: jobs, error } = await admin
    .from('jobs')
    .select('*')
    .eq('user_id', userId);

  if (error) {
    console.error('Error fetching jobs:', error);
  } else {
    console.log(`Found ${jobs?.length} jobs for user ${userId}:`, JSON.stringify(jobs, null, 2));
  }
}

run();
