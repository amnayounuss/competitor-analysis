import { serverClient, adminClient } from '@/lib/supabase';
import CompetitorsView from './competitors-view';

export const dynamic = 'force-dynamic';

/**
 * Competitor discovery module.
 *
 * The client stores their Business Profile refresh token here once, then runs
 * discovery: the platform reads their locations, searches the area around each
 * one, and proposes brands to compete against. Confirmed brands become the
 * options in the new-analysis form.
 */
export default async function CompetitorsPage() {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  const { data: profile } = await adminClient()
    .from('profiles').select('role').eq('id', user.id).maybeSingle();

  return (
    <div className="px-4 sm:px-10 py-10 space-y-8">
      <CompetitorsView canEdit={profile?.role !== 'viewer'} />
    </div>
  );
}
