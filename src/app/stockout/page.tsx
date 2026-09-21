'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { DayStrip } from '@/components/Charts';
import { DataGrid, type Column } from '@/components/DataGrid';
import { AbcChip, Alert, Empty, StatusChip, fmt, useApi } from '@/components/ui';
import type { PlatformGap, SkuStockout } from '@/lib/stockout';
import { PLATFORM_LABEL } from '@/lib/stockout';

type Row = SkuStockout & {
  name: string | null; sapCode: string | null; abcClass: string; status2: string;
  volatile: boolean; outAllShops: boolean; outSomeShops: boolean;
};
type Gap = PlatformGap & { name: string | null; outAllShops: boolean; outSomeShops: boolean };
type Resp = {
  ok: boolean; from: string; to: string; today: string; days: string[]; dataGaps: string[];
  snapshotDate: string | null; stockSince: string | null;
  options: { minRunDays: number; minAds: number; minSellSharePct: number; platformMinRunDays: number; platformMinSharePct: number; withPhaseOut: boolean; withExcluded: boolean; maxDays: number; volatileDays: number };
  settings: { areaScope: string; actionBasis: string; doiDisplay: string };
  summary: {
    skuAnalyzed: number; skuAffected: number; outDays: number; episodes: number;
    lostLow: number; lostHigh: number; ongoing: number; confirmed: number; suspected: number;
    stockAvailable: number; campaignDays: number; platformGaps: number; platformSkus: number;
    bothProblems: number; outsideTable: number; outsideReasons: Record<string, number>; baselineFromSales: number;
  };
  rows: Row[]; gaps: Gap[]; series: Record<string, number[]>;
};

