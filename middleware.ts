import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PROTECTED = ['/dashboard', '/jobs', '/admin', '/schedules', '/connect-database'];
const PUBLIC_DURING_SETUP = ['/setup', '/api/setup'];

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // Skip API + static
  if (path.startsWith('/api/') || path.startsWith('/_next/') || path.includes('.')) {
    return NextResponse.next();
  }

  // ── Setup gate ──
  if (!PUBLIC_DURING_SETUP.some(p => path === p || path.startsWith(p + '/'))) {
    try {
      const r = await fetch(new URL('/api/setup', req.url), {
        headers: { cookie: req.headers.get('cookie') || '' }, cache: 'no-store',
      });
      if (r.ok) {
        const j = await r.json();
        if (!j.setup_completed) return NextResponse.redirect(new URL('/setup', req.url));
      }
    } catch {}
  } else if (path === '/setup') {
    try {
      const r = await fetch(new URL('/api/setup', req.url), {
        headers: { cookie: req.headers.get('cookie') || '' }, cache: 'no-store',
      });
      if (r.ok) {
        const j = await r.json();
        if (j.setup_completed) return NextResponse.redirect(new URL('/login', req.url));
      }
    } catch {}
  }

  // ── Auth gate ──
  let res = NextResponse.next({ request: { headers: req.headers } });
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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

  const { data: { user } } = await sb.auth.getUser();
  const needsAuth = PROTECTED.some(p => path === p || path.startsWith(p + '/'));

  if (needsAuth && !user) return NextResponse.redirect(new URL('/login', req.url));

  // ── Client DB connection gate (skip for /connect-database itself + admin pages + Admins) ──
  if (user && (path.startsWith('/dashboard') || path.startsWith('/jobs') || path.startsWith('/schedules'))) {
    try {
      // Check if user is admin (exempt from forced DB setup)
      const { data: profile } = await sb.from('profiles').select('is_admin').eq('id', user.id).single();
      if (profile?.is_admin) return res;

      const r = await fetch(new URL('/api/client-db', req.url), {
        headers: { cookie: req.headers.get('cookie') || '' }, cache: 'no-store',
      });
      if (r.ok) {
        const j = await r.json();
        if (!j.connection?.last_test_ok) {
          return NextResponse.redirect(new URL('/connect-database', req.url));
        }
      }
    } catch {}
  }

  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/auth).*)'],
};
