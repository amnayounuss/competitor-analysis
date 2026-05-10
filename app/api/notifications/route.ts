import { NextRequest, NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase';

export async function GET() {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data } = await sb.from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30);

  return NextResponse.json({ notifications: data || [] });
}

export async function PATCH(req: NextRequest) {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (body?.markAllRead) {
    await sb.from('notifications').update({ read_at: new Date().toISOString() })
      .is('read_at', null).eq('user_id', user.id);
    return NextResponse.json({ ok: true });
  }
  if (body?.id) {
    await sb.from('notifications').update({ read_at: new Date().toISOString() })
      .eq('id', body.id);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'no action' }, { status: 400 });
}
