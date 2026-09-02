/**
 * The auth cookie name, in one place.
 *
 * @supabase/ssr otherwise derives this from the Supabase URL's first hostname
 * label. That breaks here for two reasons: the browser and the server now pass
 * different urls (the browser goes through this app's /sb proxy), and the
 * browser's url follows whatever origin served the page — so direct-IP and
 * tunnelled access would derive different names and silently invalidate each
 * other's sessions.
 *
 * It must be IDENTICAL in every client. When it was pinned in lib/supabase.ts
 * but still derived in middleware.ts, the browser wrote `sb-app-auth-token`
 * while middleware looked for `sb-52-auth-token`: login succeeded and set the
 * cookie, then middleware saw no session and bounced every protected route
 * straight back to /login, which looked exactly like a failed login.
 *
 * Changing this value logs everyone out once.
 */
export const AUTH_COOKIE_NAME = 'sb-app-auth-token';