const addDays = (k: string, n: number) => {
  const d = new Date(`${k}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const STATUS_LABEL: Record<Row['status'], string> = {
  TERKONFIRMASI: 'Stok kosong (terkonfirmasi)',
  DUGAAN: 'Dugaan stok kosong',
  STOK_ADA: 'Stok ada — bukan masalah stok',
};
const STATUS_CHIP: Record<Row['status'], string> = { TERKONFIRMASI: 'chip-bad', DUGAAN: 'chip-warn', STOK_ADA: 'chip-info' };

export default function StockoutPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(addDays(today, -90));
  const [to, setTo] = useState(addDays(today, -1));
  const [minRun, setMinRun] = useState(1);
  const [minAds, setMinAds] = useState(1);
  const [minSell, setMinSell] = useState(80);
  const [phaseOut, setPhaseOut] = useState(false);
  const [showOpts, setShowOpts] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState(0); // penanda "terapkan"

  const url = useMemo(
    () => `/api/stockout?from=${from}&to=${to}&minRun=${minRun}&minAds=${minAds}&minSell=${minSell}${phaseOut ? '&phaseOut=1' : ''}#${q}`.split('#')[0],
    [from, to, minRun, minAds, minSell, phaseOut, q],
  );
  const { data, error, loading } = useApi<Resp>(url);

  const days = data?.days ?? [];
  const gapSet = useMemo(() => new Set(data?.dataGaps ?? []), [data]);
  const s = data?.summary;

  const preset = (n: number) => { setTo(addDays(today, -1)); setFrom(addDays(today, -n)); setQ((v) => v + 1); };

  const columns = useMemo<Column<Row>[]>(() => [
    { key: 'sku', label: 'SKU', get: (r) => r.sku, mono: true, width: 240, sticky: true, isTitle: true,
      render: (r) => <span className="font-semibold" title={r.name ?? undefined}>{r.sku}</span> },
    { key: 'abc', label: 'ABC', get: (r) => r.abcClass || null, width: 64,
      render: (r) => r.abcClass ? <AbcChip cls={r.abcClass} /> : <span className="empty">—</span> },
    { key: 'st', label: 'Temuan', get: (r) => STATUS_LABEL[r.status], width: 190,
      render: (r) => <span className={`chip ${STATUS_CHIP[r.status]}`}>{r.status === 'TERKONFIRMASI' ? 'Terkonfirmasi' : r.status === 'DUGAAN' ? 'Dugaan' : 'Stok ada'}</span> },
    { key: 'outdays', label: 'Hari kosong', get: (r) => r.outDays, type: 'number', mono: true, width: 110,
      render: (r) => <b>{fmt(r.outDays)}</b> },
    { key: 'eps', label: 'Episode', get: (r) => r.episodeCount, type: 'number', mono: true, width: 90 },
    { key: 'longest', label: 'Terpanjang', get: (r) => r.longestDays, type: 'number', mono: true, width: 110,
      render: (r) => `${r.longestDays} hr` },
    { key: 'last', label: 'Terakhir kosong', get: (r) => r.lastTo, type: 'date', mono: true, width: 200,
      render: (r) => <>{r.lastTo}{r.ongoing ? <span className="ml-1 chip chip-bad chip-noicon">berlangsung</span> : null}</> },
    { key: 'allshop', label: 'Kosong di semua shop', get: (r) => r.outAllShops ? 'Ya' : 'Tidak', width: 190,
      title: 'Ada hari dengan penjualan nol di SELURUH shop sekaligus — ciri kehabisan stok',
      render: (r) => <YaTidak ya={r.outAllShops} tone="bad" /> },
    { key: 'someshop', label: 'Kosong di beberapa shop', get: (r) => r.outSomeShops ? 'Ya' : 'Tidak', width: 205,
      title: 'SKU ini JUGA punya hari di mana hanya sebagian shop yang nol — itu masalah listing, bukan stok',
      render: (r) => <YaTidak ya={r.outSomeShops} tone="warn" /> },
    { key: 'ads', label: 'Normal (pcs/hari)', get: (r) => r.ads, type: 'number', mono: true, width: 165,
      title: 'Angka normal yang dipakai menghitung kehilangan: ADS snapshot, atau median penjualan bila SKU tidak ada di snapshot',
      render: (r) => (
        <>
          {fmt(r.ads, 1)}
          {r.adsSource === 'PENJUALAN'
            ? <span className="ml-1 text-[10px] text-muted" title="Tidak ada ADS di snapshot — dipakai median penjualan 28 hari sebelum episode">dr. jual</span>
            : r.adsEstimated ? <span className="ml-1 text-[10px] text-muted" title="Snapshot pada tanggal itu belum ada — dipakai yang paling awal tersedia">≈</span> : null}
        </>
      ) },
    { key: 'adssell', label: 'ADS hari-laku', get: (r) => r.adsSelling, type: 'number', mono: true, width: 120, prio: 'p2',
      title: 'Total penjualan ÷ jumlah hari yang ada penjualannya', render: (r) => fmt(r.adsSelling, 1) },
    { key: 'sellshare', label: 'Hari laku', get: (r) => r.sellSharePct, type: 'number', mono: true, width: 100, prio: 'p2',
      title: 'Pangsa hari yang ada penjualannya di rentang ini', render: (r) => `${fmt(r.sellSharePct, 0)}%` },
    { key: 'low', label: 'Hilang (konservatif)', get: (r) => r.lostLow, type: 'number', mono: true, width: 165,
      title: 'Hari kosong × ADS acuan', render: (r) => <b>{fmt(r.lostLow)}</b> },
    { key: 'high', label: 'Hilang (optimis)', get: (r) => r.lostHigh, type: 'number', mono: true, width: 145,
      title: 'Hari kosong × ADS hari-laku' },
    { key: 'camp', label: 'Kosong saat campaign', get: (r) => r.campaignDays, type: 'number', mono: true, width: 175, prio: 'p2',
      title: 'Hari double date / gajian yang ikut kosong — kehilangan paling mahal',
      render: (r) => r.campaignDays ? <span className="text-negative font-semibold">{r.campaignDays} hr</span> : <span className="empty">—</span> },
    { key: 'vol', label: 'Catatan', get: (r) => r.volatile ? 'data masih bisa berubah' : null, width: 180, prio: 'p2',
      render: (r) => r.volatile ? <span className="chip chip-warn" title={`Seluruh episodenya di ${data?.options.volatileDays ?? 7} hari terakhir, yang masih ditarik ulang tiap malam`}>bisa berubah</span> : <span className="empty">—</span> },
    { key: 'doistat', label: 'Status DOI', get: (r) => r.status2 || null, width: 130, prio: 'p3',
      render: (r) => r.status2 ? <StatusChip status={r.status2} /> : <span className="empty">—</span> },
    { key: 'sap', label: 'SAP', get: (r) => r.sapCode, mono: true, width: 110, prio: 'p3' },
  ], [data]);

  const gapCols = useMemo<Column<Gap>[]>(() => [
    { key: 'sku', label: 'SKU', get: (r) => r.sku, mono: true, width: 240, sticky: true, isTitle: true },
    { key: 'pf', label: 'Platform', get: (r) => PLATFORM_LABEL[r.platform], width: 120,
      render: (r) => <span className="chip chip-info">{PLATFORM_LABEL[r.platform]}</span> },
    { key: 'allshop', label: 'Kosong di semua shop', get: (r) => r.outAllShops ? 'Ya' : 'Tidak', width: 190,
      title: 'SKU ini juga punya hari kosong di seluruh shop — kalau Ya, ada masalah stok DAN masalah listing',
      render: (r) => <YaTidak ya={r.outAllShops} tone="bad" /> },
    { key: 'someshop', label: 'Kosong di beberapa shop', get: (r) => 'Ya', width: 205, noFilter: true,
      title: 'Selalu Ya di tabel ini — memang itu definisinya',
      render: () => <YaTidak ya tone="warn" /> },
    { key: 'from', label: 'Mulai', get: (r) => r.from, type: 'date', mono: true, width: 110 },
    { key: 'to', label: 'Sampai', get: (r) => r.to, type: 'date', mono: true, width: 110,
      render: (r) => <>{r.to}{r.ongoing ? <span className="ml-1 chip chip-bad chip-noicon">berlangsung</span> : null}</> },
    { key: 'days', label: 'Hari', get: (r) => r.days, type: 'number', mono: true, width: 80, render: (r) => <b>{r.days}</b> },
    { key: 'share', label: 'Pangsa platform', get: (r) => r.sharePct, type: 'number', mono: true, width: 140,
      title: 'Pangsa platform ini dari total penjualan SKU pada rentang', render: (r) => `${fmt(r.sharePct, 1)}%` },
    { key: 'other', label: 'Platform lain tetap laku', get: (r) => r.otherQty, type: 'number', mono: true, width: 190,
      title: 'Penjualan dari platform lain selama gap — bukti produknya masih jalan' },
    { key: 'lost', label: 'Perkiraan hilang', get: (r) => r.lostQty, type: 'number', mono: true, width: 150 },
    { key: 'name', label: 'Nama', get: (r) => r.name, width: 260, prio: 'p2' },
  ], []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Analisis Stok Kosong</h1>
          <div className="mt-1 text-[12.5px] text-label">
            Hari ketika SKU yang biasanya laku tiba-tiba tidak punya penjualan sama sekali — beserta perkiraan penjualan yang hilang.
          </div>
        </div>
        <button className="btn btn-sm" onClick={() => setShowOpts((v) => !v)} aria-expanded={showOpts}>
          {showOpts ? 'Sembunyikan setelan' : 'Setelan lanjutan'}
        </button>
      </div>

      <section className="card card-pad">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="f-from">Dari</label>
            <input id="f-from" className="input" style={{ width: 160 }} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="f-to">Sampai</label>
            <input id="f-to" className="input" style={{ width: 160 }} type="date" value={to} min={from} max={addDays(today, -1)} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {[30, 60, 90, 180].map((n) => (
              <button key={n} className="btn btn-sm" onClick={() => preset(n)}>{n} hari</button>
            ))}
          </div>
          <span className="ml-auto text-[12px] text-label">
            Maks {data?.options.maxDays ?? 180} hari · berakhir kemarin · area {data?.settings.areaScope ?? '—'}
          </span>
        </div>

        {showOpts ? (
          <div className="mt-4 flex flex-wrap items-end gap-4 border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
            <div>
              <label className="label" htmlFor="f-run">Minimal hari berturut</label>
              <input id="f-run" className="input" style={{ width: 120 }} type="number" min={1} max={60} value={minRun}
                onChange={(e) => setMinRun(Math.max(1, Number(e.target.value) || 1))} />
            </div>
            <div>
              <label className="label" htmlFor="f-ads">Minimal ADS (pcs/hari)</label>
              <input id="f-ads" className="input" style={{ width: 140 }} type="number" min={0} step={0.5} value={minAds}
                onChange={(e) => setMinAds(Math.max(0, Number(e.target.value) || 0))} />
            </div>
            <div>
              <label className="label" htmlFor="f-sell">Minimal hari laku (%)</label>
              <input id="f-sell" className="input" style={{ width: 150 }} type="number" min={0} max={100} step={5} value={minSell}
                title="Pangsa hari yang ada penjualannya. Ini yang memisahkan produk yang biasanya laku tiap hari dari produk slow-moving yang polanya memang bolong."
                onChange={(e) => setMinSell(Math.min(100, Math.max(0, Number(e.target.value) || 0)))} />
            </div>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={phaseOut} onChange={(e) => setPhaseOut(e.target.checked)} /> Ikutkan SKU phase out
            </label>
            <span className="text-[12px] text-label">
              SKU yang ditandai <i>dikecualikan</i> di Lead Time &amp; SKU selalu dikeluarkan.
            </span>
          </div>
        ) : null}
      </section>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {loading && !data ? <Empty>Menghitung…</Empty> : null}

      {data && s ? (
        <>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(12rem,1fr))' }}>
            <Tile k="SKU terdampak" v={fmt(s.skuAffected)} h={`dari ${fmt(s.skuAnalyzed)} SKU dianalisis`} />
            <Tile k="Total hari kosong" v={fmt(s.outDays)} h={`${fmt(s.episodes)} episode`} />
            <Tile k="Perkiraan hilang" v={fmt(s.lostLow)} h={`sampai ${fmt(s.lostHigh)} pcs (optimis)`} />
            <Tile k="Masih berlangsung" v={fmt(s.ongoing)} h="kosong sampai hari terakhir rentang" tone={s.ongoing ? 'text-negative' : undefined} />
            <Tile k="Terkonfirmasi / dugaan" v={`${fmt(s.confirmed)} / ${fmt(s.suspected)}`} h={`${fmt(s.stockAvailable)} ternyata stoknya ada`} />
            <Tile k="Kosong saat campaign" v={fmt(s.campaignDays)} h="hari double date / gajian" tone={s.campaignDays ? 'text-negative' : undefined} />
            <Tile k="Kena dua-duanya" v={fmt(s.bothProblems)} h="kosong total + ada shop yang berhenti sendiri" tone={s.bothProblems ? 'text-negative' : undefined} />
          </div>

          {data.dataGaps.length ? (
            <Alert tone="warn">
              {data.dataGaps.length} hari dikeluarkan karena datanya tidak lengkap (sinkronisasi penjualan gagal / sebagian):{' '}
              <span className="num">{data.dataGaps.slice(0, 8).join(', ')}{data.dataGaps.length > 8 ? ` … +${data.dataGaps.length - 8}` : ''}</span>.
              Hari-hari itu tidak dihitung sebagai stok kosong.
            </Alert>
          ) : null}
          {s.outsideTable ? (
            <Alert tone="info">
              Analisis ini hanya memuat <b>SKU aktif yang ada di Tabel DOI</b>.{' '}
              {fmt(s.outsideTable)} SKU lain pernah laku di rentang ini tapi tidak ada di daftar itu, jadi tidak ikut dihitung —{' '}
              {Object.entries(s.outsideReasons).map(([k, v]) => `${k}: ${v}`).join(' · ')}.
            </Alert>
          ) : null}

          <section className="card overflow-hidden">
            <div className="card-head">
              <h2 className="card-title">Stok kosong — kosong di semua shop</h2>
              <span className="text-[12px] text-label">
                {data.stockSince ? <>terkonfirmasi lewat riwayat stok sejak {data.stockSince}; sebelum itu hanya dugaan</> : 'belum ada riwayat stok — seluruh temuan masih berupa dugaan'}
              </span>
            </div>
            <div className="p-3">
              <DataGrid<Row>
                id="stockout"
                rows={data.rows}
                columns={columns}
                rowKey={(r) => r.sku}
                loading={loading}
                expanded={open}
                onRowClick={(r) => setOpen(open === r.sku ? null : r.sku)}
                renderExpanded={(r) => (
                  <Detail r={r} days={days} series={data.series[r.sku] ?? []} gapSet={gapSet} />
                )}
                emptyText="Tidak ada SKU yang kehabisan stok pada rentang ini."
                footerNote="klik baris = rincian episode & pita harian"
              />
            </div>
          </section>

          <section className="card overflow-hidden">
            <div className="card-head">
              <h2 className="card-title">Masalah listing — kosong di beberapa shop saja</h2>
              <span className="text-[12px] text-label">
                Shop ini nol beberapa hari padahal shop lain tetap laku · minimal {data.options.platformMinRunDays} hari &amp; pangsa ≥ {fmt(data.options.platformMinSharePct)}%
              </span>
            </div>
            <div className="p-3">
              <DataGrid<Gap>
                id="stockout-platform"
                rows={data.gaps}
                columns={gapCols}
                rowKey={(r) => `${r.sku}|${r.platform}|${r.from}`}
                emptyText="Tidak ada platform yang berhenti sendirian pada rentang ini."
                footerNote="ini bukan masalah stok — periksa listing, iklan, atau harga di platform tersebut"
              />
            </div>
          </section>

          <div className="text-[12px] text-label">
            Cara baca: hanya SKU aktif di Tabel DOI yang dianalisis. Sebuah hari dihitung kosong bila qty-nya nol bulat —
            {data.options.minRunDays <= 1 ? ' satu hari nol pun sudah dilaporkan' : ` minimal ${data.options.minRunDays} hari berturut-turut`},
            untuk SKU yang normalnya ≥ {fmt(data.options.minAds, 1)} pcs/hari dan laku pada ≥ {fmt(data.options.minSellSharePct)}% hari
            (itulah arti "laku hampir setiap hari").
            Angka <i>normal</i> memakai ADS acuan (basis {data.settings.actionBasis.toLowerCase()}) dari snapshot terdekat sebelum
            episode; untuk SKU yang tidak ada di snapshot dipakai median penjualan 28 hari sebelum episode ({fmt(s.baselineFromSales)} SKU).
            Angka konservatif cenderung <i>terlalu kecil</i>, karena hari kosong ikut menjadi pembagi saat ADS dihitung —
            kolom optimis memakai ADS hari-laku sebagai batas atasnya.
          </div>
        </>
      ) : null}
    </div>
  );
}

