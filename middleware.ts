import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { AUTH_COOKIE_NAME } from '@/lib/auth-cookie';

const PROTECTED = ['/dashboard', '/jobs', '/admin', '/schedules', '/connect-database'];
const PUBLIC_DURING_SETUP = ['/setup', '/api/setup'];

/**
 * Middleware runs on the server for EVERY request, so the address it uses to
 * reach Supabase decides the floor latency of the whole app.
 *
 * NEXT_PUBLIC_SUPABASE_URL is the browser's address. Reaching it from inside the
 * instance does not work — AWS does not route an instance's own public IP back
 * to itself — so each of the calls below stalled until it timed out, putting a
 * flat ~10s on every page load and making a healthy app look dead. Server-side
 * code must use the internal address.
 */
const INTERNAL_URL = process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;

// Cookie name comes from the shared constant — deriving it here instead is what
// made middleware look for a cookie the browser never wrote. See lib/auth-cookie.ts.

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // Skip API + static
  if (path.startsWith('/api/') || path.startsWith('/_next/') || path.includes('.')) {
    return NextResponse.next();
  }

  // ── Initialize Supabase client ──
  let res = NextResponse.next({ request: { headers: req.headers } });
  const sb = createServerClient(
    INTERNAL_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { name: AUTH_COOKIE_NAME },
      cookies: {
        get(n: string) { return req.cookies.get(n)?.value; },
        set(n: string, v: string, o: CookieOptions) {
          req.cookies.set({ name: n, value: v, ...o });
          res = NextResponse.next({ request: { headers: req.headers } });
          res.cookies.set({ name: n, value: v, ...o });
        },
        remove(n: string, o: CookieOptions) {
          req.cookies.set({ name: n, value: '', ...o });
          res = NextResponse.next({ request: { headers: req.headers } });
          res.cookies.set({ name: n, value: '', ...o });
        },
      },
    },
  );

  // ── Setup gate (Optimized: use RPC instead of fetch) ──
  if (!PUBLIC_DURING_SETUP.some(p => path === p || path.startsWith(p + '/'))) {
    const { data: setupCompleted } = await sb.rpc('is_setup_completed');
    if (setupCompleted === false) {
      return NextResponse.redirect(new URL('/setup', req.url));
    }
  } else if (path === '/setup') {
    const { data: setupCompleted } = await sb.rpc('is_setup_completed');
    if (setupCompleted === true) {
      return NextResponse.redirect(new URL('/login', req.url));
    }
  }

  // ── Auth gate ──
  const { data: { user } } = await sb.auth.getUser();
  const needsAuth = PROTECTED.some(p => path === p || path.startsWith(p + '/'));

  if (needsAuth && !user) return NextResponse.redirect(new URL('/login', req.url));

  // ── Role + DB connection gate ──
  if (user && (path.startsWith('/dashboard') || path.startsWith('/jobs') || path.startsWith('/schedules'))) {
    const { data: profile } = await sb.from('profiles').select('role, parent_user_id, is_admin').eq('id', user.id).maybeSingle();
    const role = profile?.role === 'viewer' ? 'viewer' : profile?.role === 'admin' || profile?.is_admin ? 'admin' : 'client';

    if (role === 'admin') return res;

    if (role === 'viewer') {
      if (path === '/dashboard/new' || path.startsWith('/schedules') || path === '/dashboard/team' || path === '/connect-database') {
        return NextResponse.redirect(new URL('/dashboard', req.url));
      }
      const dbUserId = profile?.parent_user_id || user.id;
      const admin = createClient(INTERNAL_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const { data: conn } = await admin.from('client_databases').select('last_test_ok').eq('user_id', dbUserId).maybeSingle();
      if (!conn?.last_test_ok) {
        return NextResponse.redirect(new URL('/login', req.url));
      }
      return res;
    }

    const { data: conn } = await sb.from('client_databases').select('last_test_ok').eq('user_id', user.id).maybeSingle();
    if (!conn?.last_test_ok) {
      return NextResponse.redirect(new URL('/connect-database', req.url));
    }
  }

  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/auth).*)'],
};
