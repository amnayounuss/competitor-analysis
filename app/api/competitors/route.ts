import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { serverClient, adminClient } from '@/lib/supabase';
import { getClientDbCreds, clientDbClient } from '@/lib/client-db';

/** Resolve who we are acting for — a viewer reads their parent's data. */
async function resolveUser() {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: 'unauthorized' as const, status: 401 };

  const admin = adminClient();
  const { data: profile } = await admin.from('profiles')
    .select('role, parent_user_id').eq('id', user.id).maybeSingle();

  const effectiveUserId = profile?.role === 'viewer' && profile.parent_user_id
    ? profile.parent_user_id
    : user.id;

  return { user, role: profile?.role || 'client', effectiveUserId };
}

/** The candidate list, plus the settings the module's controls bind to. */
export async function GET() {
  const ctx = await resolveUser();
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const admin = adminClient();
  const { data: row } = await admin
    .from('client_databases')
    .select('gmb_refresh_token, discovery_radius_m, discovery_max_per_location, discovery_min_colocation, discovery_last_run_at')
    .eq('user_id', ctx.effectiveUserId)
    .maybeSingle();

  let candidates: any[] = [];
  let schemaReady = true;
  try {
    const cdb = clientDbClient(await getClientDbCreds(ctx.effectiveUserId));
    const res = await cdb
      .from('competitor_candidates')
      .select('*')
      .order('co_location_count', { ascending: false })
      .order('total_reviews', { ascending: false });
    // Absent table means this schema predates client migration 009.
    if (res.error) schemaReady = false;
    else candidates = res.data || [];
  } catch {
    schemaReady = false;
  }

  return NextResponse.json({
    candidates,
    schemaReady,
    // Never return the token itself — only whether one is stored.
    hasToken: !!row?.gmb_refresh_token,
    settings: {
      radiusM: row?.discovery_radius_m ?? 5000,
      maxPerLocation: row?.discovery_max_per_location ?? 20,
      minCoLocation: row?.discovery_min_colocation ?? 2,
    },
    lastRunAt: row?.discovery_last_run_at ?? null,
  });
}

const PutBody = z.object({
  refresh_token: z.string().trim().min(20).optional(),
  radiusM:        z.number().int().min(500).max(50000).optional(),
  maxPerLocation: z.number().int().min(5).max(60).optional(),
  minCoLocation:  z.number().int().min(1).max(50).optional(),
});

/** Save the refresh token and the discovery tuning. */
export async function PUT(req: NextRequest) {
  const ctx = await resolveUser();
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  if (ctx.role === 'viewer') return NextResponse.json({ error: 'Viewers cannot change settings.' }, { status: 403 });

  const parsed = PutBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.refresh_token)         patch.gmb_refresh_token = parsed.data.refresh_token;
  if (parsed.data.radiusM        != null) patch.discovery_radius_m = parsed.data.radiusM;
  if (parsed.data.maxPerLocation != null) patch.discovery_max_per_location = parsed.data.maxPerLocation;
  if (parsed.data.minCoLocation  != null) patch.discovery_min_colocation = parsed.data.minCoLocation;

  const { error } = await adminClient()
    .from('client_databases').update(patch).eq('user_id', ctx.effectiveUserId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

const PatchBody = z.object({
  brand_keys: z.array(z.string().min(1)).min(1).max(500),
  status: z.enum(['suggested', 'confirmed', 'rejected']),
});

/** Confirm or reject candidates. This is what feeds the analysis dropdown. */
export async function PATCH(req: NextRequest) {
  const ctx = await resolveUser();
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  if (ctx.role === 'viewer') return NextResponse.json({ error: 'Viewers cannot change competitors.' }, { status: 403 });

  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const cdb = clientDbClient(await getClientDbCreds(ctx.effectiveUserId));
  const { error } = await cdb
    .from('competitor_candidates')
    .update({
      status: parsed.data.status,
      decided_at: parsed.data.status === 'suggested' ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .in('brand_key', parsed.data.brand_keys);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, updated: parsed.data.brand_keys.length });
}
