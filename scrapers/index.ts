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
