'use client';
import Link from 'next/link';
import { useState } from 'react';
import { AbcChip, Alert, Bars, Empty, Kpi, RefreshButton, STATUS_COLOR, STATUS_ORDER, STATUS_TEXT, StatusChip, fmt, fmtDateTime, fmtDoi, useApi } from '@/components/ui';
import { DataGrid, type Column } from '@/components/DataGrid';
import type { DashboardView, SnapshotRow } from '@/lib/query';

type Resp = DashboardView & { ok: boolean };

const skuCol: Column<SnapshotRow> = { key: 'sku', label: 'SKU', get: (r) => r.sku, mono: true, width: 220, isTitle: true,
  render: (r) => <span className="font-semibold" title={r.name}>{r.sku}</span> };
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

const PO_OUT_COLS: Column<SnapshotRow>[] = [
  { ...skuCol, width: 200 },
  { key: 'stock', label: 'Stok', get: (r) => r.availableQty, type: 'number', mono: true, width: 80 },
  { key: 'target', label: 'Target habis', get: (r) => r.phaseOutTargetDate, type: 'date', mono: true, width: 120 },
  { key: 'excess', label: 'Sisa saat target', get: (r) => r.phaseOutExcessQty, type: 'number', mono: true, width: 130 },
  { key: 'late', label: 'Telat', get: (r) => r.phaseOutLateDays, type: 'number', mono: true, width: 80,
    render: (r) => (r.phaseOutLateDays ?? 0) > 0 ? <span className="text-negative">{r.phaseOutLateDays} hr</span> : <span className="empty">—</span> },
];

export default function Dashboard() {
  const { data, error, loading, reload } = useApi<Resp>('/api/dashboard');
  const [withPhaseOut, setWithPhaseOut] = useState(false);
  const s = data?.summary;
  const set = data?.settings;
  // Kedua versi total sudah dihitung saat compute, jadi toggle ini tidak menghitung ulang apa pun.
  const tot = s ? ((withPhaseOut ? s.totalWithPhaseOut : s.total) ?? s.total) : null;
  const poSum = s?.phaseOut ?? { count: 0, stock: 0, excessQty: 0, lateCount: 0 };

  const critical = data?.po ?? [];
  const overstock = data?.overstock ?? [];
  const npl = data?.npl ?? [];
  const phaseOut = data?.phaseOut ?? [];

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
        <div className="flex flex-wrap items-center gap-3">
          {poSum.count > 0 ? (
            <label className="flex items-center gap-2 text-[13px]" title="Secara default SKU phase out tidak dihitung di DOI total & ABC">
              <input type="checkbox" checked={withPhaseOut} onChange={(e) => setWithPhaseOut(e.target.checked)} />
              Hitung termasuk Phase Out
            </label>
          ) : null}
          <RefreshButton onDone={reload} />
        </div>
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
            <Kpi label="SKU dihitung" value={fmt(tot!.skuCount)} hint={`${fmt(s.byStatus.EXCLUDED)} dikecualikan · ${fmt(s.byStatus.PHASE_OUT ?? 0)} phase out`} />
            <Kpi label="Total stok (Available)" value={fmt(tot!.stock)} hint={`+ ${fmt(tot!.transit)} dalam perjalanan`} />
            <Kpi label="DOI total — Opsi 1" value={fmtDoi(tot!.doi1)} unit="hari" hint={`ADS total ${fmt(tot!.ads1, 1)}/hari · 3 bln ex campaign`} />
            <Kpi label="DOI total — Opsi 2" value={fmtDoi(tot!.doi2)} unit="hari" hint={`ADS total ${fmt(tot!.ads2, 1)}/hari · max(8w,4w,2w)`} />
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
              <div className="table-scroll"><table className="dgrid mt-2">
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

            {poSum.count ? (
              <div className="card overflow-hidden">
                <div className="flex items-center justify-between px-4 pt-4">
                  <div>
                    <div className="card-title">Phase Out — pantau sell-down</div>
                    <div className="mt-0.5 text-[12px] text-label">
                      {fmt(poSum.count)} SKU · stok {fmt(poSum.stock)} pcs · perkiraan sisa saat target {fmt(poSum.excessQty)} pcs
                      {poSum.lateCount ? <span className="text-negative"> · {fmt(poSum.lateCount)} melewati target</span> : null}
                    </div>
                  </div>
                  <Link href="/phase-out" className="text-[12.5px] text-primary hover:underline">Kelola →</Link>
                </div>
                <div className="p-3"><DataGrid<SnapshotRow> id="dash-phaseout" compact rows={phaseOut} columns={PO_OUT_COLS} rowKey={(r) => r.sku} emptyText="Tidak ada." /></div>
              </div>
            ) : null}
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
