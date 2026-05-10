import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { serverClient } from '@/lib/supabase';

const Schema = z.object({
  enabled: z.boolean().default(true),
  target_name: z.string().min(1),
  competitors: z.array(z.string()).min(1),
  refresh_token: z.string().min(20),
  email_to: z.string().email(),
  day_of_month: z.number().int().min(1).max(28).default(1),
});

export async function GET() {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data } = await sb.from('schedules').select('*').order('created_at', { ascending: false });
  // Strip refresh tokens from response
  const safe = (data || []).map(({ refresh_token, ...rest }: any) => ({
    ...rest, has_token: !!refresh_token,
  }));
  return NextResponse.json({ schedules: safe });
}

export async function POST(req: NextRequest) {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const next_run_at = computeNextRun(parsed.data.day_of_month).toISOString();

  const { data, error } = await sb.from('schedules').insert({
    ...parsed.data, user_id: user.id, next_run_at,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ schedule: data });
}

export async function DELETE(req: NextRequest) {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await sb.from('schedules').delete().eq('id', id).eq('user_id', user.id);
  return NextResponse.json({ ok: true });
}

function computeNextRun(dayOfMonth: number): Date {
  const now = new Date();
  // If today is before that day, run this month; otherwise next month
  const candidate = new Date(now.getFullYear(), now.getMonth(), dayOfMonth, 9, 0, 0);
  if (candidate <= now) candidate.setMonth(candidate.getMonth() + 1);
  return candidate;
}
