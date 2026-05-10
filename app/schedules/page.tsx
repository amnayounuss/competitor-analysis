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
    <main className="max-w-3xl mx-auto p-6">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Monthly schedules</h1>
          <p className="text-sm text-gray-600">Auto-runs on the 1st of every month at 9 AM UTC</p>
        </div>
        <Link href="/dashboard" className="text-sm border rounded px-3 py-1.5 hover:bg-gray-50">← Dashboard</Link>
      </header>
      <SchedulesList />
    </main>
  );
}
