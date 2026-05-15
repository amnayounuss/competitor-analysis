import { NextResponse } from 'next/server';
import { serverClient, adminClient } from '@/lib/supabase';

async function requireAdmin() {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: 'unauthorized', status: 401 as const };
  const { data: profile } = await sb.from('profiles').select('is_admin').eq('id', user.id).single();
  if (!profile?.is_admin) return { error: 'forbidden', status: 403 as const };
  return { user };
}

export async function GET() {
  const auth = await requireAdmin();
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sb = adminClient();

  // 1. Basic Counts & Totals
  const [
    { count: totalClients },
    { count: connectedDBs },
    { count: activeSchedules },
    { data: allJobs },
    { data: recentErrors }
  ] = await Promise.all([
    sb.from('profiles').select('*', { count: 'exact', head: true }).eq('is_admin', false),
    sb.from('client_databases').select('*', { count: 'exact', head: true }).eq('last_test_ok', true),
    sb.from('schedules').select('*', { count: 'exact', head: true }).eq('enabled', true),
    sb.from('jobs').select('status, branches_total, reviews_total, finished_at, target_name, user_id, queued_at'),
    sb.from('job_logs').select('message, created_at, job_id').eq('level', 'error').order('created_at', { ascending: false }).limit(5)
  ]);

  // 2. Aggregations
  let activeJobs = 0;
  let succeededJobs = 0;
  let failedJobs = 0;
  let totalReviews = 0;
  let totalBranches = 0;
  let manualJobs = 0;
  let scheduledJobs = 0;

  for (const j of allJobs || []) {
    if (j.status === 'running' || j.status === 'queued') activeJobs++;
    else if (j.status === 'succeeded') succeededJobs++;
    else if (j.status === 'failed') failedJobs++;

    totalReviews += (j.reviews_total || 0);
    totalBranches += (j.branches_total || 0);
  }

  // 3. Recent Activity (Last 5 jobs)
  const { data: recentJobs } = await sb
    .from('jobs')
    .select('id, target_name, status, finished_at, queued_at, user_id, kind')
    .order('queued_at', { ascending: false })
    .limit(5);

  // Get user emails for recent activity
  const userIds = Array.from(new Set([
    ...(recentJobs?.map(j => j.user_id) || []),
    ...(recentErrors?.map(e => e.job_id) || []) // Technically need to get user_id for errors too if we want emails there
  ]));
  
  const { data: profiles } = await sb.from('profiles').select('id, email').in('id', userIds);
  const emailMap: Record<string, string> = {};
  profiles?.forEach(p => emailMap[p.id] = p.email);

  const formattedRecent = recentJobs?.map(j => ({
    ...j,
    user_email: emailMap[j.user_id] || 'Unknown'
  }));

  return NextResponse.json({
    totalClients: totalClients || 0,
    connectedDBs: connectedDBs || 0,
    activeSchedules: activeSchedules || 0,
    activeJobs,
    succeededJobs,
    failedJobs,
    totalReviews,
    totalBranches,
    recentJobs: formattedRecent || [],
    recentErrors: recentErrors || []
  });
}
