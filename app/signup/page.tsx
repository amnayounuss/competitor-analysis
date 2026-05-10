import Link from 'next/link';
import { getSettings } from '@/lib/settings';
import SignupForm from './signup-form';

export const dynamic = 'force-dynamic';

export default async function SignupPage() {
  const s = await getSettings();
  if (!s.signup_allowed) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-white border rounded-lg p-8 text-center space-y-4">
          <h1 className="text-xl font-semibold">Signups are disabled</h1>
          <p className="text-sm text-gray-600">Contact your administrator to request access.</p>
          <Link href="/login" className="inline-block text-sm text-blue-600 hover:underline">Back to sign in</Link>
        </div>
      </main>
    );
  }
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <SignupForm />
    </main>
  );
}
