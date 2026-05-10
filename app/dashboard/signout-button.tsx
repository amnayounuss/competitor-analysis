'use client';
import { useRouter } from 'next/navigation';

export default function SignOutButton() {
  const router = useRouter();
  async function onClick() {
    await fetch('/api/auth/signout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }
  return (
    <button onClick={onClick}
      className="text-sm border rounded px-3 py-1.5 hover:bg-gray-50">
      Sign out
    </button>
  );
}
