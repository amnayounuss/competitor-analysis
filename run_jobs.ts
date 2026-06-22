import 'dotenv/config';
// Hard-suppress the client report email for these data-correction re-runs,
// regardless of how the process was launched.
process.env.SUPPRESS_REPORT_EMAIL = 'true';
import { adminClient } from './lib/supabase';
import { runJob } from './lib/job-runner';
import type { Job } from './lib/types';

// Controlled, SEQUENTIAL re-run of specific jobs with the new (Places-API)
// pipeline. No queue involved → no second worker can race these jobs.
// Run with: SUPPRESS_REPORT_EMAIL=true npx tsx run_jobs.ts
// Optionally pass specific job IDs as CLI args; defaults to both.
const DEFAULT_JOBS = [
  'bd584eac-0497-4a20-a23e-dc1eb323672a', // Anoosh + Bostani
  'b2f9a8c4-1c29-4356-8c7f-50c3d4d0b932', // Anoosh + Tawa
];
const JOB_IDS = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_JOBS;

(async () => {
  const sb = adminClient();
  for (const id of JOB_IDS) {
    const { data, error } = await sb.from('jobs').select('*').eq('id', id).single();
    if (error || !data) { console.error(`[run_jobs] cannot load ${id}: ${error?.message}`); continue; }
    console.log(`\n████ RUNNING JOB ${id} — ${data.target_name} / ${(data.competitors?.[0]||'').split('|')[0]} ████`);
    try {
      await runJob(data as Job);
      console.log(`████ DONE ${id} ████`);
    } catch (e: any) {
      console.error(`████ JOB ${id} THREW: ${e?.message || e} ████`);
    }
  }
  console.log('\n[run_jobs] all jobs processed');
  process.exit(0);
})();
