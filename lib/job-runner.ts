/**
 * Job runner — dual database flow.
 *
 *  Operational data (status, logs, progress) → admin DB
 *  Business data (branches, reviews, reports) → CLIENT DB
 *  Excel/Markdown files → CLIENT DB Storage bucket
 *  Email → Gmail (via admin's app password)
 *  Notifications → admin DB (so the bell icon updates)
 */

import fs from 'node:fs';
import path from 'node:path';
import { adminClient } from './supabase';
import { sendReportEmail, sendFailureEmail } from './email';
import { notify } from './notifications';
import { getClientDbCreds, clientDbClient, testClientDb } from './client-db';
import type { Job } from './types';
import { buildJobConfig } from '../scrapers/build-config';
import { parseAddressesWithClaude, expandSearchQueries, verifyChainBranches } from './anthropic';
import { getClientAnthropicKey } from './client-db';

import {
  fetchTarget, scrapeHoursForTarget, scrapeCompetitors,
  scrapeBrand, scrapePopularTimes, analyze, writeWorkbook, writeReport,
} from '../scrapers';

export async function runJob(job: Job): Promise<void> {
  const sb = adminClient();

  const log = async (level: 'info' | 'warn' | 'error', message: string) => {
    // We'll still use this for manual status updates, but console intercept handles the rest
    await sb.from('job_logs').insert({ job_id: job.id, level, message });
  };

  // ── Intercept console logs to push EVERYTHING to live logs ──
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = (...args) => {
    originalLog(...args);
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    log('info', msg).catch(() => {});
  };
  console.warn = (...args) => {
    originalWarn(...args);
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    log('warn', msg).catch(() => {});
  };
  console.error = (...args) => {
    originalError(...args);
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    log('error', msg).catch(() => {});
  };

  const setProgress = async (pct: number, stage: string) =>
    void await sb.from('jobs').update({ progress_pct: pct, current_stage: stage }).eq('id', job.id);

  try {
    const checkCancellation = async () => {
      const { data: latest } = await sb.from('jobs').select('status').eq('id', job.id).single();
      if (latest?.status === 'cancelled') {
        throw new Error('STOPPED_BY_USER');
      }
    };

    await sb.from('jobs').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', job.id);
    await notify({ userId: job.user_id, jobId: job.id, kind: 'job_started',
                   title: `Analysis started — ${job.target_name}` });

    // ── Pre-flight: ensure client DB is reachable ──
    await setProgress(2, 'Validating your database connection');
    const creds = await getClientDbCreds(job.user_id);
    const test = await testClientDb(creds);
    if (!test.ok) throw new Error('Client DB unreachable: ' + (test.error || 'unknown'));
    if (!test.schemaReady) throw new Error('Client schema missing — run client-schema.sql in your DB');
    const cdb = clientDbClient(creds);
    await log('info', 'Client database connection OK');

    // ── Build config + workdir ──
    const cfg = await buildJobConfig({
      jobId: job.id, targetName: job.target_name, competitors: job.competitors,
      refreshToken:   job.refresh_token,
      searchLocation: job.search_location ?? undefined,
      dateStart:      job.date_start ?? undefined,
      dateEnd:        job.date_end   ?? undefined,
    });
    fs.mkdirSync(cfg.workDir, { recursive: true });
    await log('info', `Workdir: ${cfg.workDir}`);

    // ── Stage A — target via Google Business Profile API ──
    await checkCancellation();
    await setProgress(10, 'Stage A: target API');
    let target: any[] = [];
    let apiPathWorked = false;
    try {
      target = await fetchTarget(cfg, checkCancellation);
      if (target.length > 0) {
        fs.writeFileSync(cfg.TARGET_CACHE, JSON.stringify(target, null, 2));
      }
      apiPathWorked = target.length > 0;
      await log('info', `Stage A — ${target.length} target branches (API)`);
    } catch (err: any) {
      await log('warn', `Stage A API failed: ${err.message} — will try Puppeteer fallback`);
    }

    // ── Stage A2 — Puppeteer fallback for target when API gave nothing ──
    if (target.length === 0) {
      await checkCancellation();
      await setProgress(18, 'Stage A2: target via public Google Maps');
      try {
        target = await scrapeBrand(cfg.TARGET_SEARCH, cfg, checkCancellation);
        if (target.length > 0) {
          fs.writeFileSync(cfg.TARGET_CACHE, JSON.stringify(target, null, 2));
        }
        await log('info', `Stage A2 — ${target.length} target branches (Puppeteer fallback)`);
      } catch (err: any) {
        await log('warn', `Stage A2 fallback also failed: ${err.message} — continuing without target data`);
      }
    }

    // ── Stage B — target hours (only meaningful when API path was used) ──
    if (target.length > 0) {
      await checkCancellation();
      await setProgress(25, 'Stage B: target hours');
      if (apiPathWorked) {
        try {
          target = await scrapeHoursForTarget(target, cfg, checkCancellation);
          fs.writeFileSync(cfg.TARGET_CACHE, JSON.stringify(target, null, 2));
          await log('info', `Stage B — hours scraped for ${target.length} branches`);
        } catch (err: any) { await log('warn', `Stage B hours failed: ${err.message} — continuing without hours`); }
      } else {
        await log('info', 'Stage B skipped — Puppeteer fallback already collected hours');
      }
    }

    // ── Stage C — AI-expanded search + competitors ──
    await checkCancellation();
    const anthropicKey = await getClientAnthropicKey(job.user_id);
    if (anthropicKey && cfg.searchLocation) {
      await setProgress(40, 'AI: expanding search queries for full coverage');
      try {
        const parsedComps = cfg.COMPETITORS.reduce((acc: Array<{brand: string; aliases: string[]}>, c) => {
          const existing = acc.find(a => a.brand === c.key);
          if (existing) { if (!existing.aliases.includes(c.name)) existing.aliases.push(c.name); }
          else acc.push({ brand: c.key, aliases: [c.name] });
          return acc;
        }, []);

        const aiQueries = await expandSearchQueries(parsedComps, cfg.searchLocation, anthropicKey);
        const existingUrls = new Set(cfg.COMPETITORS.map(c => c.url));
        let added = 0;
        for (const q of aiQueries) {
          const url = `https://www.google.com/maps/search/${encodeURIComponent(q.query)}/?hl=en`;
          if (!existingUrls.has(url)) {
            cfg.COMPETITORS.push({ key: q.brand, name: q.query, url });
            existingUrls.add(url);
            added++;
          }
        }
        await log('info', `AI search expansion: ${aiQueries.length} queries generated, ${added} new searches added (${cfg.COMPETITORS.length} total)`);
      } catch (err: any) {
        await log('warn', `AI search expansion failed: ${err.message} — using original queries`);
      }
    }

    await checkCancellation();
    await setProgress(45, 'Stage C: competitors');
    let competitors: any[] = [];
    try {
      competitors = await scrapeCompetitors(cfg, checkCancellation);
      await log('info', `Stage C — ${competitors.length} competitor branches`);
    } catch (err: any) {
      await log('warn', `Stage C failed: ${err.message} — continuing with target data only`);
    }

    // ── AI chain verification — filter false positives from competitor discovery ──
    if (competitors.length > 0 && anthropicKey) {
      try {
        await setProgress(50, 'AI: verifying competitor branches');
        // Use the original pipe-separated competitor strings for real brand aliases
        const parsedComps = job.competitors.map(raw => {
          const parts = raw.split('|').map(s => s.trim()).filter(Boolean);
          return { brand: parts[0], aliases: parts };
        });

        for (const comp of parsedComps) {
          const compPlaces = competitors.filter(p => {
            const sb = (p.__searchBrand || '').toLowerCase();
            return sb === comp.brand.toLowerCase() || comp.aliases.some(a => sb.includes(a.toLowerCase()));
          });
          if (compPlaces.length === 0) continue;

          const titles = compPlaces.map(p => p.title || '');
          const uniqueTitles = Array.from(new Set(titles));
          const validIndices = await verifyChainBranches(comp.brand, comp.aliases, uniqueTitles, anthropicKey);
          const validTitles = new Set(uniqueTitles.filter((_, i) => validIndices.has(i)));

          const before = compPlaces.length;
          competitors = competitors.filter(p => {
            const sb = (p.__searchBrand || '').toLowerCase();
            const isThisComp = sb === comp.brand.toLowerCase() || comp.aliases.some(a => sb.includes(a.toLowerCase()));
            if (!isThisComp) return true;
            return validTitles.has(p.title);
          });
          const removed = before - competitors.filter(p => {
            const sb = (p.__searchBrand || '').toLowerCase();
            return sb === comp.brand.toLowerCase() || comp.aliases.some(a => sb.includes(a.toLowerCase()));
          }).length;
          await log('info', `AI verification for "${comp.brand}": ${removed} false positives removed (${before} → ${before - removed})`);
        }
      } catch (err: any) {
        await log('warn', `AI chain verification failed: ${err.message} — keeping all discovered branches`);
      }
    }

    let rawPlaces = [...target, ...competitors];
    if (rawPlaces.length === 0) {
      throw new Error(
        `No branches discovered for "${job.target_name}" or competitors [${job.competitors.join(', ')}]` +
        (job.search_location ? ` in "${job.search_location}"` : '') +
        '. Check that the brand names are correct and Google Maps returns results for them.'
      );
    }
    fs.writeFileSync(cfg.RAW_JSON_FILE, JSON.stringify(rawPlaces, null, 2));
    await log('info', `Merged: ${target.length} target + ${competitors.length} competitor = ${rawPlaces.length} branches`);

    // ── Stage D — popular times (optional, non-fatal) ──
    await checkCancellation();
    await setProgress(65, 'Stage D: popular times');
    try {
      rawPlaces = await scrapePopularTimes(rawPlaces, cfg, checkCancellation);
      fs.writeFileSync(cfg.RAW_JSON_FILE, JSON.stringify(rawPlaces, null, 2));
    } catch (err: any) { await log('warn', `Stage D failed: ${err.message} — popular times will show N/A`); }

    // ── Stage E — analyze + files ──
    await checkCancellation();
    await setProgress(78, 'Stage E: analyze + build files');

    // Filter reviews by date range if provided
    if (job.date_start || job.date_end) {
      const start = job.date_start ? new Date(job.date_start) : new Date(0);
      const end   = job.date_end ? new Date(job.date_end) : new Date();
      end.setHours(23, 59, 59, 999);

      await log('info', `Filtering reviews by date range: ${job.date_start || 'any'} to ${job.date_end || 'today'}`);
      
      let filteredCount = 0;
      rawPlaces = rawPlaces.map(place => {
        if (!place.reviews) return place;
        const initialCount = place.reviews.length;
        const keptReviews = place.reviews.filter((r: any) => {
          if (!r.publishedAtDate) return true; // keep if date unknown? or discard? let's keep.
          const d = new Date(r.publishedAtDate);
          return d >= start && d <= end;
        });
        filteredCount += (initialCount - keptReviews.length);
        return { ...place, reviews: keptReviews };
      });
      await log('info', `Filtered out ${filteredCount} reviews outside range`);
    }

    // ── AI Branch Naming & City Normalization ──
    const detectBrand = makeBrandDetector(job.target_name, job.competitors);
    // Explicitly tag every raw place with its exact brand before we rename them
    for (const p of rawPlaces) {
      p.__searchBrand = detectBrand(p);
    }

    const clientAiKey = anthropicKey ?? await getClientAnthropicKey(job.user_id);
    if (clientAiKey && rawPlaces.length > 0) {
      await checkCancellation();
      await setProgress(75, 'Stage AI: AI-powered branch naming & city normalization');
      try {
        await log('info', `Running AI Address parser for ${rawPlaces.length} locations...`);
        const parsed = await parseAddressesWithClaude(
          rawPlaces.map(p => ({ title: p.title || '', address: p.address || '' })),
          clientAiKey
        );
        for (let i = 0; i < rawPlaces.length; i++) {
          if (parsed[i]) {
            // Overwrite title with the AI-parsed unique branch name
            rawPlaces[i].title = parsed[i].branch_name;
            // Overwrite city
            rawPlaces[i].city = parsed[i].city;
          }
        }
        await log('info', 'AI Address parser completed successfully.');
      } catch (err: any) {
        await log('warn', `AI Address parser failed: ${err.message} — using default names`);
      }
    }

    const analysis = analyze(rawPlaces, cfg);
    writeWorkbook(analysis, cfg);
    writeReport(analysis, cfg);

    // ── Stage F — push business data to client DB ──
    await setProgress(85, 'Saving data to your database');
    await pushDataToClientDb(cdb, job.id, rawPlaces, analysis, target, {
      dateStart: job.date_start ?? null,
      dateEnd:   job.date_end   ?? null,
    }, { target_name: job.target_name, competitors: job.competitors });
    await log('info', 'Branches, reviews, analyses, branch_analytics written to your DB');

    // ── Stage G — upload files to client Storage ──
    await checkCancellation();
    await setProgress(92, 'Uploading report files to your storage');
    const { excel_url, report_url } = await uploadReportsToClientStorage(cdb, job.id, cfg);
    await log('info', 'Files uploaded — public URLs ready');

    // ── Stage H — record report row ──
    const excelStatBytes = fs.statSync(cfg.EXCEL_FILE).size;
    await cdb.from('reports').upsert({
      job_id: job.id,
      target_brand: job.target_name,
      competitors: job.competitors,
      excel_url, report_md_url: report_url,
      excel_size_kb: Math.round(excelStatBytes / 1024),
    }, { onConflict: 'job_id' });

    // ── Email ──
    const reviewsTotal = rawPlaces.reduce((s, p) => s + (p.reviews?.length || 0), 0);
    try {
      await setProgress(96, 'Sending email');
      await sendReportEmail({
        to: job.email_to,
        targetName: job.target_name,
        competitors: job.competitors,
        branchesTotal: rawPlaces.length,
        reviewsTotal,
        excelPath: cfg.EXCEL_FILE,
        reportPath: cfg.REPORT_FILE,
      });
      await log('info', `Email sent to ${job.email_to}`);
      await notify({
        userId: job.user_id, jobId: job.id, kind: 'email_sent',
        title: 'Report email sent',
        body: `Sent to ${job.email_to}`,
      });
    } catch (emailErr: any) {
      await log('warn', `Email failed to send: ${emailErr.message}. You can still download the report from the dashboard.`);
    }

    // ── Mirror history to client DB ──
    await cdb.from('job_history').upsert({
      job_id: job.id,
      target_brand: job.target_name,
      competitors: job.competitors,
      status: 'succeeded',
      branches_total: rawPlaces.length,
      reviews_total: reviewsTotal,
      started_at: job.started_at || new Date().toISOString(),
      finished_at: new Date().toISOString(),
      duration_sec: job.started_at ? Math.round((Date.now() - new Date(job.started_at).getTime()) / 1000) : null,
    }, { onConflict: 'job_id' });

    // ── Mark done in admin DB ──
    await sb.from('jobs').update({
      status: 'succeeded', progress_pct: 100, current_stage: 'Done',
      finished_at: new Date().toISOString(),
      excel_url, report_url,
      branches_total: rawPlaces.length,
      reviews_total: reviewsTotal,
    }).eq('id', job.id);

    await notify({
      userId: job.user_id, jobId: job.id, kind: 'job_succeeded',
      title: `${job.target_name} analysis complete`,
      body: `${rawPlaces.length} branches • ${reviewsTotal} reviews — files in your dashboard`,
    });
    await log('info', '✅ Job succeeded');

  } catch (err: any) {
    if (err?.message === 'STOPPED_BY_USER') {
      await log('info', 'Job stopped by user command');
      return;
    }
    const msg = err?.message || String(err);
    console.error(`[job:${job.id}] FATAL`, err);
    await sb.from('job_logs').insert({ job_id: job.id, level: 'error', message: 'FATAL: ' + msg });
    await sb.from('jobs').update({
      status: 'failed', finished_at: new Date().toISOString(), error_message: msg,
    }).eq('id', job.id);
    await notify({
      userId: job.user_id, jobId: job.id, kind: 'job_failed',
      title: `Analysis failed — ${job.target_name}`, body: msg.slice(0, 200),
    });
    try { await sendFailureEmail(job.email_to, job.target_name, msg); } catch {}
  } finally {
    // Restore original console
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
}

// ──────────────────────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────────────────────

async function pushDataToClientDb(
  cdb: any,
  jobId: string,
  rawPlaces: any[],
  analysis: any,
  targetPlaces: any[],
  window: { dateStart: string | null; dateEnd: string | null },
  job: { target_name: string; competitors: string[] },
) {
  const targetSet = new Set(targetPlaces.map(t => t.title));
  const detectBrand = makeBrandDetector(job.target_name, job.competitors);

  // Compute fallback rating from review stars when scraper didn't capture
  // the place-level rating (some Google Maps layouts hide it, and the
  // Business Profile API doesn't return one).
  const avgFromReviews = (reviews: any[]): number => {
    if (!Array.isArray(reviews) || reviews.length === 0) return 0;
    const valid = reviews
      .map(r => Number(r.stars ?? r.rating))
      .filter(s => s >= 1 && s <= 5 && Number.isFinite(s));
    if (valid.length === 0) return 0;
    return Number((valid.reduce((s, n) => s + n, 0) / valid.length).toFixed(2));
  };

  // Deduplicate raw places by placeId (same physical location may appear
  // multiple times from different search queries with varying transliterations)
  const dedupedPlaces: typeof rawPlaces = [];
  const seenPlaceIds = new Set<string>();
  for (const p of rawPlaces) {
    const pid = p.placeId || p.place_id;
    if (pid && seenPlaceIds.has(pid)) continue;
    if (pid) seenPlaceIds.add(pid);
    dedupedPlaces.push(p);
  }

  const branchRows = dedupedPlaces.map(p => ({
    job_id: jobId,
    brand: detectBrand(p),
    branch_name: p.title || '(unknown)',
    city: p.city || extractCity(p.address),
    address: p.address,
    phone: p.phone || null,
    website: p.website || null,
    hours_json: p.hours || null,
    stars: Number(p.rating) || avgFromReviews(p.reviews),
    reviews_count: p.reviewsCount || p.reviews_count || p.reviews?.length || 0,
    popular_times: p.popularTimes?.grid || p.popular_times || null,
    is_target: detectBrand(p) === job.target_name,
    place_id: p.placeId || p.place_id || null,
  }));

  // Clean up stale data from previous runs of the same job
  await cdb.from('reviews').delete().eq('job_id', jobId);
  await cdb.from('branches').delete().eq('job_id', jobId);

  let { data: insertedBranches, error: branchErr } = await cdb
    .from('branches').insert(branchRows).select('id, branch_name, brand');
  if (branchErr?.message?.includes('place_id')) {
    const rowsNoPid = branchRows.map(({ place_id, ...rest }) => rest);
    ({ data: insertedBranches, error: branchErr } = await cdb
      .from('branches').insert(rowsNoPid).select('id, branch_name, brand'));
  }
  if (branchErr) throw new Error('Failed inserting branches: ' + branchErr.message);

  const branchIdByKey = new Map<string, string>();
  for (const b of insertedBranches || []) {
    branchIdByKey.set(`${b.brand}|${b.branch_name}`, b.id);
  }

  // Reviews — flatten across all places
  const reviewRows: any[] = [];
  for (const p of rawPlaces) {
    const branchId = branchIdByKey.get(`${detectBrand(p)}|${p.title}`);
    for (const r of p.reviews || []) {
      reviewRows.push({
        job_id: jobId,
        branch_id: branchId,
        brand: detectBrand(p),
        rating: r.stars || r.reviewRating || r.rating || null,
        text: r.text || r.comment || r.review_text || null,
        reviewer_name: r.name || r.author || r.author_name || r.reviewerName || 'Anonymous',
        published_at: r.publishedAtDate || r.published_at || r.time || null,
      });
    }
  }

  if (reviewRows.length > 0) {
    // Insert in chunks of 500 to avoid Supabase request size limits
    for (let i = 0; i < reviewRows.length; i += 500) {
      const chunk = reviewRows.slice(i, i + 500);
      const { error } = await cdb.from('reviews').insert(chunk);
      if (error) throw new Error('Failed inserting reviews: ' + error.message);
    }
  }

  // Analyses (per brand) — aggregate star counts from branchRows since
  // brandRows in the analyzer doesn't carry star histograms.
  if (analysis?.brandRows?.length > 0) {
    const starsByBrand: Record<string, {s5:number;s4:number;s3:number;s2:number;s1:number}> = {};
    for (const r of analysis.branchRows || []) {
      if (!starsByBrand[r.brand]) starsByBrand[r.brand] = { s5:0, s4:0, s3:0, s2:0, s1:0 };
      const acc = starsByBrand[r.brand];
      acc.s5 += r.stars5 || 0; acc.s4 += r.stars4 || 0;
      acc.s3 += r.stars3 || 0; acc.s2 += r.stars2 || 0; acc.s1 += r.stars1 || 0;
    }
    const analysisRows = analysis.brandRows.map((b: any) => ({
      job_id: jobId,
      brand: b.brand,
      branch_count: b.totalBranches,
      total_reviews_period: b.totalReviewsPeriod,
      avg_rating_period: b.avgRatingPeriod,
      star_5_count: starsByBrand[b.brand]?.s5 || 0,
      star_4_count: starsByBrand[b.brand]?.s4 || 0,
      star_3_count: starsByBrand[b.brand]?.s3 || 0,
      star_2_count: starsByBrand[b.brand]?.s2 || 0,
      star_1_count: starsByBrand[b.brand]?.s1 || 0,
    }));
    const { error } = await cdb.from('analyses').insert(analysisRows);
    if (error) throw new Error('Failed inserting analyses: ' + error.message);
  }

  // ── Branch analytics (mirrors Excel "Branch Wise Data" sheet) ──
  if (analysis?.branchRows?.length > 0) {
    const placeByName = new Map<string, any>();
    for (const p of dedupedPlaces) placeByName.set(p.title, p);

    const analyticsRows = analysis.branchRows.map((r: any) => {
      const pt   = r.popularTimes || {};
      const peak = pt.available
        ? `${pt.peakDay || ''} ${pt.peakHour || ''}${pt.peakBusyness != null ? ` (${pt.peakBusyness}%)` : ''}`.trim()
        : null;
      const place = placeByName.get(r.branchName);
      const mapsLink = r.addressLink || place?.addressLink || place?.url || null;

      // business_hours: flatten {Mon:"7AM-12AM",...} to pipe-separated string
      let businessHours: string | null = null;
      if (r.hours && typeof r.hours === 'object' && !Array.isArray(r.hours)) {
        businessHours = Object.entries(r.hours).map(([d, h]) => `${d}: ${h}`).join(' | ');
      } else if (typeof r.hours === 'string') {
        businessHours = r.hours;
      }

      return {
        job_id: jobId,
        branch_id: branchIdByKey.get(`${r.brand}|${r.branchName}`) || null,
        brand: r.brand,
        branch_name: r.branchName,
        city: r.city || null,
        address: r.address || null,
        google_maps_link: mapsLink,
        business_hours: businessHours,
        phone: r.phone || null,
        peak_day: pt.peakDay || null,
        peak_hour: pt.peakHour || null,
        peak_busyness_pct: pt.peakBusyness ?? null,
        peak_time: peak,
        busy_hours_summary: pt.summary || null,
        avg_rating_period: r.avgRatingPeriod,
        total_reviews_period: r.totalReviewsPeriod || 0,
        period_1_reviews: r.period1Count || 0,
        period_1_avg_rating: r.period1Avg,
        period_2_reviews: r.period2Count || 0,
        period_2_avg_rating: r.period2Avg,
        period_3_reviews: r.period3Count || 0,
        period_3_avg_rating: r.period3Avg,
        star_5_count: r.stars5 || 0,
        star_4_count: r.stars4 || 0,
        star_3_count: r.stars3 || 0,
        star_2_count: r.stars2 || 0,
        star_1_count: r.stars1 || 0,
        popular_times_grid: pt.grid || null,
        date_start: window.dateStart,
        date_end:   window.dateEnd,
        place_id: place?.placeId || place?.place_id || null,
      };
    });

    let stripPlaceId = false;
    for (let i = 0; i < analyticsRows.length; i += 200) {
      let chunk = analyticsRows.slice(i, i + 200);
      if (stripPlaceId) chunk = chunk.map(({ place_id, ...rest }: any) => rest);
      let { error } = await cdb.from('branch_analytics').insert(chunk);
      if (error?.message?.includes('place_id') && !stripPlaceId) {
        stripPlaceId = true;
        chunk = chunk.map(({ place_id, ...rest }: any) => rest);
        ({ error } = await cdb.from('branch_analytics').insert(chunk));
      }
      if (error) throw new Error('Failed inserting branch_analytics: ' + error.message);
    }
  }
}

async function uploadReportsToClientStorage(cdb: any, jobId: string, cfg: any) {
  const excelBuf = fs.readFileSync(cfg.EXCEL_FILE);
  const mdBuf    = fs.readFileSync(cfg.REPORT_FILE);

  const excelKey = `${jobId}/${path.basename(cfg.EXCEL_FILE)}`;
  const mdKey    = `${jobId}/${path.basename(cfg.REPORT_FILE)}`;

  const { error: e1 } = await cdb.storage.from('reports').upload(excelKey, excelBuf, {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    upsert: true,
  });
  if (e1) throw new Error('Excel upload failed: ' + e1.message);

  const { error: e2 } = await cdb.storage.from('reports').upload(mdKey, mdBuf, {
    contentType: 'text/markdown', upsert: true,
  });
  if (e2) throw new Error('Markdown upload failed: ' + e2.message);

  const { data: pub1 } = cdb.storage.from('reports').getPublicUrl(excelKey);
  const { data: pub2 } = cdb.storage.from('reports').getPublicUrl(mdKey);
  return { excel_url: pub1.publicUrl, report_url: pub2.publicUrl };
}

/** Build a brand-classifier closure over this job's target + competitors.
 *  For the target brand (from Business Profile API) we trust __searchBrand.
 *  For competitors (from Maps scraping) we validate the title actually matches
 *  an alias — the scraper tags ALL results from a search query with the brand,
 *  even unrelated businesses. */
function makeBrandDetector(target: string, competitors: string[]) {
  const targetLower = target.toLowerCase();
  const brandAliases = new Map<string, string[]>();
  for (const c of competitors) {
    const parts = c.split('|').map(s => s.trim()).filter(Boolean);
    const brand = parts[0];
    const aliases = parts.map(p => p.toLowerCase());
    brandAliases.set(brand, aliases);
  }

  function stripBrandNoise(s: string): string {
    return s
      .replace(/\b(sweets?|chocolat\w*|chocolate|cafe|restaurant)\b/gi, ' ')
      .replace(/[.()&]/g, ' ')
      .replace(/(حلويات|وشوكولا|شوكولاته?)/g, ' ')
      .replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function titleMatchesBrand(title: string, aliases: string[]): boolean {
    const segments = title.split(/\s*[|]\s*/).map(s => s.trim()).filter(Boolean);
    for (const seg of segments) {
      const stripped = stripBrandNoise(seg);
      for (const alias of aliases) {
        if (stripped === alias) return true;
        if (seg.toLowerCase().trim() === alias) return true;
      }
      // After stripping noise, also strip known aliases to check if nothing meaningful remains
      let residual = stripped;
      for (const alias of aliases) residual = residual.replace(alias, ' ');
      if (stripped !== residual.replace(/\s+/g, ' ').trim() && residual.replace(/\s+/g, '').length === 0) return true;
    }
    return false;
  }

  return function detect(p: any): string {
    const t = (p?.title || '').toLowerCase().trim();
    if (t.includes(targetLower)) return target;
    if (p?.__searchBrand === target) return target;
    let found: string | null = null;
    brandAliases.forEach((aliases, brand) => {
      if (!found && titleMatchesBrand(p?.title || '', aliases)) { found = brand; }
    });
    if (found) return found;
    return 'Other';
  };
}

function extractCity(addr?: string): string | null {
  if (!addr) return null;
  const parts = addr.split(',').map(s => s.trim());
  return parts.length >= 2 ? parts[parts.length - 2] : null;
}
