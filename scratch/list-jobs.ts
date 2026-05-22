import 'dotenv/config';
import { adminClient } from '../lib/supabase';

async function main() {
  const sb = adminClient();
  const { data: jobs, error } = await sb
    .from('jobs')
    .select('id, target_name, status, progress_pct, queued_at, started_at, finished_at, error_message')
    .order('queued_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('Error fetching jobs:', error.message);
    return;
  }

  console.log('\nRECENT JOBS IN DATABASE:');
  console.log('========================================================================');
  for (const job of jobs || []) {
    console.log(`ID:       ${job.id}`);
    console.log(`Target:   ${job.target_name}`);
    console.log(`Status:   ${job.status}`);
    console.log(`Progress: ${job.progress_pct}%`);
    console.log(`Queued:   ${job.queued_at}`);
    console.log(`Started:  ${job.started_at}`);
    console.log(`Finished: ${job.finished_at}`);
    console.log(`Error:    ${job.error_message || 'None'}`);
    console.log('------------------------------------------------------------------------');
  }
}

main().catch(console.error);
