'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { LineChart, PlatformSplit, SalesBars, type Line } from '@/components/Charts';
import { DataGrid, type Column } from '@/components/DataGrid';
import { AbcChip, Alert, Empty, StatusChip, fmt, fmtDoi, show1, show2, useApi, type DoiDisplay } from '@/components/ui';

type Row = {
  date: string; qty: number | null;
  shopee: number; tiktok: number; tokped: number; lazada: number; other: number;
  stock: number | null; onHand: number | null; onOrder: number | null;
  doi1: number | null; doi2: number | null; refDoi: number | null;
  excluded: string | null;
};
type Snap = {
  snapshotDate: string; availableQty: number; qtyOnHand: number; qtyOnOrder: number; transitQty: number;
  leadTimeDays: number; ads1: number; ads2: number; ads2Source: string; ads8w: number; ads4w: number; ads2w: number;
  doi1: number | null; doi2: number | null; doi1Transit: number | null; doi2Transit: number | null; refDoi: number | null;
  status: string; action: string; suggested1: number; suggested2: number;
  abcClass: string; abcShare: number; sales90: number; salesEx: number; daysEx: number;
  firstSalesDate: string | null; ageDays: number | null; isNpl: boolean; nplNote: string | null;
  runOutDate: string | null; isPhaseOut: boolean;
};
type Resp = {
  ok: boolean; sku: string; today: string; days: number; name: string | null; sapCode: string | null;
  master: { leadTimeDays: number | null; isExcluded: boolean; note: string | null } | null;
  phaseOut: { sapCode: string | null; reason: string | null; note: string | null; targetOutDate: string | null } | null;
  settings: { targetDoiDays: number; safetyDays: number; defaultLeadTimeDays: number; doiDisplay: DoiDisplay; opsi1WindowDays: number };
  snapshot: Snap | null;
  totals: { qty: number; shopee: number; tiktok: number; tokped: number; lazada: number; other: number };
  stockSince: string | null; stockDays: number;
  series: Row[];
};

const RANGES = [30, 60, 90, 180, 365];

