'use client';
import { useState } from 'react';
import { Alert, fmt, fmtDateTime, postForm, postJson, useApi } from '@/components/ui';
import { DataGrid, type Column } from '@/components/DataGrid';

type Coverage = {
  ok: boolean; today: string; rowCount: number; firstDate: string | null; lastDate: string | null;
  daysCoveredLast90: number; missingLast90: string[];
  batches: { id: string; filename: string; rowCount: number; note: string | null; uploadedAt: string }[];
};
type Batch = { id: string; filename: string; rowCount: number; note: string | null; uploadedAt: string };
type Log = { id: number; kind: string; trigger: string; startedAt: string; finishedAt: string | null; status: string; rows: number; message: string | null };
type Status = { ok: boolean; logs: Log[] };

const BATCH_COLS: Column<Batch>[] = [
  { key: 'file', label: 'Berkas', get: (b) => b.filename, width: 220, isTitle: true },
  { key: 'rows', label: 'Baris', get: (b) => b.rowCount, type: 'number', mono: true, width: 80 },
  { key: 'range', label: 'Rentang', get: (b) => b.note, mono: true, width: 190 },
  { key: 'at', label: 'Waktu', get: (b) => b.uploadedAt, type: 'date', mono: true, width: 150, render: (b) => fmtDateTime(b.uploadedAt) },
];
const LOG_COLS: Column<Log>[] = [
  { key: 'kind', label: 'Jenis', get: (l) => l.kind, mono: true, width: 90, isTitle: true },
  { key: 'trigger', label: 'Pemicu', get: (l) => l.trigger, width: 80 },
  { key: 'at', label: 'Mulai', get: (l) => l.startedAt, type: 'date', mono: true, width: 150, render: (l) => fmtDateTime(l.startedAt) },
  { key: 'status', label: 'Status', get: (l) => l.status, width: 90, render: (l) => <span className={`chip chip-noicon ${l.status === 'ok' ? 'chip-ok' : l.status === 'error' ? 'chip-bad' : 'chip-gray'}`}>{l.status}</span> },
  { key: 'rows', label: 'Baris', get: (l) => l.rows, type: 'number', mono: true, width: 80 },
  { key: 'msg', label: 'Pesan', get: (l) => l.message, width: 260, prio: 'p2' },
];

