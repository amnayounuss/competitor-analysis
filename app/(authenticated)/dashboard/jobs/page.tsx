import React from 'react';
import { serverClient } from '@/lib/supabase';
import StatusBadge from '../status-badge';
import StopJobButton from '../stop-job-button';
import DownloadButton from '../download-button';
import Link from 'next/link';
import type { Job } from '@/lib/types';
import { BiInline } from '@/lib/bilingual';

export const dynamic = 'force-dynamic';

export default async function AnalysisHistoryPage() {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();

  const { data: jobs } = await sb
    .from('jobs')
    .select('*')
    .eq('user_id', user?.id)
    .order('queued_at', { ascending: false });

  return (
    <div className="p-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight"><BiInline en="Analysis History" /></h1>
          <p className="text-slate-500 font-medium mt-1"><BiInline en="Review your past reports and active tracking jobs." /></p>
        </div>
        <Link href="/dashboard/new" className="px-6 py-3 bg-indigo-600 text-white font-bold text-sm rounded-2xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-500/20 active:scale-95">
          <BiInline en="+ New Analysis" />
        </Link>
      </div>

      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-xl shadow-slate-200/30 overflow-hidden">
        {(!jobs || jobs.length === 0) ? (
          <div className="py-20 text-center">
            <p className="text-slate-400 font-bold"><BiInline en="No analysis history found." /></p>
            <Link href="/dashboard/new" className="text-indigo-600 font-bold mt-2 inline-block hover:underline"><BiInline en="Create your first analysis →" /></Link>
          </div>
        ) : (
          <table className="w-full text-start">
            <thead className="bg-slate-50/50 border-b border-slate-100">
              <tr>
                <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-start"><BiInline en="Analysis Target" /></th>
                <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-start"><BiInline en="Date" /></th>
                <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-start"><BiInline en="Status" /></th>
                <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-end"><BiInline en="Actions" /></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {jobs.map((j: Job) => (
                <tr key={j.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-8 py-6 text-start">
                    <Link href={`/jobs/${j.id}`} className="block">
                      <p className="font-bold text-slate-900 group-hover:text-indigo-600 transition-colors"><BiInline en={j.target_name} /></p>
                      <p className="text-xs text-slate-400 italic">
                        <BiInline en="vs" />{' '}
                        {j.competitors.map((c: string, idx: number) => (
                          <React.Fragment key={idx}>
                            {idx > 0 && ', '}
                            <BiInline en={c} />
                          </React.Fragment>
                        ))}
                      </p>
                    </Link>
                  </td>
                  <td className="px-8 py-6 text-sm font-medium text-slate-500 text-start">
                    {new Date(j.queued_at).toLocaleDateString()}
                  </td>
                  <td className="px-8 py-6 text-start">
                    <StatusBadge status={j.status} />
                  </td>
                  <td className="px-8 py-6 text-end">
                    <div className="flex items-center justify-end gap-2">
                      {j.status === 'succeeded' && j.excel_url && <DownloadButton url={j.excel_url} />}
                      {(j.status === 'running' || j.status === 'queued') && <StopJobButton jobId={j.id} />}
                      <Link href={`/jobs/${j.id}`} className="p-2 text-slate-400 hover:text-indigo-600 transition-colors">
                        <svg className="w-5 h-5 rtl:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
