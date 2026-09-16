'use client';
import { useMemo, useState } from 'react';
import { Alert, RefreshButton, fmt, fmtDateTime, postForm, postJson, useApi } from '@/components/ui';
import { DataGrid, type Column } from '@/components/DataGrid';

type Row = { sku: string; qty: number; eta: string | null; note: string | null; updatedAt: string };
type Resp = { ok: boolean; rows: Row[]; batches: { id: string; filename: string; rowCount: number; uploadedAt: string }[] };

export default function TransitPage() {
  const { data, error, reload } = useApi<Resp>('/api/transit');
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error' | 'warn'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<{ sku: string; qty: string; eta: string } | null>(null);

  async function upload() {
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await postForm('/api/transit', form);
      setMsg({ tone: r.skipped ? 'warn' : 'ok', text: `Tabel diganti: ${r.inserted} SKU.${r.skipped ? ` ${r.skipped} baris dilewati: ${r.problems.join('; ')}` : ''} Klik "Hitung ulang" agar DOI memakai angka baru.` });
      setFile(null); reload();
    } catch (e) { setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!edit) return;
    try {
      await postJson('/api/transit', { sku: edit.sku, qty: Number(edit.qty), eta: edit.eta || null }, 'PATCH');
      setEdit(null); reload();
    } catch (e) { setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) }); }
  }

  async function clearAll() {
    if (!confirm('Kosongkan seluruh stok dalam perjalanan?')) return;
    await fetch('/api/transit', { method: 'DELETE' }); reload();
  }

  const total = (data?.rows ?? []).reduce((s, r) => s + r.qty, 0);
  const columns = useMemo<Column<Row>[]>(() => [
    { key: 'sku', label: 'SKU', get: (r) => r.sku, mono: true, width: 260, isTitle: true, sticky: true },
    { key: 'qty', label: 'Qty', get: (r) => r.qty, type: 'number', mono: true, width: 100,
      render: (r) => edit?.sku === r.sku ? <input className="input w-24 text-right" value={edit.qty} onChange={(e) => setEdit({ ...edit, qty: e.target.value })} onClick={(e) => e.stopPropagation()} /> : fmt(r.qty) },
    { key: 'eta', label: 'ETA', get: (r) => r.eta, type: 'date', mono: true, width: 130,
      render: (r) => edit?.sku === r.sku ? <input className="input w-36" type="date" value={edit.eta} onChange={(e) => setEdit({ ...edit, eta: e.target.value })} /> : (r.eta ?? <span className="empty">—</span>) },
    { key: 'note', label: 'Catatan', get: (r) => r.note, width: 220 },
    { key: 'updated', label: 'Diperbarui', get: (r) => r.updatedAt, type: 'date', mono: true, width: 140, prio: 'p3', render: (r) => fmtDateTime(r.updatedAt) },
    { key: 'act', label: '', get: () => null, noSort: true, noFilter: true, width: 150,
      render: (r) => edit?.sku === r.sku
        ? <span className="space-x-1"><button className="btn btn-sm btn-primary" onClick={save}>Simpan</button><button className="btn btn-sm" onClick={() => setEdit(null)}>Batal</button></span>
        : <button className="btn btn-sm" onClick={() => setEdit({ sku: r.sku, qty: String(r.qty), eta: r.eta ?? '' })}>Edit</button> },
  ], [edit]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Stok Dalam Perjalanan</h1>
          <div className="mt-1 text-[12.5px] text-label">Satu angka per SKU. Unggahan bersifat <b>replace</b> — seluruh tabel diganti dengan isi berkas terakhir.</div>
        </div>
        <RefreshButton withStock={false} onDone={reload} />
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="card card-pad">
          <div className="card-title mb-2">Unggah berkas (replace)</div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1"><label className="label">Berkas XLSX — kolom SKU | Qty (opsional ETA, Catatan)</label>
              <input type="file" accept=".xlsx" className="input h-auto py-1" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
            <button className="btn btn-primary" onClick={upload} disabled={!file || busy}>{busy ? 'Mengunggah…' : 'Unggah & ganti'}</button>
            <a className="btn" href="/api/template?kind=transit">Unduh template</a>
          </div>
          <div className="mt-2 text-[12px] text-label">SKU yang muncul dua kali dijumlahkan. Qty 0 tidak disimpan. ETA hanya untuk catatan — DOI + transit menganggap barang tiba dalam lead time.</div>
        </div>
        <div className="card card-pad">
          <div className="card-title mb-2">Riwayat unggahan</div>
          {data?.batches.length ? (
            <ul className="space-y-1 text-[12.5px]">
              {data.batches.map((b) => <li key={b.id} className="flex justify-between gap-2"><span className="truncate">{b.filename}</span><span className="text-label">{b.rowCount} SKU · {fmtDateTime(b.uploadedAt)}</span></li>)}
            </ul>
          ) : <div className="text-[12.5px] text-label">Belum ada unggahan.</div>}
        </div>
      </div>

      <DataGrid<Row>
        id="transit"
        rows={data?.rows ?? []}
        columns={columns}
        rowKey={(r) => r.sku}
        emptyText="Kosong — tidak ada stok dalam perjalanan."
        toolbarExtra={<><span className="text-[12px] text-label">total {fmt(total)} pcs</span><button className="btn btn-sm btn-danger" onClick={clearAll} disabled={!data?.rows.length}>Kosongkan</button></>}
      />
    </div>
  );
}
