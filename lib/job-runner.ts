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
import { extractReviewWordsForJob } from './review-word-ai';
import { scoreReviewsForJob } from './review-sentiment';
import { getClientAnthropicKey, getClientApifyToken } from './client-db';

import {
  fetchTarget, scrapeHoursForTarget, scrapeCompetitors,
  scrapeBrand, scrapePopularTimes, analyze, writeWorkbook, writeReport,
  fetchCompetitorsViaPlaces, scrapeReviewsForBranches, enrichRatingsViaPlaces,
  enrichBranchesViaApify, fetchGbpPerformance,
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
    if (!test.schemaReady) {
      // testClientDb already knows which tables failed and why. Throwing a
      // fixed sentence instead threw that away, and diagnosing one failure
      // meant reproducing the probe by hand.
      throw new Error(
        'Client schema not usable: ' + (test.error || 'unknown')
        + ` (schema ${creds.schema_name || 'cloud'})`);
    }
    const cdb = clientDbClient(creds);
    await log('info', 'Client database connection OK');

    // ── Build config + workdir ──
    const cfg = await buildJobConfig({
      jobId: job.id, targetName: job.target_name, competitors: job.competitors,
      refreshToken:   job.refresh_token,
      searchLocation: job.search_location ?? undefined,
      dateStart:      job.date_start ?? undefined,
      dateEnd:        job.date_end   ?? undefined,
      // Client's own Apify account when they supplied a token, so scraping
      // quota is billed to them rather than to the shared instance token.
      apifyToken:     (await getClientApifyToken(job.user_id)) ?? undefined,
    });
    fs.mkdirSync(cfg.workDir, { recursive: true });
    await log('info', `Workdir: ${cfg.workDir}`);

    // ── Stage A — target via Google Business Profile API ──
    await checkCancellation();
    await setProgress(10, 'Stage A: target API');
    let target: any[] = [];
    let apiPathWorked = false;
    // The GMB OAuth token refresh / API occasionally fails transiently. Since
    // the target brand MUST come authoritatively from GMB (the Puppeteer
    // fallback only finds ~20 and scrapes reviews), retry a few times before
    // giving up to the fallback.
    const GMB_RETRIES = 3;
    for (let attempt = 1; attempt <= GMB_RETRIES; attempt++) {
      try {
        target = await fetchTarget(cfg, checkCancellation);
        if (target.length > 0) {
          fs.writeFileSync(cfg.TARGET_CACHE, JSON.stringify(target, null, 2));
          apiPathWorked = true;
          await log('info', `Stage A — ${target.length} target branches (API, attempt ${attempt})`);
          break;
        }
        await log('warn', `Stage A — GMB API returned 0 branches (attempt ${attempt}/${GMB_RETRIES})`);
      } catch (err: any) {
        await log('warn', `Stage A API failed (attempt ${attempt}/${GMB_RETRIES}): ${err.message || err?.toString() || 'unknown error'}`);
      }
      if (attempt < GMB_RETRIES) await new Promise(r => setTimeout(r, 3000 * attempt));
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

    // ── Stage B — target Google rating + review count via Places API ──
    // Hours already come from GMB regularHours (no Puppeteer needed). We only
    // need each branch's Google average rating + total review count, which the
    // GMB API doesn't expose — fetch them from the Places API by placeId.
    if (target.length > 0 && apiPathWorked) {
      await checkCancellation();
      await setProgress(25, 'Stage B: target ratings via Places API');
      if (cfg.PLACES_API_KEY) {
        try {
          target = await enrichRatingsViaPlaces(target, cfg, checkCancellation);
          fs.writeFileSync(cfg.TARGET_CACHE, JSON.stringify(target, null, 2));
          const withRating = target.filter((t: any) => t.rating != null).length;
          await log('info', `Stage B — ratings filled for ${withRating}/${target.length} target branches`);
        } catch (err: any) { await log('warn', `Stage B ratings failed: ${err.message} — continuing without ratings`); }
      } else {
        // No Places key: fall back to Puppeteer hours+rating scrape (legacy).
        try {
          target = await scrapeHoursForTarget(target, cfg, checkCancellation);
          fs.writeFileSync(cfg.TARGET_CACHE, JSON.stringify(target, null, 2));
          await log('info', `Stage B — hours/ratings scraped via Puppeteer for ${target.length} branches`);
        } catch (err: any) { await log('warn', `Stage B Puppeteer fallback failed: ${err.message}`); }
      }
    }

    // ── Stage C — competitor discovery + reviews ──
    await checkCancellation();
    const anthropicKey = await getClientAnthropicKey(job.user_id);
    let competitors: any[] = [];

    // Preferred path: authoritative discovery via the Google Places API
    // (place_id-keyed, country-filtered, closed branches dropped, self-updating).
    if (cfg.PLACES_API_KEY) {
      try {
        await setProgress(40, 'Stage C: discovering competitors via Google Places API');
        let discovered = await fetchCompetitorsViaPlaces(cfg, checkCancellation);
        await log('info', `Places API — ${discovered.length} competitor branches discovered`);

        // AI chain verification — drop businesses that merely share a word.
        if (discovered.length > 0 && anthropicKey) {
          await setProgress(48, 'AI: verifying competitor branches');
          discovered = await verifyCompetitorsWithAI(discovered, job.competitors, anthropicKey, log);
        }

        // No review scraping — the Places branches already carry Google's
        // average rating + total review count, hours, phone, website and the
        // ChIJ placeId. Use them directly (popular times added in Stage D).
        competitors = discovered;
        await log('info', `Stage C — ${competitors.length} verified competitor branches (rating + count from Places, no review scraping)`);
      } catch (err: any) {
        await log('warn', `Places discovery path failed: ${err.message} — falling back to Puppeteer discovery`);
      }
    }

    // Fallback path: legacy Puppeteer feed-scroll discovery (used when no
    // Places key is configured or Places returned nothing).
    if (competitors.length === 0) {
      if (anthropicKey && cfg.searchLocation && !cfg.PLACES_API_KEY) {
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
      try {
        competitors = await scrapeCompetitors(cfg, checkCancellation);
        await log('info', `Stage C — ${competitors.length} competitor branches`);

        if (competitors.length > 0 && anthropicKey) {
          await setProgress(50, 'AI: verifying competitor branches');
          competitors = await verifyCompetitorsWithAI(competitors, job.competitors, anthropicKey, log);
        }
      } catch (err: any) {
        await log('warn', `Stage C failed: ${err.message} — continuing with target data only`);
      }
    }

    // ── Region filter + coordinate/place_id dedup (both paths) ──
    if (job.search_location && competitors.length > 0) {
      const before = competitors.length;
      competitors = filterByRegion(competitors, job.search_location);
      const removed = before - competitors.length;
      if (removed > 0) await log('info', `Region filter: ${removed} branches outside "${job.search_location}" removed (${before} → ${competitors.length})`);
    }
    if (competitors.length > 0) {
      const before = competitors.length;
      competitors = deduplicateByLocation(competitors);
      const removed = before - competitors.length;
      if (removed > 0) await log('info', `Location dedup: ${removed} duplicate locations removed (${before} → ${competitors.length})`);
    }

    // ── Stage C2 — Apify: competitor reviews (date-windowed) + star
    //    distribution + popular times. Google has no public reviews API for
    //    places we don't own, so this third-party source powers the
    //    rating-distribution and review-trend sections for competitors. ──
    const reviewsStartDate = job.date_start
      || new Date(Date.now() - (cfg.LOOKBACK_MONTHS || 3) * 31 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    if (cfg.APIFY_TOKEN && competitors.length > 0) {
      await checkCancellation();
      await setProgress(58, 'Stage C: competitor reviews + popular times (Apify)');
      try {
        competitors = await enrichBranchesViaApify(
          competitors,
          { maxReviews: 200, reviewsStartDate, fillRating: true },
          cfg, checkCancellation,
        );
        const withRev = competitors.filter((c: any) => (c.reviews?.length || 0) > 0).length;
        const withPt  = competitors.filter((c: any) => c.popularTimes?.available).length;
        await log('info', `Apify — competitor data: ${withRev}/${competitors.length} with reviews, ${withPt}/${competitors.length} with popular times`);
      } catch (err: any) {
        // An exhausted Apify account (or a rejected token) is not a transient
        // blip: no retry will help, and leaving competitors with zero reviews
        // guts the whole comparison. Fall back to scraping them from public
        // Google Maps instead, and tell the client why.
        if (err?.quotaExhausted || err?.badToken) {
          const reason = err.badToken
            ? 'Your Apify token was rejected'
            : 'Your Apify account is out of credit';
          await log('warn', `${reason} — falling back to Google Maps scraping for competitor reviews`);
          await notify({
            userId: job.user_id, jobId: job.id, kind: 'apify_key_problem',
            title: 'Apify key needs attention',
            body: `${reason}. This run scraped competitor reviews from Google Maps instead, which is slower and may find fewer reviews. Add a working Apify token for full data.`,
          });
          try {
            await setProgress(60, 'Stage C: competitor reviews (Google Maps fallback)');
            competitors = await scrapeReviewsForBranches(competitors, cfg, checkCancellation);
            const withRev = competitors.filter((c: any) => (c.reviews?.length || 0) > 0).length;
            await log('info', `Puppeteer fallback — ${withRev}/${competitors.length} competitor branches with reviews`);
          } catch (fallbackErr: any) {
            await log('warn', `Google Maps fallback also failed: ${fallbackErr.message} — competitors will lack reviews`);
          }
        } else {
          await log('warn', `Apify competitor fetch failed: ${err.message} — competitors will lack reviews/popular times`);
        }
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
    // Prefer Apify (reliable per-day data). The old Puppeteer hover scraper
    // produced broken per-day data (every branch wrongly peaked on Sunday), so
    // it's only a last-resort fallback when no Apify token is configured.
    // Competitors already got popular times in Stage C2; here we fill the rest
    // (the target/Anoosh branches).
    await checkCancellation();
    await setProgress(65, 'Stage D: popular times');
    try {
      if (cfg.APIFY_TOKEN) {
        const needPT = rawPlaces.filter(p => p.placeId && !p.popularTimes);
        if (needPT.length > 0) {
          await enrichBranchesViaApify(needPT, { maxReviews: 0 }, cfg, checkCancellation);
        }
        const withPt = rawPlaces.filter(p => p.popularTimes?.available).length;
        await log('info', `Stage D — popular times via Apify: ${withPt}/${rawPlaces.length} branches`);
      } else {
        rawPlaces = await scrapePopularTimes(rawPlaces, cfg, checkCancellation);
      }
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
    // Explicitly tag every raw place with its exact brand before we rename them,
    // and preserve the ORIGINAL Google store name (English or Arabic, exactly as
    // Google returns it) — the AI parser overwrites `title` with a district name,
    // so capture the real store name first for the dedicated store_name column.
    for (const p of rawPlaces) {
      p.__searchBrand = detectBrand(p);
      if (!p.store_name) p.store_name = p.title || '';
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

    // ── Stage P — Business Profile Performance API ──
    // Daily metrics (impressions, clicks, calls, directions, bookings…) for the
    // client's OWN locations. Runs after Stage F so each metric row can be tied
    // to the branch row that was just inserted. Non-fatal: a client whose token
    // lacks the scope, or whose locations are too new to have data, still gets
    // the rest of the report.
    await checkCancellation();
    await setProgress(88, 'Stage P: Business Profile performance metrics');
    try {
      const perfBranches = target.filter((t: any) => t.gmbLocationId);
      if (perfBranches.length === 0) {
        await log('info', 'Stage P — no GMB location ids on target branches, skipping performance metrics');
      } else {
        const series = await fetchGbpPerformance(
          perfBranches,
          { dateStart: job.date_start ?? undefined, dateEnd: job.date_end ?? undefined },
          cfg, checkCancellation,
        );
        const written = await pushGbpMetricsToClientDb(cdb, job.id, series, job.target_name);
        await log('info', `Stage P — ${series.length} metric series, ${written} daily rows saved`);
      }
    } catch (err: any) {
      await log('warn', `Stage P failed: ${err.message} — performance dashboards will be empty for this job`);
    }

    // ── Stage W — review word clouds ──
    // Claude reads this job's reviews for the client's own branches and labels
    // the sentiment-bearing words, which the dashboard renders as the positive /
    // negative clouds. Scoped to this job's reviews, and skips any already
    // labelled, so a re-run costs only what is new.
    await checkCancellation();
    await setProgress(90, 'Stage W: review word clouds');
    try {
      // null, not this job: the client's own reviews come from the Business
      // Profile sync and carry no job id, so scoping to the job labelled
      // nothing at all.
      const wc = await extractReviewWordsForJob({
        cdb, jobId: null, anthropicKey: clientAiKey, log,
      });
      if (wc.keyProblem) {
        // The client's own key is the blocker — tell them, in a notification
        // they will actually see, instead of only in the job log.
        await notify({
          userId: job.user_id, jobId: job.id, kind: 'ai_key_problem',
          title: 'Claude API key needs attention',
          body: wc.keyProblem.message,
        });
      } else if (wc.reviewsRead > 0) {
        await log('info', `Stage W — ${wc.reviewsRead} reviews read, ${wc.positiveHits} positive + ${wc.negativeHits} negative words`);
      } else {
        await log('info', 'Stage W — no new reviews to label');
      }
      if (wc.failedBatches > 0) {
        await log('warn', `Stage W — ${wc.failedBatches} batch(es) failed; those reviews stay unlabelled and will be picked up next run`);
      }
    } catch (err: any) {
      await log('warn', `Stage W failed: ${err.message} — word clouds may be incomplete`);
    }

    // ── Stage S — per-review sentiment ──
    // Scores the client's own reviews 0-100 from their text, through whichever
    // AI provider their key belongs to. This is what the Branch Health module
    // plots against the star rating: the two disagree often, and the gap is the
    // part a rating average hides.
    await checkCancellation();
    await setProgress(91, 'Stage S: review sentiment');
    try {
      const s = await scoreReviewsForJob({
        cdb, jobId: job.id, aiKey: clientAiKey,
        log: async (level, message) => { await log(level, message); },
      });
      if (s.keyProblem) {
        await notify({
          userId: job.user_id, jobId: job.id, kind: 'ai_key_problem',
          title: 'AI key needs attention',
          body: s.keyProblem.message,
        });
      } else if (s.scored > 0) {
        await log('info', `Stage S — ${s.scored} reviews scored via ${s.provider} (${s.model})`);
      } else {
        await log('info', 'Stage S — no new reviews to score');
      }
      if (s.failedBatches > 0) {
        await log('warn', `Stage S — ${s.failedBatches} batch(es) failed; those reviews stay unscored and will be retried next run`);
      }
    } catch (err: any) {
      await log('warn', `Stage S failed: ${err.message} — Branch Health will fall back to star ratings`);
    }

    // ── Stage G — upload files to client Storage ──
    await checkCancellation();
    await setProgress(92, 'Uploading report files to your storage');
    const { excel_url, report_url } = await uploadReportsToClientStorage(cdb, job.id, cfg, creds.schema_name);
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
    // Allow suppressing the client report email (e.g. for data-correction
    // re-runs) without disabling the rest of the pipeline.
    if (process.env.SUPPRESS_REPORT_EMAIL === 'true') {
      await log('info', 'Report email suppressed (SUPPRESS_REPORT_EMAIL=true)');
    } else {
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

/** AI chain verification — for each competitor brand, ask Claude which of the
 *  discovered titles are genuine branches of that chain and drop the rest
 *  (businesses that merely share a word). Shared by both discovery paths. */
async function verifyCompetitorsWithAI(
  competitors: any[],
  jobCompetitors: string[],
  anthropicKey: string,
  log: (level: 'info' | 'warn' | 'error', message: string) => Promise<void>,
): Promise<any[]> {
  const parsedComps = jobCompetitors.map(raw => {
    const parts = raw.split('|').map(s => s.trim()).filter(Boolean);
    return { brand: parts[0], aliases: parts };
  });

  let result = competitors;
  for (const comp of parsedComps) {
    const isThisComp = (p: any) => {
      const sb = (p.__searchBrand || '').toLowerCase();
      return sb === comp.brand.toLowerCase() || comp.aliases.some(a => sb.includes(a.toLowerCase()));
    };
    const compPlaces = result.filter(isThisComp);
    if (compPlaces.length === 0) continue;

    const uniqueTitles = Array.from(new Set(compPlaces.map(p => p.title || '')));
    let validTitles: Set<string>;
    try {
      const validIndices = await verifyChainBranches(comp.brand, comp.aliases, uniqueTitles, anthropicKey);
      validTitles = new Set(uniqueTitles.filter((_, i) => validIndices.has(i)));
    } catch (err: any) {
      await log('warn', `AI verification for "${comp.brand}" failed: ${err.message} — keeping all`);
      continue;
    }

    const before = compPlaces.length;
    result = result.filter(p => (isThisComp(p) ? validTitles.has(p.title) : true));
    const after = result.filter(isThisComp).length;
    await log('info', `AI verification for "${comp.brand}": ${before - after} false positives removed (${before} → ${after})`);
  }
  return result;
}

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

  // Target brand entries come from the authoritative GBP API — don't dedup them.
  // Only dedup competitor entries (from Puppeteer scraping which can find duplicates).
  const isTarget = (p: any) => (p.__searchBrand || '').toLowerCase() === job.target_name.toLowerCase();
  const targetEntries = rawPlaces.filter(isTarget);
  const competitorEntries = rawPlaces.filter(p => !isTarget(p));
  const dedupedCompetitors = deduplicateByLocation(competitorEntries);
  // Drop competitor-scraped entries classified as the target brand — they're
  // duplicates of what GBP already provides authoritatively.
  const targetLower = job.target_name.toLowerCase();
  const filteredCompetitors = dedupedCompetitors.filter(p => detectBrand(p).toLowerCase() !== targetLower);
  const dedupedPlaces = [...targetEntries, ...filteredCompetitors];
  console.log(`[dedup] rawPlaces=${rawPlaces.length} targetEntries=${targetEntries.length} competitorEntries=${competitorEntries.length} dedupedComp=${dedupedCompetitors.length} filteredComp=${filteredCompetitors.length} dedupedPlaces=${dedupedPlaces.length}`);

  const branchRows = dedupedPlaces.map(p => ({
    job_id: jobId,
    brand: detectBrand(p),
    branch_name: p.title || '(unknown)',
    store_name: p.store_name || p.title || null,
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
    // Business Profile location id — only the client's own branches have one.
    // Required later by the Performance API, which is keyed by it rather than
    // by place_id.
    gmb_location_id: p.gmbLocationId || p.gmb_location_id || null,
  }));

  // Clean up stale data from previous runs of the same job
  await cdb.from('branch_analytics').delete().eq('job_id', jobId);
  await cdb.from('analyses').delete().eq('job_id', jobId);
  await cdb.from('reviews').delete().eq('job_id', jobId);
  await cdb.from('branches').delete().eq('job_id', jobId);

  /**
   * A location already known to this client keeps its existing row.
   *
   * The standalone review sync writes branches with no job attached; an
   * analysis writes its own set keyed by job_id. Both mark the client's own
   * branches is_target, so a client who had synced and then ran an analysis
   * ended up with two rows and two review sets per location — every figure on
   * the dashboard doubled. The sync's corpus is the complete one (an analysis
   * only covers its window), so the analysis attaches to those rows instead of
   * making rivals for them.
   */
  const existingByLocation = new Map<string, any>();
  const existingByPlace = new Map<string, any>();
  {
    const { data: known } = await cdb
      .from('branches').select('id, brand, branch_name, place_id, gmb_location_id')
      .is('job_id', null);
    for (const b of known || []) {
      if (b.gmb_location_id) existingByLocation.set(String(b.gmb_location_id), b);
      if (b.place_id) existingByPlace.set(String(b.place_id), b);
    }
  }
  const matchExisting = (r: any) =>
    (r.gmb_location_id && existingByLocation.get(String(r.gmb_location_id)))
    || (r.place_id && existingByPlace.get(String(r.place_id)))
    || null;

  const reused: any[] = [];
  const freshRows: any[] = [];
  for (const r of branchRows) {
    const hit = matchExisting(r);
    if (hit) {
      // Refresh the details Google may have changed, but leave brand alone:
      // the sync's label is canonicalised across the whole account, and
      // detectBrand only sees one name at a time.
      const { brand, is_target, job_id, ...rest } = r as any;
      await cdb.from('branches').update(rest).eq('id', hit.id);
      reused.push({ ...hit, ...rest, brand: hit.brand });
    } else {
      freshRows.push(r);
    }
  }
  if (reused.length) {
    console.log(`[job:${jobId}] reusing ${reused.length} existing branch row(s) instead of duplicating them`);
  }

  // Insert branches; gracefully drop optional columns the client schema may not
  // have yet (place_id, store_name) by retrying without whichever the error names.
  const stripCols = (rows: any[], cols: string[]) =>
    rows.map(r => { const c = { ...r }; for (const k of cols) delete c[k]; return c; });
  let rowsToInsert = freshRows;
  let selectCols = 'id, branch_name, brand, place_id, gmb_location_id';
  let insertedBranches: any[] | null = null;
  let branchErr: any = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (rowsToInsert.length === 0) { insertedBranches = []; branchErr = null; break; }
    ({ data: insertedBranches, error: branchErr } = await cdb
      .from('branches').insert(rowsToInsert).select(selectCols));
    if (!branchErr) break;
    if (branchErr.message?.includes('gmb_location_id')) {
      // Client schema predates migration 007 — drop the column and carry on.
      rowsToInsert = stripCols(rowsToInsert, ['gmb_location_id']);
      selectCols = 'id, branch_name, brand, place_id';
    } else if (branchErr.message?.includes('store_name')) {
      rowsToInsert = stripCols(rowsToInsert, ['store_name']);
    } else if (branchErr.message?.includes('place_id')) {
      rowsToInsert = stripCols(rowsToInsert, ['place_id']);
      selectCols = 'id, branch_name, brand';
    } else break;
  }
  if (branchErr) throw new Error('Failed inserting branches: ' + branchErr.message);

  // Link analytics/reviews back to branches. place_id is the unique key; the
  // brand|name key is a fallback only (AI-generated branch names collide, e.g.
  // four "King Fahd Road" branches in different cities → never key by name).
  const branchIdByPid = new Map<string, string>();
  const branchIdByName = new Map<string, string>();
  for (const b of [...reused, ...(insertedBranches || [])]) {
    if (b.place_id) branchIdByPid.set(b.place_id, b.id);
    if (!branchIdByName.has(`${b.brand}|${b.branch_name}`)) branchIdByName.set(`${b.brand}|${b.branch_name}`, b.id);
  }
  const branchIdFor = (brand: string, name: string, placeId?: string | null): string | undefined =>
    (placeId && branchIdByPid.get(placeId)) || branchIdByName.get(`${brand}|${name}`);

  /**
   * Branches whose reviews already come from the standalone sync.
   *
   * Reusing the branch row stopped the branches duplicating but not the
   * reviews: the analysis went on writing its own scraped window onto the same
   * branch, so a synced client ended up with two review sets — 14,912 rows
   * where there were 7,143 — and every count doubled. The scraped copy is the
   * lesser one: it carries no Google review id (so it cannot dedupe) and no
   * owner replies, and it covers only the job's window. The sync owns the
   * client's own reviews; the analysis still writes competitors', because
   * nothing else can.
   */
  const syncOwnedBranchIds = new Set(reused.map((b: any) => String(b.id)));

  // Reviews — flatten across all places
  const reviewRows: any[] = [];
  let skippedSynced = 0;
  for (const p of rawPlaces) {
    const branchId = branchIdFor(detectBrand(p), p.title, p.placeId || p.place_id);
    if (branchId && syncOwnedBranchIds.has(String(branchId))) {
      skippedSynced += (p.reviews || []).length;
      continue;
    }
    for (const r of p.reviews || []) {
      reviewRows.push({
        job_id: jobId,
        branch_id: branchId,
        brand: detectBrand(p),
        rating: r.stars || r.reviewRating || r.rating || null,
        text: r.text || r.comment || r.review_text || null,
        reviewer_name: r.name || r.author || r.author_name || r.reviewerName || 'Anonymous',
        published_at: r.publishedAtDate || r.published_at || r.time || null,
        // Owner replies come from the Business Profile API and drive reply rate
        // and response time on the Branch Health module. Only the client's own
        // reviews carry them — scraped competitor reviews never will.
        reply_text: r.replyText || null,
        replied_at: r.repliedAt || null,
      });
    }
  }

  if (skippedSynced > 0) {
    console.log(`[job:${jobId}] skipped ${skippedSynced} scraped review(s) for branches whose reviews come from the Business Profile sync`);
  }

  if (reviewRows.length > 0) {
    // Insert in chunks of 500 to avoid Supabase request size limits. Drop the
    // reply columns if the client schema predates migration 010 rather than
    // failing the whole job over an optional field.
    let replyColsOk = true;
    for (let i = 0; i < reviewRows.length; i += 500) {
      let chunk = reviewRows.slice(i, i + 500);
      if (!replyColsOk) chunk = chunk.map(({ reply_text, replied_at, ...rest }) => rest);
      let { error } = await cdb.from('reviews').insert(chunk);
      if (error && replyColsOk && /reply_text|replied_at/.test(error.message || '')) {
        replyColsOk = false;
        chunk = chunk.map(({ reply_text, replied_at, ...rest }) => rest);
        ({ error } = await cdb.from('reviews').insert(chunk));
      }
      if (error) throw new Error('Failed inserting reviews: ' + error.message);
    }
    if (!replyColsOk) {
      console.warn('[reviews] reply columns absent — run client migration 010 to capture owner replies');
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
    const placeByPid = new Map<string, any>();
    for (const p of dedupedPlaces) {
      placeByName.set(p.title, p);
      const pid = p.placeId || p.place_id;
      if (pid) placeByPid.set(pid, p);
    }

    // analysis.branchRows is 1:1 with rawPlaces — keep only indices that survived dedup
    const dedupedSet = new Set(dedupedPlaces);
    const filteredBranchRows = analysis.branchRows.filter((_: any, i: number) => dedupedSet.has(rawPlaces[i]));
    const anooshAnalytics = filteredBranchRows.filter((r: any) => r.brand === job.target_name);
    console.log(`[dedup] analysis.branchRows=${analysis.branchRows.length} filteredBranchRows=${filteredBranchRows.length} anooshInFiltered=${anooshAnalytics.length}`);

    const analyticsRows = filteredBranchRows.map((r: any) => {
      const pt   = r.popularTimes || {};
      const peak = pt.available
        ? `${pt.peakDay || ''} ${pt.peakHour || ''}${pt.peakBusyness != null ? ` (${pt.peakBusyness}%)` : ''}`.trim()
        : null;
      // Prefer place_id linkage (unique); name lookup collides on AI-duplicate names.
      const place = (r.placeId && placeByPid.get(r.placeId)) || placeByName.get(r.branchName);
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
        branch_id: branchIdFor(r.brand, r.branchName, r.placeId) || null,
        brand: r.brand,
        branch_name: r.branchName,
        store_name: place?.store_name || r.branchName || null,
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
        place_id: r.placeId || place?.placeId || place?.place_id || null,
      };
    });

    // Drop optional columns the client schema may lack (place_id, store_name).
    const strip = new Set<string>();
    const applyStrip = (rows: any[]) => strip.size === 0 ? rows
      : rows.map((row: any) => { const c = { ...row }; for (const k of strip) delete c[k]; return c; });
    for (let i = 0; i < analyticsRows.length; i += 200) {
      let chunk = applyStrip(analyticsRows.slice(i, i + 200));
      for (let attempt = 0; attempt < 3; attempt++) {
        const { error } = await cdb.from('branch_analytics').insert(chunk);
        if (!error) break;
        if (error.message?.includes('store_name')) { strip.add('store_name'); chunk = applyStrip(analyticsRows.slice(i, i + 200)); }
        else if (error.message?.includes('place_id')) { strip.add('place_id'); chunk = applyStrip(analyticsRows.slice(i, i + 200)); }
        else throw new Error('Failed inserting branch_analytics: ' + error.message);
      }
    }
  }
}

/**
 * Write Performance API series into the client's `gbp_metrics` table.
 *
 * Rows are upserted on (job_id, gmb_location_id, metric, metric_date) so a
 * re-run of the same job corrects values instead of duplicating them. Branch
 * ids are resolved by GMB location id — the identifier the metrics are keyed by.
 *
 * Returns the number of daily rows written.
 */
async function pushGbpMetricsToClientDb(
  cdb: any,
  jobId: string,
  series: any[],
  targetBrand: string,
): Promise<number> {
  if (!Array.isArray(series) || series.length === 0) return 0;

  // Map location id → branch row just inserted for this job.
  const { data: branchRows, error: bErr } = await cdb
    .from('branches')
    .select('id, branch_name, gmb_location_id')
    .eq('job_id', jobId)
    .not('gmb_location_id', 'is', null);
  if (bErr) {
    // Schema without migration 007 — nothing to write into.
    console.warn(`[gbp-perf] cannot read gmb_location_id (${bErr.message}) — skipping metric save`);
    return 0;
  }
  const branchByLoc = new Map<string, { id: string; branch_name: string }>();
  for (const b of branchRows || []) branchByLoc.set(String(b.gmb_location_id), b);

  const rows: any[] = [];
  for (const s of series) {
    const branch = branchByLoc.get(String(s.gmbLocationId));
    for (const point of s.series || []) {
      rows.push({
        job_id: jobId,
        branch_id: branch?.id || null,
        gmb_location_id: String(s.gmbLocationId),
        brand: targetBrand,
        branch_name: branch?.branch_name || s.title || null,
        metric: s.metric,
        metric_date: point.date,
        value: Number(point.value) || 0,
      });
    }
  }
  if (rows.length === 0) return 0;

  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await cdb
      .from('gbp_metrics')
      .upsert(chunk, { onConflict: 'job_id,gmb_location_id,metric,metric_date' });
    if (error) throw new Error('Failed inserting gbp_metrics: ' + error.message);
    written += chunk.length;
  }
  return written;
}

async function uploadReportsToClientStorage(cdb: any, jobId: string, cfg: any, schemaName?: string | null) {
  const excelBuf = fs.readFileSync(cfg.EXCEL_FILE);
  const mdBuf    = fs.readFileSync(cfg.REPORT_FILE);

  const prefix = schemaName ? `${schemaName}/${jobId}` : jobId;
  const excelKey = `${prefix}/${path.basename(cfg.EXCEL_FILE)}`;
  const mdKey    = `${prefix}/${path.basename(cfg.REPORT_FILE)}`;

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

  // getPublicUrl builds an absolute URL from whatever host this process uses to
  // reach Kong — a loopback or internal address that no browser can open, and
  // Kong's own port is not reachable from outside anyway. Store the path
  // relative to the app's /sb proxy instead, so the link resolves against
  // whatever origin the user actually loaded the dashboard from.
  const toProxyPath = (absolute: string): string => {
    const i = absolute.indexOf('/storage/v1/');
    return i === -1 ? absolute : `/sb${absolute.slice(i)}`;
  };

  return { excel_url: toProxyPath(pub1.publicUrl), report_url: toProxyPath(pub2.publicUrl) };
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
    if (p?.__searchBrand && brandAliases.has(p.__searchBrand)) return p.__searchBrand;
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

const REGION_CITIES: Record<string, Set<string>> = {
  'saudi arabia': new Set([
    'riyadh','jeddah','makkah','mecca','madinah','medina','dammam','al khobar','khobar',
    'dhahran','tabuk','abha','taif','hail','ha\'il','najran','yanbu','al jubail','jubail',
    'buraydah','buraidah','khamis mushait','khamis mushayit','al hofuf','hofuf','al kharj',
    'sakaka','jazan','jizan','al bahah','hafar al batin','unaizah','al majmaah','al mubarraz',
    'al qatif','ras tanura','al zulfi','dawadmi','al duwadimi','shaqra','wadi ad dawasir',
    'al aflaj','layla','al uyun','al lith','rabigh','al qunfudhah','bisha','muhayil',
    'ar rass','al bukayriyah','al mithnab','arar','turaif','rafha','al khafji',
    'al namas','baljurashi','al makhwah','al aqiq','qilwah','sarat abidah',
  ]),
  'uae': new Set([
    'dubai','abu dhabi','sharjah','ajman','ras al khaimah','fujairah','al ain','umm al quwain',
  ]),
  'united arab emirates': new Set([
    'dubai','abu dhabi','sharjah','ajman','ras al khaimah','fujairah','al ain','umm al quwain',
  ]),
  'bahrain': new Set(['manama','riffa','muharraq','isa town','hamad town','sitra']),
  'kuwait': new Set(['kuwait city','hawalli','salmiya','jahra','farwaniya','ahmadi']),
  'qatar': new Set(['doha','al wakrah','al khor','al rayyan','umm salal']),
  'oman': new Set(['muscat','salalah','sohar','nizwa','sur','ibri']),
};

function filterByRegion(places: any[], searchLocation: string): any[] {
  const loc = searchLocation.toLowerCase().trim();
  let allowedCities: Set<string> | null = null;
  for (const [region, cities] of Object.entries(REGION_CITIES)) {
    if (loc.includes(region)) { allowedCities = cities; break; }
  }
  if (!allowedCities) return places;

  return places.filter(p => {
    const addr = (p.address || '').toLowerCase();
    const city = (p.city || '').toLowerCase();
    // Allow if any known city appears in address or city field
    const cities = Array.from(allowedCities!);
    for (const c of cities) {
      if (addr.includes(c) || city.includes(c)) return true;
    }
    // Also allow if address contains the country name directly
    if (addr.includes(loc)) return true;
    // If no address at all, keep it (can't determine region)
    if (!p.address && !p.city) return true;
    return false;
  });
}

function deduplicateByLocation(places: any[]): any[] {
  const result: any[] = [];
  const seenPids = new Set<string>();
  const seenCoords = new Set<string>();
  const seenUrlBase = new Set<string>();

  for (const p of places) {
    const pid = p.placeId || p.place_id;
    // place_id is the authoritative identity. When present, dedup ONLY by it —
    // never fall through to the weaker coord/URL keys, because Places-sourced
    // URLs look like ".../maps/place/?q=place_id:X" whose base (before "?") is
    // identical for every branch and would otherwise collapse them all to one.
    if (pid) {
      if (seenPids.has(pid)) continue;
      seenPids.add(pid);
      result.push(p);
      continue;
    }

    // No place_id → fall back to coordinate dedup (round to ~110m precision)…
    if (p.lat != null && p.lng != null) {
      const coordKey = `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`;
      if (seenCoords.has(coordKey)) continue;
      seenCoords.add(coordKey);
    }

    // …and URL-base dedup, but only for real /maps/place/<slug> URLs (skip the
    // query-only place_id URLs whose base is non-distinguishing).
    const rawUrl = p.url || '';
    const urlBase = rawUrl.split('?')[0];
    const isPlaceIdQueryUrl = /\/maps\/place\/?$/.test(urlBase) && rawUrl.includes('q=place_id:');
    if (urlBase && !isPlaceIdQueryUrl) {
      if (seenUrlBase.has(urlBase)) continue;
      seenUrlBase.add(urlBase);
    }

    result.push(p);
  }
  return result;
}
