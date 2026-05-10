import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { serverClient, adminClient } from '@/lib/supabase';

async function requireAdmin() {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: 'unauthorized', status: 401 as const };
  const { data: profile } = await sb.from('profiles').select('is_admin').eq('id', user.id).single();
  if (!profile?.is_admin) return { error: 'forbidden', status: 403 as const };
  return { user };
}

// ── GET — list users with their job counts
export async function GET() {
  const auth = await requireAdmin();
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sb = adminClient();
  const { data: profiles, error } = await sb
    .from('profiles')
    .select('id, email, full_name, is_admin, created_at')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Count jobs per user
  const { data: jobs } = await sb.from('jobs').select('user_id, status');
  const counts: Record<string, { total: number; running: number }> = {};
  for (const j of jobs || []) {
    counts[j.user_id] ??= { total: 0, running: 0 };
    counts[j.user_id].total += 1;
    if (j.status === 'running' || j.status === 'queued') counts[j.user_id].running += 1;
  }

  return NextResponse.json({
    users: (profiles || []).map(p => ({
      ...p,
      jobs_total:   counts[p.id]?.total   || 0,
      jobs_active:  counts[p.id]?.running || 0,
    })),
  });
}

// ── POST — create a new user (admin invites)
const CreateUser = z.object({
  email:    z.string().email(),
  password: z.string().min(8),
  full_name: z.string().optional(),
  is_admin: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid' }, { status: 400 }); }
  const parsed = CreateUser.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const sb = adminClient();
  const { data: created, error } = await sb.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: { full_name: parsed.data.full_name || parsed.data.email },
  });
  if (error || !created.user) return NextResponse.json({ error: error?.message || 'create failed' }, { status: 500 });

  if (parsed.data.is_admin) {
    await sb.from('profiles').update({ is_admin: true }).eq('id', created.user.id);
  }
  return NextResponse.json({ ok: true, user: { id: created.user.id, email: created.user.email } });
}

// ── DELETE — remove a user (with safety: can't delete the last admin)
export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin();
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('id');
  if (!userId) return NextResponse.json({ error: 'id required' }, { status: 400 });

  // Don't let the admin delete themselves
  if (userId === auth.user.id) {
    return NextResponse.json({ error: 'cannot delete yourself' }, { status: 400 });
  }

  const sb = adminClient();
  // Cascade — profile + jobs + job_logs all deleted via FK ON DELETE CASCADE
  const { error } = await sb.auth.admin.deleteUser(userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
