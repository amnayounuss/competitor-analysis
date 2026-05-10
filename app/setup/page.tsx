import { redirect } from 'next/navigation';
import { isSetupCompleted } from '@/lib/settings';
import SetupWizard from './setup-wizard';

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  if (await isSetupCompleted()) redirect('/login');
  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10 bg-gray-50">
      <SetupWizard />
    </main>
  );
}
