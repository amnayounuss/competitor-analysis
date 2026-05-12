'use client';
import { useEffect, useState, useRef } from 'react';
import { browserClient } from '@/lib/supabase';
import StatusBadge from '../../dashboard/status-badge';

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
    <div className="space-y-8 mt-6">
      <header className="modern-card p-8">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">{job.target_name}</h1>
            <p className="text-sm text-slate-500 mt-2 font-medium italic">
              Competitive Analysis vs {job.competitors.join(', ')}
            </p>
          </div>
          <StatusBadge status={job.status} />
        </div>

        {(job.status === 'queued' || job.status === 'running') && (
          <div className="mt-8">
            <div className="flex justify-between items-end mb-2">
              <p className="text-xs font-bold text-indigo-600 uppercase tracking-widest">
                {job.current_stage || (job.status === 'queued' ? 'Waiting for worker' : 'Processing…')}
              </p>
              <p className="text-sm font-bold text-slate-900">{job.progress_pct}%</p>
            </div>
            <div className="h-3 bg-slate-100 rounded-full overflow-hidden shadow-inner">
              <div 
                className="h-full bg-gradient-to-r from-indigo-500 to-blue-600 transition-all duration-700 rounded-full shadow-[0_0_12px_rgba(79,70,229,0.4)]" 
                style={{ width: `${job.progress_pct}%` }} 
              />
            </div>
          </div>
        )}

        {job.status === 'succeeded' && (
          <div className="mt-8 bg-emerald-50 border border-emerald-100 rounded-2xl p-6 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 shadow-sm">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
            </div>
            <div>
              <h3 className="font-bold text-emerald-900">Analysis Completed Successfully</h3>
              <p className="text-sm text-emerald-800/80 mt-1">
                {job.branches_total} branches processed with {job.reviews_total} reviews. Report sent to your inbox.
              </p>
            </div>
          </div>
        )}

        {job.status === 'failed' && (
          <div className="mt-8 bg-rose-50 border border-rose-100 rounded-2xl p-6">
            <div className="flex items-center gap-3 text-rose-800 mb-3">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              <h3 className="font-bold">Process Interrupted</h3>
            </div>
            <pre className="bg-white/50 border border-rose-100 rounded-xl p-4 font-mono text-xs text-rose-700 overflow-auto max-h-32">
              {job.error_message}
            </pre>
          </div>
        )}
      </header>

      <section className="modern-card overflow-hidden flex flex-col shadow-2xl">
        <div className="px-8 py-4 border-b border-slate-50 bg-slate-50/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-widest">Live Execution Log</h2>
          </div>
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-slate-200" />
            <div className="w-2.5 h-2.5 rounded-full bg-slate-200" />
            <div className="w-2.5 h-2.5 rounded-full bg-slate-200" />
          </div>
        </div>
        <div className="bg-[#0F172A] p-6 h-[500px] overflow-y-auto font-mono text-[11px] leading-relaxed selection:bg-indigo-500/30">
          {logs.length === 0
            ? <p className="text-slate-500 italic">Initializing secure log stream…</p>
            : logs.map(l => (
                <div key={l.id} className="flex gap-4 py-0.5 group">
                  <span className="text-slate-600 shrink-0 select-none">{new Date(l.created_at).toLocaleTimeString()}</span>
                  <span className={`shrink-0 w-12 font-bold uppercase ${
                    l.level === 'error' ? 'text-rose-500' :
                    l.level === 'warn'  ? 'text-amber-500' : 'text-emerald-500'
                  }`}>[{l.level}]</span>
                  <span className={`${
                    l.level === 'error' ? 'text-rose-200' :
                    l.level === 'warn'  ? 'text-amber-100' : 'text-slate-300'
                  }`}>{l.message}</span>
                </div>
              ))}
          <div ref={logsEndRef} />
        </div>
      </section>
    </div>
  );
}
