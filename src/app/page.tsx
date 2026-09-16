'use client';
import Link from 'next/link';
import { AbcChip, Alert, Bars, Empty, Kpi, RefreshButton, STATUS_COLOR, STATUS_ORDER, STATUS_TEXT, StatusChip, fmt, fmtDateTime, fmtDoi, useApi } from '@/components/ui';
import { DataGrid, type Column } from '@/components/DataGrid';
import type { SnapshotRow, SnapshotView } from '@/lib/query';

type Resp = SnapshotView & { ok: boolean };

const skuCol: Column<SnapshotRow> = { key: 'sku', label: 'SKU', get: (r) => r.sku, mono: true, width: 220, isTitle: true,
  render: (r) => <><div className="font-semibold">{r.sku}</div><div className="truncate font-sans text-[11px] font-normal text-label">{r.name}</div></> };
const PO_COLS: Column<SnapshotRow>[] = [
  skuCol,
  { key: 'abc', label: 'ABC', get: (r) => r.abcClass, width: 60, render: (r) => <AbcChip cls={r.abcClass} /> },
  { key: 'stock', label: 'Stok', get: (r) => r.availableQty, type: 'number', mono: true, width: 76 },
  { key: 'transit', label: 'Transit', get: (r) => r.transitQty, type: 'number', mono: true, width: 76, prio: 'p2' },
  { key: 'ads', label: 'ADS', get: (r) => Math.max(r.ads1, r.ads2), type: 'number', mono: true, width: 72, prio: 'p2', title: 'ADS acuan (sesuai basis tindakan)', render: (r) => fmt(Math.max(r.ads1, r.ads2), 1) },
  { key: 'doi', label: 'DOI', get: (r) => r.refDoi, type: 'number', mono: true, width: 66, title: 'DOI acuan (stok saja)', render: (r) => <b>{fmtDoi(r.refDoi)}</b> },
  { key: 'doit', label: 'DOI+T', get: (r) => r.refDoiTransit, type: 'number', mono: true, width: 70, prio: 'p3', title: 'DOI acuan termasuk transit', render: (r) => fmtDoi(r.refDoiTransit) },
  { key: 'lt', label: 'LT', get: (r) => r.leadTimeDays, type: 'number', mono: true, width: 50 },
  { key: 'sug', label: 'Saran qty', get: (r) => Math.max(r.suggested1, r.suggested2), type: 'number', mono: true, width: 84 },
  { key: 'status', label: 'Status', get: (r) => STATUS_TEXT[r.status], width: 120, render: (r) => <StatusChip status={r.status} /> },
  { key: 'action', label: 'Saran tindakan', get: (r) => r.action, width: 260, prio: 'p2' },
];
const OVER_COLS: Column<SnapshotRow>[] = [
  { ...skuCol, width: 200 },
  { key: 'stock', label: 'Stok', get: (r) => r.availableQty, type: 'number', mono: true, width: 80 },
  { key: 'doi1', label: 'DOI 1', get: (r) => r.doi1, type: 'number', mono: true, width: 70, render: (r) => fmtDoi(r.doi1) },
  { key: 'doi2', label: 'DOI 2', get: (r) => r.doi2, type: 'number', mono: true, width: 70, render: (r) => fmtDoi(r.doi2) },
];
const NPL_COLS: Column<SnapshotRow>[] = [
  { ...skuCol, width: 180 },
  { key: 'first', label: 'Jual pertama', get: (r) => r.firstSalesDate, type: 'date', mono: true, width: 100 },
  { key: 'age', label: 'Umur', get: (r) => r.ageDays, type: 'number', mono: true, width: 60, render: (r) => `${r.ageDays} hr` },
  { key: 'ads1', label: 'ADS 1', get: (r) => r.ads1, type: 'number', mono: true, width: 64, render: (r) => fmt(r.ads1, 1) },
  { key: 'status', label: 'Status', get: (r) => STATUS_TEXT[r.status], width: 110, render: (r) => <StatusChip status={r.status} /> },
];