export default function SalesPage() {
  const cov = useApi<Coverage>('/api/import/sales');
  const st = useApi<Status>('/api/status');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error' | 'warn' | 'info'; text: string } | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [days, setDays] = useState('7');

  function refresh() { cov.reload(); st.reload(); }

  async function upload() {
    if (!file) return;
    setBusy('upload'); setMsg(null);
    try {
      const form = new FormData(); form.append('file', file);
      const r = await postForm('/api/import/sales', form);
      setMsg({ tone: r.warning ? 'warn' : 'ok', text: `${r.written} baris (${r.format}) ${r.firstDate} s/d ${r.lastDate}, ${r.coverageDays} hari.${r.skipped ? ` ${r.skipped} baris dilewati.` : ''} ${r.warning ?? ''}` });
      setFile(null); refresh();
    } catch (e) { setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(null); }
  }

  async function pull(body: { days?: number; from?: string; to?: string }) {
    setBusy('pull'); setMsg(null);
    try {
      const r = await postJson('/api/sync', body);
      setMsg({
        tone: r.skipped ? 'warn' : r.failed?.length ? 'warn' : 'ok',
        text: r.skipped ? r.message : `${r.rows} baris untuk ${r.dates.length} tanggal (${Math.round(r.durationMs / 1000)} dtk).${r.failed?.length ? ` Gagal: ${r.failed.join(', ')}` : ''}`,
      });
      refresh();
    } catch (e) { setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(null); }
  }

  const c = cov.data;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Data Penjualan</h1>
        <div className="mt-1 text-[12.5px] text-label">Sumber: OCS Report ORDER › SKU, area sesuai Pengaturan, semua status order dari PROCESSED ke atas (tanpa UNPAID / CANCELLED). Tiap 01.00 WIB, 7 hari terakhir ditarik ulang dan ditimpa.</div>
      </div>
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
      {cov.error ? <Alert tone="error">{cov.error}</Alert> : null}

      <div className="kpi-grid">
        <div className="card card-pad"><div className="kpi-label">Baris tersimpan</div><div className="kpi-value">{fmt(c?.rowCount)}</div></div>
        <div className="card card-pad"><div className="kpi-label">Tanggal terawal</div><div className="kpi-value text-[18px]">{c?.firstDate ?? '—'}</div><div className="kpi-hint">tanggal listing dicari mundur sampai sini</div></div>
        <div className="card card-pad"><div className="kpi-label">Tanggal terakhir</div><div className="kpi-value text-[18px]">{c?.lastDate ?? '—'}</div></div>
        <div className="card card-pad"><div className="kpi-label">Cakupan 90 hari</div><div className={`kpi-value ${c && c.daysCoveredLast90 < 90 ? 'text-critical' : ''}`}>{c?.daysCoveredLast90 ?? '—'} / 90</div>
          <div className="kpi-hint">{c?.missingLast90.length ? `hilang: ${c.missingLast90.slice(0, 6).join(', ')}${c.missingLast90.length > 6 ? ` +${c.missingLast90.length - 6}` : ''}` : 'lengkap'}</div></div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card card-pad">
          <div className="card-title mb-2">Unggah histori awal (XLSX)</div>
          <div className="text-[12.5px] text-label">Bentuk panjang <code>Date | SKU | Qty</code> (opsional Area) atau melebar (SKU lalu satu kolom per tanggal). Baris dengan kunci sama ditimpa. Unggah sejak Januari supaya tanggal listing akurat.</div>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="flex-1"><input type="file" accept=".xlsx" className="input h-auto py-1" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
            <button className="btn btn-primary" onClick={upload} disabled={!file || !!busy}>{busy === 'upload' ? 'Mengunggah…' : 'Unggah'}</button>
            <a className="btn" href="/api/template?kind=sales">Template</a>
          </div>
        </div>
        <div className="card card-pad">
          <div className="card-title mb-2">Tarik dari OCS sekarang</div>
          <div className="flex flex-wrap items-end gap-2">
            <div><label className="label">N hari terakhir</label><input className="input w-20" value={days} onChange={(e) => setDays(e.target.value)} /></div>
            <button className="btn" onClick={() => pull({ days: Number(days) })} disabled={!!busy}>{busy === 'pull' ? 'Menarik…' : 'Tarik N hari'}</button>
            <span className="text-muted">|</span>
            <div><label className="label">Dari</label><input type="date" className="input w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><label className="label">Sampai</label><input type="date" className="input w-40" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            <button className="btn" onClick={() => pull({ from, to })} disabled={!!busy || !from || !to}>Tarik rentang</button>
          </div>
          <div className="mt-2 text-[12px] text-label">Maksimal 31 hari per penarikan (±2 detik/hari). Untuk histori panjang lebih cepat lewat CLI: <code>npm run backfill:sales -- --from=2026-01-01 --to=2026-09-14</code>.</div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div>
          <div className="card-title mb-2">Riwayat unggahan</div>
          <DataGrid<Batch> id="sales-batches" compact rows={c?.batches ?? []} columns={BATCH_COLS} rowKey={(b) => b.id} emptyText="Belum ada unggahan." />
        </div>
        <div>
          <div className="card-title mb-2">Log sinkronisasi & perhitungan</div>
          <DataGrid<Log> id="sales-logs" compact rows={st.data?.logs ?? []} columns={LOG_COLS} rowKey={(l) => String(l.id)} emptyText="Belum ada log." />
        </div>
      </div>
    </div>
  );
}
