'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getTheme, setTheme, type Theme } from '@/lib/theme';

/**
 * Shell IEG v3.0 (§7–§8 design-ocs.md): grid satu penggulir (.app-main),
 * sidebar satu komponen tiga mode — Drawer (<768) · Rail (768–1279) · Expanded (≥1280,
 * boleh diciutkan & disimpan) — tombol tema Morning/Evening di topbar.
 */
type Item = { href: string; label: string; module: string; icon: keyof typeof ICONS; admin?: boolean; group: string; hidden?: boolean };
const LINKS: Item[] = [
  { href: '/', label: 'Dashboard', module: 'Ringkasan', icon: 'home', group: 'Monitoring' },
  { href: '/monitoring', label: 'Tabel DOI', module: 'Perhitungan', icon: 'table', group: 'Monitoring' },
  { href: '/stockout', label: 'Analisis Stok Kosong', module: 'Perhitungan', icon: 'empty', group: 'Monitoring' },
  { href: '/transit', label: 'Stok Dalam Perjalanan', module: 'Master Data', icon: 'truck', group: 'Master data' },
  { href: '/sku-master', label: 'Lead Time & SKU', module: 'Master Data', icon: 'clock', group: 'Master data' },
  { href: '/phase-out', label: 'Phase Out', module: 'Master Data', icon: 'sunset', group: 'Master data' },
  { href: '/sales', label: 'Data Penjualan', module: 'Data Sumber', icon: 'chart', group: 'Data' },
  { href: '/settings', label: 'Pengaturan', module: 'Sistem', icon: 'cog', admin: true, group: 'Sistem' },
  { href: '/users', label: 'Pengguna', module: 'Sistem', icon: 'users', admin: true, group: 'Sistem' },
  { href: '/account', label: 'Akun Saya', module: 'Sistem', icon: 'user', group: 'Sistem' },
  // Halaman anak — tidak tampil di menu, tapi judul topbar tetap benar.
  { href: '/sku', label: 'Analisis SKU', module: 'Perhitungan', icon: 'chart', group: 'Monitoring', hidden: true },
];

const ICONS = {
  home: 'M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  table: 'M3 5h18v14H3zM3 10h18M3 15h18M9 5v14M15 5v14',
  truck: 'M3 7h11v8H3zM14 10h4l3 3v2h-7zM7 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM17 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  cog: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  sunset: 'M17 18a5 5 0 0 0-10 0M12 2v4M4.9 8.9 7 11M2 18h2M20 18h2M17 11l2.1-2.1M2 22h20M16 5l-4 4-4-4',
  empty: 'M3 7h18v13H3zM3 12h18M12 3v2M8.5 16h7',
};
const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

