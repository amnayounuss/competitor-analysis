/**
 * Manual branch management for a report (client DB).
 *   DELETE  { jobId, branchId }            → remove a branch (+cascade), recompute
 *   POST    { jobId, branch }              → add a branch (+optional popular-times), recompute
 *   PATCH   { jobId, action: 'dedup' }     → remove duplicate branches, recompute
 *
 * Auth: logged-in user must own the job (viewers act on their parent's data but
 * may NOT mutate). Aggregates: `analyses` is recomputed here; the DB views
 * (job_summary, branch_rankings) recompute automatically.
 */
import { NextResponse } from 'next/server';
import { serverClient, adminClient } from '@/lib/supabase';
import { getClientDbCreds, clientDbClient } from '@/lib/client-db';
import { getUserProfile, getEffectiveUserId } from '@/lib/user-role';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function authcheck(allowViewer = false) {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  const admin = adminClient();
  const profile = await getUserProfile(admin, user.id);
  if (!allowViewer && profile.role === 'viewer') {
    return { error: NextResponse.json({ error: 'viewers cannot edit data' }, { status: 403 }) };
  }
  const effectiveUserId = getEffectiveUserId(profile, user.id);
  return { user, admin, effectiveUserId };
}

async function ownsJob(admin: any, jobId: string, effectiveUserId: string): Promise<boolean> {
  const { data } = await admin.from('jobs').select('user_id').eq('id', jobId).single();
  return !!data && data.user_id === effectiveUserId;
}

/** Recompute the per-brand `analyses` rows from current branch_analytics. */
async function recomputeAnalyses(cdb: any, jobId: string) {
  const { data: rows } = await cdb
    .from('branch_analytics')
    .select('brand, avg_rating_period, total_reviews_period')
    .eq('job_id', jobId);
  const byBrand = new Map<string, { count: number; ratingSum: number; weight: number; reviews: number }>();
  for (const r of rows || []) {
    const acc = byBrand.get(r.brand) || { count: 0, ratingSum: 0, weight: 0, reviews: 0 };
    acc.count++;
    const reviews = Number(r.total_reviews_period) || 0;
    acc.reviews += reviews;
    if (r.avg_rating_period != null && reviews > 0) {
      acc.ratingSum += Number(r.avg_rating_period) * reviews;
      acc.weight += reviews;
    } else if (r.avg_rating_period != null) {
      // No review weight available — fall back to simple mean contribution.
      acc.ratingSum += Number(r.avg_rating_period);
      acc.weight += 1;
    }
    byBrand.set(r.brand, acc);
  }
  await cdb.from('analyses').delete().eq('job_id', jobId);
  const analysisRows = Array.from(byBrand.entries()).map(([brand, a]) => ({
    job_id: jobId,
    brand,
    branch_count: a.count,
    total_reviews_period: a.reviews,
    avg_rating_period: a.weight > 0 ? Number((a.ratingSum / a.weight).toFixed(2)) : null,
    star_5_count: 0, star_4_count: 0, star_3_count: 0, star_2_count: 0, star_1_count: 0,
  }));
  if (analysisRows.length) await cdb.from('analyses').insert(analysisRows);
}

