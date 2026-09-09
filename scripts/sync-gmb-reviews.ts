/**
 * sync-gmb-reviews.ts
 *
 * Pulls a client's entire Business Profile review corpus into their schema:
 * every account, every open location, every review, with the owner's reply.
 *
 * Upserts on Google's reviewId, so it is safe to run repeatedly — replies that
 * arrive later, and ratings that change, are picked up without duplicating rows.
 *
 *   npx tsx scripts/sync-gmb-reviews.ts <user-uuid|email>
 *   npx tsx scripts/sync-gmb-reviews.ts codeco@wags.sa --locations 3   # trial
 */

import 'dotenv/config';
import { adminClient } from '../lib/supabase';
import { clientDbClient, getClientDbCreds } from '../lib/client-db';
import { getSettings } from '../lib/settings';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const sync = require('../scrapers/gmb-review-sync');

const args = process.argv.slice(2);
const who = args.find(a => !a.startsWith('--'));
const li = args.indexOf('--locations');
const locLimit = li > -1 ? parseInt(args[li + 1], 10) : Infinity;

async function resolveUserId(id: string): Promise<string> {
  if (/^[0-9a-f-]{36}$/i.test(id)) return id;
  const { data } = await adminClient().from('profiles').select('id').eq('email', id).maybeSingle();
  if (!data?.id) throw new Error(`No user with email ${id}`);
  return data.id;
}

async function main() {
  if (!who) { console.error('usage: npx tsx scripts/sync-gmb-reviews.ts <user-uuid|email> [--locations N]'); process.exit(1); }
  const userId = await resolveUserId(who);

  const settings = await getSettings();
  const { data: row } = await adminClient()
    .from('client_databases')
    .select('gmb_refresh_token')
    .eq('user_id', userId).maybeSingle();

  if (!settings.gmb_oauth_client_id || !settings.gmb_oauth_client_secret) throw new Error('GMB OAuth is not configured in app_settings');
  if (!row?.gmb_refresh_token) throw new Error('This client has no stored GMB refresh token');

  const oauth = {
    clientId: settings.gmb_oauth_client_id,
    clientSecret: settings.gmb_oauth_client_secret,
    refreshToken: row.gmb_refresh_token,
  };

  const cdb = clientDbClient(await getClientDbCreds(userId));
  const log = (m: string) => console.log('  ' + m);

  const { token, locations } = await sync.listLocations(oauth, log);
  const targets = Number.isFinite(locLimit) ? locations.slice(0, locLimit) : locations;

  // Brand breakdown up front — a client account can hold several unrelated
  // brands, and it is worth seeing that before thousands of rows land.
  const byBrand = targets.reduce((acc: Record<string, number>, l: any) => {
    acc[l.brandKey || '(unknown)'] = (acc[l.brandKey || '(unknown)'] || 0) + 1; return acc;
  }, {});
  log('brands: ' + Object.entries(byBrand).map(([b, n]) => `${b} (${n})`).join(', '));

  let totalReviews = 0, totalReplies = 0, shortfalls: string[] = [];

  for (const [i, loc] of targets.entries()) {
    // The branch row is keyed by the GMB location id, so a re-sync updates it.
    const { data: existing } = await cdb
      .from('branches').select('id').eq('gmb_location_id', loc.locationId).maybeSingle();

    const branchPatch = {
      brand: loc.brandKey || loc.storeName,
      brand_key: loc.brandKey,
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
      await cdb.from('branches').update(branchPatch).eq('id', branchId);
    } else {
      const { data: created, error } = await cdb
        .from('branches').insert({ ...branchPatch, job_id: null }).select('id').single();
      if (error) { log(`  ${loc.storeName}: could not create branch — ${error.message}`); continue; }
      branchId = created.id;
    }

    const { reviews, reportedTotal } = await sync.fetchAllReviews(token, loc.accountId, loc.locationId, log);

    if (reviews.length > 0) {
      const rows = reviews.map((r: any) => ({
        job_id: null,
        branch_id: branchId,
        brand: loc.brandKey || loc.storeName,
        gmb_review_id: r.gmbReviewId,
        rating: r.rating,
        text: r.text,
        reviewer_name: r.reviewerName,
        published_at: r.publishedAt,
        reply_text: r.replyText,
        replied_at: r.repliedAt,
      })).filter((r: any) => r.gmb_review_id);

      for (let k = 0; k < rows.length; k += 400) {
        const chunk = rows.slice(k, k + 400);
        const { error } = await cdb.from('reviews')
          .upsert(chunk, { onConflict: 'branch_id,gmb_review_id' });
        if (error) { log(`  ${loc.storeName}: review upsert failed — ${error.message}`); break; }
      }
    }

    await cdb.from('branches').update({ review_total: reportedTotal }).eq('id', branchId);

    const replies = reviews.filter((r: any) => r.replyText).length;
    totalReviews += reviews.length;
    totalReplies += replies;

    // Compare what Google says the location has against what we actually got —
    // a silent shortfall is how a partial sync passes for a complete one.
    const short = reportedTotal != null && reviews.length < reportedTotal;
    if (short) shortfalls.push(`${loc.storeName} ${loc.city || ''}: got ${reviews.length} of ${reportedTotal}`);

    log(`[${i + 1}/${targets.length}] ${(loc.brandKey || '?').padEnd(14)} ${(loc.city || '').padEnd(12)} ` +
        `${String(reviews.length).padStart(4)} reviews, ${String(replies).padStart(4)} replied` +
        (short ? `  (Google reports ${reportedTotal})` : ''));
  }

  console.log(`\n  ${totalReviews} reviews, ${totalReplies} with a reply (${totalReviews ? Math.round(100 * totalReplies / totalReviews) : 0}%)`);
  if (shortfalls.length) {
    console.log(`\n  ${shortfalls.length} location(s) returned fewer reviews than Google reports:`);
    shortfalls.forEach(s => console.log('    ' + s));
  }
  process.exit(0);
}

main().catch(e => { console.error('fatal:', e.message); process.exit(1); });
