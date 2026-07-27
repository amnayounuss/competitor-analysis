import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { serverClient, adminClient } from '@/lib/supabase';
import { testClientDb } from '@/lib/client-db';
import { provisionClientSchema } from '@/lib/provision-client-schema';

const CloudSchema = z.object({
  supabase_url: z.string().url(),
  service_role_key: z.string().min(40),
  anthropic_api_key: z.string().optional(),
});

// ── POST /api/client-db — provision self-hosted schema OR test cloud creds
export async function POST(req: NextRequest) {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);

  // Self-hosted: auto-provision (no body or { mode: 'provision' })
  if (!body || body.mode === 'provision') {
    try {
      const schemaName = await provisionClientSchema(user.id);
      return NextResponse.json({ ok: true, schema_name: schemaName });
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
  }

  // Cloud mode: test external credentials
  const parsed = CloudSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  const result = await testClientDb({
    ...parsed.data,
    schema_name: null,
  });
  return NextResponse.json(result);
}

// ── PUT /api/client-db — save cloud creds (after test passed) + optional anthropic key
export async function PUT(req: NextRequest) {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);

  // Anthropic key update (works for both self-hosted and cloud)
  if (body?.anthropic_api_key !== undefined) {
    const admin = adminClient();
    const { error } = await admin.from('client_databases')
      .update({ anthropic_api_key: body.anthropic_api_key, updated_at: new Date().toISOString() })
      .eq('user_id', user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Cloud mode: save external creds
  const parsed = CloudSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  const test = await testClientDb({ ...parsed.data, schema_name: null });
  if (!test.ok) {
    return NextResponse.json({ error: 'connection test failed: ' + test.error }, { status: 400 });
  }
  if (!test.schemaReady) {
    return NextResponse.json({ error: 'schema not ready: ' + test.error }, { status: 400 });
  }

  const admin = adminClient();
  const { error } = await admin.from('client_databases').upsert({
    user_id: user.id,
    supabase_url: parsed.data.supabase_url,
    service_role_key: parsed.data.service_role_key,
    schema_name: null,
    last_test_ok: true,
    last_test_at: new Date().toISOString(),
    last_test_error: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// ── GET /api/client-db — read connection status
export async function GET() {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = adminClient();
  const { data: profile } = await admin.from('profiles').select('role, parent_user_id').eq('id', user.id).maybeSingle();
  const dbUserId = profile?.role === 'viewer' && profile.parent_user_id ? profile.parent_user_id : user.id;

  const { data } = await admin.from('client_databases')
    .select('supabase_url, schema_name, last_test_ok, last_test_at, last_test_error, updated_at')
    .eq('user_id', dbUserId).maybeSingle();

  return NextResponse.json({ connection: data || null });
}