// ── DELETE ─────────────────────────────────────────────────
export async function DELETE(req: Request) {
  const a = await authcheck();
  if (a.error) return a.error;
  const { jobId, branchId } = await req.json().catch(() => ({}));
  if (!jobId || !branchId) return NextResponse.json({ error: 'jobId and branchId required' }, { status: 400 });
  if (!(await ownsJob(a.admin, jobId, a.effectiveUserId))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const cdb = clientDbClient(await getClientDbCreds(a.effectiveUserId));
  // FK on branch_analytics/reviews is ON DELETE CASCADE, but delete explicitly
  // too in case the FK isn't present on older client schemas.
  await cdb.from('branch_analytics').delete().eq('job_id', jobId).eq('branch_id', branchId);
  await cdb.from('reviews').delete().eq('branch_id', branchId);
  const { error } = await cdb.from('branches').delete().eq('id', branchId).eq('job_id', jobId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recomputeAnalyses(cdb, jobId);
  return NextResponse.json({ ok: true });
}

// ── POST (add) ─────────────────────────────────────────────
export async function POST(req: Request) {
  const a = await authcheck();
  if (a.error) return a.error;
  const body = await req.json().catch(() => ({}));
  const { jobId, branch } = body;
  if (!jobId || !branch || !branch.brand || !branch.branch_name) {
    return NextResponse.json({ error: 'jobId, branch.brand, branch.branch_name required' }, { status: 400 });
  }
  if (!(await ownsJob(a.admin, jobId, a.effectiveUserId))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const cdb = clientDbClient(await getClientDbCreds(a.effectiveUserId));

  // Determine if this brand is the target brand for the job.
  const { data: jobRow } = await a.admin.from('jobs').select('target_name').eq('id', jobId).single();
  const isTarget = jobRow?.target_name?.toLowerCase() === String(branch.brand).toLowerCase();

  const rating = branch.stars != null ? Number(branch.stars) : null;
  const reviewsCount = branch.reviews_count != null ? Number(branch.reviews_count) : 0;
  const mapsLink = branch.google_maps_link
    || (branch.place_id ? `https://www.google.com/maps/place/?q=place_id:${branch.place_id}` : null);

  // Optional: scrape popular times for the new location (best-effort).
  let popularTimes: any = null;
  if (branch.place_id && String(branch.place_id).startsWith('ChIJ')) {
    try {
      const settings = await getSettings();
      const { scrapePopularTimes } = await import('@/scrapers');
      const cfg: any = {
        PUPPETEER_OPTIONS: { headless: settings.puppeteer_headless, betweenBranchesMs: 1000 },
        POPULAR_TIMES_OPTIONS: { enableHoverFallback: true, concurrency: 1 },
        RAW_JSON_FILE: null,
      };
      const placeArr = [{ title: branch.branch_name, placeId: branch.place_id, url: mapsLink }];
      const out = await Promise.race([
        scrapePopularTimes(placeArr, cfg, null),
        new Promise<any[]>((res) => setTimeout(() => res(placeArr), 70000)),
      ]);
      popularTimes = out?.[0]?.popularTimes || null;
    } catch { /* best-effort */ }
  }

  const peak = popularTimes?.available ? popularTimes : null;

  const { data: inserted, error: bErr } = await cdb.from('branches').insert({
    job_id: jobId,
    place_id: branch.place_id || null,
    brand: branch.brand,
    branch_name: branch.branch_name,
    store_name: branch.store_name || branch.branch_name || null,
    city: branch.city || null,
    address: branch.address || null,
    phone: branch.phone || null,
    website: branch.website || null,
    popular_times: popularTimes?.grid || null,
    stars: rating ?? 0,
    reviews_count: reviewsCount,
    is_target: isTarget,
  }).select('id').single();
  if (bErr) return NextResponse.json({ error: 'insert branch failed: ' + bErr.message }, { status: 500 });

  const { error: aErr } = await cdb.from('branch_analytics').insert({
    job_id: jobId,
    branch_id: inserted.id,
    brand: branch.brand,
    branch_name: branch.branch_name,
    store_name: branch.store_name || branch.branch_name || null,
    city: branch.city || null,
    address: branch.address || null,
    google_maps_link: mapsLink,
    business_hours: branch.business_hours || branch.hours || null,
    phone: branch.phone || null,
    peak_day: peak?.peakDay || null,
    peak_hour: peak?.peakHour || null,
    peak_busyness_pct: peak?.peakBusyness ?? null,
    peak_time: peak ? `${peak.peakDay || ''} ${peak.peakHour || ''}`.trim() : null,
    busy_hours_summary: peak?.summary || null,
    avg_rating_period: rating,
    total_reviews_period: reviewsCount,
    star_5_count: 0, star_4_count: 0, star_3_count: 0, star_2_count: 0, star_1_count: 0,
    popular_times_grid: popularTimes?.grid || null,
  });
  if (aErr) return NextResponse.json({ error: 'insert analytics failed: ' + aErr.message }, { status: 500 });

  await recomputeAnalyses(cdb, jobId);
  return NextResponse.json({ ok: true, branchId: inserted.id, popularTimes: !!popularTimes?.available });
}

// ── PATCH (dedup) ──────────────────────────────────────────
export async function PATCH(req: Request) {
  const a = await authcheck();
  if (a.error) return a.error;
  const { jobId, action } = await req.json().catch(() => ({}));
  if (!jobId || action !== 'dedup') return NextResponse.json({ error: "jobId and action:'dedup' required" }, { status: 400 });
  if (!(await ownsJob(a.admin, jobId, a.effectiveUserId))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const cdb = clientDbClient(await getClientDbCreds(a.effectiveUserId));
  const { data: branches } = await cdb
    .from('branches')
    .select('id, place_id, brand, branch_name, city, created_at')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true });

  const seen = new Set<string>();
  const toDelete: string[] = [];
  for (const b of branches || []) {
    // Strongest key first: place_id; otherwise brand|branch_name|city.
    const key = b.place_id
      ? `pid:${b.place_id}`
      : `n:${(b.brand || '').toLowerCase()}|${(b.branch_name || '').toLowerCase()}|${(b.city || '').toLowerCase()}`;
    if (seen.has(key)) toDelete.push(b.id);
    else seen.add(key);
  }

  if (toDelete.length) {
    await cdb.from('branch_analytics').delete().eq('job_id', jobId).in('branch_id', toDelete);
    await cdb.from('reviews').delete().in('branch_id', toDelete);
    await cdb.from('branches').delete().in('id', toDelete);
    await recomputeAnalyses(cdb, jobId);
  }
  return NextResponse.json({ ok: true, removed: toDelete.length });
}
