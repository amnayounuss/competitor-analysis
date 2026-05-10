import 'dotenv/config';
import { adminClient } from '../lib/supabase';
import { runJob } from '../lib/job-runner';
import { startScheduler } from '../lib/scheduler';
import type { Job } from '../lib/types';

const POLL_MS = parseInt(process.env.WORKER_POLL_INTERVAL_MS || '5000', 10);

let stopping = false;
process.on('SIGINT',  () => { console.log('\n[worker] SIGINT'); stopping = true; });
process.on('SIGTERM', () => { console.log('\n[worker] SIGTERM'); stopping = true; });

console.log(`[worker] starting — poll every ${POLL_MS}ms`);

// Start both loops concurrently
startScheduler().catch(e => console.error('[scheduler] crashed', e));
mainLoop().catch(e => console.error('[worker] crashed', e));

async function mainLoop() {
  while (!stopping) {
    try {
      const job = await claimNextJob();
      if (job) {
        console.log(`[worker] claimed job ${job.id} for ${job.target_name}`);
        await runJob(job);
      } else {
        await sleep(POLL_MS);
      }
    } catch (err) {
      console.error('[worker] poll loop error', err);
      await sleep(POLL_MS);
    }
  }
  console.log('[worker] exited');
}

async function claimNextJob(): Promise<Job | null> {
  const sb = adminClient();
  const { data: queued } = await sb.from('jobs').select('*')
    .eq('status', 'queued').order('queued_at').limit(1);
  if (!queued || queued.length === 0) return null;
  const candidate = queued[0] as Job;

  const { data: claimed } = await sb.from('jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', candidate.id).eq('status', 'queued')
    .select().single();
  return (claimed as Job) || null;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
