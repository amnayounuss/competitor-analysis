import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { serverClient, adminClient } from '@/lib/supabase';
import { getClientDbCreds, clientDbClient } from '@/lib/client-db';
import { startPerformanceSync, getSyncState } from '@/lib/performance-sync';


async function resolveUser() {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: 'unauthorized' as const, status: 401 };
  const { data: profile } = await adminClient()
    .from('profiles').select('role, parent_user_id').eq('id', user.id).maybeSingle();
  return {
    user,
    role: profile?.role || 'client',
    effectiveUserId: profile?.role === 'viewer' && profile.parent_user_id ? profile.parent_user_id : user.id,
  };
}

/** Performance figures for a date range, plus when they were last refreshed. */
export async function GET(req: NextRequest) {
  const ctx = await resolveUser();
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const sp = new URL(req.url).searchParams;
  const from = sp.get('from');
  const to   = sp.get('to');

  let payload: any = { totals: [], daily: [], heatmap: [], schemaReady: true };
  try {
    const cdb = clientDbClient(await getClientDbCreds(ctx.effectiveUserId));

    // Totals and the weekday grid are derived from the same rows the daily view
    // reads, so all three are filtered by the same dates rather than the views'
    // own defaults — otherwise the tiles and the chart disagree.
    let metrics = cdb.from('gbp_metrics').select('metric, metric_date, value, gmb_location_id, branch_name, brand');
    if (from) metrics = metrics.gte('metric_date', from);
    if (to)   metrics = metrics.lte('metric_date', to);
    const { data: rows, error } = await metrics.limit(100000);

    if (error) payload.schemaReady = false;
    else payload.rows = rows || [];
  } catch {
    payload.schemaReady = false;
  }

  const { data: row } = await adminClient()
    .from('client_databases')
    .select('performance_synced_at, gmb_refresh_token')
    .eq('user_id', ctx.effectiveUserId).maybeSingle();

  return NextResponse.json({
    ...payload,
    lastSyncedAt: row?.performance_synced_at ?? null,
    connected: !!row?.gmb_refresh_token,
    sync: getSyncState(ctx.effectiveUserId),
  });
}

const SyncBody = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).refine(d => d.from <= d.to, { message: 'The start date must be on or before the end date.' })
  .refine(d => d.to <= new Date().toISOString().slice(0, 10), { message: 'The end date cannot be in the future.' });

/**
 * Start a refresh from Google and return at once.
 *
 * The fetch itself takes tens of seconds to minutes, so it runs in the
 * background and the page polls GET for progress — see startPerformanceSync.
 */
export async function POST(req: NextRequest) {
  const ctx = await resolveUser();
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  if (ctx.role === 'viewer') return NextResponse.json({ error: 'Viewers cannot refresh figures.' }, { status: 403 });

  const parsed = SyncBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message || 'Pick a valid date range.';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const already = getSyncState(ctx.effectiveUserId);
  if (already?.running) {
    return NextResponse.json({ started: false, sync: already, alreadyRunning: true }, { status: 202 });
  }

  const state = startPerformanceSync({
    userId: ctx.effectiveUserId,
    from: parsed.data.from,
    to: parsed.data.to,
  });
  return NextResponse.json({ started: true, sync: state }, { status: 202 });
}
