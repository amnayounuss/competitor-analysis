'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

type Lang = 'en' | 'ar';

interface LangContextType {
  lang: Lang;
  isAr: boolean;
  toggle: () => void;
}

const LangContext = createContext<LangContextType>({ lang: 'en', isAr: false, toggle: () => {} });

export function useLang() {
  return useContext(LangContext);
}

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('app-lang') as Lang) || 'en';
    }
    return 'en';
  });

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
      if (typeof window !== 'undefined') localStorage.setItem('app-lang', next);
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
