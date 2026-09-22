'use client';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { HealthSummary, ProductStatus } from '@/lib/doi';
import type { DoiSettings } from '@/lib/settings';
import { getTheme, setTheme, type Theme } from '@/lib/theme';
import { doiLabel, doiTotalLabel, opsi2Label, show1, show2, windowLabel } from '@/components/ui';

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
const ORDER: ProductStatus[] = ['CRITICAL', 'LOW', 'WAITING', 'HEALTHY', 'OVERSTOCK', 'NPL_WAIT', 'PHASE_OUT', 'DEAD_STOCK', 'NO_SALES', 'EXCLUDED'];

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

  const mainRef = useRef<HTMLElement>(null);
  const [fitRows, setFitRows] = useState(12);

  // Berapa baris yang benar-benar muat — .tv-root overflow:hidden, jadi kelebihan
  // baris terpotong dan tidak bisa digulir. Tinggi baris DIUKUR dari tabel yang
  // sedang tampil, bukan ditebak angka tetap: ukuran teks TV ikut besar layar,
  // jadi angka tetap pasti meleset di resolusi lain.
  useEffect(() => {
    const el = mainRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const avail = el.clientHeight;
      if (avail <= 0) return;
      const tr = el.querySelector('.tv-table tbody tr');
      const th = el.querySelector('.tv-table thead');
      const rem = parseFloat(getComputedStyle(el).fontSize) || 16;
      const rowH = tr ? tr.getBoundingClientRect().height : rem * 2.2;
      const chrome = (th ? th.getBoundingClientRect().height : rem * 2.4) + rem * 0.8;
      if (rowH <= 0) return;
      const fit = Math.max(3, Math.floor((avail - chrome) / rowH));
      setFitRows((prev) => (prev === fit ? prev : fit));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const t = setTimeout(measure, 250);   // ukur ulang setelah tabel benar-benar tergambar
    return () => { ro.disconnect(); clearTimeout(t); };
  }, [idx, data]);

  const slideSeconds = Number(params.get('slide')) || data?.tv.slideSeconds || 15;
  // Jumlah baris mengikuti tinggi layar supaya slide terisi penuh — layar 1080p
  // memuat jauh lebih banyak daripada 720p, dan memakai angka tetap menyisakan
  // ruang kosong besar di layar besar. ?rows=N memaksa angka tertentu.
  const forcedRows = Number(params.get('rows')) || 0;
  const rowsPerSlide = Math.max(3, forcedRows || fitRows);
  // Daftar di slide ringkasan ikut menyusut agar tidak terdorong keluar layar.
  const topSales = Math.max(3, Math.min(8, fitRows - 4));
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

  const disp = data?.settings?.doiDisplay ?? 'BOTH';
  const d1 = show1(disp), d2 = show2(disp);

  const slides = useMemo<Slide[]>(() => {
    if (!data?.summary) return [];
    const s = data.summary;
    const set = data.settings;
    // Keterangan jendela ikut Pengaturan, tidak ditulis mati.
    const win1 = windowLabel(set?.opsi1WindowDays);
    const win2 = opsi2Label(set?.opsi2W8Days, set?.opsi2W4Days, set?.opsi2W2Days);
    const rows = data.rows;
    const out: Slide[] = [];

    out.push({
      key: 'ringkasan', title: 'Ringkasan DOI', subtitle: `Area ${set?.areaScope ?? ''} · ${nf(s.total.skuCount)} SKU`,
      render: () => (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="tv-kpis">
            {d1 ? <Kpi label={doiTotalLabel(1, disp)} value={`${doi(s.total.doi1)}`} unit="hari" hint={`${win1} ex campaign`} /> : null}
            {d2 ? <Kpi label={doiTotalLabel(2, disp)} value={`${doi(s.total.doi2)}`} unit="hari" hint={win2} /> : null}
            <Kpi label="Total stok" value={nf(s.total.stock)} unit="pcs" hint={`+ ${nf(s.total.transit)} transit`} />
            <Kpi label="Perlu open PO" value={nf(s.byStatus.CRITICAL + s.byStatus.LOW)} unit="SKU" hint={`${nf(s.byStatus.CRITICAL)} kritis · ${nf(s.byStatus.LOW)} low`} tone="var(--negative)" />
            <Kpi label="Overstock" value={nf(s.byStatus.OVERSTOCK)} unit="SKU" hint={`> ${set?.targetDoiDays ?? 14} hari`} tone="var(--accent-violet)" />
            <Kpi label="Produk baru" value={nf(s.npl)} unit="SKU" hint={`${nf(s.byStatus.NPL_WAIT)} data belum cukup`} tone="var(--primary)" />
          </div>
          <div className="tv-panels min-h-0 flex-1">
            <Panel title="Status SKU">
              <Bars items={ORDER.map((k) => ({ label: STATUS_TEXT[k], value: s.byStatus[k] ?? 0, color: STATUS_COLOR[k] }))} />
            </Panel>
            <Panel title="Distribusi DOI">
              <Bars items={s.buckets.map((b) => ({ label: b.label, value: b.count, color: 'var(--c1)' }))} />
              <div className="mt-4 text-[15px] text-label">Target DOI {set?.targetDoiDays} hari · safety {set?.safetyDays} hari · lead time default {set?.defaultLeadTimeDays} hari</div>
            </Panel>
            <Panel title={`Analisis ABC (qty ${win1})`}>
              <div className="tv-tablewrap tv-tablewrap-mini"><table className="tv-table tv-table-mini">
                <thead><tr><th>Kelas</th><th className="num">SKU</th><th className="num">Pangsa</th><th className="num">Stok</th>{d1 ? <th className="num">{doiLabel('DOI', 1, disp)}</th> : null}{d2 ? <th className="num">{doiLabel('DOI', 2, disp)}</th> : null}</tr></thead>
                <tbody>
                  {(['A', 'B', 'C'] as const).map((c) => {
                    const k = s.byAbc[c]; const tot = s.byAbc.A.sales + s.byAbc.B.sales + s.byAbc.C.sales;
                    return <tr key={c}><td><Abc cls={c} /></td><td className="num">{nf(k.count)}</td><td className="num">{tot ? nf((k.sales / tot) * 100, 1) : 0}%</td><td className="num">{nf(k.stock)}</td>{d1 ? <td className="num">{doi(k.total.doi1)}</td> : null}{d2 ? <td className="num">{doi(k.total.doi2)}</td> : null}</tr>;
                  })}
                </tbody>
              </table></div>
              <div className="tv-list-title">Penjualan tertinggi {win1}</div>
              <div className="tv-list">
                {[...rows].sort((a, b) => b.sales90 - a.sales90).slice(0, topSales).map((r, i) => (
                  <div key={r.sku} className="tv-list-row">
                    <span className="tv-list-no">{i + 1}.</span>
                    <span className="tv-list-sku" title={r.name}>{r.sku}</span>
                    <span className="tv-list-val">{nf(r.sales90)} pcs</span>
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
          <div className="tv-tablewrap"><table className="tv-table">
            <thead><tr><th className="c-sku">SKU</th><th className="c-abc">ABC</th><th className="num">Stok</th><th className="num">Transit</th><th className="num">ADS</th><th className="num">DOI</th><th className="num">DOI+T</th><th className="num">LT</th><th className="num">Saran Qty</th><th className="c-status">Status</th></tr></thead>
            <tbody>{part.map((r) => (
              <tr key={r.sku}>
                <td className="sku" title={r.name}>{r.sku}</td>
                <td><Abc cls={r.abc} /></td>
                <td className="num">{nf(r.stock)}</td><td className="num">{r.transit ? nf(r.transit) : '—'}</td>
                <td className="num">{nf(Math.max(r.ads1, r.ads2), 1)}</td>
                <td className="num font-bold">{doi(r.refDoi)}</td><td className="num">{doi(r.refDoiT)}</td>
                <td className="num">{r.lt}</td><td className="num font-bold">{nf(r.sug)}</td>
                <td><Chip status={r.status} /></td>
              </tr>))}</tbody>
          </table></div>
        ) : <Empty>Tidak ada SKU yang perlu open PO.</Empty>,
      });
    }

    const over = rows.filter((r) => r.status === 'OVERSTOCK').sort((a, b) => b.stock - a.stock).slice(0, rowsPerSlide);
    out.push({
      key: 'overstock', title: 'Overstock Terbesar', subtitle: `${nf(s.byStatus.OVERSTOCK)} SKU di atas ${set?.targetDoiDays ?? 14} hari`,
      render: () => over.length ? (
        <div className="tv-tablewrap"><table className="tv-table">
          <thead><tr><th className="c-sku">SKU</th><th className="c-abc">ABC</th><th className="num">Stok</th>{d1 ? <th className="num">{doiLabel('ADS', 1, disp)}</th> : null}{d2 ? <th className="num">{doiLabel('ADS', 2, disp)}</th> : null}{d1 ? <th className="num">{doiLabel('DOI', 1, disp)}</th> : null}{d2 ? <th className="num">{doiLabel('DOI', 2, disp)}</th> : null}<th className="num">Penjualan {win1}</th></tr></thead>
          <tbody>{over.map((r) => (
            <tr key={r.sku}>
              <td className="sku" title={r.name}>{r.sku}</td>
              <td><Abc cls={r.abc} /></td>
              <td className="num font-bold">{nf(r.stock)}</td>{d1 ? <td className="num">{nf(r.ads1, 1)}</td> : null}{d2 ? <td className="num">{nf(r.ads2, 1)}</td> : null}
              {d1 ? <td className="num">{doi(r.doi1)}</td> : null}{d2 ? <td className="num">{doi(r.doi2)}</td> : null}<td className="num">{nf(r.sales90)}</td>
            </tr>))}</tbody>
        </table></div>
      ) : <Empty>Tidak ada overstock.</Empty>,
    });

    const npl = rows.filter((r) => r.isNpl).sort((a, b) => (a.age ?? 0) - (b.age ?? 0)).slice(0, rowsPerSlide);
    if (npl.length) {
      out.push({
        key: 'npl', title: 'Produk Baru (NPL)', subtitle: `${nf(s.npl)} SKU berumur jual < ${set?.nplDays ?? 90} hari`,
        render: () => (
          <div className="tv-tablewrap"><table className="tv-table">
            <thead><tr><th className="c-sku">SKU</th><th>Jual pertama</th><th className="num">Umur</th><th className="num">Stok</th>{d1 ? <th className="num">{doiLabel('ADS', 1, disp)}</th> : null}{d2 ? <th className="num">{doiLabel('ADS', 2, disp)}</th> : null}<th className="num">DOI</th><th className="c-status">Status</th></tr></thead>
            <tbody>{npl.map((r) => (
              <tr key={r.sku}>
                <td className="sku" title={r.name}>{r.sku}</td>
                <td>{r.first}</td><td className="num">{r.age} hr</td><td className="num">{nf(r.stock)}</td>
                {d1 ? <td className="num">{nf(r.ads1, 1)}</td> : null}{d2 ? <td className="num">{nf(r.ads2, 1)}</td> : null}<td className="num font-bold">{doi(r.refDoi)}</td>
                <td><Chip status={r.status} /></td>
              </tr>))}</tbody>
          </table></div>
        ),
      });
    }

    const dead = rows.filter((r) => r.status === 'DEAD_STOCK').sort((a, b) => b.stock - a.stock).slice(0, rowsPerSlide);
    if (dead.length) {
      out.push({
        key: 'dead', title: 'Dead Stock', subtitle: `${nf(s.byStatus.DEAD_STOCK)} SKU tanpa penjualan ${set?.deadStockWindowDays ?? 90} hari`,
        render: () => (
          <div className="tv-tablewrap"><table className="tv-table">
            <thead><tr><th className="c-sku">SKU</th><th className="c-abc">ABC</th><th className="num">Stok</th><th>Jual terakhir diketahui</th><th>Saran</th></tr></thead>
            <tbody>{dead.map((r) => (
              <tr key={r.sku}>
                <td className="sku" title={r.name}>{r.sku}</td>
                <td><Abc cls={r.abc} /></td><td className="num font-bold">{nf(r.stock)}</td><td>—</td><td>{r.action}</td>
              </tr>))}</tbody>
          </table></div>
        ),
      });
    }
    return out;
  }, [data, rowsPerSlide, topSales, disp, d1, d2]);

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
        <div className="flex min-w-0 items-center gap-3">
          <span className="tv-accent" />
          <div className="min-w-0">
            <div className="tv-title truncate">{slide?.title ?? 'IEG DOI Monitor'}</div>
            <div className="tv-sub truncate">{slide?.subtitle ?? ''}</div>
          </div>
        </div>
        <div className="min-w-0">
          <div className="tv-clock">{clock}</div>
          <div className="tv-sub truncate text-right">
            {data?.computedAt ? <>Snapshot {data.snapshotDate} · dihitung {timeWib(data.computedAt)}</> : 'Belum ada snapshot'}
            {paused ? ' · JEDA' : ''}
          </div>
        </div>
      </header>

      <main className="tv-main" ref={mainRef}>
        {error ? <Empty>{error}</Empty> : !data ? <Empty>Memuat…</Empty> : !slide ? <Empty>Belum ada perhitungan. Jalankan Refresh dari aplikasi.</Empty> : (
          <div key={slide.key} className="tv-slide">{slide.render()}</div>
        )}
      </main>

      <footer className="tv-foot">
        <div className="flex items-center gap-2">
          {slides.map((s, i) => <button key={s.key} className={`tv-dot ${i === safeIdx ? 'is-active' : ''}`} onClick={() => { setIdx(i); setTick((x) => x + 1); }} aria-label={s.title} />)}
        </div>
        <div className="tv-progress"><div key={`${safeIdx}-${tick}`} className={`tv-progress-bar ${paused ? 'is-paused' : ''}`} style={{ animationDuration: `${slideSeconds}s` }} /></div>
        <div className="flex min-w-0 items-center gap-2">
          <button className="tv-btn" onClick={() => { setIdx((i) => (i - 1 + slides.length) % Math.max(1, slides.length)); setTick((x) => x + 1); }} aria-label="Slide sebelumnya">‹</button>
          <button className="tv-btn" onClick={() => setPaused((p) => !p)}>{paused ? 'Lanjut' : 'Jeda'}</button>
          <button className="tv-btn" onClick={() => { setIdx((i) => (i + 1) % Math.max(1, slides.length)); setTick((x) => x + 1); }} aria-label="Slide berikutnya">›</button>
          <button className="tv-btn" onClick={toggleFullscreen}>Layar penuh</button>
          <button className="tv-btn" onClick={toggleTheme} aria-label="Ganti tema">{theme === 'evening' ? '☀ Morning' : '☾ Evening'}</button>
          <span className="tv-footnote ml-1">{safeIdx + 1}/{slides.length} · {slideSeconds} dtk/slide · data tiap {refreshMinutes} mnt</span>
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
    <div className="tv-card tv-kpi">
      <div className="tv-kpi-label">{label}</div>
      <div className="tv-kpi-value" style={{ color: tone ?? 'var(--ink)' }}>
        {value}{unit ? <span className="tv-kpi-unit">{unit}</span> : null}
      </div>
      {hint ? <div className="tv-kpi-hint" title={hint}>{hint}</div> : null}
    </div>
  );
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="tv-card tv-panel"><div className="tv-panel-title">{title}</div><div className="tv-panel-body">{children}</div></div>;
}
function Bars({ items }: { items: { label: string; value: number; color: string }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="tv-bars">
      {items.map((i) => (
        <div key={i.label} className="tv-bar-row">
          <div className="tv-bar-label">{i.label}</div>
          <div className="tv-bar-track"><div className="tv-bar-fill" style={{ width: `${(i.value / max) * 100}%`, background: i.color }} /></div>
          <div className="tv-bar-value">{nf(i.value)}</div>
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
/* Semua ukuran memakai em dari .tv-root, dan font-size root ikut layar.
   Satu angka yang berubah membuat seluruh slide ikut menyesuaikan — inilah yang
   membuat tampilan tetap rapi dari 1280x720 sampai layar 4K. */
.tv-root{
  font-size:clamp(11px, 0.52vw + 0.55vh, 24px);
  height:100vh;height:100dvh;display:flex;flex-direction:column;
  background:var(--bg-canvas);color:var(--ink);overflow:hidden;
}
.tv-head{display:flex;align-items:center;justify-content:space-between;gap:1em;
  min-height:3.6em;padding:.6em 1.6em;background:var(--bg-surface);border-bottom:1px solid var(--border);flex:none}
.tv-title{font-size:1.9em;font-weight:700;line-height:1.15;letter-spacing:-.01em}
.tv-sub{font-size:.95em;color:var(--ink-label);margin-top:.15em}
.tv-clock{font-size:1.9em;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.15;text-align:right}
.tv-accent{display:inline-block;width:.25em;height:1.7em;border-radius:.15em;background:var(--grad-brand);flex:none}
.tv-main{flex:1;min-height:0;padding:.9em 1.6em;display:flex;flex-direction:column}
.tv-slide{flex:1;min-height:0;display:flex;flex-direction:column;animation:tvFade .4s ease}
@keyframes tvFade{from{opacity:0;transform:translateY(.3em)}to{opacity:1;transform:none}}

.tv-card{background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--r-md);box-shadow:var(--shadow-0);min-width:0}

/* KPI: jumlah kolom ikut lebar layar, tidak dipatok enam. */
.tv-kpis{display:grid;gap:.7em;grid-template-columns:repeat(auto-fit,minmax(11em,1fr))}
.tv-kpi{padding:.7em .9em;min-width:0}
.tv-kpi-label{font-size:.92em;color:var(--ink-label);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tv-kpi-value{font-size:2.4em;font-weight:700;line-height:1.05;font-variant-numeric:tabular-nums;white-space:nowrap}
.tv-kpi-unit{font-size:.42em;font-weight:600;color:var(--ink-label);margin-left:.3em}
.tv-kpi-hint{font-size:.85em;color:var(--ink-label);margin-top:.2em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* Panel: melebar/menyempit sendiri, tidak dipatok tiga kolom. */
.tv-panels{display:grid;gap:.7em;min-height:0;grid-template-columns:repeat(auto-fit,minmax(20em,1fr))}
.tv-panel{display:flex;flex-direction:column;min-height:0;padding:.9em 1em}
.tv-panel-title{font-size:1.15em;font-weight:700;margin-bottom:.6em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tv-panel-body{flex:1;min-height:0;overflow:hidden}

/* Tabel: lebar kolom pasti, teks panjang dipotong rapi — bukan didorong keluar. */
.tv-tablewrap{flex:1;min-height:0;overflow:hidden;border:1px solid var(--border);border-radius:var(--r-md);
  border-top:2px solid transparent;border-image:var(--grad-brand) 1;background:var(--bg-surface)}
.tv-table{width:100%;table-layout:fixed;border-collapse:separate;border-spacing:0;font-size:1.02em}
.tv-table thead tr{background:var(--bg-surface-alt)}
.tv-table th{font-size:.78em;font-weight:700;color:var(--ink-label);letter-spacing:.05em;text-transform:uppercase;
  text-align:left;padding:.75em 1em;border-bottom:1px solid var(--border-strong);white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}
.tv-table td{padding:.5em 1em;border-bottom:1px solid var(--border-subtle);white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}
.tv-table tbody tr:last-child td{border-bottom:0}
/* Tabel kecil di dalam panel: lebar kolom mengikuti isi, bukan dibagi rata —
   kalau dipaksa rata, judul seperti "Pangsa" ikut terpotong di layar sempit. */
.tv-table-mini{table-layout:auto;font-size:.92em}
.tv-tablewrap-mini{flex:none;overflow:auto}
.tv-table-mini th,.tv-table-mini td{padding:.4em .55em}
.tv-table th.c-sku{width:24%}
.tv-table th.c-abc{width:5.5em}
.tv-table th.c-status{width:11.5em}
.tv-table td .tv-chip{max-width:100%}
.tv-table .num{text-align:right;font-variant-numeric:tabular-nums}
.tv-table .sku{font-weight:600}
.tv-table th.num{text-align:right}

.tv-chip{display:inline-flex;align-items:center;gap:.4em;padding:.15em .6em;border-radius:999px;
  font-size:.82em;font-weight:700;border:1px solid;white-space:nowrap;max-width:100%}
.tv-chip::before{content:"";width:.42em;height:.42em;border-radius:50%;background:currentColor;flex:none}
.tv-chip-plain::before{content:none}

.tv-list-title{font-size:1.05em;font-weight:700;margin:.9em 0 .45em}
.tv-list{display:flex;flex-direction:column;gap:.3em}
.tv-list-row{display:grid;grid-template-columns:1.6em minmax(0,1fr) auto auto;align-items:center;gap:.6em;font-size:.95em}
.tv-list-no{color:var(--ink-muted);font-variant-numeric:tabular-nums}
.tv-list-sku{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tv-list-val{color:var(--ink-label);font-variant-numeric:tabular-nums;white-space:nowrap}
.tv-bars{display:flex;flex-direction:column;gap:.55em}
.tv-bar-row{display:grid;grid-template-columns:minmax(5em,8em) 1fr minmax(2.5em,4em);align-items:center;gap:.6em;font-size:1em}
.tv-bar-label{color:var(--ink-label);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tv-bar-track{height:1.1em;border-radius:.3em;background:var(--chart-track);overflow:hidden}
.tv-bar-fill{height:100%;border-radius:.3em}
.tv-bar-value{text-align:right;font-size:1.05em;font-weight:700;font-variant-numeric:tabular-nums}

.tv-foot{display:flex;align-items:center;gap:1em;min-height:2.6em;padding:.3em 1.6em;background:var(--bg-sunken);
  border-top:1px solid var(--border-subtle);flex:none;padding-bottom:max(.3em,env(safe-area-inset-bottom,0px))}
.tv-dot{width:.55em;height:.55em;border-radius:50%;background:var(--primary-border);border:0;cursor:pointer;padding:0;flex:none}
.tv-dot.is-active{background:var(--primary);width:1.5em;border-radius:.3em}
.tv-progress{flex:1;height:.22em;border-radius:.11em;background:var(--chart-track);overflow:hidden;min-width:3em}
.tv-progress-bar{height:100%;width:0;background:var(--grad-brand);animation:tvGrow linear forwards}
.tv-progress-bar.is-paused{animation-play-state:paused}
@keyframes tvGrow{from{width:0}to{width:100%}}
.tv-btn{min-height:2em;padding:0 .7em;border:1px solid var(--border);border-radius:var(--r-sm);
  background:var(--bg-surface);color:var(--primary);font-size:.85em;font-weight:600;cursor:pointer;white-space:nowrap}
.tv-btn:hover{background:var(--primary-subtle)}
.tv-btn:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.tv-footnote{font-size:.82em;color:var(--ink-label);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* Layar sempit: yang tidak penting disingkirkan supaya angka tetap terbaca. */
@media (max-width:900px){
  .tv-head{padding:.5em .9em}
  .tv-main{padding:.6em .9em}
  .tv-foot{padding:.3em .9em}
  .tv-table th,.tv-table td{padding:.45em .6em}
  .tv-footnote{display:none}
}
@media (max-width:640px){
  .tv-clock{font-size:1.4em}
  .tv-panels{grid-template-columns:1fr}
}
@media (prefers-reduced-motion:reduce){
  .tv-slide{animation:none}
  .tv-progress-bar{animation:none;width:100%}
}
`;
