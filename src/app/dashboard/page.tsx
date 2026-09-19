'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { DashboardBody } from '@/components/DashboardBody';
import { Empty } from '@/components/ui';
import { getTheme, setTheme, type Theme } from '@/lib/theme';

export default function PublicDashboardPage() {
  return (
    <Suspense fallback={<Empty>Memuat…</Empty>}>
      <PublicDashboard />
    </Suspense>
  );
}

/** Dashboard baca-saja tanpa login. Kunci opsional lewat ?key= (PUBLIC_TV_TOKEN). */
function PublicDashboard() {
  const params = useSearchParams();
  const key = params.get('key');
  const [theme, setThemeState] = useState<Theme>('morning');
  useEffect(() => { setThemeState(getTheme()); }, []);

  function toggle() {
    const next: Theme = theme === 'morning' ? 'evening' : 'morning';
    setThemeState(next); setTheme(next);
  }

  return (
    <div className="pub-root">
      <header className="pub-top">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="side-logo" aria-hidden="true">D</span>
          <span className="truncate text-[15px] font-semibold">IEG DOI Monitor</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-sm" onClick={toggle} aria-label="Ganti tema">
            {theme === 'morning' ? '☾ Evening' : '☀ Morning'}
          </button>
          <a className="btn btn-sm btn-primary" href="/login">Masuk</a>
        </div>
      </header>
      <main className="pub-main">
        <div className="pub-page">
          <DashboardBody apiUrl={`/api/public/dashboard${key ? `?key=${encodeURIComponent(key)}` : ''}`} readOnly />
        </div>
      </main>
    </div>
  );
}
