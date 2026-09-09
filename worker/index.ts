import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { adminClient } from '../lib/supabase';
import { runJob } from '../lib/job-runner';
import { startScheduler } from '../lib/scheduler';
import type { Job } from '../lib/types';

const POLL_MS = parseInt(process.env.WORKER_POLL_INTERVAL_MS || '5000', 10);

let stopping = false;
process.on('SIGINT',  () => { console.log('\n[worker] SIGINT'); stopping = true; });
process.on('SIGTERM', () => { console.log('\n[worker] SIGTERM'); stopping = true; });

/**
 * dotenv reads .env once, at import. Change the file and this process keeps the
 * old values until somebody restarts it — which is how a client's first
 * analysis failed with "Client schema missing" for twenty minutes after the
 * schema was demonstrably there: the worker was still resolving Supabase
 * through an address it could no longer reach.
 *
 * So the worker prints what it resolved, and exits when the file changes.
 */
const ENV_FILE = path.join(process.cwd(), '.env');
const envStamp = () => {
  try { return fs.statSync(ENV_FILE).mtimeMs; } catch { return 0; }
};
const startedWithEnvAt = envStamp();

console.log(`[worker] starting — poll every ${POLL_MS}ms`);
// Printed so a stale worker is visible in the log rather than only in its
// symptoms.
console.log('[worker] supabase   : ' + (process.env.SUPABASE_INTERNAL_URL
  || process.env.NEXT_PUBLIC_SUPABASE_URL || '(unset!)'));
console.log('[worker] .env loaded: ' + (startedWithEnvAt ? new Date(startedWithEnvAt).toISOString() : 'no .env found'));

// Start both loops concurrently
startScheduler().catch(e => console.error('[scheduler] crashed', e));
mainLoop().catch(e => console.error('[worker] crashed', e));

async function mainLoop() {
  while (!stopping) {
    try {
      // Checked between jobs only: a restart must never interrupt a run in
      // progress. PM2 brings the worker straight back with the new values.
      if (envStamp() !== startedWithEnvAt) {
        console.log('[worker] .env changed since startup — exiting so PM2 restarts with the new settings');
        process.exit(0);
      }

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
