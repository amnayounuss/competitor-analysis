/**
 * Getting a client's data in, from the browser.
 *
 * A fresh client's dashboard is empty, and until now the three steps that fill
 * it — pull the reviews from Google, read them for feeling, sort them by
 * subject — existed only as CLI scripts. So a client could see "this read covers
 * 0% of your reviews" with no way to do anything about it. These are the same
 * operations, startable from the page.
 *
 * All three run in the background and report progress, for the reason the
 * performance sync and the advisory both learned the hard way: a request held
 * open for minutes gets its connection dropped somewhere between the browser
 * and this box, and the user sees "NetworkError" for work that succeeded.
 */

import { adminClient } from './supabase';
import { clientDbClient, getClientDbCreds, getClientAiKey } from './client-db';
import { getSettings } from './settings';
import { scoreReviewsForJob } from './review-sentiment';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const sync = require('../scrapers/gmb-review-sync');

export interface RunState {
  running: boolean;
  startedAt: string;
  finishedAt: string | null;
  /** Units finished, in whatever the step counts. */
  done: number;
  /** Units expected, 0 when not known up front. */
  total: number;
  /** A translation key plus a number, so the page can localise it. */
  step: { key: string; n: number } | null;
  error: string | null;
}

function begin(map: Map<string, RunState>, userId: string, total: number): RunState {
  const state: RunState = {
    running: true, startedAt: new Date().toISOString(), finishedAt: null,
    done: 0, total, step: null, error: null,
  };
  map.set(userId, state);
  return state;
}
function end(state: RunState) {
  state.running = false;
  state.finishedAt = new Date().toISOString();
}

/* ────────────── 1. pull the reviews ────────────── */

export interface ReviewSyncResult {
  locations: number;
  /** Rows written this run — new reviews plus any whose reply changed. */
  reviews: number;
  replies: number;
  /** Locations read in full because nothing was stored for them yet. */
  firstTimeLocations: number;
  shortfalls: string[];
  /** Locations that could not be stored at all, with the reason. */
  failures: string[];
}

/**
 * Bring the client's Business Profile reviews into their schema.
 *
 * Incremental by default and per location: each branch is asked only for what
 * Google has touched since that branch's newest stored review, so a routine
 * sync costs one page per location instead of re-reading tens of thousands of
 * rows that are already here. A location with nothing stored is read in full,
 * which is what a brand-new client gets on their first run.
 *
 * Upserts on Google's review id, so nothing duplicates and a reply that arrives
 * later overwrites the blank one.
 */
