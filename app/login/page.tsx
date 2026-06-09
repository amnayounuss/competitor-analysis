'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserClient } from '@/lib/supabase';
import Link from 'next/link';
import { Bi, BiInline, useT } from '@/lib/bilingual';
import { useLang } from '@/lib/lang-context';
import LangToggle from '@/components/lang-toggle';

export default function LoginPage() {
  const sb = browserClient();
  const router = useRouter();
  const t = useT();
  const { isAr } = useLang();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    const { error } = await sb.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setErr(error.message);
      return;
    }

    const { data: { user } } = await sb.auth.getUser();
    if (user) {
      const { data: profile } = await sb.from('profiles').select('role, is_admin').eq('id', user.id).single();
      const role = profile?.role === 'viewer' ? 'viewer' : profile?.role === 'admin' || profile?.is_admin ? 'admin' : 'client';
      if (role === 'admin') { router.push('/admin'); return; }
      if (role === 'viewer') { router.push('/dashboard'); return; }

      const r = await fetch('/api/client-db', { cache: 'no-store' });
      const j = r.ok ? await r.json() : null;
      if (!j?.connection?.last_test_ok) {
        router.push('/connect-database');
      } else {
        router.push('/dashboard');
      }
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden" dir={isAr ? 'rtl' : 'ltr'}>
      {/* Language Toggle - Top */}
      <div className="absolute top-4 md:top-6 z-20" style={{ [isAr ? 'left' : 'right']: '1.5rem' }}>
        <LangToggle />
      </div>
      {/* Decorative background elements */}
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-100/30 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-100/20 rounded-full blur-[120px]" />
      </div>

      <div className="w-full max-w-[400px] relative z-10">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-600 text-white shadow-2xl shadow-indigo-600/30 mb-6 group transition-transform hover:rotate-6">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <Bi en="Welcome Back" as="h1" className="text-4xl font-bold tracking-tight text-slate-900" />
          <Bi en="Continue to your analysis dashboard" as="p" className="text-slate-500 mt-2 font-medium" />
        </div>

        <form onSubmit={onSubmit} className="modern-card p-10 space-y-6">
          {err && (
            <div className="bg-rose-50 border border-rose-100 text-rose-700 text-sm font-medium rounded-xl p-4 flex items-center gap-3 animate-shake">
              <div className="w-1.5 h-1.5 rounded-full bg-rose-500" />
              {err}
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-sm font-bold text-slate-700 tracking-tight ml-1"><BiInline en="Email address" /></label>
            <input 
              type="email" 
              required 
              value={email} 
              onChange={e => setEmail(e.target.value)}
              placeholder={t('name@company.com')}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all" 
            />
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center px-1">
              <label className="block text-sm font-bold text-slate-700 tracking-tight"><BiInline en="Password" /></label>
              <button type="button" className="text-xs font-bold text-indigo-600 hover:text-indigo-700 transition-colors"><BiInline en="Forgot?" /></button>
            </div>
            <input 
              type="password" 
              required 
              value={password} 
              onChange={e => setPassword(e.target.value)}
              placeholder={t('••••••••')}
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
                <BiInline en="Authenticating..." />
              </span>
            ) : <BiInline en="Sign in to Account" />}
          </button>

          <div className="pt-4 text-center">
            <p className="text-sm text-slate-500 font-medium">
              <BiInline en="Don't have an account?" />{' '}
              <Link href="/signup" className="text-indigo-600 font-bold hover:underline"><BiInline en="Create one for free" /></Link>
            </p>
          </div>
        </form>

        <p className="mt-8 text-center text-xs text-slate-400 font-medium tracking-wide uppercase">
          &copy; 2026 <BiInline en="Reviews Analytics" /> &bull; <BiInline en="Secure Connection" />
        </p>
      </div>
    </main>
  );
}
