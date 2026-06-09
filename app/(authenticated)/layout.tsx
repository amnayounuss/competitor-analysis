import { redirect } from 'next/navigation';
import { serverClient, adminClient } from '@/lib/supabase';
import SignOutButton from '@/app/(authenticated)/dashboard/signout-button';
import NotificationBell from '@/app/(authenticated)/dashboard/notification-bell';
import NavLinks from '@/app/(authenticated)/nav-links';
import AuthShell from './auth-shell';
import { getUserProfile, type UserRole } from '@/lib/user-role';

export type { UserRole };

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');

  const admin = adminClient();
  const { role } = await getUserProfile(admin, user.id);

  return (
    <AuthShell
      role={role}
      email={user.email || ''}
      navLinks={<NavLinks role={role} />}
      notificationBell={<NotificationBell />}
      signOutButton={<SignOutButton />}
    >
      {children}
    </AuthShell>
  );
}
