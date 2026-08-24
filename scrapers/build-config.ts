/**
 * Per-job config factory.
 *
 * Reads GMB OAuth credentials (NOT Gmail!) from app_settings, since the
 * scrapers fetch from Google Business Profile API.
 */
import path from 'node:path';
import { getSettings } from '../lib/settings';

export interface CompetitorEntry { key: string; name: string; url: string; }

export interface BrandKeyword { keyword: string; brand: string; }

export interface JobConfig {
  jobId:           string;
  targetName:      string;
  workDir:         string;
  searchLocation?: string;
  /** Lower-cased keywords → brand name. Used by analyzer to classify any
   *  scraped place whose `__searchBrand` was not set. First match wins, so
   *  order from most-specific to least-specific. */
  BRAND_KEYWORDS:  BrandKeyword[];
  TARGET_API: {
    clientId:     string;
    clientSecret: string;
    refreshToken: string;
    readMask:     string;
  };
  /** Same shape as a competitor entry, but for the target brand. Used by the
   *  Puppeteer fallback when the Business Profile API returns no data. */
  TARGET_SEARCH:  CompetitorEntry;
  COMPETITORS: CompetitorEntry[];
  /** Google Places API key — when present, competitors are discovered via the
   *  Places API (authoritative, place_id-keyed) instead of Puppeteer scroll. */
  PLACES_API_KEY?: string;
  /** Optional explicit city list for Places per-city fan-out. Defaults to the
   *  built-in SA city list when searchLocation is Saudi Arabia. */
  PLACES_CITIES?: string[];
  /** Apify token — competitor reviews + star distribution + popular times. */
  APIFY_TOKEN?: string;
  REVIEWS_OPTIONS: { maxReviews: number };
  LOOKBACK_MONTHS: number;
  /** Inclusive YYYY-MM-DD start of analysis window. If absent, analyzer uses LOOKBACK_MONTHS. */
  DATE_START?:     string;
  /** Inclusive YYYY-MM-DD end of analysis window. If absent, analyzer uses today. */
  DATE_END?:       string;
  PUPPETEER_OPTIONS: {
    headless: boolean; maxScrollsStage1: number; maxScrollsStage2: number;
    scrollPauseMs: number; betweenBranchesMs: number;
  };
  POPULAR_TIMES_OPTIONS: { enableHoverFallback: boolean; concurrency?: number };
  TARGET_CACHE: string;
  COMP_BRANCHES: string;
  COMP_REVIEWS: string;
  RAW_JSON_FILE: string;
  EXCEL_FILE: string;
  REPORT_FILE: string;
}

export interface BuildConfigArgs {
  jobId:        string;
  targetName:   string;
  competitors:  string[];
  refreshToken: string;
  /** Free-form location qualifier appended to every Google Maps search query
   *  (e.g. "Riyadh", "Dubai UAE", "London"). Empty/undefined = no qualifier. */
  searchLocation?: string;
  dateStart?:   string;   // YYYY-MM-DD
  dateEnd?:     string;   // YYYY-MM-DD
  /** The client's own Apify token. Takes precedence over the instance-wide one
   *  so each client is billed against their own Apify account. */
  apifyToken?:  string;
}

const WORKROOT = process.env.JOB_WORKDIR || '/tmp/scraper-jobs';

