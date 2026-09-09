import { NextResponse } from 'next/server';
import { serverClient, adminClient } from '@/lib/supabase';
import { runDiscovery, DiscoveryError } from '@/lib/competitor-discovery';

/**
 * Run discovery now.
 *
 * Synchronous on purpose: a full run is roughly 35 seconds for 29 locations, so
 * the client can wait on it and see the result. It is also billed per Places
 * call, which is a reason to keep it explicit and user-triggered rather than
 * something that fires on its own.
 */
export const maxDuration = 300;

export async function POST() {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = adminClient();
  const { data: profile } = await admin.from('profiles')
    .select('role, parent_user_id').eq('id', user.id).maybeSingle();
  if (profile?.role === 'viewer') {
    return NextResponse.json({ error: 'Viewers cannot run discovery.' }, { status: 403 });
  }

  try {
    const result = await runDiscovery(user.id, msg => console.log('[discovery]', msg));
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    if (err instanceof DiscoveryError) {
      // 409 for "you need to do something first", 502 for a genuine failure.
      const status = err.kind === 'failed' ? 502 : 409;
      return NextResponse.json({ error: err.message, kind: err.kind }, { status });
    }
    console.error('[discovery] unexpected', err);
    return NextResponse.json({ error: err?.message || 'Discovery failed' }, { status: 500 });
  }
}
