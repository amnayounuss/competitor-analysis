import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { serverClient, adminClient } from '@/lib/supabase';

async function requireClient() {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: 'unauthorized', status: 401 as const };
  const admin = adminClient();
  const { data: profile } = await admin.from('profiles').select('role, is_admin').eq('id', user.id).single();
  const role = profile?.role === 'viewer' ? 'viewer' : profile?.role === 'admin' || profile?.is_admin ? 'admin' : 'client';
  if (role !== 'client') return { error: 'Only clients can manage team members.', status: 403 as const };
  return { user };
}

export async function GET() {
  const auth = await requireClient();
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sb = adminClient();
  const { data: viewers } = await sb
    .from('profiles')
    .select('id, email, full_name, created_at')
    .eq('role', 'viewer')
    .eq('parent_user_id', auth.user.id)
    .order('created_at', { ascending: false });

  return NextResponse.json({ viewers: viewers || [] });
}

const CreateViewer = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireClient();
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid body' }, { status: 400 }); }
  const parsed = CreateViewer.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const sb = adminClient();
  const { data: created, error } = await sb.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: {
      full_name: parsed.data.full_name || parsed.data.email,
      role: 'viewer',
      parent_user_id: auth.user.id,
    },
  });

  if (error || !created.user) {
    return NextResponse.json({ error: error?.message || 'Failed to create viewer' }, { status: 500 });
  }

  await sb.from('profiles').update({
    role: 'viewer',
    parent_user_id: auth.user.id,
  }).eq('id', created.user.id);

  return NextResponse.json({ ok: true, viewer: { id: created.user.id, email: created.user.email } });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireClient();
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(req.url);
  const viewerId = searchParams.get('id');
  if (!viewerId) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const sb = adminClient();
  const { data: viewer } = await sb.from('profiles')
    .select('id, parent_user_id, role')
    .eq('id', viewerId).single();

  if (!viewer || viewer.role !== 'viewer' || viewer.parent_user_id !== auth.user.id) {
    return NextResponse.json({ error: 'Viewer not found or not yours' }, { status: 404 });
  }

  const { error } = await sb.auth.admin.deleteUser(viewerId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
