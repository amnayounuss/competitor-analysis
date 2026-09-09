'use client';
import { useState } from 'react';
import { BiInline } from '@/lib/bilingual';

export default function ResendTab(props?: any) {
  const [testEmail, setTestEmail] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [testMsg, setTestMsg] = useState<{type:'ok'|'err', text:string}|null>(null);

  async function sendTest() {
    if (!testEmail) return;
    setSendingTest(true);
    setTestMsg(null);
    try {
      const r = await fetch('/api/admin/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testEmail }),
      });
      const data = await r.json();
      if (!r.ok) {
        setTestMsg({ type: 'err', text: data.error || 'Failed to send test email' });
      } else {
        setTestMsg({ type: 'ok', text: 'Test email sent successfully via Resend!' });
      }
    } catch (err: any) {
      setTestMsg({ type: 'err', text: err.message || 'An error occurred' });
    } finally {
      setSendingTest(false);
    }
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <div>
        <h2 className="text-2xl font-black text-slate-900 tracking-tight"><BiInline en="Email Gateway (Resend)" /></h2>
        <p className="text-sm text-slate-500 mt-1"><BiInline en="Verify and test your Resend API dispatch configuration." /></p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="space-y-6">
          <div className="bg-emerald-50 border border-emerald-100 rounded-3xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
              <h4 className="text-xs font-black text-emerald-900 uppercase tracking-widest"><BiInline en="Resend Integration Active" /></h4>
            </div>
            <p className="text-xs text-emerald-800/80 leading-relaxed">
              Your platform is configured to send analysis reports instantly using the **Resend API**. SMTP dependencies have been completely removed.
            </p>
            <div className="bg-white/60 border border-emerald-200/50 rounded-2xl p-4 text-[10px] text-emerald-900/80 font-mono">
              RESEND_API_KEY: Configured in .env
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-100 rounded-3xl p-6 space-y-4 shadow-sm">
            <div>
              <h4 className="text-xs font-black text-slate-900 uppercase tracking-widest flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-indigo-600 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 19v-8.93a2 2 0 01.89-1.664l8-5.333a2 2 0 012.22 0l8 5.333A2 2 0 0121 10.07V19M3 19a2 2 0 002 2h14a2 2 0 002-2M3 19l6.75-4.5M21 19l-6.75-4.5M3 10l6.75 4.5M21 10l-6.75 4.5m0 0l-1.14.76a2 2 0 01-2.22 0l-1.14-.76" /></svg>
                Send Test Email
              </h4>
              <p className="text-[11px] text-slate-500 leading-relaxed mt-1">Verify that your Resend API Key is working perfectly by dispatching a live test message.</p>
            </div>
            
            <div className="flex gap-2">
              <input
                type="email"
                placeholder="recipient@example.com"
                value={testEmail}
                onChange={e => setTestEmail(e.target.value)}
                className="modern-input flex-1 py-1.5 text-xs bg-white"
              />
              <button
                onClick={sendTest}
                disabled={sendingTest || !testEmail}
                className="btn-primary text-xs px-4 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50"
              >
                {sendingTest ? 'Sending...' : 'Test'}
              </button>
            </div>

            {testMsg && (
              <p className={`text-[10px] font-black uppercase tracking-wider ${testMsg.type === 'ok' ? 'text-emerald-600 animate-pulse' : 'text-rose-600'}`}>
                {testMsg.text}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-slate-50 border border-slate-100 rounded-3xl p-6">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2"><BiInline en="Pro Tip" /></h4>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Resend requires a **verified sending domain** to send emails from your own domain. If you are using the free tier or haven't verified a domain, emails will be delivered from <b>onboarding@resend.dev</b>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
