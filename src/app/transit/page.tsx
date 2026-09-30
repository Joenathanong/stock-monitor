'use client';
import { useMemo, useState } from 'react';
import { Alert, Empty, RefreshButton, fmt, fmtDateTime, postForm, postJson, useApi } from '@/components/ui';
import { DataGrid, type Column } from '@/components/DataGrid';

type Hitung = 'IKUT' | 'BELUM_HITUNG' | 'TIDAK_ADA_STOK';
type Row = {
  sku: string; areaId: string; qty: number; qtyBatch: number; source: string;
  docNums: string | null; eta: string | null; note: string | null; updatedAt: string;
  hitung: Hitung; qtyDipakai: number; perCtn: number; ctnPcs: string; boxMismatch: boolean;
};
type PerArea = { area: string; sku: number; qty: number; ocs: number; manual: number };
type Ringkas = {
  total: number; ikut: number; dariOcs: number; manual: number; boxBeda: number;
  belumHitung: { sku: number; qty: number };
  tidakAdaStok: { sku: number; qty: number; contoh: string[] };
};
type Resp = {
  ok: boolean; rows: Row[]; snapshotDate: string | null; ringkas: Ringkas; perArea: PerArea[];
  batches: { id: string; filename: string; rowCount: number; uploadedAt: string }[];
};

const HITUNG_TEKS: Record<Hitung, string> = {
  IKUT: 'Ikut dihitung',
  BELUM_HITUNG: 'Belum — hitung ulang',
  TIDAK_ADA_STOK: 'Tidak ada di stok OCS',
};
const HITUNG_KELAS: Record<Hitung, string> = {
  IKUT: 'text-positive',
  BELUM_HITUNG: 'text-critical',
  TIDAK_ADA_STOK: 'text-negative',
};

