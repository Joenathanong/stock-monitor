'use client';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { HealthSummary, ProductStatus } from '@/lib/doi';
import type { DoiSettings } from '@/lib/settings';
import { getTheme, setTheme, type Theme } from '@/lib/theme';

/**
 * Dashboard TV — layar penuh, tanpa login, berganti slide otomatis.
 * Data dari /api/public/tv. Tombol: ← → ganti slide, spasi jeda, F layar penuh.
 * Parameter URL: ?slide=15 (detik) &rows=12 (baris/slide) &key=<PUBLIC_TV_TOKEN>.
 */

type Row = {
  sku: string; name: string; abc: 'A' | 'B' | 'C'; stock: number; transit: number;
  ads1: number; ads2: number; doi1: number | null; doi2: number | null; refDoi: number | null; refDoiT: number | null;
  lt: number; sug: number; status: ProductStatus; action: string; isNpl: boolean; age: number | null; first: string | null; sales90: number;
};
type Resp = {
  ok: boolean; error?: string; snapshotDate: string | null; computedAt: string | null; summary: HealthSummary | null; settings: DoiSettings | null;
  tv: { slideSeconds: number; rowsPerSlide: number; refreshMinutes: number }; rows: Row[];
};

const STATUS_TEXT: Record<string, string> = {
  CRITICAL: 'Kritis', LOW: 'Low Stock', WAITING: 'Tunggu Kiriman', HEALTHY: 'Aman', OVERSTOCK: 'Overstock',
  DEAD_STOCK: 'Dead Stock', NO_SALES: 'Belum Terjual', NPL_WAIT: 'NPL', EXCLUDED: 'Dikecualikan',
};
const STATUS_COLOR: Record<string, string> = {
  CRITICAL: 'var(--negative-solid)', LOW: 'var(--critical-solid)', WAITING: 'var(--informative-solid)', HEALTHY: 'var(--positive-solid)',
  OVERSTOCK: 'var(--accent-violet)', NPL_WAIT: 'var(--primary)', DEAD_STOCK: 'var(--neutral-solid)', NO_SALES: 'var(--neutral-border)', EXCLUDED: 'var(--border-strong)',
};
const STATUS_CHIP: Record<string, { fg: string; bg: string; bd: string }> = {
  CRITICAL: { fg: 'var(--negative)', bg: 'var(--negative-bg)', bd: 'var(--negative-border)' },
  LOW: { fg: 'var(--critical)', bg: 'var(--critical-bg)', bd: 'var(--critical-border)' },
  WAITING: { fg: 'var(--informative)', bg: 'var(--informative-bg)', bd: 'var(--informative-border)' },
  HEALTHY: { fg: 'var(--positive)', bg: 'var(--positive-bg)', bd: 'var(--positive-border)' },
  OVERSTOCK: { fg: 'var(--violet-fg)', bg: 'var(--violet-bg)', bd: 'var(--violet-border)' },
  NPL_WAIT: { fg: 'var(--primary-subtle-fg)', bg: 'var(--primary-subtle)', bd: 'var(--primary-border)' },
  DEAD_STOCK: { fg: 'var(--neutral)', bg: 'var(--neutral-bg)', bd: 'var(--neutral-border)' },
  NO_SALES: { fg: 'var(--neutral)', bg: 'var(--neutral-bg)', bd: 'var(--neutral-border)' },
  EXCLUDED: { fg: 'var(--neutral)', bg: 'var(--neutral-bg)', bd: 'var(--neutral-border)' },
};
const ORDER: ProductStatus[] = ['CRITICAL', 'LOW', 'WAITING', 'HEALTHY', 'OVERSTOCK', 'NPL_WAIT', 'DEAD_STOCK', 'NO_SALES', 'EXCLUDED'];

const nf = (n: number | null | undefined, d = 0) =>
  n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
const doi = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n >= 100 ? nf(n, 0) : nf(n, 1));
const timeWib = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' WIB' : '—';

type Slide = { key: string; title: string; subtitle?: string; render: () => React.ReactNode };

export default function TvPage() {
  return <Suspense><Tv /></Suspense>;
}

