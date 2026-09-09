/**
 * Pull Google Business Profile performance figures on demand.
 *
 * The analysis pipeline already collects these as one stage of a full run, but a
 * full run takes minutes and does a great deal besides. Checking last week's
 * numbers should not require re-scraping competitors, so this fetches the
 * metrics on their own for whatever dates the client picks.
 *
 * Rows upsert on (job, location, metric, date), so re-syncing an overlapping
 * range corrects figures rather than duplicating them. Google restates recent
 * days for a while, which is exactly why a re-sync has to overwrite.
 */

import { adminClient } from './supabase';
import { getClientDbCreds, clientDbClient } from './client-db';
import { getSettings } from './settings';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const perf = require('../scrapers/gbp-performance');

/** A stable job id for standalone syncs, so they never collide with a real run. */
const SYNC_JOB_ID = '00000000-0000-0000-0000-0000000000p1'.replace('p', '0');

export interface PerformanceSyncResult {
  locations: number;
  series: number;
  rows: number;
  from: string;
  to: string;
  unavailable: string[];
}

export class PerformanceSyncError extends Error {
  constructor(message: string, readonly kind: 'no_token' | 'no_locations' | 'bad_token' | 'failed') {
    super(message);
  }
}

/* ────────────── running it in the background ────────────── */

/**
 * A sync of ~30 locations means ~300 calls to Google and takes tens of seconds
 * — minutes once Google starts metering us. Holding the browser's request open
 * that whole time is what produced "NetworkError when attempting to fetch
 * resource": the work finished and saved server-side, but something on the path
 * between the browser and this box dropped a connection that had sat silent for
 * minutes, so the user saw a failure for a sync that had actually worked.
 *
 * So the request no longer waits. POST starts the run and returns; the page
 * polls for state. State lives in this process only — a restart mid-run loses
 * it, and the page then falls back to `performance_synced_at`, which is the
 * honest answer anyway.
 */
export interface SyncState {
  running: boolean;
  startedAt: string;
  finishedAt: string | null;
  from: string;
  to: string;
  /** A translation key, and the number to substitute for {n} in it. */
  step: { key: string; n: number } | null;
  result: PerformanceSyncResult | null;
  error: string | null;
  errorKind: PerformanceSyncError['kind'] | null;
}

const runs = new Map<string, SyncState>();

export function getSyncState(userId: string): SyncState | null {
  return runs.get(userId) ?? null;
}

/**
 * Kick off a sync unless one is already running for this client. Returns the
 * state to report back straight away; never throws for sync failures, which
 * land on the state instead.
 */
export function startPerformanceSync(opts: { userId: string; from: string; to: string }): SyncState {
  const existing = runs.get(opts.userId);
  if (existing?.running) return existing;

  const state: SyncState = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    from: opts.from,
    to: opts.to,
    step: null,
    result: null,
    error: null,
    errorKind: null,
  };
  runs.set(opts.userId, state);

  // Deliberately not awaited: the caller returns to the browser immediately.
  void syncPerformance({
    userId: opts.userId,
    from: opts.from,
    to: opts.to,
    onProgress: (key, n) => { state.step = { key, n }; console.log('[performance]', key, n); },
  })
    .then(result => { state.result = result; })
    .catch((err: any) => {
      state.error = err?.message || 'Could not refresh the figures.';
      state.errorKind = err instanceof PerformanceSyncError ? err.kind : 'failed';
      console.error('[performance] sync failed:', state.error);
    })
    .finally(() => {
      state.running = false;
      state.finishedAt = new Date().toISOString();
    });

  return state;
}

