import { redirect } from 'next/navigation';
import { serverClient } from '@/lib/supabase';
import SignOutButton from '@/app/(authenticated)/dashboard/signout-button';
import NotificationBell from '@/app/(authenticated)/dashboard/notification-bell';
import NavLinks from '@/app/(authenticated)/nav-links';
import AuthShell from './auth-shell';

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await sb.from('profiles').select('is_admin').eq('id', user.id).single();
  const isAdmin = !!profile?.is_admin;

  return (
    <AuthShell
      isAdmin={isAdmin}
      email={user.email || ''}
      navLinks={<NavLinks isAdmin={isAdmin} />}
      notificationBell={<NotificationBell />}
      signOutButton={<SignOutButton />}
    >
      {children}
    </AuthShell>
  );
}
