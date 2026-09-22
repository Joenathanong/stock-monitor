'use client';
import { Suspense, useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AbcChip, Alert, Empty, RefreshButton, STATUS_ORDER, STATUS_TEXT, StatusChip, doiLabel, fmt, fmtDateTime, fmtDoi, opsi2Label, show1, show2, useApi, windowLabel } from '@/components/ui';
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
  const [nplOnly, setNplOnly] = useState(params.get('npl') === '1');
  const [hidePhaseOut, setHidePhaseOut] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const earliest = data?.earliestDataDate ?? null;
  const disp = data?.settings?.doiDisplay ?? 'BOTH';
  const s1 = show1(disp), s2 = show2(disp);
  const win1 = windowLabel(data?.settings?.opsi1WindowDays);
  const win2 = opsi2Label(data?.settings?.opsi2W8Days, data?.settings?.opsi2W4Days, data?.settings?.opsi2W2Days);

  const preFilter = useCallback((r: SnapshotRow) => {
    // Phase out disembunyikan secara bawaan, kecuali memang sedang difilter ke status itu.
    if (hidePhaseOut && r.status === 'PHASE_OUT' && status !== 'PHASE_OUT') return false;
    if (status === 'PO' ? !(r.status === 'CRITICAL' || r.status === 'LOW') : status !== 'ALL' && r.status !== status) return false;
    if (abc !== 'ALL' && r.abcClass !== abc) return false;
    if (nplOnly && !r.isNpl) return false;
    return true;
  }, [status, abc, nplOnly, hidePhaseOut]);

  const columns = useMemo<Column<SnapshotRow>[]>(() => [
    { key: 'sku', label: 'SKU', get: (r) => r.sku, mono: true, width: 240, sticky: true, isTitle: true,
      render: (r) => <span className="font-semibold" title={r.name}>{r.sku}</span> },
    { key: 'abc', label: 'ABC', get: (r) => r.abcClass, width: 64, render: (r) => <AbcChip cls={r.abcClass} /> },
    { key: 'status', label: 'Status', get: (r) => STATUS_TEXT[r.status] ?? r.status, width: 130, render: (r) => <StatusChip status={r.status} /> },
    { key: 'stock', label: 'Stok', get: (r) => r.availableQty, type: 'number', mono: true, width: 80, title: 'Available Qty OCS (On Hand − On Order)' },
    { key: 'transit', label: 'Transit', get: (r) => r.transitQty, type: 'number', mono: true, width: 76, prio: 'p2', render: (r) => r.transitQty ? fmt(r.transitQty) : <span className="empty">—</span> },
    ...(s1 ? [{ key: 'ads1', label: doiLabel('ADS', 1, disp), get: (r: SnapshotRow) => r.ads1, type: 'number' as const, mono: true, width: 76, prio: 'p2' as const, title: `Rata-rata harian ${win1}, exclude double date & payday`, render: (r: SnapshotRow) => fmt(r.ads1, 1) }] : []),
    ...(s2 ? [{ key: 'ads2', label: doiLabel('ADS', 2, disp), get: (r: SnapshotRow) => r.ads2, type: 'number' as const, mono: true, width: 90, prio: 'p2' as const, title: `Max dari rata-rata ${win2}`, render: (r: SnapshotRow) => <>{fmt(r.ads2, 1)}<span className="ml-1 text-[10px] text-muted">{r.ads2Source}</span></> }] : []),
    ...(s1 ? [{ key: 'doi1', label: doiLabel('DOI', 1, disp), get: (r: SnapshotRow) => r.doi1, type: 'number' as const, mono: true, width: 72, render: (r: SnapshotRow) => <b>{fmtDoi(r.doi1)}</b> }] : []),
    ...(s2 ? [{ key: 'doi2', label: doiLabel('DOI', 2, disp), get: (r: SnapshotRow) => r.doi2, type: 'number' as const, mono: true, width: 72, render: (r: SnapshotRow) => <b>{fmtDoi(r.doi2)}</b> }] : []),
    { key: 'lt', label: 'LT', get: (r) => r.leadTimeDays, type: 'number', mono: true, width: 52, title: 'Lead time (hari)' },
    ...(s1 ? [{ key: 'sug1', label: doiLabel('Saran', 1, disp), get: (r: SnapshotRow) => r.suggested1, type: 'number' as const, mono: true, width: 80, title: 'Qty PO untuk mencapai target DOI (Opsi 1)', render: (r: SnapshotRow) => r.suggested1 ? fmt(r.suggested1) : <span className="empty">—</span> }] : []),
    ...(s2 ? [{ key: 'sug2', label: doiLabel('Saran', 2, disp), get: (r: SnapshotRow) => r.suggested2, type: 'number' as const, mono: true, width: 80, prio: 'p2' as const, title: 'Qty PO untuk mencapai target DOI (Opsi 2)', render: (r: SnapshotRow) => r.suggested2 ? fmt(r.suggested2) : <span className="empty">—</span> }] : []),
    { key: 'action', label: 'Saran tindakan', get: (r) => r.action + (r.nplNote ? ` · ${r.nplNote}` : ''), width: 240, prio: 'p2',
      render: (r) => <span title={r.action}>{r.action}{r.nplNote ? <span className="ml-1 text-primary">· {r.nplNote}</span> : null}</span> },
    { key: 'poket', label: 'Ket. Phase Out', get: (r) => r.isPhaseOut ? [r.phaseOutSapCode, r.phaseOutReason, r.phaseOutNote].filter(Boolean).join(' · ') : null,
      width: 250, prio: 'p2', title: 'Kode SAP, alasan, dan catatan dari daftar Phase Out',
      render: (r) => {
        if (!r.isPhaseOut) return <span className="empty">—</span>;
        const ket = [r.phaseOutReason, r.phaseOutNote].filter(Boolean).join(' · ');
        const full = [r.phaseOutSapCode, ket].filter(Boolean).join(' · ') || 'Phase out';
        return (
          <span title={full}>
            {r.phaseOutSapCode ? <span className="font-mono text-[11px] text-label">{r.phaseOutSapCode}</span> : null}
            {r.phaseOutSapCode && ket ? ' · ' : null}
            {ket || (r.phaseOutSapCode ? null : <span className="text-label">tanpa keterangan</span>)}
          </span>
        );
      } },
    ...(s1 ? [{ key: 'doi1t', label: `${doiLabel('DOI', 1, disp)}+T`, get: (r: SnapshotRow) => r.doi1Transit, type: 'number' as const, mono: true, width: 76, prio: 'p3' as const, title: 'DOI Opsi 1 termasuk stok dalam perjalanan', render: (r: SnapshotRow) => fmtDoi(r.doi1Transit) }] : []),
    ...(s2 ? [{ key: 'doi2t', label: `${doiLabel('DOI', 2, disp)}+T`, get: (r: SnapshotRow) => r.doi2Transit, type: 'number' as const, mono: true, width: 76, prio: 'p3' as const, title: 'DOI Opsi 2 termasuk stok dalam perjalanan', render: (r: SnapshotRow) => fmtDoi(r.doi2Transit) }] : []),
    { key: 'first', label: 'Jual pertama', get: (r) => r.firstSalesDate, type: 'date', mono: true, width: 120, prio: 'p3',
      render: (r) => r.firstSalesDate ? <>{r.firstSalesDate}{earliest && r.firstSalesDate <= earliest ? <span className="ml-1 text-[10px] text-muted" title="Sama dengan awal data — tanggal listing bisa lebih tua">≥ awal</span> : null}</> : <span className="empty">—</span> },
    { key: 'potarget', label: 'Target habis', get: (r) => r.phaseOutTargetDate, type: 'date', mono: true, width: 120, prio: 'p3', title: 'Tanggal target stok phase out harus habis' },
    { key: 'poexcess', label: 'Sisa saat target', get: (r) => r.phaseOutExcessQty, type: 'number', mono: true, width: 130, prio: 'p3',
      title: 'Perkiraan stok tersisa pada tanggal target',
      render: (r) => r.phaseOutExcessQty === null ? <span className="empty">—</span>
        : <span className={(r.phaseOutLateDays ?? 0) > 0 ? 'text-negative font-semibold' : ''}>{fmt(r.phaseOutExcessQty)}</span> },
    { key: 'sap', label: 'SAP', get: (r) => r.sapCode, mono: true, width: 100, prio: 'p3' },
  ], [earliest, disp, s1, s2, win1, win2]);

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
        renderExpanded={(r) => <Detail r={r} earliest={earliest} disp={disp} win1={win1} win2={win2} />}
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
            <label className="flex items-center gap-2 text-[13px]" title="Phase out tidak dapat saran PO dan tidak dihitung di DOI total">
              <input type="checkbox" checked={hidePhaseOut} onChange={(e) => setHidePhaseOut(e.target.checked)} /> Sembunyikan Phase Out
            </label>
          </>
        }
      />
    </div>
  );
}

