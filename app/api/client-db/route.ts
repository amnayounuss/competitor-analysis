import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { serverClient, adminClient } from '@/lib/supabase';
import { testClientDb } from '@/lib/client-db';

const Schema = z.object({
  supabase_url: z.string().url(),
  service_role_key: z.string().min(40),
  anthropic_api_key: z.string().optional(),
});

// ── POST /api/client-db/test — validate without saving
export async function POST(req: NextRequest) {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  const result = await testClientDb(parsed.data);
  return NextResponse.json(result);
}

// ── PUT /api/client-db — save creds (after test passed)
export async function PUT(req: NextRequest) {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  const test = await testClientDb(parsed.data);
  if (!test.ok) {
    return NextResponse.json({ error: 'connection test failed: ' + test.error }, { status: 400 });
  }
  if (!test.schemaReady) {
    return NextResponse.json({ error: 'schema not ready: ' + test.error }, { status: 400 });
  }

  const admin = adminClient();
  const upsertData: any = {
    user_id: user.id,
    supabase_url: parsed.data.supabase_url,
    service_role_key: parsed.data.service_role_key,
    last_test_ok: true,
    last_test_at: new Date().toISOString(),
    last_test_error: null,
    updated_at: new Date().toISOString(),
  };
  if (parsed.data.anthropic_api_key) {
    upsertData.anthropic_api_key = parsed.data.anthropic_api_key;
  }
  const { error } = await admin.from('client_databases').upsert(upsertData, { onConflict: 'user_id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// ── GET /api/client-db — read masked status
export async function GET() {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = adminClient();
  const { data: profile } = await admin.from('profiles').select('role, parent_user_id, is_admin').eq('id', user.id).maybeSingle();
  const dbUserId = profile?.role === 'viewer' && profile.parent_user_id ? profile.parent_user_id : user.id;

  const { data } = await admin.from('client_databases')
    .select('supabase_url, last_test_ok, last_test_at, last_test_error, updated_at')
    .eq('user_id', dbUserId).maybeSingle();

  return NextResponse.json({ connection: data || null });
}
