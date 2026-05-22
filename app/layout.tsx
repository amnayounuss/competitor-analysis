import './globals.css';
import type { Metadata } from 'next';
import { Outfit, Plus_Jakarta_Sans, Noto_Sans_Arabic } from 'next/font/google';
import { LangProvider } from '@/lib/lang-context';

const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit' });
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta' });
const notoArabic = Noto_Sans_Arabic({ subsets: ['arabic'], variable: '--font-arabic', weight: ['400', '500', '600', '700'] });

export const metadata: Metadata = {
  title: 'Reviews Analytics | تحليلات المراجعات',
  description: 'Multi-tenant Google Reviews competitor analysis | تحليل مراجعات جوجل التنافسي',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${outfit.variable} ${jakarta.variable} ${notoArabic.variable}`}>
      <body className="bg-[#FBFBFE] text-slate-900 font-sans antialiased selection:bg-indigo-100 selection:text-indigo-900">
        <LangProvider>
          <div className="fixed inset-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-indigo-50/20 via-transparent to-transparent pointer-events-none" />
          <div className="relative z-10">{children}</div>
        </LangProvider>
      </body>
    </html>
  );
}
