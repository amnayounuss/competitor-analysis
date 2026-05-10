import { redirect } from 'next/navigation';
import { serverClient } from '@/lib/supabase';

export default async function Home() {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  redirect(user ? '/dashboard' : '/login');
}
