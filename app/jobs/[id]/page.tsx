import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { serverClient } from '@/lib/supabase';
import LiveJobView from './live-job-view';

export const dynamic = 'force-dynamic';

export default async function JobPage({ params }: { params: { id: string } }) {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');

  const { data: job } = await sb
    .from('jobs')
    .select('id, target_name, competitors, status, progress_pct, current_stage, queued_at, started_at, finished_at, error_message, branches_total, reviews_total')
    .eq('id', params.id)
    .single();

  if (!job) notFound();

  const { data: logs } = await sb
    .from('job_logs')
    .select('id, level, message, created_at')
    .eq('job_id', params.id)
    .order('created_at', { ascending: true })
    .limit(500);

  return (
    <main className="max-w-4xl mx-auto p-6">
      <Link href="/dashboard" className="text-sm text-blue-600 hover:underline">← Back to dashboard</Link>
      <LiveJobView initialJob={job} initialLogs={logs || []} />
    </main>
  );
}
