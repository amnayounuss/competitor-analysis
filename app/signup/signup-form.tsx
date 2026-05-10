'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserClient } from '@/lib/supabase';
import Link from 'next/link';

export default function SignupForm() {
  const sb = browserClient();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setMsg(null);
    setLoading(true);
    const { data, error } = await sb.auth.signUp({
      email, password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${window.location.origin}/api/auth/callback`,
      },
    });
    setLoading(false);

    if (error) {
      if (error.message.toLowerCase().includes('already been registered')) {
        setErr('This email is already registered. Please sign in instead.');
      } else {
        setErr(error.message);
      }
      return;
    }

    if (data.session) router.push('/dashboard');
    else setMsg('Check your email to confirm your account, then sign in.');
  }

  return (
    <form onSubmit={onSubmit} className="w-full max-w-sm bg-white shadow-sm rounded-lg p-8 space-y-5 border">
      <h1 className="text-2xl font-semibold">Create account</h1>
      {err && <div className="bg-red-50 text-red-700 text-sm rounded p-3">{err}</div>}
      {msg && <div className="bg-green-50 text-green-700 text-sm rounded p-3">{msg}</div>}
      <div>
        <label className="block text-sm font-medium mb-1">Full name</label>
        <input type="text" value={fullName} onChange={e => setFullName(e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Email</label>
        <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Password</label>
        <input type="password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      <button type="submit" disabled={loading}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded py-2 font-medium">
        {loading ? 'Creating…' : 'Create account'}
      </button>
      <p className="text-sm text-gray-600 text-center">
        Already have an account? <Link href="/login" className="text-blue-600 hover:underline">Sign in</Link>
      </p>
    </form>
  );
}