function Tv() {
  const params = useSearchParams();
  const key = params.get('key');
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [tick, setTick] = useState(0);
  const [clock, setClock] = useState('');
  const [theme, setThemeState] = useState<Theme>('morning');
  useEffect(() => {
    const q = params.get('theme');
    if (q === 'morning' || q === 'evening') setTheme(q);
    setThemeState(getTheme());
  }, [params]);
  function toggleTheme() { const n: Theme = theme === 'evening' ? 'morning' : 'evening'; setTheme(n); setThemeState(n); }

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/public/tv${key ? `?key=${encodeURIComponent(key)}` : ''}`, { cache: 'no-store' });
      const j = (await r.json()) as Resp;
      if (!r.ok || j.ok === false) { setError(j.error || `HTTP ${r.status}`); return; }
      setData(j); setError(null);
    } catch (e) { setError(String(e)); }
  }, [key]);

  useEffect(() => { load(); }, [load]);

  const slideSeconds = Number(params.get('slide')) || data?.tv.slideSeconds || 15;
  const rowsPerSlide = Number(params.get('rows')) || data?.tv.rowsPerSlide || 12;
  const refreshMinutes = data?.tv.refreshMinutes || 5;

  // muat ulang data berkala
  useEffect(() => {
    const t = setInterval(load, Math.max(1, refreshMinutes) * 60_000);
    return () => clearInterval(t);
  }, [load, refreshMinutes]);

  // jam
  useEffect(() => {
    const f = () => setClock(new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    f(); const t = setInterval(f, 1000); return () => clearInterval(t);
  }, []);

  const slides = useMemo<Slide[]>(() => {
    if (!data?.summary) return [];
    const s = data.summary;
    const set = data.settings;
    const rows = data.rows;
    const out: Slide[] = [];

    out.push({
      key: 'ringkasan', title: 'Ringkasan DOI', subtitle: `Area ${set?.areaScope ?? ''} · ${nf(s.total.skuCount)} SKU`,
      render: () => (
        <div className="grid h-full grid-rows-[auto_1fr] gap-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6 xl:gap-4">
            <Kpi label="DOI total — Opsi 1" value={`${doi(s.total.doi1)}`} unit="hari" hint="3 bln ex campaign" />
            <Kpi label="DOI total — Opsi 2" value={`${doi(s.total.doi2)}`} unit="hari" hint="max 8w / 4w / 2w" />
            <Kpi label="Total stok" value={nf(s.total.stock)} unit="pcs" hint={`+ ${nf(s.total.transit)} transit`} />
            <Kpi label="Perlu open PO" value={nf(s.byStatus.CRITICAL + s.byStatus.LOW)} unit="SKU" hint={`${nf(s.byStatus.CRITICAL)} kritis · ${nf(s.byStatus.LOW)} low`} tone="var(--negative)" />
            <Kpi label="Overstock" value={nf(s.byStatus.OVERSTOCK)} unit="SKU" hint={`> ${set?.targetDoiDays ?? 14} hari`} tone="var(--accent-violet)" />
            <Kpi label="Produk baru" value={nf(s.npl)} unit="SKU" hint={`${nf(s.byStatus.NPL_WAIT)} data belum cukup`} tone="var(--primary)" />
          </div>
          <div className="grid min-h-0 grid-cols-1 gap-3 overflow-y-auto md:grid-cols-2 xl:grid-cols-3 xl:gap-4 xl:overflow-visible">
            <Panel title="Status SKU">
              <Bars items={ORDER.map((k) => ({ label: STATUS_TEXT[k], value: s.byStatus[k], color: STATUS_COLOR[k] }))} />
            </Panel>
            <Panel title="Distribusi DOI">
              <Bars items={s.buckets.map((b) => ({ label: b.label, value: b.count, color: 'var(--c1)' }))} />
              <div className="mt-4 text-[15px] text-label">Target DOI {set?.targetDoiDays} hari · safety {set?.safetyDays} hari · lead time default {set?.defaultLeadTimeDays} hari</div>
            </Panel>
            <Panel title="Analisis ABC (qty 3 bulan)">
              <table className="tv-table">
                <thead><tr><th>Kelas</th><th className="num">SKU</th><th className="num">Pangsa</th><th className="num">Stok</th><th className="num">DOI 1</th><th className="num">DOI 2</th></tr></thead>
                <tbody>
                  {(['A', 'B', 'C'] as const).map((c) => {
                    const k = s.byAbc[c]; const tot = s.byAbc.A.sales + s.byAbc.B.sales + s.byAbc.C.sales;
                    return <tr key={c}><td><Abc cls={c} /></td><td className="num">{nf(k.count)}</td><td className="num">{tot ? nf((k.sales / tot) * 100, 1) : 0}%</td><td className="num">{nf(k.stock)}</td><td className="num">{doi(k.total.doi1)}</td><td className="num">{doi(k.total.doi2)}</td></tr>;
                  })}
                </tbody>
              </table>
              <div className="mt-5 mb-2 text-[17px] font-semibold text-ink">Penjualan tertinggi 3 bulan</div>
              <div className="space-y-2">
                {[...rows].sort((a, b) => b.sales90 - a.sales90).slice(0, 8).map((r, i) => (
                  <div key={r.sku} className="grid grid-cols-[28px_1fr_auto_auto] items-center gap-3 text-[16px]">
                    <span className="text-muted">{i + 1}.</span>
                    <span className="truncate font-medium">{r.sku}</span>
                    <span className="tabular-nums text-label">{nf(r.sales90)} pcs</span>
                    <Chip status={r.status} />
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </div>
      ),
    });

    const po = rows.filter((r) => r.status === 'CRITICAL' || r.status === 'LOW').sort((a, b) => (a.refDoiT ?? 0) - (b.refDoiT ?? 0) || b.sales90 - a.sales90);
    const poPages = Math.max(1, Math.ceil(po.length / rowsPerSlide));
    for (let p = 0; p < poPages; p++) {
      const part = po.slice(p * rowsPerSlide, (p + 1) * rowsPerSlide);
      out.push({
        key: `po-${p}`, title: 'Prioritas Open PO', subtitle: `${nf(po.length)} SKU kritis / low stock${poPages > 1 ? ` · halaman ${p + 1}/${poPages}` : ''}`,
        render: () => part.length ? (
          <table className="tv-table">
            <thead><tr><th>SKU</th><th>ABC</th><th className="num">Stok</th><th className="num">Transit</th><th className="num">ADS</th><th className="num">DOI</th><th className="num">DOI+T</th><th className="num">LT</th><th className="num">Saran Qty</th><th>Status</th></tr></thead>
            <tbody>{part.map((r) => (
              <tr key={r.sku}>
                <td><div className="font-semibold">{r.sku}</div><div className="truncate text-[14px] text-label" style={{ maxWidth: 520 }}>{r.name}</div></td>
                <td><Abc cls={r.abc} /></td>
                <td className="num">{nf(r.stock)}</td><td className="num">{r.transit ? nf(r.transit) : '—'}</td>
                <td className="num">{nf(Math.max(r.ads1, r.ads2), 1)}</td>
                <td className="num font-bold">{doi(r.refDoi)}</td><td className="num">{doi(r.refDoiT)}</td>
                <td className="num">{r.lt}</td><td className="num font-bold">{nf(r.sug)}</td>
                <td><Chip status={r.status} /></td>
              </tr>))}</tbody>
          </table>
        ) : <Empty>Tidak ada SKU yang perlu open PO.</Empty>,
      });
    }

    const over = rows.filter((r) => r.status === 'OVERSTOCK').sort((a, b) => b.stock - a.stock).slice(0, rowsPerSlide);
    out.push({
      key: 'overstock', title: 'Overstock Terbesar', subtitle: `${nf(s.byStatus.OVERSTOCK)} SKU di atas ${set?.targetDoiDays ?? 14} hari`,
      render: () => over.length ? (
        <table className="tv-table">
          <thead><tr><th>SKU</th><th>ABC</th><th className="num">Stok</th><th className="num">ADS 1</th><th className="num">ADS 2</th><th className="num">DOI 1</th><th className="num">DOI 2</th><th className="num">Penjualan 3 bln</th></tr></thead>
          <tbody>{over.map((r) => (
            <tr key={r.sku}>
              <td><div className="font-semibold">{r.sku}</div><div className="truncate text-[14px] text-label" style={{ maxWidth: 520 }}>{r.name}</div></td>
              <td><Abc cls={r.abc} /></td>
              <td className="num font-bold">{nf(r.stock)}</td><td className="num">{nf(r.ads1, 1)}</td><td className="num">{nf(r.ads2, 1)}</td>
              <td className="num">{doi(r.doi1)}</td><td className="num">{doi(r.doi2)}</td><td className="num">{nf(r.sales90)}</td>
            </tr>))}</tbody>
        </table>
      ) : <Empty>Tidak ada overstock.</Empty>,
    });

    const npl = rows.filter((r) => r.isNpl).sort((a, b) => (a.age ?? 0) - (b.age ?? 0)).slice(0, rowsPerSlide);
    if (npl.length) {
      out.push({
        key: 'npl', title: 'Produk Baru (NPL)', subtitle: `${nf(s.npl)} SKU berumur jual < ${set?.nplDays ?? 90} hari`,
        render: () => (
          <table className="tv-table">
            <thead><tr><th>SKU</th><th>Jual pertama</th><th className="num">Umur</th><th className="num">Stok</th><th className="num">ADS 1</th><th className="num">ADS 2</th><th className="num">DOI</th><th>Status</th></tr></thead>
            <tbody>{npl.map((r) => (
              <tr key={r.sku}>
                <td><div className="font-semibold">{r.sku}</div><div className="truncate text-[14px] text-label" style={{ maxWidth: 520 }}>{r.name}</div></td>
                <td>{r.first}</td><td className="num">{r.age} hr</td><td className="num">{nf(r.stock)}</td>
                <td className="num">{nf(r.ads1, 1)}</td><td className="num">{nf(r.ads2, 1)}</td><td className="num font-bold">{doi(r.refDoi)}</td>
                <td><Chip status={r.status} /></td>
              </tr>))}</tbody>
          </table>
        ),
      });
    }

    const dead = rows.filter((r) => r.status === 'DEAD_STOCK').sort((a, b) => b.stock - a.stock).slice(0, rowsPerSlide);
    if (dead.length) {
      out.push({
        key: 'dead', title: 'Dead Stock', subtitle: `${nf(s.byStatus.DEAD_STOCK)} SKU tanpa penjualan ${set?.deadStockWindowDays ?? 90} hari`,
        render: () => (
          <table className="tv-table">
            <thead><tr><th>SKU</th><th>ABC</th><th className="num">Stok</th><th>Jual terakhir diketahui</th><th>Saran</th></tr></thead>
            <tbody>{dead.map((r) => (
              <tr key={r.sku}>
                <td><div className="font-semibold">{r.sku}</div><div className="truncate text-[14px] text-label" style={{ maxWidth: 520 }}>{r.name}</div></td>
                <td><Abc cls={r.abc} /></td><td className="num font-bold">{nf(r.stock)}</td><td>—</td><td>{r.action}</td>
              </tr>))}</tbody>
          </table>
        ),
      });
    }
    return out;
  }, [data, rowsPerSlide]);

  // rotasi otomatis
  useEffect(() => {
    if (paused || slides.length <= 1) return;
    const t = setInterval(() => { setIdx((i) => (i + 1) % slides.length); setTick((x) => x + 1); }, slideSeconds * 1000);
    return () => clearInterval(t);
  }, [paused, slides.length, slideSeconds]);

  // keyboard
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') { setIdx((i) => (i + 1) % Math.max(1, slides.length)); setTick((x) => x + 1); }
      else if (e.key === 'ArrowLeft') { setIdx((i) => (i - 1 + slides.length) % Math.max(1, slides.length)); setTick((x) => x + 1); }
      else if (e.key === ' ') { e.preventDefault(); setPaused((p) => !p); }
      else if (e.key.toLowerCase() === 'f') toggleFullscreen();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [slides.length]);

  const safeIdx = slides.length ? idx % slides.length : 0;
  const slide = slides[safeIdx];

  return (
    <div className="tv-root">
      <style>{TV_CSS}</style>
      <header className="tv-head">
        <div className="flex items-center gap-4">
          <span className="tv-accent" />
          <div>
            <div className="text-[22px] font-bold leading-tight text-ink md:text-[28px]">{slide?.title ?? 'IEG DOI Monitor'}</div>
            <div className="text-[15px] text-label">{slide?.subtitle ?? ''}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[26px] font-semibold tabular-nums text-ink">{clock}</div>
          <div className="text-[14px] text-label">
            {data?.computedAt ? <>Snapshot {data.snapshotDate} · dihitung {timeWib(data.computedAt)}</> : 'Belum ada snapshot'}
            {paused ? ' · JEDA' : ''}
          </div>
        </div>
      </header>

      <main className="tv-main">
        {error ? <Empty>{error}</Empty> : !data ? <Empty>Memuat…</Empty> : !slide ? <Empty>Belum ada perhitungan. Jalankan Refresh dari aplikasi.</Empty> : (
          <div key={slide.key} className="tv-slide">{slide.render()}</div>
        )}
      </main>

      <footer className="tv-foot">
        <div className="flex items-center gap-2">
          {slides.map((s, i) => <button key={s.key} className={`tv-dot ${i === safeIdx ? 'is-active' : ''}`} onClick={() => { setIdx(i); setTick((x) => x + 1); }} aria-label={s.title} />)}
        </div>
        <div className="tv-progress"><div key={`${safeIdx}-${tick}`} className={`tv-progress-bar ${paused ? 'is-paused' : ''}`} style={{ animationDuration: `${slideSeconds}s` }} /></div>
        <div className="flex items-center gap-2 text-[13px] text-label">
          <button className="tv-btn" onClick={() => { setIdx((i) => (i - 1 + slides.length) % Math.max(1, slides.length)); setTick((x) => x + 1); }}>‹</button>
          <button className="tv-btn" onClick={() => setPaused((p) => !p)}>{paused ? 'Lanjut' : 'Jeda'}</button>
          <button className="tv-btn" onClick={() => { setIdx((i) => (i + 1) % Math.max(1, slides.length)); setTick((x) => x + 1); }}>›</button>
          <button className="tv-btn" onClick={toggleFullscreen}>Layar penuh</button>
          <button className="tv-btn" onClick={toggleTheme} aria-label="Ganti tema">{theme === 'evening' ? '☀ Morning' : '☾ Evening'}</button>
          <span className="ml-2 hidden lg:inline">{safeIdx + 1}/{slides.length} · {slideSeconds} dtk/slide · data tiap {refreshMinutes} mnt · IEG DOI Monitor</span>
        </div>
      </footer>
    </div>
  );
}

function toggleFullscreen() {
  if (typeof document === 'undefined') return;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
}

function Kpi({ label, value, unit, hint, tone }: { label: string; value: string; unit?: string; hint?: string; tone?: string }) {
  return (
    <div className="tv-card px-5 py-4">
      <div className="text-[15px] font-medium text-label">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-[44px] font-bold leading-none tabular-nums" style={{ color: tone ?? 'var(--ink)' }}>{value}</span>
        {unit ? <span className="text-[16px] text-label">{unit}</span> : null}
      </div>
      {hint ? <div className="mt-1 text-[14px] text-label">{hint}</div> : null}
    </div>
  );
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="tv-card flex min-h-0 flex-col p-5"><div className="mb-3 text-[19px] font-semibold text-ink">{title}</div><div className="min-h-0 flex-1">{children}</div></div>;
}
function Bars({ items }: { items: { label: string; value: number; color: string }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-4">
      {items.map((i) => (
        <div key={i.label} className="grid grid-cols-[170px_1fr_80px] items-center gap-3 text-[19px]">
          <div className="truncate text-label">{i.label}</div>
          <div className="h-6 rounded" style={{ background: 'var(--chart-track)' }}><div className="h-6 rounded" style={{ width: `${(i.value / max) * 100}%`, background: i.color }} /></div>
          <div className="text-right text-[22px] font-bold tabular-nums">{nf(i.value)}</div>
        </div>
      ))}
    </div>
  );
}
function Chip({ status }: { status: string }) {
  const c = STATUS_CHIP[status] ?? STATUS_CHIP.EXCLUDED;
  return <span className="tv-chip" style={{ color: c.fg, background: c.bg, borderColor: c.bd }}>{STATUS_TEXT[status] ?? status}</span>;
}
function Abc({ cls }: { cls: string }) {
  const c = cls === 'A' ? { color: 'var(--primary-subtle-fg)', bg: 'var(--primary-subtle)', bd: 'var(--primary-border)' } : cls === 'B' ? { color: 'var(--informative)', bg: 'var(--informative-bg)', bd: 'var(--informative-border)' } : { color: 'var(--neutral)', bg: 'var(--neutral-bg)', bd: 'var(--neutral-border)' };
  return <span className="tv-chip tv-chip-plain" style={{ color: c.color, background: c.bg, borderColor: c.bd, minWidth: 34, justifyContent: 'center' }}>{cls}</span>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center text-[22px] text-label">{children}</div>;
}

const TV_CSS = `
.tv-root{height:100vh;height:100dvh;display:flex;flex-direction:column;background:var(--bg-canvas);color:var(--ink);overflow:hidden}
.tv-head{display:flex;align-items:center;justify-content:space-between;height:88px;padding:0 32px;background:var(--bg-surface);border-bottom:1px solid var(--border);flex:none}
.tv-accent{display:inline-block;width:5px;height:34px;border-radius:3px;background:var(--grad-brand)}
.tv-main{flex:1;min-height:0;padding:20px 32px}
.tv-slide{height:100%;animation:tvFade .45s ease}
@keyframes tvFade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.tv-card{background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--r-md);box-shadow:var(--shadow-0)}
.tv-table{width:100%;border-collapse:separate;border-spacing:0;font-size:18px;background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--r-md);overflow:hidden;border-top:2px solid transparent;border-image:var(--grad-brand) 1}
.tv-table thead tr{background:var(--bg-surface-alt)}
.tv-table th{font-size:14px;font-weight:600;color:var(--ink-label);letter-spacing:.04em;text-transform:uppercase;text-align:left;padding:12px 16px;border-bottom:1px solid var(--border-strong);white-space:nowrap}
.tv-table td{padding:9px 16px;border-bottom:1px solid var(--border-subtle);white-space:nowrap}
.tv-table tbody tr:last-child td{border-bottom:0}
.tv-table .num{text-align:right;font-variant-numeric:tabular-nums}
.tv-chip{display:inline-flex;align-items:center;gap:7px;height:28px;padding:0 12px;border-radius:999px;font-size:14px;font-weight:600;border:1px solid;white-space:nowrap}
.tv-chip::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor;flex:none}
.tv-chip-plain::before{content:none}
.tv-foot{display:flex;align-items:center;gap:20px;height:56px;padding:0 32px;background:var(--bg-sunken);border-top:1px solid var(--border-subtle);flex:none;padding-bottom:env(safe-area-inset-bottom,0px)}
.tv-dot{width:10px;height:10px;border-radius:50%;background:var(--primary-border);border:0;cursor:pointer;padding:0}
.tv-dot.is-active{background:var(--primary);width:26px;border-radius:6px}
.tv-progress{flex:1;height:4px;border-radius:2px;background:var(--chart-track);overflow:hidden}
.tv-progress-bar{height:100%;width:0;background:var(--grad-brand);animation:tvGrow linear forwards}
.tv-progress-bar.is-paused{animation-play-state:paused}
@keyframes tvGrow{from{width:0}to{width:100%}}
.tv-btn{height:max(30px,var(--tap));padding:0 12px;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--bg-surface);color:var(--primary);font-size:13px;font-weight:500;cursor:pointer}
.tv-btn:hover{background:var(--primary-subtle)}
.tv-btn:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
@media (max-width:1023.98px){
  .tv-head{height:auto;min-height:64px;padding:8px 16px}
  .tv-main{padding:12px 16px}
  .tv-foot{padding:0 16px}
  .tv-table{font-size:15px}
  .tv-table th,.tv-table td{padding:8px 10px}
}
@media (max-width:767.98px){
  .tv-head > div:last-child{display:none}
  .tv-foot span{display:none}
}
`;
