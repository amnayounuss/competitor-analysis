import { redirect } from 'next/navigation';
import Link from 'next/link';
import { serverClient, adminClient } from '@/lib/supabase';
import ConnectDbForm from './connect-form';

export const dynamic = 'force-dynamic';

export default async function ConnectDbPage() {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');

  const admin = adminClient();
  const { data: existing } = await admin
    .from('client_databases')
    .select('supabase_url, last_test_ok, updated_at')
    .eq('user_id', user.id).maybeSingle();

  return (
    <main className="max-w-2xl mx-auto p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Connect your Supabase</h1>
        <p className="text-sm text-gray-600">All your scraped data will be stored in your own database.</p>
      </header>

      {existing?.last_test_ok && (
        <div className="bg-green-50 border border-green-200 rounded p-3 text-sm text-green-800 mb-4">
          ✅ Currently connected to <code className="bg-white px-1">{existing.supabase_url}</code>
          <Link href="/dashboard" className="float-right text-blue-600 hover:underline">Go to dashboard →</Link>
        </div>
      )}

      <div className="bg-white border rounded-lg p-6 shadow-sm">
        <ConnectDbForm existingUrl={existing?.supabase_url || ''} />
      </div>

      <details className="mt-4 bg-blue-50 border border-blue-200 rounded p-4 text-sm">
        <summary className="cursor-pointer font-medium text-blue-900">How do I find these values?</summary>
        <ol className="list-decimal pl-5 mt-3 space-y-2 text-blue-900">
          <li>Go to <a href="https://supabase.com" target="_blank" className="underline">supabase.com</a> and create a new project (free tier is fine).</li>
          <li>Wait for the project to provision (~2 minutes).</li>
          <li>Open the <b>SQL Editor</b> from the left sidebar.</li>
          <li>Copy the schema from <Link href="/connect-database/schema" className="underline">this page</Link> and paste it in the SQL editor → Run.</li>
          <li>Go to <b>Settings → API</b>:
            <ul className="list-disc pl-5 mt-1">
              <li>Copy <b>Project URL</b> → paste in "Supabase URL" field above</li>
              <li>Copy <b>service_role</b> key (secret) → paste in "Service role key" field</li>
            </ul>
          </li>
          <li>Click "Test connection" — if green, click "Save".</li>
        </ol>
      </details>
    </main>
  );
}
