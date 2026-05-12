const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data: logs } = await sb.from('job_logs').select('message, created_at').order('created_at', { ascending: false }).limit(20);
  console.log('Latest System Logs:', JSON.stringify(logs, null, 2));

  const { data: jobs } = await sb.from('jobs').select('id, target_name, status, branches_total').order('queued_at', { ascending: false }).limit(5);
  console.log('Recent Jobs:', JSON.stringify(jobs, null, 2));
}

check();