function Detail({ r, earliest, disp, win1, win2 }: { r: SnapshotRow; earliest: string | null; disp: 'OPSI1' | 'OPSI2' | 'BOTH'; win1: string; win2: string }) {
  const truncated = !!r.firstSalesDate && !!earliest && r.firstSalesDate <= earliest;
  return (
    <div className="grid gap-4 py-2 text-[12.5px] md:grid-cols-2 xl:grid-cols-4">
      <div className="md:col-span-2 xl:col-span-4">
        <Link className="btn btn-sm btn-primary" href={`/sku/${encodeURIComponent(r.sku)}`}>
          Analisis lengkap SKU ini →
        </Link>
        <span className="ml-2 text-label">grafik penjualan harian, riwayat stok & DOI, pecahan platform</span>
      </div>
      {show1(disp) ? (
      <div>
        <div className="font-semibold text-primary">Opsi 1 — {win1} ex campaign</div>
        <div>Penjualan dihitung: <b>{fmt(r.salesEx)}</b> pcs / <b>{r.daysEx}</b> hari</div>
        <div>Penjualan {win1} (semua hari): {fmt(r.sales90)} pcs</div>
        <div>ADS 1 = {fmt(r.ads1, 2)} → DOI {fmtDoi(r.doi1)} hari</div>
      </div>
      ) : null}
      {show2(disp) ? (
      <div>
        <div className="font-semibold text-primary">Opsi 2 — {win2}</div>
        <div>8 minggu: {fmt(r.ads8w, 2)} · 4 minggu: {fmt(r.ads4w, 2)} · 2 minggu: {fmt(r.ads2w, 2)}</div>
        <div>Dipakai: <b>{r.ads2Source}</b> = {fmt(r.ads2, 2)} → DOI {fmtDoi(r.doi2)} hari</div>
      </div>
      ) : null}
      <div>
        <div className="font-semibold text-primary">Stok</div>
        <div>On hand {fmt(r.qtyOnHand)} · on order {fmt(r.qtyOnOrder)} · available <b>{fmt(r.availableQty)}</b></div>
        <div>Dalam perjalanan: {fmt(r.transitQty)} · lead time {r.leadTimeDays} hari</div>
        <div>Perkiraan habis: {r.runOutDate ?? '—'}</div>
      </div>
      {r.isPhaseOut ? (
        <div>
          <div className="font-semibold" style={{ color: 'var(--critical)' }}>Phase Out</div>
          <div>Kode SAP: {r.phaseOutSapCode ?? '—'}</div>
          <div>Alasan: {r.phaseOutReason ?? '—'}{r.phaseOutNote ? ` · ${r.phaseOutNote}` : ''}</div>
          <div>Target habis: {r.phaseOutTargetDate ?? '—'}
            {(r.phaseOutLateDays ?? 0) > 0 ? <span className="text-negative"> · telat {r.phaseOutLateDays} hari, sisa ±{fmt(r.phaseOutExcessQty)} pcs</span> : null}
          </div>
          <div className="text-label">Tidak diberi saran PO dan tidak dihitung di DOI total.</div>
        </div>
      ) : null}
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
