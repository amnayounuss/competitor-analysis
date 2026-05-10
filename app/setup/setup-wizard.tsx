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
  const [gmailFromName, setGmailFromName] = useState('Anoosh Analysis');
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
    <div className="w-full max-w-xl bg-white border rounded-xl shadow-sm p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Welcome — first-time setup</h1>
        <p className="text-sm text-gray-600 mt-1">One-time wizard. Manage everything from /admin afterwards.</p>
        <Stepper current={step} />
      </header>

      {err && <div className="bg-red-50 text-red-700 text-sm rounded p-3 mb-4">{err}</div>}

      {step === 1 && (
        <Section title="Step 1 — Create admin account"
          hint="Your owner account. You can add normal users later.">
          <Field label="Full name (optional)">
            <input type="text" value={adminName} onChange={e => setAdminName(e.target.value)}
              className="input" placeholder="Your name" />
          </Field>
          <Field label="Admin email *">
            <input type="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)}
              className="input" placeholder="[email protected]" />
          </Field>
          <Field label="Admin password *" hint="At least 8 characters">
            <input type="password" value={adminPassword} onChange={e => setAdminPassword(e.target.value)}
              className="input" minLength={8} />
          </Field>
        </Section>
      )}

      {step === 2 && (
        <Section title="Step 2 — Gmail OAuth (for sending email)"
          hint="Use the Google Cloud project that owns the email-sending Gmail account.">
          <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-900 mb-2">
            <p className="font-medium">Need a refresh token?</p>
            <p className="mt-1">Go to <a className="underline" target="_blank" href="https://developers.google.com/oauthplayground">OAuth 2.0 Playground</a>, set your own credentials in the gear icon, authorize <code className="bg-white px-1">https://mail.google.com</code>, then exchange the auth code for a refresh token.</p>
          </div>
          <Field label="Gmail address *">
            <input type="email" value={gmailUser} onChange={e => setGmailUser(e.target.value)}
              className="input" placeholder="[email protected]" />
          </Field>
          <Field label="From display name">
            <input type="text" value={gmailFromName} onChange={e => setGmailFromName(e.target.value)} className="input" />
          </Field>
          <Field label="OAuth Client ID *">
            <input type="text" value={gmailClientId} onChange={e => setGmailClientId(e.target.value)}
              className="input font-mono" placeholder="xxxxx.apps.googleusercontent.com" />
          </Field>
          <Field label="OAuth Client Secret *">
            <input type="password" value={gmailClientSecret} onChange={e => setGmailClientSecret(e.target.value)}
              className="input font-mono" placeholder="GOCSPX-..." />
          </Field>
          <Field label="Refresh Token *" hint="One-time token from OAuth Playground for the gmail address above">
            <input type="password" value={gmailRefreshToken} onChange={e => setGmailRefreshToken(e.target.value)}
              className="input font-mono" placeholder="1//0gK..." />
          </Field>
        </Section>
      )}

      {step === 3 && (
        <Section title="Step 3 — GMB OAuth (for Business Profile API)"
          hint="Different Google Cloud project — clients provide their own refresh tokens at job-submit time.">
          <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-900 mb-2">
            <p>The required scope is <code className="bg-white px-1">https://www.googleapis.com/auth/business.manage</code>. Each of your clients must generate a refresh token under THIS OAuth app and paste it into their job form.</p>
          </div>
          <Field label="GMB Client ID *">
            <input type="text" value={gmbClientId} onChange={e => setGmbClientId(e.target.value)}
              className="input font-mono" placeholder="xxxxx.apps.googleusercontent.com" />
          </Field>
          <Field label="GMB Client Secret *">
            <input type="password" value={gmbClientSecret} onChange={e => setGmbClientSecret(e.target.value)}
              className="input font-mono" placeholder="GOCSPX-..." />
          </Field>
        </Section>
      )}

      {step === 4 && (
        <Section title="Step 4 — Preferences" hint="Change later from /admin.">
          <label className="flex items-center gap-3 p-3 border rounded cursor-pointer hover:bg-gray-50">
            <input type="checkbox" checked={signupAllowed} onChange={e => setSignupAllowed(e.target.checked)} />
            <div>
              <div className="font-medium text-sm">Allow public signup</div>
              <div className="text-xs text-gray-500">Off = only you create users from /admin.</div>
            </div>
          </label>
        </Section>
      )}

      {step === 5 && (
        <Section title="Step 5 — Confirm">
          <div className="bg-blue-50 border border-blue-200 rounded p-4 text-sm">
            <p className="font-medium mb-2">Ready to finish</p>
            <ul className="text-xs space-y-1">
              <li>• <b>Admin:</b> <code className="bg-white px-1">{adminEmail}</code></li>
              <li>• <b>Gmail sender:</b> <code className="bg-white px-1">{gmailUser}</code></li>
              <li>• <b>Gmail OAuth:</b> <code className="bg-white px-1">{gmailClientId.slice(0, 30)}...</code></li>
              <li>• <b>GMB OAuth:</b> <code className="bg-white px-1">{gmbClientId.slice(0, 30)}...</code></li>
              <li>• <b>Public signup:</b> {signupAllowed ? 'enabled' : 'disabled'}</li>
            </ul>
          </div>
        </Section>
      )}

      <div className="flex justify-between mt-8 pt-4 border-t">
        <button onClick={back} disabled={step === 1 || submitting}
          className="text-sm border rounded px-4 py-2 hover:bg-gray-50 disabled:opacity-40">Back</button>
        {step < 5
          ? <button onClick={next} disabled={!canProceed()}
            className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded px-5 py-2 font-medium">
            Continue
          </button>
          : <button onClick={finish} disabled={submitting}
            className="text-sm bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded px-5 py-2 font-medium">
            {submitting ? 'Setting up…' : 'Finish setup'}
          </button>
        }
      </div>

      <style jsx>{`
        .input {
          width: 100%; border: 1px solid #d1d5db; border-radius: 6px;
          padding: 8px 12px; font-size: 14px; outline: none;
        }
        .input:focus { border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2); }
      `}</style>
    </div>
  );
}

function Stepper({ current }: { current: number }) {
  const labels = ['Admin', 'Gmail', 'GMB', 'Prefs', 'Done'];
  return (
    <div className="flex items-center gap-2 mt-4">
      {labels.map((label, i) => {
        const n = i + 1;
        const active = current === n;
        const done = current > n;
        return (
          <div key={n} className="flex items-center gap-1.5 flex-1 min-w-0">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0
              ${done ? 'bg-green-600 text-white' : active ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
              {done ? '✓' : n}
            </div>
            <span className={`text-xs truncate ${active ? 'font-semibold' : 'text-gray-500'}`}>{label}</span>
            {n < 5 && <div className="flex-1 h-px bg-gray-200" />}
          </div>
        );
      })}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  );
}