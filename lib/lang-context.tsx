'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { LANG_COOKIE, LANG_COOKIE_MAX_AGE, type Lang } from './lang-cookie';



interface LangContextType {
  lang: Lang;
  isAr: boolean;
  toggle: () => void;
}

const LangContext = createContext<LangContextType>({ lang: 'en', isAr: false, toggle: () => {} });

export function useLang() {
  return useContext(LangContext);
}

function readCookieLang(): Lang | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(/(?:^|;\s*)app-lang=(en|ar)\b/);
  return m ? (m[1] as Lang) : null;
}

export function LangProvider({ children, initialLang }: {
  children: React.ReactNode;
  /**
   * The language the server already rendered with, read from the cookie.
   *
   * Deriving it from localStorage during the first render instead made the
   * server emit English and the browser emit Arabic, which React reported as
   * hydration errors (#418/#423/#425) and recovered from by throwing the
   * server's HTML away — on every page load an Arabic user made.
   */
  initialLang?: Lang;
}) {
  const [lang, setLang] = useState<Lang>(initialLang ?? 'en');

  // Older sessions stored the choice in localStorage only; move it to the
  // cookie once so the server can honour it from the next request onwards.
  useEffect(() => {
    if (initialLang) return;
    let stored: Lang | null = readCookieLang();
    if (!stored) {
      try { stored = (localStorage.getItem(LANG_COOKIE) as Lang) || null; } catch { stored = null; }
      if (stored === 'ar' || stored === 'en') {
        document.cookie = `${LANG_COOKIE}=${stored}; path=/; max-age=${LANG_COOKIE_MAX_AGE}; samesite=lax`;
      }
    }
    if (stored && stored !== lang) setLang(stored);
    // Runs once: it exists only to migrate a pre-cookie session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply dir + lang on <html> whenever language changes
  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    html.setAttribute('lang', lang);
    // Add/remove font class for Arabic
    if (lang === 'ar') {
      html.classList.add('font-arabic');
    } else {
      html.classList.remove('font-arabic');
    }
  }, [lang]);

  const toggle = useCallback(() => {
    setLang(prev => {
      const next = prev === 'en' ? 'ar' : 'en';
      if (typeof window !== 'undefined') {
        try { localStorage.setItem(LANG_COOKIE, next); } catch { /* private mode */ }
        // The cookie is the one the server reads on the next navigation.
        document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=${LANG_COOKIE_MAX_AGE}; samesite=lax`;
      }
      return next;
    });
  }, []);

  const isAr = lang === 'ar';

  return (
    <LangContext.Provider value={{ lang, isAr, toggle }}>
      {children}
    </LangContext.Provider>
  );
}
