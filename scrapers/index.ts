/**
 * Thin TS wrappers around the original JS scraper modules.
 *
 * Pattern:
 *   1. Set the active config in scrapers/config.js (the proxy)
 *   2. Call the original function (which reads config via the proxy)
 *   3. Clear the active config when done (defensive)
 *
 * Why this exists:
 *   The original code uses require('./config') and reads from a global. We
 *   keep that code untouched — battle-tested with 2000+ lines of working
 *   Puppeteer logic — and inject the per-job config via a proxy.
 */

import type { JobConfig } from './build-config';

// require() the proxy + original modules (CommonJS interop)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const proxyConfig = require('./config');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const _targetFetcher  = require('./target-fetcher');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const _hoursScraper   = require('./hours-scraper');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const _scraper        = require('./scraper');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const _placesFetcher  = require('./places-fetcher');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const _apifyFetcher   = require('./apify-fetcher');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const _gbpPerformance = require('./gbp-performance');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const _popularTimes   = require('./popular-times');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const _analyzer       = require('./analyzer');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const _excelBuilder   = require('./excel-builder');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const _reportBuilder  = require('./report-builder');

async function withConfig<T>(cfg: JobConfig, cancelCheck: (() => Promise<void>) | null, fn: () => Promise<T> | T): Promise<T> {
  proxyConfig.__setActiveConfig(cfg);
  if (cancelCheck) proxyConfig.__setCancelCheck(cancelCheck);
  try {
    return await fn();
  } finally {
    proxyConfig.__clearActiveConfig();
  }
}

// ── Stage A ────────────────────────────────────────────────
export async function fetchTarget(cfg: JobConfig, cancelCheck: (() => Promise<void>) | null = null): Promise<any[]> {
  return withConfig(cfg, cancelCheck, () => _targetFetcher.fetchTarget());
}

// ── Stage B ────────────────────────────────────────────────
export async function scrapeHoursForTarget(branches: any[], cfg: JobConfig, cancelCheck: (() => Promise<void>) | null = null): Promise<any[]> {
  return withConfig(cfg, cancelCheck, () => _hoursScraper.scrapeHoursForTarget(branches));
}

// ── Stage C ────────────────────────────────────────────────
export async function scrapeCompetitors(cfg: JobConfig, cancelCheck: (() => Promise<void>) | null = null): Promise<any[]> {
  return withConfig(cfg, cancelCheck, () => _scraper.scrapeCompetitors());
}

// ── Stage C (Places API discovery) ─────────────────────────
// Authoritative competitor discovery via the Google Places API. Returns
// branches keyed by ChIJ place_id (exact dedup, country-filtered, closed
// branches dropped). Reviews are filled afterwards by scrapeReviewsForBranches.
export async function fetchCompetitorsViaPlaces(cfg: JobConfig, cancelCheck: (() => Promise<void>) | null = null): Promise<any[]> {
  return withConfig(cfg, cancelCheck, () => _placesFetcher.fetchCompetitorsViaPlaces());
}

// Fill Google rating + review count (+ Maps link) on branches that have a
// placeId — used for the GMB-sourced target brand.
export async function enrichRatingsViaPlaces(branches: any[], cfg: JobConfig, cancelCheck: (() => Promise<void>) | null = null): Promise<any[]> {
  return withConfig(cfg, cancelCheck, () => _placesFetcher.enrichRatingsViaPlaces(branches));
}

// Attach Apify data (reviews + star distribution + popular times) onto branches
// by placeId. Used for competitors (reviews + PT) and for target popular times.
export async function enrichBranchesViaApify(
  branches: any[],
  opts: { maxReviews?: number; reviewsStartDate?: string; fillRating?: boolean; language?: string },
  cfg: JobConfig,
  cancelCheck: (() => Promise<void>) | null = null,
): Promise<any[]> {
  return withConfig(cfg, cancelCheck, () => _apifyFetcher.enrichBranchesViaApify(branches, opts));
}

// Stage 2 only (reviews + hours) over a pre-discovered branch list.
export async function scrapeReviewsForBranches(branches: any[], cfg: JobConfig, cancelCheck: (() => Promise<void>) | null = null): Promise<any[]> {
  return withConfig(cfg, cancelCheck, () => _scraper.scrapeProvidedBranches(branches));
}

// ── Stage A2 (fallback) ───────────────────────────────────
// Puppeteer-scrapes a single brand (target) from public Google Maps when
// the Business Profile API path returns nothing.
export async function scrapeBrand(
  brand: { key: string; name: string; url: string },
  cfg: JobConfig,
  cancelCheck: (() => Promise<void>) | null = null,
): Promise<any[]> {
  return withConfig(cfg, cancelCheck, () => _scraper.scrapeBrand(brand));
}

// ── Stage P (Business Profile Performance API) ─────────────
// Daily metric time series for the client's OWN locations, keyed by the GMB
// location id captured in Stage A. Competitors have no location id and are
// skipped — the API only serves locations the account manages.
export async function fetchGbpPerformance(
  branches: any[],
  opts: { dateStart?: string; dateEnd?: string; metrics?: string[] },
  cfg: JobConfig,
  cancelCheck: (() => Promise<void>) | null = null,
): Promise<any[]> {
  return withConfig(cfg, cancelCheck, () => _gbpPerformance.fetchPerformance(branches, opts));
}

export const GBP_DAILY_METRICS: string[] = _gbpPerformance.DAILY_METRICS;

// ── Stage D ────────────────────────────────────────────────
export async function scrapePopularTimes(places: any[], cfg: JobConfig, cancelCheck: (() => Promise<void>) | null = null): Promise<any[]> {
  return withConfig(cfg, cancelCheck, () => _popularTimes.scrapePopularTimes(places, cfg.RAW_JSON_FILE));
}

// ── Stage E ────────────────────────────────────────────────
export function analyze(places: any[], cfg: JobConfig): any {
  proxyConfig.__setActiveConfig(cfg);
  try {
    return _analyzer.analyze(places);
  } finally {
    proxyConfig.__clearActiveConfig();
  }
}

// ── Stage F ────────────────────────────────────────────────
export function writeWorkbook(analysis: any, cfg: JobConfig): string {
  proxyConfig.__setActiveConfig(cfg);
  try {
    return _excelBuilder.writeWorkbook(analysis);
  } finally {
    proxyConfig.__clearActiveConfig();
  }
}

export function writeReport(analysis: any, cfg: JobConfig): string {
  proxyConfig.__setActiveConfig(cfg);
  try {
    return _reportBuilder.writeReport(analysis);
  } finally {
    proxyConfig.__clearActiveConfig();
  }
}
