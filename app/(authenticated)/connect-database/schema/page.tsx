import fs from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import SchemaCopier from './copier';

export default function SchemaPage() {
  const schemaPath = path.join(process.cwd(), 'supabase/client-schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  return (
    <main className="min-h-screen bg-slate-50/50 py-12 px-4">
      <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <header className="space-y-4">
          <Link 
            href="/connect-database" 
            className="inline-flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-indigo-600 transition-colors uppercase tracking-widest group"
          >
            <svg className="w-3 h-3 transform group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M15 19l-7-7 7-7" /></svg>
            Back to Configuration
          </Link>
          
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight font-display">Client Schema SQL</h1>
            <p className="text-sm font-medium text-slate-500 max-w-2xl leading-relaxed">
              Copy this SQL and execute it within your Supabase SQL editor. 
              This will automatically provision the required tables, indexes, and storage buckets for your analysis reports.
            </p>
          </div>
        </header>

        <SchemaCopier sql={sql} />

        <footer className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 flex-shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <div className="text-[11px] text-indigo-900/70 font-medium leading-relaxed">
            <p className="font-bold text-indigo-900 mb-0.5 uppercase tracking-tight">Important Notice</p>
            Running this SQL multiple times is safe (it uses <code className="bg-white/50 px-1 rounded">IF NOT EXISTS</code>). Ensure you are connected to the correct project before running.
          </div>
        </footer>
      </div>
    </main>
  );
}


