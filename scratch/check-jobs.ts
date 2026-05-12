import { adminClient } from '../lib/supabase';

async function check() {
  const sb = adminClient();
  const { data: jobs } = await sb.from('jobs').select('id, status, error_message').order('queued_at', { ascending: false }).limit(5);
  console.log('Recent Jobs:', JSON.stringify(jobs, null, 2));

  if (jobs?.[0]) {
    const { data: logs } = await sb.from('job_logs').select('message').eq('job_id', jobs[0].id).order('created_at', { ascending: false }).limit(10);
    console.log('Latest Logs for Job', jobs[0].id, ':', JSON.stringify(logs, null, 2));
  }
}

check();
