import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { serverClient } from '@/lib/supabase';
import { sendTestEmail } from '@/lib/email';

const Body = z.object({ to: z.string().email() });

export async function POST(req: NextRequest) {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { data: profile } = await sb.from('profiles').select('role, is_admin').eq('id', user.id).single();
  if (profile?.role !== 'admin' && !profile?.is_admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid' }, { status: 400 }); }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid email' }, { status: 400 });

  try {
    await sendTestEmail(parsed.data.to);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'email failed' }, { status: 500 });
  }
}