export async function buildJobConfig(args: BuildConfigArgs): Promise<JobConfig> {
  const settings = await getSettings();
  const workDir  = path.join(WORKROOT, args.jobId);
  const location = (args.searchLocation || '').trim();
  // Builds "BrandName Location" or just "BrandName" if no location provided.
  const buildQuery = (brand: string) =>
    location ? `${brand} ${location}` : brand;

  // Strip location words from brand/competitor names if the user accidentally
  // included them (e.g. "Bostani Saudi Arabia" when search_location is already
  // set to "Saudi Arabia").  This prevents the brand key/name from containing
  // location noise that would break brand matching and produce ugly labels.
  const stripLocation = (name: string): string => {
    if (!location) return name;
    const locWords = location.toLowerCase().split(/\s+/).filter(Boolean);
    const words = name.split(/\s+/);
    const cleaned = words.filter(w => !locWords.includes(w.toLowerCase()));
    return cleaned.length > 0 ? cleaned.join(' ') : name; // keep original if everything got stripped
  };

  // The scrapers use GMB OAuth (admin's Business Profile API project), not Gmail.
  if (!settings.gmb_oauth_client_id || !settings.gmb_oauth_client_secret) {
    throw new Error('GMB OAuth not configured. Admin must set GMB client_id and secret in /admin.');
  }

  const cleanTarget = stripLocation(args.targetName);

  // Parse competitor aliases: "Tawa|تاوة|حلويات تاوة" → brand="Tawa", aliases=["Tawa","تاوة","حلويات تاوة"]
  const parsedComps = args.competitors.map(raw => {
    const parts = raw.split('|').map(s => s.trim()).filter(Boolean);
    const brand = stripLocation(parts[0]);
    const aliases = parts.length > 1 ? parts.map(p => stripLocation(p)) : [brand];
    return { brand, aliases };
  });

  const brandKeywords: BrandKeyword[] = [
    { keyword: cleanTarget.toLowerCase(), brand: cleanTarget },
  ];
  const competitorEntries: CompetitorEntry[] = [];

  for (const comp of parsedComps) {
    for (const alias of comp.aliases) {
      brandKeywords.push({ keyword: alias.toLowerCase(), brand: comp.brand });
      competitorEntries.push({
        key:  comp.brand,
        name: alias,
        url:  `https://www.google.com/maps/search/${encodeURIComponent(buildQuery(alias))}/?hl=en`,
      });
    }
  }

  return {
    jobId: args.jobId,
    targetName: cleanTarget,
    workDir,
    searchLocation: location || undefined,
    BRAND_KEYWORDS: brandKeywords,
    TARGET_API: {
      clientId:     settings.gmb_oauth_client_id,
      clientSecret: settings.gmb_oauth_client_secret,
      refreshToken: args.refreshToken,
      readMask:     'name,title,storeCode,storefrontAddress,regularHours,phoneNumbers,websiteUri,metadata,openInfo',
    },
    TARGET_SEARCH: {
      key:  cleanTarget,
      name: cleanTarget,
      url:  `https://www.google.com/maps/search/${encodeURIComponent(buildQuery(cleanTarget))}/?hl=en`,
    },
    COMPETITORS: competitorEntries,
    PLACES_API_KEY: settings.google_places_api_key || undefined,
    APIFY_TOKEN: args.apifyToken || settings.apify_token || undefined,
    REVIEWS_OPTIONS: { maxReviews: 100 },
    LOOKBACK_MONTHS: 3,
    DATE_START:      args.dateStart,
    DATE_END:        args.dateEnd,
    PUPPETEER_OPTIONS: {
      headless:           settings.puppeteer_headless,
      maxScrollsStage1:   50,
      maxScrollsStage2:   15,
      scrollPauseMs:      1500,
      betweenBranchesMs:  1500,
    },
    POPULAR_TIMES_OPTIONS: { enableHoverFallback: true, concurrency: 6 },
    TARGET_CACHE:   path.join(workDir, 'target_locations.json'),
    COMP_BRANCHES:  path.join(workDir, 'competitor_branches.json'),
    COMP_REVIEWS:   path.join(workDir, 'competitor_reviews.json'),
    RAW_JSON_FILE:  path.join(workDir, 'raw_places.json'),
    EXCEL_FILE:     path.join(workDir, `${slug(args.targetName)}_analysis.xlsx`),
    REPORT_FILE:    path.join(workDir, `${slug(args.targetName)}_report.md`),
  };
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
