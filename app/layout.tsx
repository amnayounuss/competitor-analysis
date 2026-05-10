import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Anoosh Analysis',
  description: 'Multi-tenant Google Reviews competitor analysis',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  );
}
