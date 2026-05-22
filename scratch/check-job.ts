import 'dotenv/config';
import { adminClient } from '../lib/supabase';

async function main() {
  const sb = adminClient();
  const { data: jobs, error: err } = await sb
    .from('jobs')
    .select('*')
    .order('queued_at', { ascending: false })
    .limit(1);

  if (err || !jobs || jobs.length === 0) {
    console.error('Failed to fetch latest job:', err?.message || 'No jobs found');
    return;
  }

  const job = jobs[0];
  console.log('\n========================================');
  console.log(`LATEST JOB: ${job.id}`);
  console.log(`Target:     ${job.target_name}`);
  console.log(`Status:     ${job.status}`);
  console.log(`Progress:   ${job.progress_pct}% (${job.current_stage})`);
  console.log(`Started:    ${job.started_at}`);
  console.log(`Finished:   ${job.finished_at}`);
  console.log(`Error:      ${job.error_message || 'None'}`);
  console.log('========================================');

  const { data: logs } = await sb
    .from('job_logs')
    .select('*')
    .eq('job_id', job.id)
    .order('created_at', { ascending: true });

  console.log('\nLOGS:');
  if (!logs || logs.length === 0) {
    console.log('No logs found for this job.');
  } else {
    for (const log of logs) {
      console.log(`[${log.created_at}] [${log.level.toUpperCase()}] ${log.message}`);
    }
  }
  console.log('========================================\n');
}

main().catch(console.error);
