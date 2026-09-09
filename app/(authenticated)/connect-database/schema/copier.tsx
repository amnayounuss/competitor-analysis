'use client';
import { useState } from 'react';
import { BiInline } from '@/lib/bilingual';
import { useLang } from '@/lib/lang-context';

export default function SchemaCopier({ sql }: { sql: string }) {
  const [copied, setCopied] = useState(false);
  const { isAr } = useLang();

  async function copy() {
    await navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="modern-card overflow-hidden border-slate-200/60 shadow-2xl shadow-slate-200/50 animate-in zoom-in-95 duration-500" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between px-6 py-4 bg-slate-900 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-rose-500/80 shadow-sm" />
            <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80 shadow-sm" />
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 shadow-sm" />
          </div>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ms-2">client-schema.sql</span>
        </div>
        
        <button 
          onClick={copy}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-95 ${
            copied 
              ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' 
              : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-600/20'
          }`}
        >
          {copied ? (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>
              <BiInline en="Copied!" />
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
              <BiInline en="Copy SQL" />
            </>
          )}
        </button>
      </div>
      
      <div className="relative group" dir="ltr">
        <pre className="p-6 text-[13px] leading-relaxed font-mono overflow-x-auto bg-slate-900 text-slate-300 max-h-[600px] overflow-y-auto selection:bg-indigo-500/30">
          {sql}
        </pre>
        <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-slate-900 to-transparent pointer-events-none opacity-50" />
      </div>
    </div>
  );
}
