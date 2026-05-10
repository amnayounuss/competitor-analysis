/**
 * App settings — single source of truth for runtime config.
 *
 * Two separate OAuth credentials:
 *   1. Gmail (sender)  — admin's own Google project for sending mail
 *   2. GMB (Business Profile API) — separate Google project; clients provide
 *      their own refresh tokens at job-submit time
 *
 * All read from DB (set via /setup wizard or /admin), with optional .env fallback.
 */
import { adminClient } from './supabase';

export interface AppSettings {
  // Gmail OAuth (sender)
  gmail_user:                 string;
  gmail_from_name:            string;
  gmail_oauth_client_id:      string;
  gmail_oauth_client_secret:  string;
  gmail_refresh_token:        string;

  // GMB OAuth
  gmb_oauth_client_id:        string;
  gmb_oauth_client_secret:    string;

  // Worker
  worker_poll_ms:             number;
  puppeteer_headless:         boolean;
  signup_allowed:             boolean;
  setup_completed:            boolean;
}

let _cache: AppSettings | null = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 30_000;

export async function getSettings(forceFresh = false): Promise<AppSettings> {
  if (!forceFresh && _cache && Date.now() - _cacheTime < CACHE_TTL_MS) return _cache;

  const sb = adminClient();
  const { data, error } = await sb.from('app_settings').select('*').eq('id', 1).single();

  if (error && error.code !== 'PGRST116') {
    console.warn('[settings] DB read failed, env fallback:', error.message);
  }

  const merged: AppSettings = {
    gmail_user:                 data?.gmail_user                 || process.env.GMAIL_USER                 || '',
    gmail_from_name:            data?.gmail_from_name            || process.env.GMAIL_FROM_NAME            || 'Reports',
    gmail_oauth_client_id:      data?.gmail_oauth_client_id      || process.env.GMAIL_OAUTH_CLIENT_ID      || '',
    gmail_oauth_client_secret:  data?.gmail_oauth_client_secret  || process.env.GMAIL_OAUTH_CLIENT_SECRET  || '',
    gmail_refresh_token:        data?.gmail_refresh_token        || process.env.GMAIL_REFRESH_TOKEN        || '',
    gmb_oauth_client_id:        data?.gmb_oauth_client_id        || process.env.GMB_OAUTH_CLIENT_ID        || '',
    gmb_oauth_client_secret:    data?.gmb_oauth_client_secret    || process.env.GMB_OAUTH_CLIENT_SECRET    || '',
    worker_poll_ms:             data?.worker_poll_ms             ?? parseInt(process.env.WORKER_POLL_INTERVAL_MS || '5000', 10),
    puppeteer_headless:         data?.puppeteer_headless         ?? (process.env.PUPPETEER_HEADLESS !== 'false'),
    signup_allowed:             data?.signup_allowed             ?? true,
    setup_completed:            data?.setup_completed            ?? false,
  };

  _cache = merged;
  _cacheTime = Date.now();
  return merged;
}

export function clearSettingsCache() {
  _cache = null;
  _cacheTime = 0;
}

export async function isSetupCompleted(): Promise<boolean> {
  const s = await getSettings();
  return s.setup_completed
    && !!s.gmail_user
    && !!s.gmail_refresh_token
    && !!s.gmb_oauth_client_id;
}
