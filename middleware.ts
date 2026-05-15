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

  // ── Initialize Supabase client ──
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

  // ── Client DB connection gate (Optimized: direct DB query) ──
  if (user && (path.startsWith('/dashboard') || path.startsWith('/jobs') || path.startsWith('/schedules'))) {
    // Check if user is admin (exempt from forced DB setup)
    // We can use a single query to get both profile and connection status
    const [{ data: profile }, { data: conn }] = await Promise.all([
      sb.from('profiles').select('is_admin').eq('id', user.id).maybeSingle(),
      sb.from('client_databases').select('last_test_ok').eq('user_id', user.id).maybeSingle()
    ]);

    if (profile?.is_admin) return res;

    if (!conn?.last_test_ok) {
      return NextResponse.redirect(new URL('/connect-database', req.url));
    }
  }

  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/auth).*)'],
};
