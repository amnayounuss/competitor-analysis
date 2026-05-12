import Link from 'next/link';
import { getSettings } from '@/lib/settings';
import SignupForm from './signup-form';

export const dynamic = 'force-dynamic';

export default async function SignupPage() {
  const s = await getSettings();
  if (!s.signup_allowed) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-6 relative overflow-hidden">
        {/* Background Decorative Elements */}
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-50/50 rounded-full blur-3xl -z-10 translate-x-1/2 -translate-y-1/2" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-slate-50 rounded-full blur-3xl -z-10 -translate-x-1/2 translate-y-1/2" />

        <div className="w-full max-w-md modern-card p-10 text-center space-y-6">
          <div className="w-16 h-16 bg-rose-50 rounded-2xl flex items-center justify-center mx-auto mb-2 border border-rose-100">
            <svg className="w-8 h-8 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 15v2m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Access Restricted</h1>
            <p className="text-sm font-medium text-slate-500">Public registrations are currently disabled by the root administrator.</p>
          </div>
          <div className="pt-4">
            <Link href="/login" className="btn-secondary w-full py-3">
              Return to Authentication
            </Link>
          </div>
        </div>
      </main>
    );
  }
  return (
    <main className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">
      {/* Background Decorative Elements */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-50/50 rounded-full blur-3xl -z-10 translate-x-1/2 -translate-y-1/2" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-slate-50 rounded-full blur-3xl -z-10 -translate-x-1/2 translate-y-1/2" />
      <SignupForm />
    </main>
  );
}
