'use client';
import { Suspense, useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AbcChip, Alert, Empty, RefreshButton, STATUS_ORDER, STATUS_TEXT, StatusChip, fmt, fmtDateTime, fmtDoi, useApi } from '@/components/ui';
import { DataGrid, type Column } from '@/components/DataGrid';
import type { SnapshotRow, SnapshotView } from '@/lib/query';

type Resp = SnapshotView & { ok: boolean };

export default function MonitoringPage() {
  return (
    <Suspense fallback={<Empty>Memuat…</Empty>}>
      <Monitoring />
    </Suspense>
  );
}

function Monitoring() {
  const params = useSearchParams();
  const { data, error, loading, reload } = useApi<Resp>('/api/monitoring');
  const [status, setStatus] = useState(params.get('status') || 'ALL');
  const [abc, setAbc] = useState('ALL');
  const [nplOnly, setNplOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const earliest = data?.earliestDataDate ?? null;

  const preFilter = useCallback((r: SnapshotRow) => {
    if (status === 'PO' ? !(r.status === 'CRITICAL' || r.status === 'LOW') : status !== 'ALL' && r.status !== status) return false;
    if (abc !== 'ALL' && r.abcClass !== abc) return false;
    if (nplOnly && !r.isNpl) return false;
    return true;
  }, [status, abc, nplOnly]);

  const columns = useMemo<Column<SnapshotRow>[]>(() => [
    { key: 'sku', label: 'SKU', get: (r) => r.sku, mono: true, width: 240, sticky: true, isTitle: true,
      render: (r) => <span className="font-semibold" title={r.name}>{r.sku}</span> },
    { key: 'abc', label: 'ABC', get: (r) => r.abcClass, width: 64, render: (r) => <AbcChip cls={r.abcClass} /> },
    { key: 'status', label: 'Status', get: (r) => STATUS_TEXT[r.status] ?? r.status, width: 130, render: (r) => <StatusChip status={r.status} /> },
    { key: 'stock', label: 'Stok', get: (r) => r.availableQty, type: 'number', mono: true, width: 80, title: 'Available Qty OCS (On Hand − On Order)' },
    { key: 'transit', label: 'Transit', get: (r) => r.transitQty, type: 'number', mono: true, width: 76, prio: 'p2', render: (r) => r.transitQty ? fmt(r.transitQty) : <span className="empty">—</span> },
    { key: 'ads1', label: 'ADS 1', get: (r) => r.ads1, type: 'number', mono: true, width: 76, prio: 'p2', title: 'Rata-rata harian 3 bulan, exclude double date & payday', render: (r) => fmt(r.ads1, 1) },
    { key: 'ads2', label: 'ADS 2', get: (r) => r.ads2, type: 'number', mono: true, width: 90, prio: 'p2', title: 'Max dari rata-rata 8w / 4w / 2w', render: (r) => <>{fmt(r.ads2, 1)}<span className="ml-1 text-[10px] text-muted">{r.ads2Source}</span></> },
    { key: 'doi1', label: 'DOI 1', get: (r) => r.doi1, type: 'number', mono: true, width: 72, render: (r) => <b>{fmtDoi(r.doi1)}</b> },
    { key: 'doi2', label: 'DOI 2', get: (r) => r.doi2, type: 'number', mono: true, width: 72, render: (r) => <b>{fmtDoi(r.doi2)}</b> },
    { key: 'lt', label: 'LT', get: (r) => r.leadTimeDays, type: 'number', mono: true, width: 52, title: 'Lead time (hari)' },
    { key: 'sug1', label: 'Saran 1', get: (r) => r.suggested1, type: 'number', mono: true, width: 80, title: 'Qty PO untuk mencapai target DOI (Opsi 1)', render: (r) => r.suggested1 ? fmt(r.suggested1) : <span className="empty">—</span> },
    { key: 'sug2', label: 'Saran 2', get: (r) => r.suggested2, type: 'number', mono: true, width: 80, prio: 'p2', render: (r) => r.suggested2 ? fmt(r.suggested2) : <span className="empty">—</span> },
    { key: 'action', label: 'Saran tindakan', get: (r) => r.action + (r.nplNote ? ` · ${r.nplNote}` : ''), width: 240, prio: 'p2',
      render: (r) => <span title={r.action}>{r.action}{r.nplNote ? <span className="ml-1 text-primary">· {r.nplNote}</span> : null}</span> },
    { key: 'doi1t', label: 'DOI 1+T', get: (r) => r.doi1Transit, type: 'number', mono: true, width: 76, prio: 'p3', title: 'DOI Opsi 1 termasuk stok dalam perjalanan', render: (r) => fmtDoi(r.doi1Transit) },
    { key: 'doi2t', label: 'DOI 2+T', get: (r) => r.doi2Transit, type: 'number', mono: true, width: 76, prio: 'p3', render: (r) => fmtDoi(r.doi2Transit) },
    { key: 'first', label: 'Jual pertama', get: (r) => r.firstSalesDate, type: 'date', mono: true, width: 120, prio: 'p3',
      render: (r) => r.firstSalesDate ? <>{r.firstSalesDate}{earliest && r.firstSalesDate <= earliest ? <span className="ml-1 text-[10px] text-muted" title="Sama dengan awal data — tanggal listing bisa lebih tua">≥ awal</span> : null}</> : <span className="empty">—</span> },
    { key: 'sap', label: 'SAP', get: (r) => r.sapCode, mono: true, width: 100, prio: 'p3' },
  ], [earliest]);

  const exportUrl = `/api/export?status=${encodeURIComponent(status === 'PO' ? 'ALL' : status)}&abc=${abc}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Tabel DOI</h1>
          <div className="mt-1 text-[12.5px] text-label">
            {data?.computedAt ? <>Snapshot {data.snapshotDate}, dihitung {fmtDateTime(data.computedAt)} · {fmt(data.rows.length)} SKU</> : 'Belum ada snapshot'}
          </div>
        </div>
        <div className="btn-group flex flex-wrap items-center gap-2">
          <a className="btn" href={exportUrl}>Export XLSX</a>
          <RefreshButton onDone={reload} />
        </div>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}

      <DataGrid<SnapshotRow>
        id="monitoring"
        rows={data?.rows ?? []}
        columns={columns}
        rowKey={(r) => r.sku}
        loading={loading}
        preFilter={preFilter}
        expanded={open}
        onRowClick={(r) => setOpen(open === r.sku ? null : r.sku)}
        renderExpanded={(r) => <Detail r={r} earliest={earliest} />}
        footerNote="klik baris = rincian perhitungan"
        toolbarExtra={
          <>
            <select className="input" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
              <option value="ALL">Semua status</option>
              <option value="PO">Perlu open PO (kritis + low)</option>
              {STATUS_ORDER.map((k) => <option key={k} value={k}>{STATUS_TEXT[k]}</option>)}
            </select>
            <select className="input" style={{ width: 'auto' }} value={abc} onChange={(e) => setAbc(e.target.value)} aria-label="Kelas ABC">
              <option value="ALL">ABC: semua</option><option value="A">A</option><option value="B">B</option><option value="C">C</option>
            </select>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={nplOnly} onChange={(e) => setNplOnly(e.target.checked)} /> NPL</label>
          </>
        }
      />
    </div>
  );
}

function Detail({ r, earliest }: { r: SnapshotRow; earliest: string | null }) {
  const truncated = !!r.firstSalesDate && !!earliest && r.firstSalesDate <= earliest;
  return (
    <div className="grid gap-4 py-2 text-[12.5px] md:grid-cols-2 xl:grid-cols-4">
      <div>
        <div className="font-semibold text-primary">Opsi 1 — 3 bulan ex campaign</div>
        <div>Penjualan dihitung: <b>{fmt(r.salesEx)}</b> pcs / <b>{r.daysEx}</b> hari</div>
        <div>Penjualan 3 bln (semua hari): {fmt(r.sales90)} pcs</div>
        <div>ADS 1 = {fmt(r.ads1, 2)} → DOI {fmtDoi(r.doi1)} hari</div>
      </div>
      <div>
        <div className="font-semibold text-primary">Opsi 2 — max(8w, 4w, 2w)</div>
        <div>8 minggu: {fmt(r.ads8w, 2)} · 4 minggu: {fmt(r.ads4w, 2)} · 2 minggu: {fmt(r.ads2w, 2)}</div>
        <div>Dipakai: <b>{r.ads2Source}</b> = {fmt(r.ads2, 2)} → DOI {fmtDoi(r.doi2)} hari</div>
      </div>
      <div>
        <div className="font-semibold text-primary">Stok</div>
        <div>On hand {fmt(r.qtyOnHand)} · on order {fmt(r.qtyOnOrder)} · available <b>{fmt(r.availableQty)}</b></div>
        <div>Dalam perjalanan: {fmt(r.transitQty)} · lead time {r.leadTimeDays} hari</div>
        <div>Perkiraan habis: {r.runOutDate ?? '—'}</div>
      </div>
      <div>
        <div className="font-semibold text-primary">Produk & ABC</div>
        <div className="text-label">{r.name}</div>
        <div>Jual pertama: {r.firstSalesDate ?? '—'} {r.ageDays !== null ? `(${r.ageDays} hari)` : ''} {truncated ? '· ≥ awal data' : ''} {r.nplNote ? `· ${r.nplNote}` : ''}</div>
        <div>Pangsa penjualan {fmt(r.abcShare, 2)}% · kumulatif {fmt(r.abcCumShare, 1)}% → kelas {r.abcClass}</div>
        <div>SAP: {r.sapCode ?? '—'}</div>
      </div>
    </div>
  );
}
