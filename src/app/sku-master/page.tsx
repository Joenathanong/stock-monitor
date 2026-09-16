'use client';
import { useMemo, useState } from 'react';
import { Alert, RefreshButton, postForm, postJson, useApi } from '@/components/ui';
import { DataGrid, type Column } from '@/components/DataGrid';

type Row = { sku: string; name: string; leadTimeDays: number | null; isExcluded: boolean; note: string | null };
type Resp = { ok: boolean; rows: Row[] };
type SettingsResp = { ok: boolean; settings: Record<string, string> };

export default function SkuMasterPage() {
  const { data, error, reload } = useApi<Resp>('/api/sku-master');
  const settings = useApi<SettingsResp>('/api/settings');
  const defaultLt = Number(settings.data?.settings.default_lead_time_days ?? 7);

  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkDays, setBulkDays] = useState('7');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error' | 'warn'; text: string } | null>(null);
  const [edit, setEdit] = useState<{ sku: string; days: string; note: string } | null>(null);


  function report(text: string, tone: 'ok' | 'error' | 'warn' = 'ok') { setMsg({ tone, text }); }

  async function bulk(all: boolean) {
    const days = Number(bulkDays);
    if (!Number.isFinite(days) || days < 0) return report('Lead time tidak valid', 'error');
    const target = all ? 'SEMUA SKU' : `${sel.size} SKU terpilih`;
    if (!confirm(`Set lead time ${days} hari untuk ${target}?`)) return;
    setBusy(true);
    try {
      const r = await postJson('/api/sku-master', { bulk: { skus: all ? [] : [...sel], leadTimeDays: days } }, 'PATCH');
      report(`${r.updated} SKU diset ${r.leadTimeDays} hari. Klik "Hitung ulang" agar status memakai lead time baru.`);
      setSel(new Set()); reload();
    } catch (e) { report(e instanceof Error ? e.message : String(e), 'error'); }
    finally { setBusy(false); }
  }

  async function upload() {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData(); form.append('file', file);
      const r = await postForm('/api/sku-master', form);
      report(`${r.upserted} SKU diperbarui.${r.skipped ? ` ${r.skipped} dilewati: ${r.problems.join('; ')}` : ''}`, r.skipped ? 'warn' : 'ok');
      setFile(null); reload();
    } catch (e) { report(e instanceof Error ? e.message : String(e), 'error'); }
    finally { setBusy(false); }
  }

  async function saveRow() {
    if (!edit) return;
    try {
      await postJson('/api/sku-master', { sku: edit.sku, leadTimeDays: edit.days === '' ? null : Number(edit.days), note: edit.note }, 'PATCH');
      setEdit(null); reload();
    } catch (e) { report(e instanceof Error ? e.message : String(e), 'error'); }
  }

  async function toggleExclude(r: Row) {
    try { await postJson('/api/sku-master', { sku: r.sku, isExcluded: !r.isExcluded }, 'PATCH'); reload(); }
    catch (e) { report(e instanceof Error ? e.message : String(e), 'error'); }
  }

  const toggleSel = (sku: string, on: boolean) => setSel((prev) => { const n = new Set(prev); if (on) n.add(sku); else n.delete(sku); return n; });
  const columns = useMemo<Column<Row>[]>(() => [
    { key: 'sel', label: '', get: () => null, noSort: true, noFilter: true, width: 40, hideMobile: false,
      render: (r) => <input type="checkbox" aria-label={`Pilih ${r.sku}`} checked={sel.has(r.sku)} onChange={(e) => toggleSel(r.sku, e.target.checked)} /> },
    { key: 'sku', label: 'SKU', get: (r) => r.sku, mono: true, width: 240, sticky: true, isTitle: true },
    { key: 'name', label: 'Nama', get: (r) => r.name, width: 300, prio: 'p2', render: (r) => <span className="text-label" title={r.name}>{r.name}</span> },
    { key: 'lt', label: 'Lead time', get: (r) => r.leadTimeDays, type: 'number', mono: true, width: 110,
      render: (r) => edit?.sku === r.sku
        ? <input className="input w-20 text-right" value={edit.days} onChange={(e) => setEdit({ ...edit, days: e.target.value })} placeholder={String(defaultLt)} />
        : r.leadTimeDays ?? <span className="text-muted">{defaultLt} (default)</span> },
    { key: 'ex', label: 'Dikecualikan', get: (r) => (r.isExcluded ? 'Ya' : 'Tidak'), width: 120,
      render: (r) => <button className={`chip ${r.isExcluded ? 'chip-bad' : 'chip-ok'}`} onClick={() => toggleExclude(r)} title="klik untuk mengubah">{r.isExcluded ? 'Ya' : 'Tidak'}</button> },
    { key: 'note', label: 'Catatan', get: (r) => r.note, width: 220, prio: 'p3',
      render: (r) => edit?.sku === r.sku ? <input className="input w-52" value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /> : (r.note ?? <span className="empty">—</span>) },
    { key: 'act', label: '', get: () => null, noSort: true, noFilter: true, width: 150,
      render: (r) => edit?.sku === r.sku
        ? <span className="space-x-1"><button className="btn btn-sm btn-primary" onClick={saveRow}>Simpan</button><button className="btn btn-sm" onClick={() => setEdit(null)}>Batal</button></span>
        : <button className="btn btn-sm" onClick={() => setEdit({ sku: r.sku, days: r.leadTimeDays === null ? '' : String(r.leadTimeDays), note: r.note ?? '' })}>Edit</button> },
  ], [sel, edit, defaultLt]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Lead Time & Master SKU</h1>
          <div className="mt-1 text-[12.5px] text-label">Lead time kirim (hari) per SKU. Yang kosong memakai default <b>{defaultLt} hari</b> dari Pengaturan. SKU bisa dikecualikan (discontinued) agar tidak masuk saran PO.</div>
        </div>
        <RefreshButton withStock={false} onDone={reload} />
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card card-pad">
          <div className="card-title mb-2">Ganti massal</div>
          <div className="flex flex-wrap items-end gap-2">
            <div><label className="label">Lead time (hari)</label><input className="input w-28" value={bulkDays} onChange={(e) => setBulkDays(e.target.value)} /></div>
            <button className="btn" onClick={() => bulk(false)} disabled={busy || !sel.size}>Terapkan ke {sel.size} terpilih</button>
            <button className="btn btn-primary" onClick={() => bulk(true)} disabled={busy}>Terapkan ke SEMUA SKU</button>
          </div>
          <div className="mt-2 text-[12px] text-label">Centang baris di tabel untuk memilih, atau terapkan ke semua sekaligus lalu ubah yang berbeda satu per satu.</div>
        </div>
        <div className="card card-pad">
          <div className="card-title mb-2">Unggah 1 kolom (upsert per SKU)</div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1"><label className="label">XLSX — kolom SKU | Lead Time (Hari) | Exclude (0/1) | Catatan</label>
              <input type="file" accept=".xlsx" className="input h-auto py-1" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
            <button className="btn btn-primary" onClick={upload} disabled={!file || busy}>Unggah</button>
            <a className="btn" href="/api/template?kind=leadtime">Template</a>
          </div>
        </div>
      </div>

      <DataGrid<Row>
        id="sku-master"
        rows={data?.rows ?? []}
        columns={columns}
        rowKey={(r) => r.sku}
        loading={!data}
        preFilter={onlyEmpty ? (r) => r.leadTimeDays === null : undefined}
        rowClass={(r) => (r.isExcluded ? 'opacity-60' : '')}
        emptyText="Tidak ada SKU. Jalankan Refresh di Dashboard dulu agar daftar SKU terisi dari OCS."
        toolbarExtra={<><label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} /> Belum diisi</label><span className="text-[12px] text-label">terpilih {sel.size}</span></>}
      />
    </div>
  );
}