export async function syncReviewsForClient(opts: {
  userId: string;
  locationLimit?: number;
  onProgress?: (key: string, n: number) => void;
}): Promise<ReviewSyncResult> {
  const { userId } = opts;
  const onProgress = opts.onProgress ?? (() => {});

  const settings = await getSettings();
  const { data: row } = await adminClient()
    .from('client_databases').select('gmb_refresh_token').eq('user_id', userId).maybeSingle();

  if (!settings.gmb_oauth_client_id || !settings.gmb_oauth_client_secret) {
    throw new Error('Google Business Profile is not connected for this platform yet.');
  }
  if (!row?.gmb_refresh_token) {
    throw new Error('Connect your Google Business Profile first — your reviews come from your own account.');
  }

  const oauth = {
    clientId: settings.gmb_oauth_client_id,
    clientSecret: settings.gmb_oauth_client_secret,
    refreshToken: row.gmb_refresh_token,
  };

  const cdb = clientDbClient(await getClientDbCreds(userId));
  const { token, locations } = await sync.listLocations(oauth, () => {});
  const targets = opts.locationLimit ? locations.slice(0, opts.locationLimit) : locations;

  // Brand labels are decided across the whole account, not one name at a time:
  // "وايت كافيه | الخبر" and "مقهى وايت | White Cafe" are one chain, and only
  // the full list shows that.
  const brandLabel: Map<string, string> = sync.canonicaliseBrands(
    targets.map((l: any) => l.storeName).filter(Boolean));
  const brandOf = (loc: any) => {
    const key = loc.brandKey || loc.storeName;
    return (key && brandLabel.get(key)) || key;
  };

  let reviews = 0, replies = 0, firstTimeLocations = 0;
  const shortfalls: string[] = [];
  const failures: string[] = [];

  /**
   * A day of overlap on the cutoff.
   *
   * Google's updateTime and our clock are not the same clock, and a review that
   * lands in the same second as a sync would otherwise fall in the gap between
   * two runs and never be seen again. Re-reading one day costs a page.
   */
  const OVERLAP_MS = 24 * 60 * 60 * 1000;

  for (const [i, loc] of targets.entries()) {
    onProgress('Reading branch {n}', i + 1);

    // The branch row is keyed by the Google location id, so a re-sync updates
    // rather than duplicates.
    const { data: existing } = await cdb
      .from('branches').select('id').eq('gmb_location_id', loc.locationId).maybeSingle();

    const patch = {
      brand: brandOf(loc),
      brand_key: brandOf(loc),
      branch_name: loc.city || loc.storeName || '(unknown)',
      store_name: loc.storeName,
      city: loc.city,
      address: loc.address,
      phone: loc.phone,
      website: loc.website,
      place_id: loc.placeId,
      gmb_location_id: loc.locationId,
      is_target: true,
      reviews_synced_at: new Date().toISOString(),
    };

    let branchId = existing?.id;
    if (branchId) {
      await cdb.from('branches').update(patch).eq('id', branchId);
    } else {
      const { data: created, error } = await cdb
        .from('branches').insert({ ...patch, job_id: null }).select('id').single();
      // Never swallowed: a `continue` here once turned a total failure — every
      // branch rejected by a NOT NULL constraint — into a cheerful "0 new
      // reviews", which is the worst possible way to report it.
      if (error) { failures.push(`${loc.storeName || loc.locationId}: ${error.message}`); continue; }
      branchId = created.id;
    }

    // Newest review already stored for this branch decides where to resume.
    let since: string | null = null;
    if (branchId) {
      const { data: newest } = await cdb
        .from('reviews')
        .select('published_at')
        .eq('branch_id', branchId)
        .not('published_at', 'is', null)
        .order('published_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (newest?.published_at) {
        since = new Date(Date.parse(newest.published_at) - OVERLAP_MS).toISOString();
      }
    }
    if (!since) firstTimeLocations++;

    const { reviews: fetched, reportedTotal, stoppedEarly } = await sync.fetchAllReviews(
      token, loc.accountId, loc.locationId, () => {}, { since });

    if (fetched.length > 0) {
      const rows = fetched.map((r: any) => ({
        job_id: null,
        branch_id: branchId,
        brand: brandOf(loc),
        gmb_review_id: r.gmbReviewId,
        rating: r.rating,
        text: r.text,
        reviewer_name: r.reviewerName,
        published_at: r.publishedAt,
        reply_text: r.replyText,
        replied_at: r.repliedAt,
      })).filter((r: any) => r.gmb_review_id);

      for (let k = 0; k < rows.length; k += 400) {
        const { error } = await cdb.from('reviews')
          .upsert(rows.slice(k, k + 400), { onConflict: 'branch_id,gmb_review_id' });
        if (error) break;
      }
    }

    /**
     * Star average and count, from the reviews themselves.
     *
     * The Overview reads branches.stars, and only the analysis scrape used to
     * set it — so a client who had synced but not yet run an analysis showed a
     * rating of zero. Every review is already here with its rating, which is a
     * better source than a scrape anyway: it cannot disagree with the reviews
     * on the same page.
     */
    const { data: rated } = await cdb
      .from('reviews').select('rating').eq('branch_id', branchId).not('rating', 'is', null);
    const ratings = (rated || []).map((r: any) => Number(r.rating)).filter((n: number) => n >= 1 && n <= 5);
    const stars = ratings.length
      ? Number((ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length).toFixed(2))
      : null;

    // Null, not zero: Google has no reviews for some branches, and a stored 0
    // reads as a one-star-worst rating everywhere it is shown.
    await cdb.from('branches').update({
      review_total: reportedTotal,
      stars: stars,
      reviews_count: ratings.length,
    }).eq('id', branchId);

    reviews += fetched.length;
    replies += fetched.filter((r: any) => r.replyText).length;

    // Only meaningful on a full read: an incremental one is *expected* to
    // return far fewer than Google's lifetime total.
    if (!since && !stoppedEarly && reportedTotal != null && fetched.length < reportedTotal) {
      shortfalls.push(`${loc.storeName} ${loc.city || ''}: ${fetched.length} of ${reportedTotal}`);
    }
  }

  // A run where nothing could be stored is a failure, not a quiet success.
  if (failures.length === targets.length && targets.length > 0) {
    throw new Error(`Could not save any branch. First error: ${failures[0]}`);
  }

  onProgress('Saved {n} reviews', reviews);
  return { locations: targets.length, reviews, replies, firstTimeLocations, shortfalls, failures };
}

const reviewRuns = new Map<string, RunState>();
export const getReviewSyncRun = (userId: string) => reviewRuns.get(userId) ?? null;

export function startReviewSync(userId: string): RunState {
  const existing = reviewRuns.get(userId);
  if (existing?.running) return existing;
  const state = begin(reviewRuns, userId, 0);

  void syncReviewsForClient({
    userId,
    onProgress: (key, n) => { state.step = { key, n }; state.done = n; },
  })
    .then(r => { state.done = r.reviews; state.step = { key: 'Saved {n} reviews', n: r.reviews }; })
    .catch((err: any) => { state.error = err?.message || 'Could not fetch your reviews.'; })
    .finally(() => end(state));

  return state;
}

/* ────────────── 2. read them for feeling ────────────── */

const feelingRuns = new Map<string, RunState>();
export const getFeelingRun = (userId: string) => feelingRuns.get(userId) ?? null;

export function startFeelingRun(opts: { userId: string; cdb: any; total: number }): RunState {
  const existing = feelingRuns.get(opts.userId);
  if (existing?.running) return existing;
  const state = begin(feelingRuns, opts.userId, opts.total);

  void (async () => {
    const key = await getClientAiKey(opts.userId);
    if (!key) throw new Error('No AI key is set for your account. Add a Claude or OpenAI key below.');
    // jobId null means the whole schema: a standalone review sync writes rows
    // with no job attached, and a job filter would skip the entire corpus.
    return scoreReviewsForJob({
      cdb: opts.cdb, jobId: null, aiKey: key, maxReviews: 100000,
      log: async (_l, m) => console.log('[feeling]', m),
    });
  })()
    .then(r => {
      state.done = r.scored;
      if (r.keyProblem) state.error = r.keyProblem.message;
    })
    .catch((err: any) => { state.error = err?.message || 'Could not read your reviews.'; })
    .finally(() => end(state));

  return state;
}