export async function syncPerformance(opts: {
  userId: string;
  from: string;
  to: string;
  onProgress?: (key: string, n: number) => void;
}): Promise<PerformanceSyncResult> {
  const { userId, from, to } = opts;
  const onProgress = opts.onProgress ?? (() => {});

  const settings = await getSettings();
  const { data: row } = await adminClient()
    .from('client_databases').select('gmb_refresh_token').eq('user_id', userId).maybeSingle();

  if (!settings.gmb_oauth_client_id || !settings.gmb_oauth_client_secret) {
    throw new PerformanceSyncError('Google Business Profile is not connected for this platform yet.', 'failed');
  }
  if (!row?.gmb_refresh_token) {
    throw new PerformanceSyncError(
      'Connect your Google Business Profile first — the figures come from your own account.',
      'no_token');
  }

  const cdb = clientDbClient(await getClientDbCreds(userId));

  // Only the client's own branches carry a Business Profile location id; the
  // performance API serves nothing for places the account does not manage.
  const { data: branches, error } = await cdb
    .from('branches')
    .select('id, branch_name, brand, store_name, gmb_location_id, place_id')
    .not('gmb_location_id', 'is', null)
    .eq('is_target', true);

  if (error) throw new PerformanceSyncError('Performance storage is missing. Re-run database setup.', 'failed');

  // One branch row per location id — a location can appear under more than one
  // analysis run, and each would otherwise be fetched separately.
  const byLocation = new Map<string, any>();
  for (const b of branches || []) {
    if (!byLocation.has(b.gmb_location_id)) byLocation.set(b.gmb_location_id, b);
  }
  const locations = Array.from(byLocation.values());

  if (locations.length === 0) {
    throw new PerformanceSyncError(
      'No branches are linked to your Google account yet. Run an analysis or sync your reviews first.',
      'no_locations');
  }

  onProgress('Asking Google about {n} branches', locations.length);

  const cfg = {
    TARGET_API: {
      clientId: settings.gmb_oauth_client_id,
      clientSecret: settings.gmb_oauth_client_secret,
      refreshToken: row.gmb_refresh_token,
    },
    __check: async () => {},
  };

  // The scraper reads its config through a module-level proxy.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const proxy = require('../scrapers/config');
  proxy.__setActiveConfig(cfg);

  let series: any[];
  try {
    series = await perf.fetchPerformance(
      locations.map(l => ({ gmbLocationId: l.gmb_location_id, placeId: l.place_id, title: l.store_name || l.branch_name })),
      { dateStart: from, dateEnd: to },
    );
  } catch (err: any) {
    if (/refresh token|invalid_grant|OAuth/i.test(err?.message || '')) {
      throw new PerformanceSyncError(
        'Google rejected your saved connection. Reconnect your Business Profile and try again.',
        'bad_token');
    }
    throw new PerformanceSyncError(err?.message || 'Could not reach Google.', 'failed');
  } finally {
    proxy.__clearActiveConfig();
  }

  const rows: any[] = [];
  for (const s of series) {
    const branch = byLocation.get(String(s.gmbLocationId));
    for (const p of s.series || []) {
      rows.push({
        job_id: SYNC_JOB_ID,
        branch_id: branch?.id ?? null,
        gmb_location_id: String(s.gmbLocationId),
        brand: branch?.brand ?? null,
        // The store name, matching what the analysis and branch tables show.
        // branch_name holds the city, so every Riyadh branch read "الرياض" and
        // the branch-by-branch table was 18 identical rows.
        branch_name: branch?.store_name ?? branch?.branch_name ?? s.title ?? null,
        metric: s.metric,
        metric_date: p.date,
        value: Number(p.value) || 0,
      });
    }
  }

  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error: upErr } = await cdb
      .from('gbp_metrics')
      .upsert(chunk, { onConflict: 'job_id,gmb_location_id,metric,metric_date' });
    if (upErr) throw new PerformanceSyncError('Could not save the figures: ' + upErr.message, 'failed');
    written += chunk.length;
  }

  await adminClient()
    .from('client_databases')
    .update({ performance_synced_at: new Date().toISOString() })
    .eq('user_id', userId);

  onProgress('Saved {n} daily figures', written);

  // Metrics a business category does not support come back empty every time;
  // naming them is more useful than leaving a blank chart unexplained.
  const returned = new Set(series.map((s: any) => s.metric));
  const unavailable = (perf.DAILY_METRICS as string[]).filter(m => !returned.has(m));

  return { locations: locations.length, series: series.length, rows: written, from, to, unavailable };
}
