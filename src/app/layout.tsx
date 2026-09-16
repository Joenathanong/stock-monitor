import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Shell } from '@/components/Shell';
import { THEME_BOOT_SCRIPT } from '@/lib/theme';

export const metadata: Metadata = {
  title: 'DOI Monitor — IEG',
  description: 'Perhitungan Days of Inventory otomatis dari OCS: dua opsi ADS, NPL, ABC, saran PO',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
