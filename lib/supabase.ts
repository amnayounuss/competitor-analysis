/**
 * Three Supabase clients for three contexts:
 *   browserClient()  — React components (uses anon key + browser cookies)
 *   serverClient()   — Next.js Server Components / API routes (cookies)
 *   adminClient()    — Worker process only (service role, bypasses RLS)
 */
import { createBrowserClient, createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { AUTH_COOKIE_NAME } from './auth-cookie';

/** The address the BROWSER uses. Must stay publicly routable. */
const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!;

/**
 * The address SERVER-SIDE code uses (server components, API routes, worker).
 *
 * These run inside the instance, where its own public IP does not route back —
 * AWS does not hairpin traffic to an instance's own Elastic IP. Every
 * server-side Supabase call aimed at the public address therefore stalled until
 * it timed out: middleware runs on every request, so EVERY page took a flat
 * ~10s before rendering, and data-heavy pages took multiples of that. The app
 * looked dead from a browser while being perfectly healthy on loopback.
 */
const SUPABASE_INTERNAL_URL = process.env.SUPABASE_INTERNAL_URL || SUPABASE_URL;

const ANON_KEY      = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Auth cookie name, pinned.
 *
 * @supabase/ssr derives the cookie name from the URL's first hostname label
 * ("52.221.243.120" → "sb-52-auth-token"). Browser and server now pass
 * DIFFERENT urls, which would derive different names and silently invalidate
 * every existing session. Deriving it from the PUBLIC url on both sides keeps
 * the name identical to what is already in users' browsers.
 */
/**
 * Auth cookie name, pinned to a constant.
 *
 * @supabase/ssr derives the cookie name from the URL's first hostname label.
 * Browser and server now pass different urls — and the browser's is relative to
 * whatever origin it was served from — so a derived name would differ between
 * the two, and between direct-IP and tunnelled access, silently invalidating
 * sessions each time. A fixed name is stable across all of those.
 */
const cookieOptions = { name: AUTH_COOKIE_NAME };

/** Path the app proxies Supabase on — see the rewrite in next.config.js. */
const SUPABASE_PROXY_PATH = '/sb';

/**
 * The browser reaches Supabase through THIS app's origin, not through Kong's
 * port directly: port 8000 is not open from outside, so a direct call never
 * arrived and every login failed. Going through the app's own origin means only
 * its port needs to be reachable, and the same build works via public IP or an
 * SSH tunnel without a rebuild.
 */
function browserSupabaseUrl(): string {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}${SUPABASE_PROXY_PATH}`;
  }
  return SUPABASE_URL;
}

export function browserClient() {
  return createBrowserClient(browserSupabaseUrl(), ANON_KEY, { cookieOptions });
}

export function serverClient() {
  // Use require inside the function to avoid importing next/headers in Client Components
  const { cookies } = require('next/headers');
  const cookieStore = cookies();
  
  return createServerClient(SUPABASE_INTERNAL_URL, ANON_KEY, {
    cookieOptions,
    cookies: {
      get(name: string) { return cookieStore.get(name)?.value; },
      set(name: string, value: string, options: CookieOptions) {
        try { cookieStore.set({ name, value, ...options }); } catch {}
      },
      remove(name: string, options: CookieOptions) {
        try { cookieStore.set({ name, value: '', ...options }); } catch {}
      },
    },
  });
}

/** Worker / cron only. Never expose to browser. */
export function adminClient() {
  if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  
  let ws;
  if (typeof window === 'undefined') {
    try {
      ws = require('ws');
    } catch (e) {
      console.error('[supabase-admin] Failed to load "ws" package:', e);
    }
  }
  
  return createSupabaseClient(SUPABASE_INTERNAL_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: {
      transport: ws
    }
  });
}
