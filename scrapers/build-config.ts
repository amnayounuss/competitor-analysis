/**
 * Per-job config factory.
 *
 * Reads GMB OAuth credentials (NOT Gmail!) from app_settings, since the
 * scrapers fetch from Google Business Profile API.
 */
import path from 'node:path';
import { getSettings } from '../lib/settings';

export interface CompetitorEntry { key: string; name: string; url: string; }

export interface JobConfig {
  jobId:           string;
  targetName:      string;
  workDir:         string;
  ANOOSH_API: {
    clientId:     string;
    clientSecret: string;
    refreshToken: string;
    readMask:     string;
  };
  COMPETITORS: CompetitorEntry[];
  REVIEWS_OPTIONS: { maxReviews: number };
  LOOKBACK_MONTHS: number;
  PUPPETEER_OPTIONS: {
    headless: boolean; maxScrollsStage1: number; maxScrollsStage2: number;
    scrollPauseMs: number; betweenBranchesMs: number;
  };
  POPULAR_TIMES_OPTIONS: { enableHoverFallback: boolean };
  ANOOSH_CACHE: string;
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
  searchSuffix?: string;
}

const WORKROOT = process.env.JOB_WORKDIR || '/tmp/anoosh-jobs';

export async function buildJobConfig(args: BuildConfigArgs): Promise<JobConfig> {
  const settings = await getSettings();
  const workDir  = path.join(WORKROOT, args.jobId);
  const suffix   = args.searchSuffix || 'saudia';

  // The scrapers use GMB OAuth (admin's Business Profile API project), not Gmail.
  if (!settings.gmb_oauth_client_id || !settings.gmb_oauth_client_secret) {
    throw new Error('GMB OAuth not configured. Admin must set GMB client_id and secret in /admin.');
  }

  return {
    jobId: args.jobId,
    targetName: args.targetName,
    workDir,
    ANOOSH_API: {
      clientId:     settings.gmb_oauth_client_id,
      clientSecret: settings.gmb_oauth_client_secret,
      refreshToken: args.refreshToken,                   // client provides this
      readMask:     'name,title,storeCode,storefrontAddress,regularHours,phoneNumbers,websiteUri,metadata',
    },
    COMPETITORS: args.competitors.map(name => ({
      key:  name,
      name,
      url:  `https://www.google.com/maps/search/${encodeURIComponent(name + ' ' + suffix)}/?hl=en`,
    })),
    REVIEWS_OPTIONS: { maxReviews: 100 },
    LOOKBACK_MONTHS: 3,
    PUPPETEER_OPTIONS: {
      headless:           settings.puppeteer_headless,
      maxScrollsStage1:   50,
      maxScrollsStage2:   15,
      scrollPauseMs:      1500,
      betweenBranchesMs:  1500,
    },
    POPULAR_TIMES_OPTIONS: { enableHoverFallback: true },
    ANOOSH_CACHE:   path.join(workDir, 'anoosh_locations.json'),
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