export default function Dashboard() {
  const { data, error, loading, reload } = useApi<Resp>('/api/monitoring');
  const s = data?.summary;
  const set = data?.settings;

  const critical = (data?.rows ?? [])
    .filter((r) => r.status === 'CRITICAL' || r.status === 'LOW')
    .sort((a, b) => (a.refDoi ?? 0) - (b.refDoi ?? 0) || b.sales90 - a.sales90)
    .slice(0, 25);
  const overstock = (data?.rows ?? [])
    .filter((r) => r.status === 'OVERSTOCK')
    .sort((a, b) => b.availableQty - a.availableQty)
    .slice(0, 12);
  const npl = (data?.rows ?? []).filter((r) => r.isNpl).sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0)).slice(0, 10);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Dashboard DOI</h1>
          <div className="mt-1 text-[12.5px] text-label">
            {data?.computedAt
              ? <>Terakhir dihitung {fmtDateTime(data.computedAt)} ({data.trigger === 'cron' ? 'otomatis 07.30' : data.trigger}) · snapshot {data.snapshotDate} · area {set?.areaScope}</>
              : 'Belum ada perhitungan'}
          </div>
        </div>
        <RefreshButton onDone={reload} />
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {!loading && data && !data.snapshotDate ? (
        <Alert tone="info">
          Belum ada snapshot. Pastikan histori penjualan sudah masuk (halaman <Link className="underline" href="/sales">Data Penjualan</Link>), lalu klik <b>Refresh</b>.
        </Alert>
      ) : null}

      {s ? (
        <>
          <div className="kpi-grid">
            <Kpi label="SKU dihitung" value={fmt(s.total.skuCount)} hint={`${fmt(s.byStatus.EXCLUDED)} dikecualikan`} />
            <Kpi label="Total stok (Available)" value={fmt(s.total.stock)} hint={`+ ${fmt(s.total.transit)} dalam perjalanan`} />
            <Kpi label="DOI total — Opsi 1" value={fmtDoi(s.total.doi1)} unit="hari" hint={`ADS total ${fmt(s.total.ads1, 1)}/hari · 3 bln ex campaign`} />
            <Kpi label="DOI total — Opsi 2" value={fmtDoi(s.total.doi2)} unit="hari" hint={`ADS total ${fmt(s.total.ads2, 1)}/hari · max(8w,4w,2w)`} />
            <Kpi label="Perlu open PO" value={fmt(s.byStatus.CRITICAL + s.byStatus.LOW)} hint={`${fmt(s.byStatus.CRITICAL)} kritis · ${fmt(s.byStatus.LOW)} low`} tone="text-negative" />
            <Kpi label="Produk baru (NPL)" value={fmt(s.npl)} hint={`${fmt(s.byStatus.NPL_WAIT)} data belum cukup`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="card card-pad">
              <div className="card-title mb-3">Status SKU</div>
              <Bars items={STATUS_ORDER.map((k) => ({ label: STATUS_TEXT[k], value: s.byStatus[k], color: STATUS_COLOR[k] }))} />
            </div>
            <div className="card card-pad">
              <div className="card-title mb-3">Distribusi DOI (basis {set?.actionBasis === 'KONSERVATIF' ? 'konservatif' : set?.actionBasis})</div>
              <Bars items={s.buckets.map((b) => ({ label: b.label, value: b.count }))} />
              <div className="mt-3 text-[12px] text-label">Target DOI {set?.targetDoiDays} hari · safety {set?.safetyDays} hari · lead time default {set?.defaultLeadTimeDays} hari</div>
            </div>
            <div className="card overflow-hidden">
              <div className="card-title px-4 pt-4">Analisis ABC (qty 3 bulan)</div>
              <div className="table-scroll"><table className="grid mt-2">
                <thead><tr><th>Kelas</th><th className="num">SKU</th><th className="num">Pangsa</th><th className="num">Stok</th><th className="num">DOI 1</th><th className="num">DOI 2</th></tr></thead>
                <tbody>
                  {(['A', 'B', 'C'] as const).map((c) => {
                    const k = s.byAbc[c];
                    const totalSales = s.byAbc.A.sales + s.byAbc.B.sales + s.byAbc.C.sales;
                    return (
                      <tr key={c}>
                        <td><AbcChip cls={c} /></td>
                        <td className="num">{fmt(k.count)}</td>
                        <td className="num">{totalSales ? fmt((k.sales / totalSales) * 100, 1) : '0'}%</td>
                        <td className="num">{fmt(k.stock)}</td>
                        <td className="num">{fmtDoi(k.total.doi1)}</td>
                        <td className="num">{fmtDoi(k.total.doi2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
              <div className="px-4 py-2 text-[12px] text-label">A ≤ {set?.abcAPct}% kumulatif · B ≤ {set?.abcBPct}% · sisanya C</div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between px-4 pt-4">
                <div className="card-title">Prioritas open PO</div>
                <Link href="/monitoring?status=CRITICAL" className="text-[12.5px] text-primary hover:underline">Lihat semua →</Link>
              </div>
              <div className="p-3">
                <DataGrid<SnapshotRow> id="dash-po" compact rows={critical} columns={PO_COLS} rowKey={(r) => r.sku} emptyText="Tidak ada SKU kritis / low stock." />
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="card overflow-hidden">
                <div className="flex items-center justify-between px-4 pt-4">
                  <div className="card-title">Overstock terbesar</div>
                  <Link href="/monitoring?status=OVERSTOCK" className="text-[12.5px] text-primary hover:underline">Lihat semua →</Link>
                </div>
                <div className="p-3"><DataGrid<SnapshotRow> id="dash-over" compact rows={overstock} columns={OVER_COLS} rowKey={(r) => r.sku} emptyText="Tidak ada overstock." /></div>
              </div>
              <div className="card overflow-hidden">
                <div className="card-title px-4 pt-4">Produk baru (NPL)</div>
                <div className="p-3"><DataGrid<SnapshotRow> id="dash-npl" compact rows={npl} columns={NPL_COLS} rowKey={(r) => r.sku} emptyText="Tidak ada produk baru." /></div>
              </div>
            </div>
          </div>

          <div className="card card-pad">
            <div className="card-title mb-2">Tanggal yang dikecualikan dari Opsi 1 (dalam jendela {set?.opsi1WindowDays} hari)</div>
            <div className="flex flex-wrap gap-1.5">
              {data!.exclusions.filter((e) => e.date >= (data!.snapshotDate ? addDaysStr(data!.snapshotDate, -(set?.opsi1WindowDays ?? 90)) : '')).map((e) => (
                <span key={e.date} className="chip chip-noicon chip-gray" title={e.reason}>{e.date} · {e.reason}</span>
              ))}
            </div>
            <div className="mt-2 text-[12px] text-label">
              Awal data penjualan: {data!.earliestDataDate ?? '—'}. SKU yang penjualan pertamanya jatuh di tanggal ini ditandai “≥ awal data” dan tidak dianggap NPL.
            </div>
          </div>
        </>
      ) : loading ? <Empty>Memuat…</Empty> : null}
    </div>
  );
}

function addDaysStr(key: string, days: number) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
