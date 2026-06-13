/**
 * App settings — single source of truth for runtime config.
 *
 * All read from DB (set via /setup wizard or /admin), with optional .env fallback.
 */
import { adminClient } from './supabase';

export interface AppSettings {
  // SMTP Config
  smtp_host:                  string;
  smtp_port:                  number;
  smtp_user:                  string;
  smtp_pass:                  string;
  smtp_secure:                boolean;
  smtp_from_name:             string;
  smtp_from_email:            string;

  // GMB OAuth (for clients)
  gmb_oauth_client_id:        string;
  gmb_oauth_client_secret:    string;

  // AI (Anthropic)
  anthropic_api_key:          string;

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
    smtp_host:                  data?.smtp_host                  || process.env.SMTP_HOST                  || '',
    smtp_port:                  data?.smtp_port                  ?? parseInt(process.env.SMTP_PORT || '587', 10),
    smtp_user:                  data?.smtp_user                  || process.env.SMTP_USER                  || '',
    smtp_pass:                  data?.smtp_pass                  || process.env.SMTP_PASS                  || '',
    smtp_secure:                data?.smtp_secure                ?? (process.env.SMTP_SECURE === 'true'),
    smtp_from_name:             data?.smtp_from_name             || process.env.SMTP_FROM_NAME             || 'Reports',
    smtp_from_email:            data?.smtp_from_email            || process.env.SMTP_FROM_EMAIL            || '',

    gmb_oauth_client_id:        data?.gmb_oauth_client_id        || process.env.GMB_OAUTH_CLIENT_ID        || '',
    gmb_oauth_client_secret:    data?.gmb_oauth_client_secret    || process.env.GMB_OAUTH_CLIENT_SECRET    || '',

    anthropic_api_key:          data?.anthropic_api_key           || process.env.ANTHROPIC_API_KEY           || '',
    
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
    && !!s.gmb_oauth_client_id;
}
