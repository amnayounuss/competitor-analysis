'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Step = 1 | 2 | 3 | 4 | 5;

export default function SetupWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Step 1
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminName, setAdminName] = useState('');

  // Step 2 — Gmail (sender)
  const [gmailUser, setGmailUser] = useState('');
  const [gmailFromName, setGmailFromName] = useState('Reviews Analytics');
  const [gmailClientId, setGmailClientId] = useState('');
  const [gmailClientSecret, setGmailClientSecret] = useState('');
  const [gmailRefreshToken, setGmailRefreshToken] = useState('');

  // Step 3 — GMB
  const [gmbClientId, setGmbClientId] = useState('');
  const [gmbClientSecret, setGmbClientSecret] = useState('');

  // Step 4 — Preferences
  const [signupAllowed, setSignupAllowed] = useState(true);

  function next() { setErr(null); if (step < 5) setStep((step + 1) as Step); }
  function back() { setErr(null); if (step > 1) setStep((step - 1) as Step); }

  async function finish() {
    setErr(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admin: { email: adminEmail.trim(), password: adminPassword, full_name: adminName.trim() },
          gmail: {
            user: gmailUser.trim(),
            from_name: gmailFromName.trim(),
            oauth_client_id: gmailClientId.trim(),
            oauth_client_secret: gmailClientSecret.trim(),
            refresh_token: gmailRefreshToken.trim(),
          },
          gmb: {
            oauth_client_id: gmbClientId.trim(),
            oauth_client_secret: gmbClientSecret.trim(),
          },
          signup_allowed: signupAllowed,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(typeof j?.error === 'string' ? j.error : JSON.stringify(j.error));
      // Hard redirect bypasses router cache and forces middleware re-check
      window.location.href = '/login?setup=done';
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  function canProceed(): boolean {
    if (step === 1) return adminEmail.includes('@') && adminPassword.length >= 8;
    if (step === 2) return gmailUser.includes('@')
      && gmailClientId.length > 10
      && gmailClientSecret.length > 10
      && gmailRefreshToken.length > 20;
    if (step === 3) return gmbClientId.length > 10 && gmbClientSecret.length > 10;
    return true;
  }

  return (
    <div className="w-full max-w-2xl modern-card p-10 space-y-10 animate-in fade-in zoom-in-95 duration-500">
      <header>
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-50 text-indigo-600 rounded-full text-[10px] font-bold uppercase tracking-widest border border-indigo-100 mb-4">
          Initial Provisioning
        </div>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Welcome — Initial Setup</h1>
        <p className="text-sm font-medium text-slate-500 mt-1">Configure your core systems and administrative identity.</p>
        <Stepper current={step} />
      </header>

      {err && (
        <div className="bg-rose-50 border border-rose-100 text-rose-700 text-sm font-medium rounded-xl p-4 flex items-center gap-3">
          <div className="w-1.5 h-1.5 rounded-full bg-rose-500" />
          {err}
        </div>
      )}

      <div className="min-h-[320px]">
        {step === 1 && (
          <Section title="Identity Management" hint="Define your primary administrative credentials.">
            <Field label="Full Name (optional)">
              <input type="text" value={adminName} onChange={e => setAdminName(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:bg-white focus:border-indigo-500 transition-all" placeholder="John Doe" />
            </Field>
            <Field label="Root Email Address *">
              <input type="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:bg-white focus:border-indigo-500 transition-all" placeholder="[email protected]" />
            </Field>
            <Field label="Secure Password *" hint="Minimum 8 characters required">
              <input type="password" value={adminPassword} onChange={e => setAdminPassword(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:bg-white focus:border-indigo-500 transition-all" minLength={8} placeholder="••••••••" />
            </Field>
          </Section>
        )}

        {step === 2 && (
          <Section title="Communication Layer" hint="Configure Gmail OAuth for automated report delivery.">
            <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 text-[11px] text-indigo-900/80 leading-relaxed mb-6">
              <p className="font-bold text-indigo-900 mb-1 flex items-center gap-2">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                OAUTH GUIDANCE
              </p>
              Use <a className="underline font-bold hover:text-indigo-600 transition-colors" target="_blank" href="https://developers.google.com/oauthplayground">OAuth Playground</a> to authorize <code className="bg-white/60 px-1 rounded">mail.google.com</code> and generate a persistent refresh token for this project.
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Sender Email *">
                <input type="email" value={gmailUser} onChange={e => setGmailUser(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:bg-white focus:border-indigo-500 transition-all" placeholder="[email protected]" />
              </Field>
              <Field label="Display Name">
                <input type="text" value={gmailFromName} onChange={e => setGmailFromName(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:bg-white focus:border-indigo-500 transition-all" />
              </Field>
            </div>
            
            <Field label="OAuth Client ID *">
              <input type="text" value={gmailClientId} onChange={e => setGmailClientId(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono outline-none focus:bg-white focus:border-indigo-500 transition-all" placeholder="xxxxx.apps.googleusercontent.com" />
            </Field>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Client Secret *">
                <input type="password" value={gmailClientSecret} onChange={e => setGmailClientSecret(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono outline-none focus:bg-white focus:border-indigo-500 transition-all" placeholder="GOCSPX-..." />
              </Field>
              <Field label="Refresh Token *">
                <input type="password" value={gmailRefreshToken} onChange={e => setGmailRefreshToken(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono outline-none focus:bg-white focus:border-indigo-500 transition-all" placeholder="1//0gK..." />
              </Field>
            </div>
          </Section>
        )}

        {step === 3 && (
          <Section title="Intelligence Engine" hint="Configure Google Business Profile API for data extraction.">
            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 text-[11px] text-emerald-900/80 leading-relaxed mb-6 italic">
              Required scope: <code className="bg-white/60 px-1 rounded font-bold">.../auth/business.manage</code>. This project acts as the orchestrator for client-provided tokens.
            </div>
            
            <Field label="GMB Client ID *">
              <input type="text" value={gmbClientId} onChange={e => setGmbClientId(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono outline-none focus:bg-white focus:border-indigo-500 transition-all" placeholder="xxxxx.apps.googleusercontent.com" />
            </Field>
            <Field label="GMB Client Secret *">
              <input type="password" value={gmbClientSecret} onChange={e => setGmbClientSecret(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono outline-none focus:bg-white focus:border-indigo-500 transition-all" placeholder="GOCSPX-..." />
            </Field>

            <div className="mt-8 pt-8 border-t border-slate-100">
              <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-4">Client Project Schema</p>
              <div className="bg-slate-900 rounded-2xl p-6 relative group overflow-hidden">
                <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(`-- Run this in your Client Supabase SQL Editor
create table public.branches (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  branch_name text not null,
  city text,
  address text,
  google_maps_link text,
  phone text,
  website text,
  stars numeric(3,2) default 0,
  reviews_count int default 0,
  popular_times jsonb,
  created_at timestamptz not null default now()
);

create table public.reviews (
  id bigserial primary key,
  brand text not null,
  branch_id uuid references public.branches(id) on delete cascade,
  rating int check (rating between 1 and 5),
  text text,
  reviewer_name text,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  brand text not null unique,
  branch_count int default 0,
  total_reviews_3m int default 0,
  avg_rating_3m numeric(3,2) default 0,
  star_5_count int default 0,
  star_4_count int default 0,
  star_3_count int default 0,
  star_2_count int default 0,
  star_1_count int default 0,
  last_updated_at timestamptz not null default now()
);

create table public.job_history (
  id uuid primary key default gen_random_uuid(),
  branches_total int default 0,
  reviews_total int default 0,
  finished_at timestamptz not null default now()
);`);
                    }}
                    className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-all text-[10px] font-bold uppercase"
                  >
                    Copy SQL
                  </button>
                </div>
                <pre className="text-[10px] text-indigo-300 font-mono leading-relaxed overflow-x-auto max-h-[150px]">
{`-- CLIENT SUPABASE SCHEMA
create table public.branches (
  id uuid primary key default ...
  ...
  stars numeric(3,2) default 0,
  reviews_count int default 0,
);

-- Click Copy for full query`}
                </pre>
              </div>
              <p className="text-[10px] font-medium text-slate-500 mt-3 leading-relaxed">
                Run the full SQL script in the **SQL Editor** of the project you connect to each client.
              </p>
            </div>
          </Section>
        )}

        {step === 4 && (
          <Section title="Environment Controls" hint="Configure platform-wide security defaults.">
            <div 
              onClick={() => setSignupAllowed(!signupAllowed)}
              className={`group relative flex items-start gap-4 p-5 rounded-2xl border transition-all cursor-pointer select-none ${
                signupAllowed 
                  ? 'bg-indigo-50/50 border-indigo-200 ring-1 ring-indigo-200' 
                  : 'bg-white border-slate-100 hover:border-slate-200 hover:bg-slate-50'
              }`}
            >
              <div className={`mt-0.5 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${
                signupAllowed ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-slate-300'
              }`}>
                {signupAllowed && <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M5 13l4 4L19 7" /></svg>}
              </div>
              <div>
                <p className={`font-bold text-sm transition-colors ${signupAllowed ? 'text-indigo-900' : 'text-slate-700'}`}>Allow Public Registration</p>
                <p className="text-[11px] font-medium text-slate-400 mt-0.5 leading-relaxed">
                  When enabled, any visitor can create an account. Disable this to restrict access to manually provisioned users only.
                </p>
              </div>
            </div>
          </Section>
        )}

        {step === 5 && (
          <Section title="Final Verification" hint="Review your configuration before committing.">
            <div className="modern-card bg-slate-50/50 border-slate-100 p-6 space-y-4">
              <div className="flex items-center justify-between py-2 border-b border-slate-100">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Admin Node</span>
                <span className="text-sm font-bold text-slate-900">{adminEmail}</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-slate-100">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Comms Interface</span>
                <span className="text-sm font-bold text-slate-900">{gmailUser}</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-slate-100">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">GMB Engine</span>
                <span className="text-sm font-bold text-slate-900 truncate max-w-[200px]">{gmbClientId}</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Public Access</span>
                <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-tighter ${signupAllowed ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                  {signupAllowed ? 'Permitted' : 'Restricted'}
                </span>
              </div>
            </div>
          </Section>
        )}
      </div>

      <footer className="flex items-center justify-between pt-8 border-t border-slate-50">
        <button 
          onClick={back} 
          disabled={step === 1 || submitting}
          className="px-6 py-2.5 text-sm font-bold text-slate-400 hover:text-slate-900 disabled:opacity-0 transition-all uppercase tracking-widest"
        >
          Previous
        </button>
        
        {step < 5 ? (
          <button 
            onClick={next} 
            disabled={!canProceed()}
            className="btn-primary px-10 shadow-xl shadow-indigo-600/20"
          >
            Continue
          </button>
        ) : (
          <button 
            onClick={finish} 
            disabled={submitting}
            className="btn-primary bg-emerald-600 hover:bg-emerald-700 px-10 shadow-xl shadow-emerald-600/20"
          >
            {submitting ? 'Finalizing Configuration…' : 'Initialize Platform'}
          </button>
        )}
      </footer>
    </div>
  );
}

function Stepper({ current }: { current: number }) {
  const labels = ['Admin', 'Gmail', 'GMB', 'Prefs', 'Confirm'];
  return (
    <div className="flex items-center gap-1.5 mt-8 w-full">
      {labels.map((label, i) => {
        const n = i + 1;
        const active = current === n;
        const done = current > n;
        return (
          <div key={n} className="flex items-center gap-2 flex-1 min-w-0 last:flex-none">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold transition-all duration-500 flex-shrink-0
              ${done ? 'bg-emerald-500 text-white ring-4 ring-emerald-500/10' : active ? 'bg-indigo-600 text-white ring-4 ring-indigo-600/20' : 'bg-slate-100 text-slate-400'}`}>
              {done ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M5 13l4 4L19 7" /></svg>
              ) : n}
            </div>
            {n < 5 && <div className={`flex-1 h-1 rounded-full transition-all duration-700 ${done ? 'bg-emerald-500' : 'bg-slate-100'}`} />}
          </div>
        );
      })}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
      <div>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">{title}</h2>
        {hint && <p className="text-sm font-medium text-slate-500 mt-1">{hint}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-bold text-slate-700 tracking-tight ml-1">{label}</label>
      {children}
      {hint && <p className="text-[11px] font-medium text-slate-400 uppercase tracking-widest ml-1">{hint}</p>}
    </div>
  );
}