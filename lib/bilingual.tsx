'use client';

import React from 'react';
import translations from './translations';
import { useLang } from './lang-context';

/**
 * Robust helper to translate text. If the text has a pipebar '|',
 * it returns the English part for 'en' and Arabic part for 'ar'.
 * Otherwise, it looks up the key in translations dictionary.
 */
export function translateText(text: string, lang: 'en' | 'ar'): string {
  if (!text) return '';
  if (text.includes('|')) {
    const parts = text.split('|');
    if (lang === 'ar') {
      return (parts[1] || parts[0]).trim();
    }
    return parts[0].trim();
  }
  if (lang === 'ar') {
    return translations[text] || text;
  }
  return text;
}

/**
 * Look up the Arabic translation for an English string.
 * Always returns Arabic — used only in non-component contexts.
 */
export function ar(en: string): string {
  return translateText(en, 'ar');
}

/**
 * Hook: returns a translator function t() that respects the current language.
 * When lang=ar → returns Arabic translation
 * When lang=en → returns original English
 */
export function useT() {
  const { lang } = useLang();
  return (text: string): string => {
    return translateText(text, lang);
  };
}

/**
 * Bilingual component — renders text in the selected language.
 * When lang=en: shows English
 * When lang=ar: shows Arabic
 */
export function Bi({
  en,
  as: Tag,
  className = '',
}: {
  en: string;
  as?: keyof React.JSX.IntrinsicElements;
  className?: string;
}) {
  const { lang } = useLang();
  const text = translateText(en, lang);

  if (Tag) {
    const CustomTag = Tag as any;
    return (
      <CustomTag className={`${className} ${lang === 'ar' ? 'font-arabic' : ''}`} {...(lang === 'ar' ? { dir: 'rtl' } : {})}>
        {text}
      </CustomTag>
    );
  }

  return (
    <span className={`${className} ${lang === 'ar' ? 'font-arabic' : ''}`} {...(lang === 'ar' ? { dir: 'rtl' } : {})}>
      {text}
    </span>
  );
}

/**
 * Inline bilingual — renders text in the current language.
 * For buttons, short labels, and inline usage.
 */
export function BiInline({
  en,
  className = '',
}: {
  en: string;
  className?: string;
}) {
  const { lang } = useLang();
  const text = translateText(en, lang);

  return (
    <span className={`${className} ${lang === 'ar' ? 'font-arabic' : ''}`} {...(lang === 'ar' ? { dir: 'rtl' } : {})}>
      {text}
    </span>
  );
}

