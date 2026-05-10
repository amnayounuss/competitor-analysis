/**
 * Three Supabase clients for three contexts:
 *   browserClient()  — React components (uses anon key + browser cookies)
 *   serverClient()   — Next.js Server Components / API routes (cookies)
 *   adminClient()    — Worker process only (service role, bypasses RLS)
 */
import { createBrowserClient, createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY      = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export function browserClient() {
  return createBrowserClient(SUPABASE_URL, ANON_KEY);
}

export function serverClient() {
  // Use require inside the function to avoid importing next/headers in Client Components
  const { cookies } = require('next/headers');
  const cookieStore = cookies();
  
  return createServerClient(SUPABASE_URL, ANON_KEY, {
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
  
  return createSupabaseClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: {
      transport: ws
    }
  });
}
