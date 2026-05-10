import { NextRequest, NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: job, error: jErr } = await sb
    .from('jobs')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single();

  if (jErr || !job) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Don't leak the refresh token back to the client
  const { refresh_token, ...safe } = job;

  const { data: logs } = await sb
    .from('job_logs')
    .select('id, level, message, created_at')
    .eq('job_id', params.id)
    .order('created_at', { ascending: true })
    .limit(500);

  return NextResponse.json({ job: safe, logs: logs || [] });
}
