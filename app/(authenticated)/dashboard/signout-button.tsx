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
    <button 
      onClick={onClick}
      className="btn-secondary px-4 py-2 text-xs font-bold flex items-center gap-2 group"
    >
      <span>Sign out</span>
      <svg className="w-3.5 h-3.5 text-slate-400 group-hover:text-rose-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
    </button>
  );
}
