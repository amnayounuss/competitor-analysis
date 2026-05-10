'use client';
import { useEffect, useState, useRef } from 'react';
import { browserClient } from '@/lib/supabase';

interface Job {
  id: string;
  target_name: string;
  competitors: string[];
  status: string;
  progress_pct: number;
  current_stage: string | null;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  branches_total: number | null;
  reviews_total: number | null;
}
interface Log { id: number; level: string; message: string; created_at: string; }

export default function LiveJobView({ initialJob, initialLogs }: { initialJob: Job; initialLogs: Log[] }) {
  const [job, setJob]   = useState<Job>(initialJob);
  const [logs, setLogs] = useState<Log[]>(initialLogs);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sb = browserClient();

    const jobChan = sb.channel(`job:${job.id}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'jobs', filter: `id=eq.${job.id}` },
        (payload) => setJob((prev) => ({ ...prev, ...(payload.new as Job) })))
      .subscribe();

    const logChan = sb.channel(`logs:${job.id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'job_logs', filter: `job_id=eq.${job.id}` },
        (payload) => setLogs((prev) => [...prev, payload.new as Log]))
      .subscribe();

    return () => { sb.removeChannel(jobChan); sb.removeChannel(logChan); };
  }, [job.id]);

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  return (
    <div className="space-y-6 mt-4">
      <header className="bg-white border rounded-lg p-6 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{job.target_name}</h1>
            <p className="text-sm text-gray-600 mt-1">vs {job.competitors.join(', ')}</p>
          </div>
          <StatusBadge status={job.status} />
        </div>

        {(job.status === 'queued' || job.status === 'running') && (
          <div className="mt-4">
            <div className="h-2 bg-gray-100 rounded overflow-hidden">
              <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${job.progress_pct}%` }} />
            </div>
            <p className="text-sm text-gray-600 mt-2">
              {job.progress_pct}% — {job.current_stage || (job.status === 'queued' ? 'Waiting for a worker…' : 'Working…')}
            </p>
          </div>
        )}

        {job.status === 'succeeded' && (
          <div className="mt-4 bg-green-50 border border-green-200 rounded p-4 text-sm text-green-800">
            ✅ Done. {job.branches_total} branches analyzed, {job.reviews_total} reviews. Check your email for the Excel report.
          </div>
        )}

        {job.status === 'failed' && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded p-4 text-sm text-red-800">
            <p className="font-medium">❌ Failed</p>
            <p className="mt-1 font-mono text-xs whitespace-pre-wrap">{job.error_message}</p>
          </div>
        )}
      </header>

      <section className="bg-white border rounded-lg shadow-sm">
        <h2 className="text-sm font-semibold px-6 py-3 border-b bg-gray-50">Live log</h2>
        <div className="max-h-[500px] overflow-y-auto p-4 font-mono text-xs space-y-1">
          {logs.length === 0
            ? <p className="text-gray-400 italic">No log entries yet…</p>
            : logs.map(l => (
                <div key={l.id} className={
                  l.level === 'error' ? 'text-red-600' :
                  l.level === 'warn'  ? 'text-yellow-600' : 'text-gray-700'
                }>
                  <span className="text-gray-400">{new Date(l.created_at).toLocaleTimeString()}</span>{' '}
                  {l.message}
                </div>
              ))}
          <div ref={logsEndRef} />
        </div>
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    queued:    'bg-gray-100 text-gray-700',
    running:   'bg-blue-100 text-blue-700',
    succeeded: 'bg-green-100 text-green-700',
    failed:    'bg-red-100 text-red-700',
    cancelled: 'bg-yellow-100 text-yellow-700',
  };
  return (
    <span className={`text-xs font-medium px-2 py-1 rounded ${map[status] || ''}`}>
      {status}
    </span>
  );
}
