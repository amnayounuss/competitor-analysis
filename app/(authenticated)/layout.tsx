import Link from 'next/link';
import { redirect } from 'next/navigation';
import { serverClient } from '@/lib/supabase';
import SignOutButton from '@/app/(authenticated)/dashboard/signout-button';
import NotificationBell from '@/app/(authenticated)/dashboard/notification-bell';
import NavLinks from '@/app/(authenticated)/nav-links';

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await sb.from('profiles').select('is_admin').eq('id', user.id).single();
  const isAdmin = !!profile?.is_admin;

  return (
    <div className="flex h-screen bg-[#F8FAFC]">
      {/* Sidebar */}
      <aside className="w-72 bg-white border-r border-slate-200 flex flex-col shrink-0">
        <div className="p-8">
          <div className="flex items-center gap-3 mb-10">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
            </div>
            <span className="text-xl font-black text-slate-900 tracking-tighter uppercase">Reviews <span className="text-indigo-600">Analytics</span></span>
          </div>

          <NavLinks isAdmin={isAdmin} />
        </div>

        <div className="mt-auto p-6 border-t border-slate-50">
          <div className="bg-slate-50 rounded-2xl p-4 mb-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Signed in as</p>
            <p className="text-xs font-bold text-slate-700 truncate">{user.email}</p>
          </div>
          <SignOutButton />
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-20 bg-white border-b border-slate-200 px-8 flex items-center justify-between z-10 shrink-0">
          <h2 className="text-lg font-black text-slate-900 tracking-tight">
            {isAdmin ? 'Admin Command Center' : 'Client Workspace'}
          </h2>
          <div className="flex items-center gap-4">
            <NotificationBell />
            <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 font-bold">
              {user.email?.[0].toUpperCase()}
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
