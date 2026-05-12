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
  POPULAR_TIMES_OPTIONS: { enableHoverFallback: boolean };
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

  // Clean brand names: strip location words if user accidentally included them
  // e.g. "Bostani Saudi Arabia" with location "Saudi Arabia" → "Bostani"
  const cleanTarget = stripLocation(args.targetName);
  const cleanComps  = args.competitors.map(c => stripLocation(c));

  // Brand vocabulary used by analyzer to classify scraped places.
  // Target first (so it matches before competitors when titles overlap),
  // then competitors in submission order.
  const brandKeywords: BrandKeyword[] = [
    { keyword: cleanTarget.toLowerCase(), brand: cleanTarget },
    ...cleanComps.map(c => ({ keyword: c.toLowerCase(), brand: c })),
  ];

  return {
    jobId: args.jobId,
    targetName: cleanTarget,
    workDir,
    BRAND_KEYWORDS: brandKeywords,
    TARGET_API: {
      clientId:     settings.gmb_oauth_client_id,
      clientSecret: settings.gmb_oauth_client_secret,
      refreshToken: args.refreshToken,                   // client provides this
      readMask:     'name,title,storeCode,storefrontAddress,regularHours,phoneNumbers,websiteUri,metadata',
    },
    TARGET_SEARCH: {
      key:  cleanTarget,
      name: cleanTarget,
      url:  `https://www.google.com/maps/search/${encodeURIComponent(buildQuery(cleanTarget))}/?hl=en`,
    },
    COMPETITORS: cleanComps.map(name => ({
      key:  name,
      name,
      url:  `https://www.google.com/maps/search/${encodeURIComponent(buildQuery(name))}/?hl=en`,
    })),
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
    POPULAR_TIMES_OPTIONS: { enableHoverFallback: true },
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