function Detail({ r, days, series, gapSet }: { r: Row; days: string[]; series: number[]; gapSet: Set<string> }) {
  const outSet = useMemo(() => {
    const set = new Set<string>();
    for (const e of r.episodes) for (let d = e.from; d <= e.to; d = addDays(d, 1)) set.add(d);
    return set;
  }, [r]);

  return (
    <div className="space-y-3 py-2">
      <div>
        <div className="mb-1.5 text-[12.5px] text-label">{r.name ?? r.sku}</div>
        <DayStrip
          dates={days}
          values={series}
          out={days.map((d) => outSet.has(d))}
          gaps={days.map((d) => gapSet.has(d))}
        />
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-label">
          <span className="inline-flex items-center gap-1.5"><span className="split-dot" style={{ background: 'var(--c1)' }} /> ada penjualan (makin tua = makin banyak)</span>
          <span className="inline-flex items-center gap-1.5"><span className="split-dot" style={{ background: 'var(--negative)' }} /> tidak ada penjualan</span>
          <span className="inline-flex items-center gap-1.5"><span className="split-dot" style={{ background: 'var(--chart-track)' }} /> data tidak ada</span>
        </div>
      </div>

      <div className="table-scroll">
        <table className="dgrid dgrid-auto">
          <thead><tr>
            <th>Mulai</th><th>Sampai</th><th className="num">Hari</th><th className="num">ADS acuan</th>
            <th className="num">Hilang (kons.)</th><th className="num">Hilang (opt.)</th><th>Bukti stok</th><th>Catatan</th>
          </tr></thead>
          <tbody>
            {r.episodes.map((e) => (
              <tr key={e.from}>
                <td className="mono">{e.from}</td>
                <td className="mono">{e.to}</td>
                <td className="num">{e.days}</td>
                <td className="num">{fmt(e.ads, 1)}{e.adsEstimated ? ' ≈' : ''}</td>
                <td className="num">{fmt(e.lostLow)}</td>
                <td className="num">{fmt(e.lostHigh)}</td>
                <td>
                  {e.stockState === 'KOSONG' ? <span className="chip chip-bad">stok 0 · {e.stockZeroDays} hr</span>
                    : e.stockState === 'ADA' ? <span className="chip chip-info">stok ada · {e.stockPositiveDays} hr</span>
                    : <span className="text-label">belum ada riwayat stok</span>}
                </td>
                <td>
                  {e.ongoing ? <span className="chip chip-bad">masih berlangsung</span> : null}
                  {e.campaignDays ? <span className="ml-1 chip chip-warn">{e.campaignDays} hr campaign</span> : null}
                  {!e.ongoing && !e.campaignDays ? <span className="empty">—</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-[12.5px]">
        <Link className="btn btn-sm" href={`/sku/${encodeURIComponent(r.sku)}`}>Analisis lengkap SKU ini →</Link>
      </div>
    </div>
  );
}

function Tile({ k, v, h, tone }: { k: string; v: React.ReactNode; h?: React.ReactNode; tone?: string }) {
  return (
    <div className="stat-tile">
      <div className="k">{k}</div>
      <div className={`v ${tone ?? ''}`}>{v}</div>
      {h ? <div className="h">{h}</div> : null}
    </div>
  );
}

/** Keterangan dua-nilai. "Tidak" sengaja dibuat redup supaya yang "Ya" langsung menonjol. */
function YaTidak({ ya, tone }: { ya: boolean; tone: 'bad' | 'warn' }) {
  if (!ya) return <span className="text-label">Tidak</span>;
  return <span className={`chip chip-${tone}`}>Ya</span>;
}
