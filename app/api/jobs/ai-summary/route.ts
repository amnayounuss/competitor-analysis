import { NextRequest, NextResponse } from 'next/server';
import { serverClient, adminClient } from '@/lib/supabase';
import { getClientDbCreds, clientDbClient } from '@/lib/client-db';
import { generateAiSummary } from '@/lib/anthropic';

export async function POST(req: NextRequest) {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const jobId = body?.jobId;
  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }

  const admin = adminClient();
  
  // 1. Fetch job from admin DB to verify ownership and extract brand names
  const { data: job, error: jobErr } = await admin
    .from('jobs')
    .select('id, user_id, target_name, competitors')
    .eq('id', jobId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (jobErr || !job) {
    return NextResponse.json({ error: 'Job not found or unauthorized' }, { status: 404 });
  }

  // 2. Guard against missing Anthropic API Key
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'Anthropic API key is not configured in your .env file. Please add ANTHROPIC_API_KEY.' },
      { status: 412 }
    );
  }

  try {
    // 3. Connect to client DB using client credentials
    const creds = await getClientDbCreds(user.id);
    const cdb = clientDbClient(creds);

    // 4. Fetch branch analytics and brand comparisons
    const [analyticsRes, analysesRes] = await Promise.all([
      cdb.from('branch_analytics').select('*').eq('job_id', jobId),
      cdb.from('analyses').select('*').eq('job_id', jobId),
    ]);

    const analytics = analyticsRes.data || [];
    const analyses = analysesRes.data || [];

    if (analytics.length === 0) {
      return NextResponse.json(
        { error: 'No branch analytical data found for this job. Make sure the job completed successfully.' },
        { status: 422 }
      );
    }

    // 5. Generate summary using Anthropic Claude
    const aiSummary = await generateAiSummary(
      job.target_name,
      job.competitors,
      analyses,
      analytics
    );

    // 6. Cache the newly generated summary in the admin DB jobs table
    const { error: updateErr } = await admin
      .from('jobs')
      .update({ ai_summary: aiSummary })
      .eq('id', jobId);

    if (updateErr) {
      console.error('[AI Summary API] Failed to update jobs table:', updateErr.message);
    }

    return NextResponse.json({ aiSummary });
  } catch (err: any) {
    console.error('[AI Summary API] Failed to generate summary:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to generate AI executive summary' },
      { status: 500 }
    );
  }
}
