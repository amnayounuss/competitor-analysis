/**
 * Competitor discovery, orchestration layer.
 *
 * Reads the credentials and tuning a client has stored, runs the discovery
 * engine, and upserts the result into their own schema. Nothing here talks to
 * Google directly — see scrapers/competitor-discovery.js for that.
 */

import { adminClient } from './supabase';
import { getClientDbCreds, clientDbClient } from './client-db';
import { getSettings } from './settings';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const engine = require('../scrapers/competitor-discovery');

export interface DiscoverySettings {
  radiusM: number;
  maxPerLocation: number;
  minCoLocation: number;
}

export interface DiscoveryResult {
  ownLocationCount: number;
  placesCalls: number;
  candidatesFound: number;
  saved: number;
  /** Brands the client had already decided on, left untouched. */
  preserved: number;
}

export class DiscoveryError extends Error {
  constructor(message: string, readonly kind: 'no_token' | 'bad_token' | 'no_places_key' | 'no_locations' | 'failed') {
    super(message);
  }
}

/** Everything a discovery run needs, gathered from settings and the client row. */
async function loadContext(userId: string) {
  const sb = adminClient();
  const settings = await getSettings();

  const { data: row } = await sb
    .from('client_databases')
    .select('gmb_refresh_token, discovery_radius_m, discovery_max_per_location, discovery_min_colocation')
    .eq('user_id', userId)
    .maybeSingle();

  if (!settings.gmb_oauth_client_id || !settings.gmb_oauth_client_secret) {
    throw new DiscoveryError(
      'Business Profile OAuth is not configured. An administrator sets this under Business API.',
      'failed');
  }
  if (!settings.google_places_api_key) {
    throw new DiscoveryError(
      'No Google Places API key is configured, so nearby businesses cannot be searched. An administrator sets this under Business API.',
      'no_places_key');
  }
  if (!row?.gmb_refresh_token) {
    throw new DiscoveryError(
      'Add your Google Business Profile refresh token first — discovery reads your locations through it.',
      'no_token');
  }

  return {
    oauth: {
      clientId: settings.gmb_oauth_client_id,
      clientSecret: settings.gmb_oauth_client_secret,
      refreshToken: row.gmb_refresh_token,
    },
    apiKey: settings.google_places_api_key,
    tuning: {
      radiusM: row.discovery_radius_m ?? 5000,
      maxPerLocation: row.discovery_max_per_location ?? 20,
      minCoLocation: row.discovery_min_colocation ?? 2,
    },
  };
}

/**
 * Run discovery for one client and store the candidates.
 *
 * A brand the client has already confirmed or rejected keeps that decision —
 * only its evidence (co-location count, ratings, branch count) is refreshed.
 * Re-running must never silently undo a choice the client made.
 */
export async function runDiscovery(
  userId: string,
  onProgress: (message: string) => void = () => {},
): Promise<DiscoveryResult> {
  const { oauth, apiKey, tuning } = await loadContext(userId);

  let result: any;
  try {
    result = await engine.discoverCompetitors({
      oauth, apiKey,
      radiusM: tuning.radiusM,
      maxPerLocation: tuning.maxPerLocation,
      minCoLocation: tuning.minCoLocation,
      onProgress,
    });
  } catch (err: any) {
    if (err?.badToken) {
      throw new DiscoveryError(
        'Google rejected that refresh token. Generate a new one with the business.manage scope and save it again.',
        'bad_token');
    }
    if (/No locations found/i.test(err?.message || '')) {
      throw new DiscoveryError(
        'That Business Profile account has no open locations, so there is no area to search around.',
        'no_locations');
    }
    throw new DiscoveryError(err?.message || 'Discovery failed', 'failed');
  }

  const candidates: any[] = result.candidates || [];
  const creds = await getClientDbCreds(userId);
  const cdb = clientDbClient(creds);

  // Which brands already carry a decision.
  const { data: decided } = await cdb
    .from('competitor_candidates')
    .select('brand_key, status')
    .neq('status', 'suggested');
  const decidedKeys = new Map<string, string>((decided || []).map((d: any) => [d.brand_key, d.status]));

  const rows = candidates.map(c => ({
    ...c,
    // Keep the client's decision; refresh everything else.
    status: decidedKeys.get(c.brand_key) || 'suggested',
    updated_at: new Date().toISOString(),
  }));

  let saved = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await cdb
      .from('competitor_candidates')
      .upsert(chunk, { onConflict: 'brand_key' });
    if (error) throw new DiscoveryError('Could not save candidates: ' + error.message, 'failed');
    saved += chunk.length;
  }

  await adminClient()
    .from('client_databases')
    .update({ discovery_last_run_at: new Date().toISOString() })
    .eq('user_id', userId);

  onProgress(`${saved} candidates saved`);

  return {
    ownLocationCount: result.ownLocationCount,
    placesCalls: result.placesCalls,
    candidatesFound: candidates.length,
    saved,
    preserved: decidedKeys.size,
  };
}