export default function SkuPage() {
  const params = useParams<{ sku: string }>();
  const sku = decodeURIComponent(String(params?.sku ?? ''));
  const [days, setDays] = useState(90);
  const { data, error, loading } = useApi<Resp>(sku ? `/api/sku/${encodeURIComponent(sku)}?days=${days}` : null);

  const disp = data?.settings?.doiDisplay ?? 'BOTH';
  const s1 = show1(disp), s2 = show2(disp);
  const snap = data?.snapshot ?? null;
  const rows = useMemo(() => data?.series ?? [], [data]);
  const dates = useMemo(() => rows.map((r) => r.date), [rows]);

  const sold = data?.totals.qty ?? 0;
  const avg = rows.length ? sold / rows.length : 0;
  const bestDay = useMemo(() => rows.reduce<Row | null>((a, r) => (r.qty ?? 0) > (a?.qty ?? -1) ? r : a, null), [rows]);
  const zeroDays = rows.filter((r) => r.stock === 0).length;
  const soldDays = rows.filter((r) => (r.qty ?? 0) > 0).length;

  const doiLines: Line[] = [
    ...(s1 ? [{ label: 'DOI Opsi 1', values: rows.map((r) => r.doi1), color: 'var(--c1)' }] : []),
    ...(s2 ? [{ label: 'DOI Opsi 2', values: rows.map((r) => r.doi2), color: 'var(--c3)' }] : []),
  ];
  const hasDoi = doiLines.some((l) => l.values.some((v) => v !== null));
  const stockLines: Line[] = [
    { label: 'Tersedia', values: rows.map((r) => r.stock), color: 'var(--c3)' },
    { label: 'On hand', values: rows.map((r) => r.onHand), color: 'var(--c1)' },
    { label: 'On order', values: rows.map((r) => r.onOrder), color: 'var(--c5)' },
  ];
  const hasStock = (data?.stockDays ?? 0) > 0;

  const columns = useMemo<Column<Row>[]>(() => [
    { key: 'date', label: 'Tanggal', get: (r) => r.date, type: 'date', mono: true, width: 108, sticky: true, isTitle: true },
    { key: 'qty', label: 'Terjual', get: (r) => r.qty, type: 'number', mono: true, width: 84,
      render: (r) => r.qty ? <b>{fmt(r.qty)}</b> : <span className="empty">—</span> },
    { key: 'ex', label: 'Campaign', get: (r) => r.excluded, width: 150, title: 'Hari yang dikeluarkan dari ADS Opsi 1',
      render: (r) => r.excluded ? <span className="chip chip-warn">{r.excluded}</span> : <span className="empty">—</span> },
    { key: 'shopee', label: 'Shopee', get: (r) => r.shopee, type: 'number', mono: true, width: 80, prio: 'p2' },
    { key: 'tiktok', label: 'TikTok', get: (r) => r.tiktok, type: 'number', mono: true, width: 80, prio: 'p2' },
    { key: 'tokped', label: 'Tokopedia', get: (r) => r.tokped, type: 'number', mono: true, width: 92, prio: 'p3' },
    { key: 'lazada', label: 'Lazada', get: (r) => r.lazada, type: 'number', mono: true, width: 80, prio: 'p3' },
    { key: 'other', label: 'Lainnya', get: (r) => r.other, type: 'number', mono: true, width: 80, prio: 'p3' },
    { key: 'stock', label: 'Stok tersedia', get: (r) => r.stock, type: 'number', mono: true, width: 118,
      render: (r) => r.stock === null ? <span className="empty">—</span>
        : <span className={r.stock === 0 ? 'text-negative font-semibold' : ''}>{fmt(r.stock)}</span> },
    { key: 'onhand', label: 'On hand', get: (r) => r.onHand, type: 'number', mono: true, width: 92, prio: 'p2' },
    { key: 'onorder', label: 'On order', get: (r) => r.onOrder, type: 'number', mono: true, width: 92, prio: 'p3' },
    ...(s1 ? [{ key: 'doi1', label: 'DOI 1', get: (r: Row) => r.doi1, type: 'number' as const, mono: true, width: 76,
      render: (r: Row) => fmtDoi(r.doi1) }] : []),
    ...(s2 ? [{ key: 'doi2', label: 'DOI 2', get: (r: Row) => r.doi2, type: 'number' as const, mono: true, width: 76,
      render: (r: Row) => fmtDoi(r.doi2) }] : []),
  ], [s1, s2]);

  if (!sku) return <Empty>SKU tidak dikenal.</Empty>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/monitoring" className="text-[12.5px] text-primary hover:underline">← Tabel DOI</Link>
          <h1 className="page-title mt-1 items-start"><span className="num min-w-0 break-words">{sku}</span></h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-label">
            {data?.name ? <span className="truncate max-w-[52ch]" title={data.name}>{data.name}</span> : null}
            {data?.sapCode ? <span className="num">· SAP {data.sapCode}</span> : null}
            {snap ? <>· <StatusChip status={snap.status} /> <AbcChip cls={snap.abcClass} /></> : null}
            {snap?.isNpl ? <span className="chip chip-warn">NPL{snap.nplNote ? ` · ${snap.nplNote}` : ''}</span> : null}
            {data?.phaseOut ? <span className="chip chip-warn">Phase Out{data.phaseOut.reason ? ` · ${data.phaseOut.reason}` : ''}</span> : null}
          </div>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto" role="group" aria-label="Rentang waktu">
          {RANGES.map((d) => (
            <button key={d} className={`btn btn-sm shrink-0 ${days === d ? 'btn-primary' : ''}`}
              aria-pressed={days === d} onClick={() => setDays(d)}>{d} hari</button>
          ))}
        </div>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {loading && !data ? <Empty>Memuat…</Empty> : null}

      {data ? (
        <>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(11rem,1fr))' }}>
            <Tile k="Stok tersedia" v={fmt(snap?.availableQty)} h={`on hand ${fmt(snap?.qtyOnHand)} · on order ${fmt(snap?.qtyOnOrder)}`} />
            <Tile k="Dalam perjalanan" v={fmt(snap?.transitQty)} h={`lead time ${snap?.leadTimeDays ?? '—'} hari`} />
            {s1 ? <Tile k={s2 ? 'DOI Opsi 1' : 'DOI'} v={fmtDoi(snap?.doi1)} h={`+transit ${fmtDoi(snap?.doi1Transit)} · ADS ${fmt(snap?.ads1, 1)}/hari`} /> : null}
            {s2 ? <Tile k={s1 ? 'DOI Opsi 2' : 'DOI'} v={fmtDoi(snap?.doi2)} h={`+transit ${fmtDoi(snap?.doi2Transit)} · ADS ${fmt(snap?.ads2, 1)} (${snap?.ads2Source ?? '—'})`} /> : null}
            <Tile k={`Terjual ${days} hari`} v={fmt(sold)} h={`rata-rata ${fmt(avg, 1)}/hari · laku ${soldDays} dari ${rows.length} hari`} />
            <Tile k="Perkiraan habis" v={snap?.runOutDate ?? '—'} h={snap?.action ?? ''} />
          </div>

          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Penjualan harian</h2>
              <span className="text-[12px] text-label">
                Batang bergaris = hari campaign (double date / gajian / manual), tidak ikut dihitung di ADS Opsi 1
              </span>
            </div>
            <div className="card-body">
              <SalesBars dates={dates} values={rows.map((r) => r.qty ?? 0)} excluded={rows.map((r) => r.excluded)}
                ads={s1 ? snap?.ads1 ?? null : snap?.ads2 ?? null} />
              <div className="mt-2 text-[12.5px] text-label">
                Total {fmt(sold)} pcs{bestDay && bestDay.qty ? <> · tertinggi {fmt(bestDay.qty)} pcs pada {bestDay.date}</> : null}
                {snap ? <> · jendela Opsi 1: {fmt(snap.salesEx)} pcs / {snap.daysEx} hari</> : null}
              </div>
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="card">
              <div className="card-head"><h2 className="card-title">Riwayat stok</h2></div>
              <div className="card-body">
                {hasStock ? (
                  <>
                    <LineChart dates={dates} lines={stockLines} zeroBand={0} unit="pcs" />
                    <div className="mt-2 text-[12.5px] text-label">
                      Terekam sejak {data.stockSince} ({data.stockDays} hari)
                      {zeroDays ? <> · <span className="text-negative">stok kosong {zeroDays} hari</span> (blok merah)</> : null}
                    </div>
                  </>
                ) : (
                  <Alert tone="info">
                    Belum ada riwayat stok untuk SKU ini. OCS hanya memberi stok saat ini, jadi riwayatnya baru
                    terkumpul sejak aplikasi mulai menghitung — satu potret tiap hari pada 07.30.
                  </Alert>
                )}
              </div>
            </section>

            <section className="card">
              <div className="card-head"><h2 className="card-title">Riwayat DOI</h2></div>
              <div className="card-body">
                {hasDoi ? (
                  <>
                    <LineChart dates={dates} lines={doiLines} unit="hari" digits={1}
                      refs={[
                        { value: data.settings.targetDoiDays, label: `Target ${data.settings.targetDoiDays} hari`, color: 'var(--c2)' },
                        { value: snap?.leadTimeDays ?? data.settings.defaultLeadTimeDays, label: `Lead time ${snap?.leadTimeDays ?? data.settings.defaultLeadTimeDays} hari`, color: 'var(--critical-solid)' },
                      ]} />
                    <div className="mt-2 text-[12.5px] text-label">
                      Garis di bawah lead time = stok habis sebelum barang datang; di atas target = overstock.
                    </div>
                  </>
                ) : (
                  <Alert tone="info">Riwayat DOI baru terisi sejak perhitungan pertama.</Alert>
                )}
              </div>
            </section>
          </div>

          <section className="card">
            <div className="card-head"><h2 className="card-title">Penjualan per platform</h2>
              <span className="text-[12px] text-label">{days} hari terakhir</span></div>
            <div className="card-body">
              <PlatformSplit parts={[
                { label: 'Shopee', value: data.totals.shopee, color: 'var(--c1)' },
                { label: 'TikTok', value: data.totals.tiktok, color: 'var(--c2)' },
                { label: 'Tokopedia', value: data.totals.tokped, color: 'var(--c3)' },
                { label: 'Lazada', value: data.totals.lazada, color: 'var(--c4)' },
                { label: 'Lainnya', value: data.totals.other, color: 'var(--c5)' },
              ]} />
            </div>
          </section>

          <DataGrid<Row>
            id="sku-daily"
            rows={[...rows].reverse()}
            columns={columns}
            rowKey={(r) => r.date}
            loading={loading}
            rowClass={(r) => (r.stock === 0 ? 'is-zero' : '')}
            footerNote="angka harian — bisa diurutkan, difilter, dan disalin (klik ganda sel)"
          />
        </>
      ) : null}
    </div>
  );
}

function Tile({ k, v, h }: { k: string; v: React.ReactNode; h?: React.ReactNode }) {
  return (
    <div className="stat-tile">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {h ? <div className="h">{h}</div> : null}
    </div>
  );
}
