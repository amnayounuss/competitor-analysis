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

import {
  fetchAnoosh, scrapeHoursForAnoosh, scrapeCompetitors,
  scrapePopularTimes, analyze, writeWorkbook, writeReport,
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
      refreshToken: job.refresh_token,
    });
    fs.mkdirSync(cfg.workDir, { recursive: true });
    await log('info', `Workdir: ${cfg.workDir}`);

    // ── Stage A — target API ──
    await setProgress(10, 'Stage A: target API');
    let target: any[] = [];
    try {
      target = await fetchAnoosh(cfg);
      fs.writeFileSync(cfg.ANOOSH_CACHE, JSON.stringify(target, null, 2));
      await log('info', `Stage A — ${target.length} target branches`);
    } catch (err: any) {
      await log('warn', `Stage A failed: ${err.message}`);
    }

    // ── Stage B — target hours ──
    await setProgress(25, 'Stage B: target hours');
    if (target.length > 0) {
      try {
        target = await scrapeHoursForAnoosh(target, cfg);
        fs.writeFileSync(cfg.ANOOSH_CACHE, JSON.stringify(target, null, 2));
        await log('info', `Stage B — hours scraped`);
      } catch (err: any) { await log('warn', `Stage B failed: ${err.message}`); }
    }

    // ── Stage C — competitors ──
    await setProgress(45, 'Stage C: competitors');
    let competitors: any[] = [];
    try {
      competitors = await scrapeCompetitors(cfg);
      await log('info', `Stage C — ${competitors.length} competitor branches`);
    } catch (err: any) {
      await log('error', `Stage C failed: ${err.message}`);
      throw err;
    }

    let rawPlaces = [...target, ...competitors];
    fs.writeFileSync(cfg.RAW_JSON_FILE, JSON.stringify(rawPlaces, null, 2));

    // ── Stage D — popular times ──
    await setProgress(65, 'Stage D: popular times');
    try {
      rawPlaces = await scrapePopularTimes(rawPlaces, cfg);
      fs.writeFileSync(cfg.RAW_JSON_FILE, JSON.stringify(rawPlaces, null, 2));
    } catch (err: any) { await log('warn', `Stage D failed: ${err.message}`); }

    // ── Stage E — analyze + files ──
    await setProgress(78, 'Stage E: analyze + build files');
    const analysis = analyze(rawPlaces, cfg);
    writeWorkbook(analysis, cfg);
    writeReport(analysis, cfg);

    // ── Stage F — push business data to client DB ──
    await setProgress(85, 'Saving data to your database');
    await pushDataToClientDb(cdb, job.id, rawPlaces, analysis, target);
    await log('info', 'Branches, reviews, analyses written to your DB');

    // ── Stage G — upload files to client Storage ──
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

async function pushDataToClientDb(cdb: any, jobId: string, rawPlaces: any[], analysis: any, targetPlaces: any[]) {
  const targetSet = new Set(targetPlaces.map(t => t.title));

  // Insert branches and capture their generated UUIDs to link reviews
  const branchRows = rawPlaces.map(p => ({
    job_id: jobId,
    brand: detectBrand(p),
    branch_name: p.title || '(unknown)',
    city: extractCity(p.address),
    address: p.address,
    phone: p.phone || null,
    website: p.website || null,
    hours_json: p.hours || null,
    popular_times: p.popularTimes || null,
    is_target: targetSet.has(p.title),
  }));

  const { data: insertedBranches, error: branchErr } = await cdb
    .from('branches').insert(branchRows).select('id, branch_name, brand');
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

  // Analyses (per brand)
  if (analysis?.brandRows?.length > 0) {
    const analysisRows = analysis.brandRows.map((b: any) => ({
      job_id: jobId,
      brand: b.brand,
      branch_count: b.totalBranches,
      total_reviews_3m: b.totalReviews3m,
      avg_rating_3m: b.avgRating3m,
      // The analyzer doesn't provide these aggregates per-brand in brandRows yet, 
      // but the table expects them. Defaulting to 0 for now.
      star_5_count: 0,
      star_4_count: 0,
      star_3_count: 0,
      star_2_count: 0,
      star_1_count: 0,
    }));
    const { error } = await cdb.from('analyses').insert(analysisRows);
    if (error) throw new Error('Failed inserting analyses: ' + error.message);
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

function detectBrand(p: any): string {
  if (p.__brandHint) return p.__brandHint;          // set by scraper
  return p.title || 'Unknown';
}

function extractCity(addr?: string): string | null {
  if (!addr) return null;
  const parts = addr.split(',').map(s => s.trim());
  return parts.length >= 2 ? parts[parts.length - 2] : null;
}
