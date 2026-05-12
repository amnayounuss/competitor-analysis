import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase';

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Verify ownership and status
  const { data: job } = await sb
    .from('jobs')
    .select('user_id, status')
    .eq('id', params.id)
    .single();

  if (!job) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (job.user_id !== user.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  
  if (job.status !== 'running' && job.status !== 'queued') {
    return NextResponse.json({ error: 'job is not active' }, { status: 400 });
  }

  // Update status to cancelled
  const { error } = await sb
    .from('jobs')
    .update({ 
      status: 'cancelled', 
      finished_at: new Date().toISOString(),
      current_stage: 'Cancelled by user'
    })
    .eq('id', params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
