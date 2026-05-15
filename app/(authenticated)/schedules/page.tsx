import { redirect } from 'next/navigation';
import Link from 'next/link';
import { serverClient } from '@/lib/supabase';
import SchedulesList from './schedules-list';

export const dynamic = 'force-dynamic';

export default async function SchedulesPage() {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');

  return (
    <main className="max-w-4xl mx-auto p-8 space-y-12">
      <header className="flex items-end justify-between border-b border-slate-100 pb-8">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-50 text-indigo-600 rounded-full text-[10px] font-bold uppercase tracking-widest border border-indigo-100 mb-2">
            Automations
          </div>
          <h1 className="text-4xl font-bold text-slate-900 tracking-tight">Recurring Cycles</h1>
          <p className="text-sm font-medium text-slate-500">Autonomous reports scheduled for the 1st of every month.</p>
        </div>
        <Link href="/dashboard" className="btn-secondary px-5 py-2.5 text-xs">
          ← Return to Command
        </Link>
      </header>
      <SchedulesList />
    </main>
  );
}
