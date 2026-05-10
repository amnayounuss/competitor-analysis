/**
 * Scheduler — runs alongside the worker.
 *
 * Every minute, scans for schedules whose next_run_at is due, and creates
 * a `jobs` row from them. The worker then picks them up like any other job.
 */
import { adminClient } from './supabase';

const CHECK_INTERVAL_MS = 60_000;

let stopping = false;
export function stopScheduler() { stopping = true; }

export async function startScheduler() {
  console.log('[scheduler] started — checks every 60s');
  while (!stopping) {
    try {
      await tick();
    } catch (e) {
      console.error('[scheduler] tick failed', e);
    }
    await sleep(CHECK_INTERVAL_MS);
  }
}

async function tick() {
  const sb = adminClient();
  const { data: due, error } = await sb
    .from('schedules')
    .select('*')
    .eq('enabled', true)
    .lte('next_run_at', new Date().toISOString())
    .limit(20);

  if (error) { console.error('[scheduler] query failed', error); return; }
  if (!due || due.length === 0) return;

  console.log(`[scheduler] ${due.length} schedule(s) due`);

  for (const s of due) {
    // Insert a job row
    const { data: created, error: insErr } = await sb.from('jobs').insert({
      user_id:       s.user_id,
      kind:          'scheduled',
      schedule_id:   s.id,
      target_name:   s.target_name,
      competitors:   s.competitors,
      refresh_token: s.refresh_token,
      email_to:      s.email_to,
    }).select('id').single();

    if (insErr || !created) {
      console.error('[scheduler] failed to create job for schedule', s.id, insErr);
      continue;
    }

    // Advance next_run_at to the same day next month
    const next = computeNextRun(s.day_of_month);
    await sb.from('schedules').update({
      last_run_at: new Date().toISOString(),
      last_job_id: created.id,
      next_run_at: next.toISOString(),
    }).eq('id', s.id);

    console.log(`[scheduler] created job ${created.id} for schedule ${s.id}, next run ${next.toISOString()}`);
  }
}

function computeNextRun(dayOfMonth: number): Date {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, dayOfMonth, 9, 0, 0);  // 9am 1st of next month
  return next;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