export default function TransitPage() {
  const { data, error, reload } = useApi<Resp>('/api/transit');
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error' | 'warn'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ sku: string; areaId: string; qty: string; eta: string } | null>(null);
  const [areaFilter, setAreaFilter] = useState<string>('SEMUA');

  async function tarikOcs() {
    setBusy('ocs'); setMsg(null);
    try {
      const r = await postJson('/api/transit/sync?force=1');
      setMsg({
        // `partial` yang menandai belum tuntas, bukan `ok`. Penarikan sebagian
        // tetap menulis baris, jadi ok:true — dulu ok:false dilempar postJson
        // sebagai error tanpa pesan dan layar hanya menampilkan "HTTP 200".
        tone: r.partial ? 'warn' : 'ok',
        text: r.skipped ? r.message
          : `${r.rows} baris dari ${r.docs} dokumen (${Math.round((r.durationMs ?? 0) / 1000)} dtk).`
            + `${r.takCocok ? ` ${r.takCocok} kode SAP tidak ketemu SKU-nya.` : ''}`
            + `${r.message ? ` ${r.message}` : ''} Klik "Hitung ulang" agar DOI memakai angka baru.`,
      });
      reload();
    } catch (e) { setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(null); }
  }

  async function upload() {
    if (!file) return;
    setBusy('upload'); setMsg(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await postForm('/api/transit', form);
      setMsg({ tone: r.skipped ? 'warn' : 'ok', text: `Baris manual diganti: ${r.inserted} baris.${r.skipped ? ` ${r.skipped} baris dilewati: ${r.problems.join('; ')}` : ''} Baris dari OCS tidak disentuh. Klik "Hitung ulang" agar DOI memakai angka baru.` });
      setFile(null); reload();
    } catch (e) { setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(null); }
  }

  async function save() {
    if (!edit) return;
    try {
      await postJson('/api/transit', { sku: edit.sku, areaId: edit.areaId, qty: Number(edit.qty), eta: edit.eta || null }, 'PATCH');
      setEdit(null); reload();
    } catch (e) { setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) }); }
  }

  async function clearManual() {
    if (!confirm('Kosongkan baris MANUAL saja? Baris dari OCS tidak dihapus.')) return;
    await fetch('/api/transit', { method: 'DELETE' }); reload();
  }

  const rk = data?.ringkas;
  const perArea = data?.perArea ?? [];
  const rows = useMemo(
    () => (data?.rows ?? []).filter((r) => areaFilter === 'SEMUA' || r.areaId === areaFilter),
    [data, areaFilter],
  );
  const total = rows.reduce((s, r) => s + r.qty, 0);

  const columns = useMemo<Column<Row>[]>(() => [
    { key: 'area', label: 'Gudang', get: (r) => r.areaId, width: 120 },
    { key: 'sku', label: 'SKU', get: (r) => r.sku, mono: true, width: 240, isTitle: true, sticky: true },
    { key: 'qty', label: 'Qty (pcs)', get: (r) => r.qty, type: 'number', mono: true, width: 110,
      title: 'Dari DoQty OCS — sudah total pcs, tidak dikalikan isi karton',
      render: (r) => edit?.sku === r.sku && edit?.areaId === r.areaId
        ? <input className="input w-24 text-right" value={edit.qty} onChange={(e) => setEdit({ ...edit, qty: e.target.value })} onClick={(e) => e.stopPropagation()} />
        : fmt(r.qty) },
    { key: 'ctn', label: 'Karton', get: (r) => r.ctnPcs, width: 130, prio: 'p2',
      title: 'Tampilan saja: floor(qty ÷ isi karton) ctn + sisanya pcs',
      render: (r) => <span title={r.perCtn ? `isi ${r.perCtn}/ctn` : 'isi karton tidak diketahui'}>
        {r.ctnPcs}{r.boxMismatch ? <span className="ml-1 text-critical" title="Isi karton menurut OCS berbeda dari angka di nama produk">⚠</span> : null}
      </span> },
    { key: 'src', label: 'Sumber', get: (r) => (r.source === 'ocs' ? 'OCS' : 'Manual'), width: 90,
      render: (r) => <span className={`chip ${r.source === 'ocs' ? 'chip-brand' : 'chip-gray'}`}>{r.source === 'ocs' ? 'OCS' : 'Manual'}</span> },
    { key: 'hitung', label: 'Masuk dashboard', get: (r) => HITUNG_TEKS[r.hitung], width: 170,
      title: 'Transit hanya terhitung kalau SKU+gudangnya ada di daftar stok OCS aktif dan perhitungan sudah dijalankan setelah datanya berubah',
      render: (r) => <span className={HITUNG_KELAS[r.hitung]}>{HITUNG_TEKS[r.hitung]}{r.hitung === 'BELUM_HITUNG' && r.qtyDipakai ? ` (kini ${fmt(r.qtyDipakai)})` : ''}</span> },
    { key: 'eta', label: 'ETA', get: (r) => r.eta, type: 'date', mono: true, width: 120, prio: 'p2',
      render: (r) => edit?.sku === r.sku && edit?.areaId === r.areaId
        ? <input className="input w-36" type="date" value={edit.eta} onChange={(e) => setEdit({ ...edit, eta: e.target.value })} />
        : (r.eta ?? <span className="empty">—</span>) },
    { key: 'doc', label: 'No. DO', get: (r) => r.docNums, width: 180, prio: 'p3' },
    { key: 'batch', label: 'BatchQty', get: (r) => r.qtyBatch, type: 'number', mono: true, width: 110, prio: 'p3',
      title: 'Angka pembanding dari OCS. TIDAK dipakai DOI — di sebagian baris ini adalah stok batch penuh, bukan jumlah yang dikirim.',
      render: (r) => r.qtyBatch ? <span className={r.qtyBatch !== r.qty ? 'text-label' : ''}>{fmt(r.qtyBatch)}</span> : <span className="empty">—</span> },
    { key: 'updated', label: 'Diperbarui', get: (r) => r.updatedAt, type: 'date', mono: true, width: 140, prio: 'p3', render: (r) => fmtDateTime(r.updatedAt) },
    { key: 'act', label: '', get: () => null, noSort: true, noFilter: true, width: 150,
      render: (r) => r.source === 'ocs'
        ? <span className="text-[12px] text-label" title="Baris OCS ditimpa tiap sinkronisasi — mengeditnya tidak akan bertahan">dari OCS</span>
        : edit?.sku === r.sku && edit?.areaId === r.areaId
          ? <span className="space-x-1"><button className="btn btn-sm btn-primary" onClick={save}>Simpan</button><button className="btn btn-sm" onClick={() => setEdit(null)}>Batal</button></span>
          : <button className="btn btn-sm" onClick={() => setEdit({ sku: r.sku, areaId: r.areaId, qty: String(r.qty), eta: r.eta ?? '' })}>Edit</button> },
  ], [edit]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Stok Dalam Perjalanan</h1>
          <div className="mt-1 text-[12.5px] text-label">
            Ditarik otomatis dari OCS <b>Receive Stock</b>, dikelompokkan per gudang tujuan.
            Qty diambil dari <b>DoQty</b> — angka itu sudah total pcs, jadi tidak dikalikan lagi dengan isi karton.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn" onClick={tarikOcs} disabled={busy === 'ocs'}>{busy === 'ocs' ? 'Menarik…' : 'Tarik dari OCS'}</button>
          <RefreshButton withStock={false} onDone={reload} />
        </div>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}

      {rk && rk.total > 0 ? (
        <Alert tone={rk.tidakAdaStok.sku ? 'error' : rk.belumHitung.sku ? 'warn' : 'ok'}>
          <b>{fmt(rk.ikut)} pcs</b> dari {fmt(rk.total)} pcs sudah ikut terhitung di dashboard
          {data?.snapshotDate ? ` (snapshot ${data.snapshotDate})` : ''}.
          {' '}{fmt(rk.dariOcs)} pcs dari OCS · {fmt(rk.manual)} pcs manual.
          {rk.belumHitung.sku ? <> {' '}<b>{rk.belumHitung.sku} baris ({fmt(rk.belumHitung.qty)} pcs)</b> belum masuk — klik <b>Hitung ulang</b>.</> : null}
          {rk.tidakAdaStok.sku ? (
            <> {' '}<b>{rk.tidakAdaStok.sku} baris ({fmt(rk.tidakAdaStok.qty)} pcs)</b> SKU+gudangnya tidak ada di daftar stok OCS aktif, jadi tidak akan ikut dihitung: {rk.tidakAdaStok.contoh.join(', ')}{rk.tidakAdaStok.sku > rk.tidakAdaStok.contoh.length ? ', …' : ''}.</>
          ) : null}
          {rk.boxBeda ? <> {' '}<b>{rk.boxBeda} baris</b> isi kartonnya berbeda antara OCS dan nama produk (ditandai ⚠) — hanya memengaruhi tampilan ctn, bukan qty.</> : null}
          <div className="mt-1 text-[12px] text-label">Transit menambah <b>DOI + transit</b> dan kolom Transit, tapi <b>tidak</b> menambah Total stok maupun DOI total — DOI total sengaja memakai stok di tangan saja.</div>
        </Alert>
      ) : null}

      {perArea.length ? (
        <div className="card card-pad">
          <div className="card-title mb-2">Per gudang tujuan</div>
          <div className="flex flex-wrap gap-2">
            <button className={`btn btn-sm ${areaFilter === 'SEMUA' ? 'btn-primary' : ''}`} onClick={() => setAreaFilter('SEMUA')}>
              Semua · {fmt(perArea.reduce((s, a) => s + a.qty, 0))} pcs
            </button>
            {perArea.map((a) => (
              <button key={a.area} className={`btn btn-sm ${areaFilter === a.area ? 'btn-primary' : ''}`} onClick={() => setAreaFilter(a.area)}
                title={`${a.sku} SKU · ${fmt(a.ocs)} pcs dari OCS · ${fmt(a.manual)} pcs manual`}>
                {a.area} · {fmt(a.qty)} pcs
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="card card-pad">
          <div className="card-title mb-2">Unggah manual (mengganti baris manual saja)</div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1"><label className="label">Berkas XLSX — kolom SKU | Qty (opsional Area, ETA, Catatan)</label>
              <input type="file" accept=".xlsx" className="input h-auto py-1" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
            <button className="btn btn-primary" onClick={upload} disabled={!file || busy === 'upload'}>{busy === 'upload' ? 'Mengunggah…' : 'Unggah & ganti'}</button>
            <a className="btn" href="/api/template?kind=transit">Unduh template</a>
          </div>
          <div className="mt-2 text-[12px] text-label">Untuk barang jalan yang belum tercatat di OCS. Kolom Area kosong dianggap Pusat. SKU+Area yang muncul dua kali dijumlahkan. Baris dari OCS tidak pernah terpengaruh unggahan ini.</div>
        </div>
        <div className="card card-pad">
          <div className="card-title mb-2">Riwayat unggahan</div>
          {data?.batches.length ? (
            <ul className="space-y-1 text-[12.5px]">
              {data.batches.map((b) => <li key={b.id} className="flex justify-between gap-2"><span className="truncate">{b.filename}</span><span className="text-label">{b.rowCount} baris · {fmtDateTime(b.uploadedAt)}</span></li>)}
            </ul>
          ) : <div className="text-[12.5px] text-label">Belum ada unggahan.</div>}
        </div>
      </div>

      <DataGrid<Row>
        id="transit"
        rows={rows}
        columns={columns}
        rowKey={(r) => `${r.sku}|${r.areaId}`}
        emptyText="Kosong — tidak ada stok dalam perjalanan."
        toolbarExtra={<>
          <span className="text-[12px] text-label">total {fmt(total)} pcs</span>
          <button className="btn btn-sm btn-danger" onClick={clearManual} disabled={!rk?.manual}>Kosongkan manual</button>
        </>}
      />
    </div>
  );
}
