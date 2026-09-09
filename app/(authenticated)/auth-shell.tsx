'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useLang } from '@/lib/lang-context';
import LangToggle from '@/components/lang-toggle';
import { BiInline } from '@/lib/bilingual';

export default function AuthShell({
  role,
  email,
  navLinks,
  notificationBell,
  signOutButton,
  children,
}: {
  role: 'admin' | 'client' | 'viewer';
  email: string;
  navLinks: React.ReactNode;
  notificationBell: React.ReactNode;
  signOutButton: React.ReactNode;
  children: React.ReactNode;
}) {
  const { isAr } = useLang();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  return (
    <div className="print-root flex h-screen bg-[#F8FAFC]" dir={isAr ? 'rtl' : 'ltr'}>
      {/* Mobile Backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 md:hidden animate-fade-in"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — hidden on mobile, shown on md+ */}
      <aside className={`
        fixed inset-y-0 z-50 w-72 bg-white flex flex-col shrink-0 transition-transform duration-300 ease-out
        ${isAr ? 'border-l right-0' : 'border-r left-0'} border-slate-200
        md:relative md:translate-x-0
        ${sidebarOpen
          ? 'translate-x-0'
          : isAr ? 'translate-x-full' : '-translate-x-full'
        }
        md:!translate-x-0
      `}>
        <div className="p-8" dir={isAr ? 'rtl' : 'ltr'}>
          {/* Close button — mobile only */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="absolute top-4 md:hidden p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
            style={{ [isAr ? 'left' : 'right']: '12px' }}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
            </div>
            <span className={`text-xl font-black text-slate-900 tracking-tighter uppercase ${isAr ? 'font-arabic' : ''}`}>
              {isAr ? (
                <>تحليلات <span className="text-indigo-600">المراجعات</span></>
              ) : (
                <>Reviews <span className="text-indigo-600">Analytics</span></>
              )}
            </span>
          </div>

          {/* Language Toggle */}
          <div className="mb-6">
            <LangToggle />
          </div>

          {navLinks}
        </div>

        <div className={`mt-auto p-6 border-t border-slate-50`} dir={isAr ? 'rtl' : 'ltr'}>
          <div className="bg-slate-50 rounded-2xl p-4 mb-4">
            <p className={`text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 ${isAr ? 'font-arabic' : ''}`}>
              <BiInline en="Signed in as" />
            </p>
            <p className="text-xs font-bold text-slate-700 truncate">{email}</p>
          </div>
          {signOutButton}
        </div>
      </aside>

      {/* Main Content */}
      <main className="print-main flex-1 flex flex-col overflow-hidden min-w-0">
        <header className={`h-16 md:h-20 bg-white border-b border-slate-200 px-4 md:px-8 flex items-center justify-between z-10 shrink-0`} dir={isAr ? 'rtl' : 'ltr'}>
          <div className="flex items-center gap-3">
            {/* Hamburger — mobile only */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="md:hidden p-2 -ms-2 rounded-xl hover:bg-slate-100 text-slate-500 hover:text-indigo-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <h2 className={`text-base md:text-lg font-black text-slate-900 tracking-tight ${isAr ? 'font-arabic' : ''}`}>
              <BiInline en={role === 'admin' ? 'Admin Command Center' : role === 'viewer' ? 'Dashboard' : 'Client Workspace'} />
            </h2>
          </div>
          <div className="flex items-center gap-2 md:gap-4">
            {notificationBell}
            <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 font-bold text-sm">
              {email?.[0].toUpperCase()}
            </div>
          </div>
        </header>

        <div className="print-scroll flex-1 overflow-auto" dir={isAr ? 'rtl' : 'ltr'}>
          {children}
        </div>
      </main>
    </div>
  );
}
