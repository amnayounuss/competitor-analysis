import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { serverClient, adminClient } from '@/lib/supabase';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

const CreateJob = z.object({
  target_name:     z.string().trim().min(1),
  competitors:     z.array(z.string().trim().min(1)).min(1),
  refresh_token:   z.string().trim().min(20),
  email_to:        z.string().trim().email(),
  date_start:      isoDate.optional(),
  date_end:        isoDate.optional(),
  search_location: z.string().trim().max(100).optional(),
}).refine(d => {
  if (!d.date_start || !d.date_end) return true;
  return d.date_start <= d.date_end;
}, { message: 'date_start must be on or before date_end', path: ['date_start'] })
  .refine(d => {
    if (!d.date_end) return true;
    return d.date_end <= new Date().toISOString().slice(0, 10);
  }, { message: 'date_end cannot be in the future', path: ['date_end'] })
  .refine(d => {
    if (!d.date_start || !d.date_end) return true;
    const s = new Date(d.date_start), e = new Date(d.date_end);
    const months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
    return months <= 12;
  }, { message: 'maximum range is 12 months', path: ['date_start'] });

export async function POST(req: NextRequest) {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Require connected client DB
  const admin = adminClient();
  const { data: conn } = await admin.from('client_databases')
    .select('last_test_ok').eq('user_id', user.id).maybeSingle();
  if (!conn?.last_test_ok) {
    return NextResponse.json(
      { error: 'You must connect your Supabase first. Visit /connect-database.' },
      { status: 412 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = CreateJob.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  // No duplicate active job
  const { count } = await sb.from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id).in('status', ['queued', 'running']);
  if ((count ?? 0) >= 1) {
    return NextResponse.json({ error: 'You already have an active job.' }, { status: 409 });
  }

  const { data: job, error } = await sb.from('jobs').insert({
    user_id: user.id, kind: 'manual', ...parsed.data,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ job });
}

export async function GET() {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: jobs } = await sb.from('jobs')
    .select('id, target_name, competitors, status, progress_pct, current_stage, queued_at, started_at, finished_at, branches_total, reviews_total, kind, excel_url')
    .order('queued_at', { ascending: false }).limit(50);
  return NextResponse.json({ jobs });
}
