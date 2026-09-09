import { serverClient, adminClient } from '@/lib/supabase';
import AdvisorView from './advisor-view';

export const dynamic = 'force-dynamic';

/**
 * The advisor dashboard.
 *
 * Answers four questions in order — what is happening, is it good or bad, why,
 * and what to do about it — instead of leaving a manager to read charts and work
 * that out themselves. Numbers come from lib/dashboard-advisor; the writing
 * beside each one comes from lib/dashboard-insights.
 */
export default async function AdvisorPage() {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  const { data: profile } = await adminClient()
    .from('profiles').select('role').eq('id', user.id).maybeSingle();

  return (
    <div className="px-4 sm:px-10 py-10 space-y-6">
      <AdvisorView canEdit={profile?.role !== 'viewer'} />
    </div>
  );
}
