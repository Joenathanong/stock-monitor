'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AbcChip, Alert, Bars, Empty, Kpi, RefreshButton, STATUS_COLOR, STATUS_ORDER, STATUS_TEXT, StatusChip, doiLabel, doiTotalLabel, fmt, fmtDateTime, fmtDoi, show1, show2, useApi } from '@/components/ui';
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
const overCols = (d: 'OPSI1' | 'OPSI2' | 'BOTH'): Column<SnapshotRow>[] => [
  { ...skuCol, width: 200 },
  { key: 'stock', label: 'Stok', get: (r) => r.availableQty, type: 'number', mono: true, width: 80 },
  ...(show1(d) ? [{ key: 'doi1', label: doiLabel('DOI', 1, d), get: (r: SnapshotRow) => r.doi1, type: 'number' as const, mono: true, width: 70, render: (r: SnapshotRow) => fmtDoi(r.doi1) }] : []),
  ...(show2(d) ? [{ key: 'doi2', label: doiLabel('DOI', 2, d), get: (r: SnapshotRow) => r.doi2, type: 'number' as const, mono: true, width: 70, render: (r: SnapshotRow) => fmtDoi(r.doi2) }] : []),
];
const NPL_COLS: Column<SnapshotRow>[] = [
  { ...skuCol, width: 180 },
  { key: 'stock', label: 'Stok', get: (r) => r.availableQty, type: 'number', mono: true, width: 76 },
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

/** Isi dashboard — dipakai versi berlogin (/) dan versi publik (/dashboard). */
export function DashboardBody({ apiUrl, readOnly = false }: { apiUrl: string; readOnly?: boolean }) {
  const { data, error, loading, reload } = useApi<Resp>(apiUrl);
  const [withPhaseOut, setWithPhaseOut] = useState(false);
  const s = data?.summary;
  const set = data?.settings;
  // Kedua versi total sudah dihitung saat compute, jadi toggle ini tidak menghitung ulang apa pun.
  const tot = s ? ((withPhaseOut ? s.totalWithPhaseOut : s.total) ?? s.total) : null;
  const poSum = s?.phaseOut ?? { count: 0, stock: 0, excessQty: 0, lateCount: 0 };
  const disp = set?.doiDisplay ?? 'BOTH';
  const OVER_COLS = useMemo(() => overCols(disp), [disp]);

  const critical = data?.po ?? [];
  const overstock = data?.overstock ?? [];
  const npl = data?.npl ?? [];
  const phaseOut = data?.phaseOut ?? [];

  // Resume dihitung dari SELURUH baris kelompoknya (dikirim server), bukan dari
  // 20/25 baris yang tampil — kalau tidak, angkanya ikut terpotong.
  const grp = data?.totals;

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
          {readOnly ? null : <RefreshButton onDone={reload} />}
        </div>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {!loading && data && !data.snapshotDate ? (
        <Alert tone="info">
          {readOnly ? <>Belum ada snapshot — perhitungan belum pernah dijalankan.</> : <>Belum ada snapshot. Pastikan histori penjualan sudah masuk (halaman <Link className="underline" href="/sales">Data Penjualan</Link>), lalu klik <b>Refresh</b>.</>}
        </Alert>
      ) : null}

      {s ? (
        <>
          <div className="kpi-grid">
            <Kpi label="SKU dihitung" value={fmt(tot!.skuCount)} hint={`${fmt(s.byStatus.EXCLUDED)} dikecualikan · ${fmt(s.byStatus.PHASE_OUT ?? 0)} phase out`} />
            <Kpi label="Total stok (Available)" value={fmt(tot!.stock)} hint={`+ ${fmt(tot!.transit)} dalam perjalanan`} />
            {show1(disp) ? <Kpi label={doiTotalLabel(1, disp)} value={fmtDoi(tot!.doi1)} unit="hari" hint={`ADS total ${fmt(tot!.ads1, 1)}/hari · 3 bln ex campaign`} /> : null}
            {show2(disp) ? <Kpi label={doiTotalLabel(2, disp)} value={fmtDoi(tot!.doi2)} unit="hari" hint={`ADS total ${fmt(tot!.ads2, 1)}/hari · max(8w,4w,2w)`} /> : null}
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
              <div className="table-scroll"><table className="dgrid dgrid-auto mt-2">
                <thead><tr><th>Kelas</th><th className="num">SKU</th><th className="num" title="Pangsa penjualan 3 bulan">%</th><th className="num">Stok</th>{show1(disp) ? <th className="num">{doiLabel('DOI', 1, disp)}</th> : null}{show2(disp) ? <th className="num">{doiLabel('DOI', 2, disp)}</th> : null}</tr></thead>
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
                        {show1(disp) ? <td className="num">{fmtDoi(k.total.doi1)}</td> : null}
                        {show2(disp) ? <td className="num">{fmtDoi(k.total.doi2)}</td> : null}
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
              <div className="flex items-start justify-between gap-3 px-4 pt-4">
                <div className="card-title">Prioritas open PO <TopTag shown={critical.length} total={grp?.po.count} note="paling mendesak" /></div>
                {readOnly ? null : <Link href="/monitoring?status=PO" className="shrink-0 text-[12.5px] text-primary hover:underline">Lihat semua →</Link>}
              </div>
              <div className="px-4 pt-3"><Resume items={[
                { k: 'SKU', v: fmt(grp?.po.count) },
                { k: 'Stok', v: fmt(grp?.po.stock), u: 'pcs' },
                { k: 'Transit', v: fmt(grp?.po.transit), u: 'pcs' },
                { k: 'Saran qty PO', v: fmt(grp?.po.suggested), u: 'pcs', tone: 'text-primary' },
              ]} /></div>
              <div className="p-3">
                <DataGrid<SnapshotRow> id="dash-po" compact rows={critical} columns={PO_COLS} rowKey={(r) => r.sku} emptyText="Tidak ada SKU kritis / low stock." />
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="card overflow-hidden">
                <div className="flex items-start justify-between gap-3 px-4 pt-4">
                  <div className="card-title">Overstock terbesar <TopTag shown={overstock.length} total={grp?.overstock.count} /></div>
                  {readOnly ? null : <Link href="/monitoring?status=OVERSTOCK" className="shrink-0 text-[12.5px] text-primary hover:underline">Lihat semua →</Link>}
                </div>
                <div className="px-4 pt-3"><Resume items={[
                  { k: 'SKU', v: fmt(grp?.overstock.count) },
                  { k: 'Stok', v: fmt(grp?.overstock.stock), u: 'pcs' },
                  { k: 'Jual 3 bln', v: fmt(grp?.overstock.sales90), u: 'pcs' },
                ]} /></div>
                <div className="p-3"><DataGrid<SnapshotRow> id="dash-over" compact rows={overstock} columns={OVER_COLS} rowKey={(r) => r.sku} emptyText="Tidak ada overstock." /></div>
              </div>
              <div className="card overflow-hidden">
                <div className="flex items-start justify-between gap-3 px-4 pt-4">
                  <div className="card-title">Produk baru (NPL) <TopTag shown={npl.length} total={grp?.npl.count} /></div>
                  {readOnly ? null : <Link href="/monitoring?npl=1" className="shrink-0 text-[12.5px] text-primary hover:underline">Lihat semua →</Link>}
                </div>
                <div className="px-4 pt-3"><Resume items={[
                  { k: 'SKU', v: fmt(grp?.npl.count) },
                  { k: 'Stok', v: fmt(grp?.npl.stock), u: 'pcs' },
                  { k: 'Jual 3 bln', v: fmt(grp?.npl.sales90), u: 'pcs' },
                ]} /></div>
                <div className="p-3"><DataGrid<SnapshotRow> id="dash-npl" compact rows={npl} columns={NPL_COLS} rowKey={(r) => r.sku} emptyText="Tidak ada produk baru." /></div>
              </div>
            </div>

            {poSum.count ? (
              <div className="card overflow-hidden">
                <div className="flex items-center justify-between px-4 pt-4">
                  <div className="card-title">Phase Out — pantau sell-down <TopTag shown={phaseOut.length} total={grp?.phaseOut.count} /></div>
                  {readOnly ? null : (
                    <span className="flex shrink-0 items-center gap-3 text-[12.5px]">
                      <Link href="/monitoring?status=PHASE_OUT" className="text-primary hover:underline">Lihat semua →</Link>
                      <Link href="/phase-out" className="text-primary hover:underline">Kelola →</Link>
                    </span>
                  )}
                </div>
                <div className="px-4 pt-3"><Resume items={[
                  { k: 'SKU', v: fmt(poSum.count) },
                  { k: 'Stok', v: fmt(poSum.stock), u: 'pcs' },
                  { k: 'Sisa saat target', v: fmt(poSum.excessQty), u: 'pcs' },
                  { k: 'Melewati target', v: fmt(poSum.lateCount), u: 'SKU', tone: poSum.lateCount ? 'text-negative' : undefined },
                ]} /></div>
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

/**
 * Resume total satu kelompok. Angkanya dari seluruh baris kelompok, bukan dari
 * baris yang kebetulan tampil — makanya dihitung di server.
 */
function Resume({ items }: { items: { k: string; v: React.ReactNode; u?: string; tone?: string }[] }) {
  return (
    <div className="resume-row">
      {items.map((i) => (
        <div key={i.k} className="resume-item">
          <span className="k">{i.k}</span>
          <span className={`v ${i.tone ?? ''}`}>{i.v}</span>
          {i.u ? <span className="u">{i.u}</span> : null}
        </div>
      ))}
    </div>
  );
}

/**
 * Penanda "TOP 20". Hanya muncul kalau daftarnya MEMANG dipotong — kalau
 * isinya kurang dari batas, tabel itu sudah lengkap dan labelnya menyesatkan.
 */
function TopTag({ shown, total, note = 'qty terbesar' }: { shown: number; total?: number; note?: string }) {
  if (total === undefined || total <= shown || !shown) return null;
  return <span className="top-tag">TOP {shown} · {note}</span>;
}
