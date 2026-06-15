import { redirect } from 'next/navigation';
import Link from 'next/link';
import fs from 'node:fs';
import path from 'node:path';
import { serverClient, adminClient } from '@/lib/supabase';
import ConnectDbForm from './connect-form';
import SchemaCopier from './schema/copier';
import { Bi, BiInline } from '@/lib/bilingual';

export const dynamic = 'force-dynamic';

export default async function ConnectDbPage() {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');

  const admin = adminClient();
  const { data: existing } = await admin
    .from('client_databases')
    .select('supabase_url, last_test_ok, updated_at, anthropic_api_key')
    .eq('user_id', user.id).maybeSingle();

  // Read the canonical client schema so user can copy it inline
  const schemaSql = fs.readFileSync(
    path.join(process.cwd(), 'supabase/client-migrations/002_branch_analytics.sql'),
    'utf8',
  );

  const isFirstTime = !existing?.last_test_ok;

  return (
    <main className="min-h-screen bg-slate-50/50 py-12 px-4">
      <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">

        {/* Header */}
        <header className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-50 text-indigo-600 rounded-full text-[10px] font-bold uppercase tracking-widest border border-indigo-100">
            <BiInline en={isFirstTime ? 'One-time Setup' : 'Database Configuration'} />
          </div>
          <Bi en="Connect your Supabase" as="h1" className="text-3xl md:text-4xl font-bold text-slate-900 tracking-tight font-display" />
          <p className="text-sm font-medium text-slate-500 max-w-xl mx-auto">
            <BiInline en="All your scraped data — branches, reviews, analytics — lives in your own Supabase project. We never store your business data." />
          </p>
        </header>

        {/* Already-connected banner */}
        {existing?.last_test_ok && (
          <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 flex items-center justify-between animate-in zoom-in-95 duration-500">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="text-[11px] font-bold text-emerald-600 uppercase tracking-widest"><BiInline en="Active Connection" /></p>
                <p className="text-sm font-bold text-slate-700 truncate max-w-[400px]">{existing.supabase_url}</p>
              </div>
            </div>
            <Link href="/dashboard" className="btn-secondary py-1.5 px-4 text-xs">
              <BiInline en="Go to Dashboard →" />
            </Link>
          </div>
        )}

        {/* ──────── Step 1: Create Supabase project ──────── */}
        <Step n={1} title={<BiInline en="Create a Supabase project" />}
          sub={<BiInline en="Free tier is fine. Takes ~2 minutes to provision." />}>
          <div className="flex flex-wrap items-center gap-3">
            <a href="https://supabase.com/dashboard/new" target="_blank" rel="noopener"
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white font-bold text-sm rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-600/20 transition active:scale-95">
              <BiInline en="Open Supabase" />
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
            </a>
            <span className="text-xs font-medium text-slate-500"><BiInline en="Already have one? Skip to step 2." /></span>
          </div>
        </Step>

        {/* ──────── Step 2: Run schema SQL ──────── */}
        <Step n={2} title={<BiInline en="Run the schema SQL" />}
          sub={<BiInline en="In your Supabase project: SQL Editor → New query → paste this → Run." />}>
          <SchemaCopier sql={schemaSql} />
          <p className="text-[11px] font-medium text-slate-500 mt-3">
            <BiInline en="Safe to re-run — uses IF NOT EXISTS everywhere." />
          </p>
        </Step>

        {/* ──────── Step 3: Paste credentials ──────── */}
        <Step n={3} title={<BiInline en="Paste your project credentials" />}
          sub={<BiInline en="From Supabase: Settings → API — copy Project URL and service_role key." />}>
          <ConnectDbForm existingUrl={existing?.supabase_url || ''} existingAnthropicKey={!!existing?.anthropic_api_key} />
        </Step>

      </div>
    </main>
  );
}

function Step({ n, title, sub, children }: {
  n: number; title: React.ReactNode; sub: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-3xl border border-slate-100 shadow-xl shadow-slate-200/30 overflow-hidden">
      <div className="flex items-start gap-4 p-6 md:p-8 border-b border-slate-50">
        <div className="flex-shrink-0 w-10 h-10 rounded-2xl bg-indigo-600 text-white font-black flex items-center justify-center shadow-lg shadow-indigo-600/20">
          {n}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold text-slate-900 tracking-tight leading-tight">{title}</h2>
          <p className="text-xs font-medium text-slate-500 mt-1 leading-relaxed">{sub}</p>
        </div>
      </div>
      <div className="p-6 md:p-8">
        {children}
      </div>
    </section>
  );
}
