import { NextResponse } from 'next/server';
import { serverClient, adminClient } from '@/lib/supabase';
import { getClientDbCreds, clientDbClient } from '@/lib/client-db';

/**
 * Throw away a dead analysis.
 *
 * Anything except a run still in progress. Failed and cancelled runs are dead
 * ends; a succeeded one can also be wrong — a client had two runs that each
 * reported one branch and 22 reviews instead of 29 and 2,408, and refusing to
 * remove them left permanently misleading figures in the history. A run that is
 * queued or running is still writing, so those stay protected.
 *
 * What it removes is scoped by job_id, and that scoping matters. Branch rows
 * with no job attached belong to the review sync and carry the client's whole
 * review corpus — an analysis reuses those rows rather than duplicating them,
 * so deleting the job must leave them exactly where they are.
 */
export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
) {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = adminClient();

  const { data: profile } = await admin
    .from('profiles').select('role, parent_user_id').eq('id', user.id).maybeSingle();
  if (profile?.role === 'viewer') {
    return NextResponse.json({ error: 'Viewers cannot delete analyses.' }, { status: 403 });
  }

  const { data: job } = await admin
    .from('jobs').select('user_id, status, target_name').eq('id', params.id).maybeSingle();
  if (!job) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (job.user_id !== user.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  if (job.status === 'running' || job.status === 'queued') {
    return NextResponse.json(
      { error: 'Stop the analysis first — it is still running.' }, { status: 400 });
  }

  // Client-schema rows first. Best-effort per table: a schema that predates one
  // of them should not block the deletion of the rest.
  const removed: Record<string, number | string> = {};
  try {
    const cdb = clientDbClient(await getClientDbCreds(job.user_id));
    for (const table of ['branch_analytics', 'gbp_metrics', 'reviews', 'analyses', 'reports', 'branches']) {
      const { error, count } = await cdb
        .from(table).delete({ count: 'exact' }).eq('job_id', params.id);
      removed[table] = error ? `skipped (${error.message.slice(0, 40)})` : (count ?? 0);
    }
  } catch {
    removed.clientDb = 'unreachable — job row still removed';
  }

  // Logs and notifications reference the job; clear them before the job itself
  // so nothing is left pointing at a row that no longer exists.
  await admin.from('job_logs').delete().eq('job_id', params.id);
  await admin.from('notifications').delete().eq('job_id', params.id);

  const { error } = await admin.from('jobs').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, removed });
}
