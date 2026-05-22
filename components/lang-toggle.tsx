'use client';

import { useLang } from '@/lib/lang-context';

export default function LangToggle() {
  const { lang, toggle } = useLang();
  const isArabic = lang === 'ar';

  return (
    <button
      onClick={toggle}
      dir="ltr"
      className="group relative flex items-center gap-2.5 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 transition-all duration-300 select-none active:scale-95"
      title={isArabic ? 'Switch to English' : 'التبديل إلى العربية'}
    >
      {/* Globe icon */}
      <svg className="w-4 h-4 text-slate-400 group-hover:text-indigo-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
      </svg>

      {/* Toggle track */}
      <div className={`relative w-10 h-5 rounded-full transition-colors duration-300 ${isArabic ? 'bg-indigo-600' : 'bg-slate-300'}`}>
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-300 ${isArabic ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </div>

      {/* Language labels */}
      <div className="flex items-center gap-1">
        <span className={`text-[10px] font-bold uppercase tracking-wider transition-colors ${!isArabic ? 'text-indigo-600' : 'text-slate-400'}`}>
          EN
        </span>
        <span className="text-slate-300 text-[10px]">/</span>
        <span className={`text-[10px] font-bold transition-colors font-arabic ${isArabic ? 'text-indigo-600' : 'text-slate-400'}`}>
          عربي
        </span>
      </div>
    </button>
  );
}
