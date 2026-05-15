'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

interface NavLinkProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  color?: 'slate' | 'indigo';
}

export default function NavLinks({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  const searchParams = useSearchParams();
  const currentTab = searchParams.get('tab') || 'overview';

  if (isAdmin) {
    return (
      <nav className="space-y-1.5">
        <NavItem href="/admin?tab=overview" icon={<LayoutIcon />} label="Platform Overview" active={pathname === '/admin' && currentTab === 'overview'} />
        <NavItem href="/admin?tab=users" icon={<UsersIcon />} label="Clients" active={pathname === '/admin' && currentTab === 'users'} />
        <NavItem href="/admin?tab=gmail" icon={<EmailIcon />} label="Email Config" active={pathname === '/admin' && currentTab === 'gmail'} />
        <NavItem href="/admin?tab=gmb" icon={<GlobeIcon />} label="Business API" active={pathname === '/admin' && currentTab === 'gmb'} />
        <NavItem href="/admin?tab=worker" icon={<CpuIcon />} label="System Runner" active={pathname === '/admin' && currentTab === 'worker'} />
      </nav>
    );
  }

  return (
    <nav className="space-y-1.5">
      <NavItem href="/dashboard" icon={<LayoutIcon />} label="Overview" active={pathname === '/dashboard'} />
      <NavItem href="/dashboard/new" icon={<PlusIcon />} label="New Analysis" active={pathname === '/dashboard/new'} />
      <NavItem href="/dashboard/jobs" icon={<ListIcon />} label="Analysis History" active={pathname.startsWith('/dashboard/jobs') || pathname.startsWith('/jobs')} />
      <NavItem href="/schedules" icon={<ClockIcon />} label="Schedules" active={pathname === '/schedules'} />
    </nav>
  );
}

function UsersIcon() { return <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>; }
function EmailIcon() { return <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>; }
function GlobeIcon() { return <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>; }
function CpuIcon() { return <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" /></svg>; }

function NavItem({ href, icon, label, color = 'slate', active }: NavLinkProps & { active: boolean }) {
  return (
    <Link 
      href={href} 
      className={`flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-all active:scale-95 ${
        active 
          ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30' 
          : color === 'indigo'
            ? 'text-indigo-600 bg-indigo-50 hover:bg-indigo-100'
            : 'text-slate-500 hover:text-indigo-600 hover:bg-indigo-50'
      }`}
    >
      <span className="w-5 h-5">{icon}</span>
      {label}
    </Link>
  );
}

function LayoutIcon() { return <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>; }
function PlusIcon() { return <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>; }
function ListIcon() { return <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" /></svg>; }
function ClockIcon() { return <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>; }
function ShieldIcon() { return <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>; }
