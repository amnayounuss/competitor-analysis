import './globals.css';
import type { Metadata } from 'next';
import { Outfit, Plus_Jakarta_Sans, Noto_Sans_Arabic } from 'next/font/google';
import { cookies } from 'next/headers';
import { LangProvider } from '@/lib/lang-context';
import { LANG_COOKIE } from '@/lib/lang-cookie';

const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit' });
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta' });
const notoArabic = Noto_Sans_Arabic({ subsets: ['arabic'], variable: '--font-arabic', weight: ['400', '500', '600', '700'] });

export const metadata: Metadata = {
  title: 'Reviews Analytics | تحليلات المراجعات',
  description: 'Multi-tenant Google Reviews competitor analysis | تحليل مراجعات جوجل التنافسي',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Read here so the very first HTML is already in the right language and
  // direction; deriving it in the browser produced a hydration mismatch.
  const stored = cookies().get(LANG_COOKIE)?.value;
  const lang = stored === 'ar' ? 'ar' : 'en';

  return (
    <html lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'}
      className={`${outfit.variable} ${jakarta.variable} ${notoArabic.variable}${lang === 'ar' ? ' font-arabic' : ''}`}>
      <body className="bg-[#FBFBFE] text-slate-900 font-sans antialiased selection:bg-indigo-100 selection:text-indigo-900">
        <LangProvider initialLang={lang}>
          <div className="fixed inset-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-indigo-50/20 via-transparent to-transparent pointer-events-none" />
          <div className="relative z-10">{children}</div>
        </LangProvider>
      </body>
    </html>
  );
}