type Me = { username: string; name: string; role: string };
const SIDE_KEY = 'ieg-side'; // 'expanded' | 'rail' — hanya berlaku ≥1280px

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const bare = path === '/login' || path === '/tv' || path === '/dashboard';

  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [wide, setWide] = useState(true);   // ≥1280: Expanded/Rail bebas
  const [narrow, setNarrow] = useState(false); // <768: Drawer
  const [theme, setThemeState] = useState<Theme>('morning');
  const [me, setMe] = useState<Me | null>(null);
  const [fly, setFly] = useState<{ label: string; top: number; left: number } | null>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const sideRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  // tema & keadaan ciut (hanya ≥1280) dari localStorage
  useEffect(() => {
    setThemeState(getTheme());
    try { setCollapsed(localStorage.getItem(SIDE_KEY) === 'rail'); } catch { /* ignore */ }
    const mqW = matchMedia('(min-width: 1280px)'); const mqN = matchMedia('(max-width: 767.98px)');
    const sync = () => { setWide(mqW.matches); setNarrow(mqN.matches); };
    sync(); mqW.addEventListener('change', sync); mqN.addEventListener('change', sync);
    return () => { mqW.removeEventListener('change', sync); mqN.removeEventListener('change', sync); };
  }, []);

  useEffect(() => {
    if (bare) return;
    fetch('/api/auth/me').then((r) => r.json()).then((j) => setMe(j.user ?? null)).catch(() => {});
  }, [bare, path]);

  // drawer: kunci gulir + jebak fokus + ESC + tutup saat layar melebar
  const openDrawer = useCallback((open: boolean) => {
    setDrawer(open);
    const main = mainRef.current;
    if (main) { main.style.overflowY = open ? 'hidden' : 'auto'; (main as HTMLElement & { inert: boolean }).inert = open; }
    if (open) setTimeout(() => sideRef.current?.querySelector<HTMLElement>('a,button')?.focus(), 30);
    else burgerRef.current?.focus();
  }, []);
  useEffect(() => {
    const mq = matchMedia('(min-width: 768px)');
    const onChange = (e: MediaQueryListEvent) => { if (e.matches) openDrawer(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') openDrawer(false); };
    mq.addEventListener('change', onChange);
    document.addEventListener('keydown', onKey);
    return () => { mq.removeEventListener('change', onChange); document.removeEventListener('keydown', onKey); };
  }, [openDrawer]);
  useEffect(() => { if (drawer) openDrawer(false); }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleTheme() {
    const next: Theme = theme === 'evening' ? 'morning' : 'evening';
    setTheme(next); setThemeState(next);
  }
  function toggleCollapsed() {
    setFly(null);
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(SIDE_KEY, next ? 'rail' : 'expanded'); } catch { /* ignore */ }
  }
  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  if (bare) return <>{children}</>;

  const current = LINKS.find((l) => (l.href === '/' ? path === '/' : path.startsWith(l.href)));
  const visible = LINKS.filter((l) => !l.hidden && (!l.admin || me?.role === 'ADMIN'));
  const groups = [...new Set(visible.map((l) => l.group))];
  // Mode sidebar: Drawer (<768, tampil penuh di dalam drawer) · Rail (768–1279 selalu, atau diciutkan di ≥1280) · Expanded
  const mode: 'expanded' | 'rail' = narrow ? 'expanded' : !wide ? 'rail' : collapsed ? 'rail' : 'expanded';

  // Tooltip nama menu saat rail — dipasang fixed di luar .side-nav agar tidak terpotong.
  const showFly = (el: HTMLElement, label: string) => {
    if (mode !== 'rail') return;
    const r = el.getBoundingClientRect();
    const side = sideRef.current?.getBoundingClientRect();
    setFly({ label, top: Math.round(r.top + r.height / 2), left: Math.round(Math.max(r.right, side?.right ?? 0) + 8) });
  };
  const hideFly = () => setFly(null);

  return (
    <div className="app-shell" data-drawer={drawer ? 'open' : 'closed'}>
      <nav ref={sideRef} id="side" className="app-side" data-mode={mode} aria-label="Menu utama" role={drawer ? 'dialog' : undefined} aria-modal={drawer ? true : undefined}>
        <div className="side-head">
          <div className="side-logo" aria-hidden="true">D</div>
          <div className="side-brand">IEG DOI Monitor</div>
          <button className="ml-auto rounded-lg p-2 text-label hover:bg-hover md:hidden" onClick={() => openDrawer(false)} aria-label="Tutup menu">✕</button>
        </div>
        <div className="side-nav" onScroll={hideFly}>
          {groups.map((g, gi) => (
            <div key={g}>
              {gi > 0 ? <span className="side-sep" aria-hidden="true" /> : null}
              <div className="side-group">{g}</div>
              {visible.filter((l) => l.group === g).map((l) => {
                const active = l.href === '/' ? path === '/' : path.startsWith(l.href);
                return (
                  <Link key={l.href} href={l.href} className={`nav-item ${active ? 'is-active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                    title={mode === 'rail' ? l.label : undefined}
                    onMouseEnter={(e) => showFly(e.currentTarget, l.label)}
                    onFocus={(e) => showFly(e.currentTarget, l.label)}
                    onTouchStart={(e) => showFly(e.currentTarget, l.label)}
                    onMouseLeave={hideFly} onBlur={hideFly} onClick={hideFly}>
                    <span className="nav-mark" aria-hidden="true" />
                    <Icon d={ICONS[l.icon]} />
                    <span className="lbl">{l.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
        <div className="side-foot">
          <span className="side-foot-text">© 2026 IEG · v1.1</span>
          <button className="collapse-btn" onClick={toggleCollapsed} disabled={!wide} aria-label={collapsed ? 'Lebarkan menu' : 'Ciutkan menu'} title={!wide ? 'Rail otomatis di layar ini' : collapsed ? 'Lebarkan menu' : 'Ciutkan menu'}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={collapsed ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'} />
            </svg>
          </button>
        </div>
      </nav>
      {fly ? <div className="nav-fly" role="tooltip" style={{ top: fly.top, left: fly.left }}>{fly.label}</div> : null}
      <div className="backdrop" onClick={() => openDrawer(false)} aria-hidden="true" />

      <header className="app-top">
        <button ref={burgerRef} className="burger h-12 w-12 items-center justify-center rounded-lg text-[20px] text-primary hover:bg-primary-subtle" onClick={() => openDrawer(true)} aria-expanded={drawer} aria-controls="side" aria-label="Buka menu">☰</button>
        <span className="hidden h-4 w-[3px] rounded md:inline-block" style={{ background: 'var(--grad-brand)' }} />
        <span className="truncate text-[15px] font-semibold text-ink md:text-[16px]">{current?.module ?? 'DOI Monitor'}</span>
        <span className="hidden text-[13px] text-label sm:inline">/ {current?.label ?? ''}</span>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <a className="btn btn-sm hidden lg:inline-flex" href="/tv" target="_blank" rel="noreferrer">Dashboard TV</a>
          <button className="btn btn-sm" onClick={toggleTheme} aria-label={theme === 'evening' ? 'Ganti ke tema Morning' : 'Ganti ke tema Evening'} title={theme === 'evening' ? 'Morning (terang)' : 'Evening (gelap)'}>
            {theme === 'evening' ? '☀' : '☾'}<span className="hidden md:inline">{theme === 'evening' ? 'Morning' : 'Evening'}</span>
          </button>
          {me ? <span className="hidden text-[12.5px] text-label lg:inline">{me.name} · {me.role === 'ADMIN' ? 'Admin' : me.role === 'USER' ? 'User' : 'Lihat saja'}</span> : null}
          <button className="btn btn-sm" onClick={logout}>Keluar</button>
        </div>
      </header>

      <main ref={mainRef} id="main" className="app-main">
        <div className="page">{children}</div>
      </main>
    </div>
  );
}
