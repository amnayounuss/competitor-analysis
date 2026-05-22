'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserClient } from '@/lib/supabase';
import Link from 'next/link';
import { Bi, BiInline, useT } from '@/lib/bilingual';
import { useLang } from '@/lib/lang-context';

export default function SignupForm() {
  const sb = browserClient();
  const router = useRouter();
  const t = useT();
  const { isAr } = useLang();
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
        setErr(t('This email is already registered. Please sign in instead.'));
      } else {
        setErr(error.message);
      }
      return;
    }

    if (data.session) {
      router.push('/connect-database');
    } else {
      setMsg(t('Check your email to confirm your account, then sign in.'));
    }
  }

  return (
    <div className="w-full max-w-[440px] relative z-10 py-12" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-600 text-white shadow-2xl shadow-indigo-600/30 mb-6 group transition-transform hover:-rotate-6">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" />
          </svg>
        </div>
        <Bi en="Start Analyzing" as="h1" className="text-4xl font-bold tracking-tight text-slate-900" />
        <Bi en="Create your professional account today" as="p" className="text-slate-500 mt-2 font-medium" />
      </div>

      <form onSubmit={onSubmit} className="modern-card p-10 space-y-6">
        {err && (
          <div className="bg-rose-50 border border-rose-100 text-rose-700 text-sm font-medium rounded-xl p-4 flex items-center gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-rose-500" />
            {err}
          </div>
        )}
        {msg && (
          <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 text-sm font-medium rounded-xl p-4 flex items-center gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            {msg}
          </div>
        )}

        <div className="space-y-2">
          <label className="block text-sm font-bold text-slate-700 tracking-tight ml-1"><BiInline en="Full name" /></label>
          <input 
            type="text" 
            value={fullName} 
            onChange={e => setFullName(e.target.value)}
            placeholder={t('John Doe')}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all" 
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-bold text-slate-700 tracking-tight ml-1"><BiInline en="Email address" /></label>
          <input 
            type="email" 
            required 
            value={email} 
            onChange={e => setEmail(e.target.value)}
            placeholder={t('john@example.com')}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all" 
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-bold text-slate-700 tracking-tight ml-1"><BiInline en="Password" /></label>
          <input 
            type="password" 
            required 
            minLength={8} 
            value={password} 
            onChange={e => setPassword(e.target.value)}
            placeholder={t('Min. 8 characters')}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all" 
          />
        </div>

        <button 
          type="submit" 
          disabled={loading}
          className="w-full btn-primary py-3.5 text-base shadow-xl shadow-indigo-600/20"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <BiInline en="Creating Account..." />
            </span>
          ) : <BiInline en="Get Started Now" />}
        </button>

        <div className="pt-4 text-center">
          <p className="text-sm text-slate-500 font-medium">
            <BiInline en="Already have an account?" />{' '}
            <Link href="/login" className="text-indigo-600 font-bold hover:underline"><BiInline en="Sign in instead" /></Link>
          </p>
        </div>
      </form>

      <p className="mt-8 text-center text-xs text-slate-400 font-medium tracking-wide uppercase">
        &copy; 2026 <BiInline en="Reviews Analytics" /> &bull; <BiInline en="Secure Signup" />
      </p>
    </div>
  );
}
