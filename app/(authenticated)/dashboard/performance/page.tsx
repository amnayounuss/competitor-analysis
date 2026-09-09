import { serverClient, adminClient } from '@/lib/supabase';
import PerformanceView from './performance-view';

export const dynamic = 'force-dynamic';

/**
 * Google Business Profile performance.
 *
 * Figures come from the client's own Google account: how many people saw the
 * business, and what they did next. The view fetches its own data so the date
 * controls and the refresh button work without a page reload.
 */
export default async function PerformancePage() {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  const { data: profile } = await adminClient()
    .from('profiles').select('role').eq('id', user.id).maybeSingle();

  return (
    <div className="px-4 sm:px-10 py-10 space-y-8">
      <PerformanceView canEdit={profile?.role !== 'viewer'} />
    </div>
  );
}
