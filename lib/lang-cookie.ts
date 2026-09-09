/**
 * The name of the language cookie, in a module with no 'use client'.
 *
 * Both the server layout and the client provider need it. Importing it from
 * lib/lang-context (which is a client module) handed the server an opaque
 * client reference instead of the string — `cookies().get({})` quietly returned
 * undefined, so every page rendered in English no matter what the visitor had
 * chosen. Same reason lib/auth-cookie.ts exists.
 */
export const LANG_COOKIE = 'app-lang';

export type Lang = 'en' | 'ar';

/** One year: a language preference is not something to ask about twice. */
export const LANG_COOKIE_MAX_AGE = 31536000;
