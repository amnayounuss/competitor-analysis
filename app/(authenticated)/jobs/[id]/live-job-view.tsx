'use client';
import { useEffect, useState, useRef } from 'react';
import { browserClient } from '@/lib/supabase';
import StatusBadge from '../../dashboard/status-badge';
import { Bi, BiInline, useT } from '@/lib/bilingual';
import { useLang } from '@/lib/lang-context';

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
  excel_url?: string | null;
  report_url?: string | null;
  email_to?: string | null;
}
interface Log { id: number; level: string; message: string; created_at: string; }

export default function LiveJobView({ initialJob, initialLogs }: { initialJob: Job; initialLogs: Log[] }) {
  const t = useT();
  const { isAr } = useLang();
  const [job, setJob]   = useState<Job>(initialJob);
  const [logs, setLogs] = useState<Log[]>(initialLogs);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [emailToInput, setEmailToInput] = useState('');
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailStatus, setEmailStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [emailErrorMsg, setEmailErrorMsg] = useState('');

  useEffect(() => {
    if (isEmailModalOpen && job?.email_to) {
      setEmailToInput(job.email_to);
      setEmailStatus('idle');
      setEmailErrorMsg('');
    }
  }, [isEmailModalOpen, job]);

  const handleSendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!job.id || !emailToInput.trim()) return;

    setIsSendingEmail(true);
    setEmailStatus('idle');
    setEmailErrorMsg('');

    try {
      const res = await fetch(`/api/jobs/${job.id}/resend-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailToInput.trim() }),
      });

      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error || 'Failed to send email.');
      }

      setEmailStatus('success');
      setTimeout(() => {
        setIsEmailModalOpen(false);
      }, 2000);
    } catch (err: any) {
      setEmailStatus('error');
      setEmailErrorMsg(err.message || 'An unexpected error occurred.');
    } finally {
      setIsSendingEmail(false);
    }
  };

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
              <BiInline en="Competitive Analysis vs" /> {job.competitors.join(', ')}
            </p>
          </div>
          <StatusBadge status={job.status} />
        </div>

        {(job.status === 'queued' || job.status === 'running') && (
          <div className="mt-8">
            <div className="flex justify-between items-end mb-2">
              <p className="text-xs font-bold text-indigo-600 uppercase tracking-widest">
                {job.current_stage || (job.status === 'queued' ? t('Waiting for worker') : t('Processing…'))}
              </p>
              <p className="text-sm font-bold text-slate-900">{job.progress_pct}%</p>
            </div>
            <div className="h-3 bg-slate-100 rounded-full overflow-hidden shadow-inner relative">
              <div 
                className="absolute inset-y-0 ltr:left-0 rtl:right-0 bg-gradient-to-r from-indigo-500 to-blue-600 transition-all duration-700 rounded-full shadow-[0_0_12px_rgba(79,70,229,0.4)]" 
                style={{ width: `${job.progress_pct}%` }} 
              />
            </div>
          </div>
        )}

        {job.status === 'succeeded' && (
          <div className="mt-8 bg-emerald-50 border border-emerald-100 rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 shadow-sm">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
              </div>
              <div>
                <h3 className="font-bold text-emerald-900"><BiInline en="Analysis Completed Successfully" /></h3>
                <p className="text-sm text-emerald-800/80 mt-1">
                  {job.branches_total} {t('branches processed with')} {job.reviews_total} {t('reviews')}. <BiInline en="Report sent to your inbox." />
                </p>
              </div>
            </div>
            {job.excel_url && (
              <button
                onClick={() => setIsEmailModalOpen(true)}
                className="flex items-center gap-2 px-5 py-2.5 bg-white border border-emerald-200 text-emerald-700 hover:text-emerald-900 text-xs font-black uppercase tracking-wider rounded-xl shadow-sm hover:shadow-md transition-all duration-300 hover:scale-105"
              >
                <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <BiInline en="Resend Email | إعادة إرسال البريد" />
              </button>
            )}
          </div>
        )}

        {job.status === 'failed' && (
          <div className="mt-8 bg-rose-50 border border-rose-100 rounded-2xl p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-3">
              <div className="flex items-center gap-3 text-rose-800">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                <h3 className="font-bold"><BiInline en="Process Interrupted" /></h3>
              </div>
              {job.excel_url && (
                <button
                  onClick={() => setIsEmailModalOpen(true)}
                  className="flex items-center gap-2 px-5 py-2.5 bg-white border border-rose-200 text-rose-700 hover:text-rose-900 text-xs font-black uppercase tracking-wider rounded-xl shadow-sm hover:shadow-md transition-all duration-300 hover:scale-105"
                >
                  <svg className="w-4 h-4 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <BiInline en="Resend Email Report | إعادة إرسال التقرير" />
                </button>
              )}
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
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-widest"><BiInline en="Live Execution Log" /></h2>
          </div>
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-slate-200" />
            <div className="w-2.5 h-2.5 rounded-full bg-slate-200" />
            <div className="w-2.5 h-2.5 rounded-full bg-slate-200" />
          </div>
        </div>
        <div className="bg-[#0F172A] p-6 h-[500px] overflow-y-auto font-mono text-[11px] leading-relaxed selection:bg-indigo-500/30">
          {logs.length === 0
            ? <p className="text-slate-500 italic"><BiInline en="Initializing secure log stream…" /></p>
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

      {/* ═══ EMAIL MODAL ═══ */}
      {isEmailModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm no-print">
          <div className="bg-white w-full max-w-md rounded-3xl p-6 border border-slate-100 shadow-2xl animate-in zoom-in-95 duration-200" dir={isAr ? 'rtl' : 'ltr'}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-black text-slate-900">
                {isAr ? 'إرسال التقرير بالبريد' : 'Email Analysis Report'}
              </h3>
              <button onClick={() => setIsEmailModalOpen(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <form onSubmit={handleSendEmail} className="space-y-4">
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5">
                  {isAr ? 'عنوان البريد الإلكتروني المستلم' : 'Recipient Email Address'}
                </label>
                <input
                  type="email"
                  required
                  placeholder="name@company.com"
                  value={emailToInput}
                  onChange={(e) => setEmailToInput(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 text-sm focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all font-bold"
                  disabled={isSendingEmail || emailStatus === 'success'}
                />
              </div>

              {emailStatus === 'success' && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-xs font-bold flex items-center gap-2">
                  <svg className="w-4 h-4 shrink-0 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <span>{isAr ? 'تم إرسال التقرير بنجاح!' : 'Report sent successfully!'}</span>
                </div>
              )}

              {emailStatus === 'error' && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl text-xs font-bold flex items-center gap-2">
                  <svg className="w-4 h-4 shrink-0 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <span className="break-all">{emailErrorMsg}</span>
                </div>
              )}

              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setIsEmailModalOpen(false)}
                  className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-black uppercase tracking-wider rounded-xl transition-colors"
                  disabled={isSendingEmail}
                >
                  {isAr ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="flex items-center justify-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black uppercase tracking-wider rounded-xl shadow-lg shadow-indigo-100 transition-all min-w-[80px]"
                  disabled={isSendingEmail || emailStatus === 'success'}
                >
                  {isSendingEmail ? (
                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  ) : (
                    isAr ? 'إرسال' : 'Send'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
