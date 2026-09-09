import { NextResponse } from 'next/server';
import { serverClient, adminClient } from '@/lib/supabase';
import { getClientDbCreds, clientDbClient } from '@/lib/client-db';

/**
 * Everything the New Analysis form should already know.
 *
 * Retyping the brand and pasting the refresh token on every run is how runs go
 * wrong: a client typed "Shovel" for a business whose Google listings are in
 * Arabic, and a location filter then discarded 28 of their 29 branches. The
 * brand and the token belong to the account, not to the run, so they come from
 * the account — still editable, but right by default.
 *
 * Cities are suggested from the branches the client actually has, so the
 * location box offers real places instead of inviting free text.
 */
export async function GET() {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = adminClient();
  const { data: profile } = await admin
    .from('profiles').select('role, parent_user_id').eq('id', user.id).maybeSingle();
  const userId = profile?.role === 'viewer' && profile.parent_user_id ? profile.parent_user_id : user.id;

  const { data: row } = await admin
    .from('client_databases').select('gmb_refresh_token').eq('user_id', userId).maybeSingle();

  const { data: lastJob } = await admin
    .from('jobs').select('target_name, search_location')
    .eq('user_id', userId).order('queued_at', { ascending: false }).limit(1).maybeSingle();

  let brand: string | null = lastJob?.target_name ?? null;
  let cities: string[] = [];
  let countryCodes: string[] = [];

  try {
    const cdb = clientDbClient(await getClientDbCreds(userId));
    const { data: own } = await cdb
      .from('branches').select('brand, city, address').eq('is_target', true);

    // Prefer the brand the pipeline itself derived: it matches the listings,
    // whatever language they are written in.
    const brandCounts = new Map<string, number>();
    const cityCounts = new Map<string, number>();
    const codes = new Set<string>();
    for (const b of own || []) {
      if (b.brand) brandCounts.set(b.brand, (brandCounts.get(b.brand) || 0) + 1);
      if (b.city) cityCounts.set(b.city, (cityCounts.get(b.city) || 0) + 1);
      // The region code is the tail of a formatted address: "…, الرياض, SA".
      const tail = String(b.address || '').trim().split(/[,\s]+/).pop() || '';
      if (/^[A-Z]{2}$/.test(tail)) codes.add(tail);
    }
    const topBrand = Array.from(brandCounts.entries()).sort((a, b) => b[1] - a[1])[0];
    if (topBrand) brand = topBrand[0];

    cities = Array.from(cityCounts.entries())
      .sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 12);
    countryCodes = Array.from(codes);
  } catch {
    // No client database yet — the last job's brand is still worth offering.
  }

  return NextResponse.json({
    brand,
    hasToken: !!row?.gmb_refresh_token,
    lastLocation: lastJob?.search_location ?? null,
    cities,
    countryCodes,
  });
}
