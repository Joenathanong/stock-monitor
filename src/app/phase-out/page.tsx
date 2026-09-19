'use client';
import { useMemo, useState } from 'react';
import { Alert, Kpi, RefreshButton, fmt, fmtDateTime, postForm, postJson, useApi } from '@/components/ui';
import { DataGrid, type Column } from '@/components/DataGrid';
import { DISPOSITION_LABEL } from '@/lib/phase-out';

type Row = {
  key: string; matchType: 'SAP' | 'SKU'; matchValue: string; sapCode: string | null;
  effectiveDate: string | null; reason: string | null; replacementSku: string | null;
  targetOutDate: string | null; disposition: string; note: string | null; updatedAt: string;
  skuCount: number; skus: string | null; name: string | null;
  stock: number | null; transit: number | null; ads: number | null;
  runOutDate: string | null; excessQty: number | null; lateDays: number | null;
};
type Resp = { ok: boolean; today: string; sapKeyLen: number; rows: Row[] };

const DISPO: Record<string, string> = DISPOSITION_LABEL;
const TONE: Record<string, string> = { ok: 'chip-ok', warn: 'chip-warn', bad: 'chip-bad', muted: 'chip-gray' };

/** Status pencocokan — hal pertama yang perlu dicek setelah mengunggah. */
function matchState(r: Row): { tone: keyof typeof TONE; text: string } {
  if (r.skuCount === 0) return { tone: 'warn', text: 'Belum ketemu di snapshot' };
  if (r.skuCount === 1) return { tone: 'ok', text: '1 SKU' };
  return { tone: 'ok', text: `${r.skuCount} SKU` };
}

/** Kesimpulan sell-down — hanya berarti bila target habis diisi. */
function verdict(r: Row): { tone: keyof typeof TONE; text: string } {
  if (r.skuCount === 0) return { tone: 'muted', text: '—' };
  if (!r.targetOutDate) return { tone: 'muted', text: 'Tanpa target' };
  if ((r.lateDays ?? 0) > 0) return { tone: 'bad', text: `Telat ${r.lateDays} hari · sisa ±${fmt(r.excessQty)} pcs` };
  if ((r.ads ?? 0) <= 0 && (r.stock ?? 0) > 0) return { tone: 'bad', text: 'Tidak ada penjualan' };
  return { tone: 'ok', text: 'Habis sebelum target' };
}

export default function PhaseOutPage() {
  const { data, error, reload } = useApi<Resp>('/api/phase-out');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error' | 'warn'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [edit, setEdit] = useState<{ key: string; targetOutDate: string; reason: string; replacementSku: string; disposition: string; note: string } | null>(null);
  const [form, setForm] = useState({ sapCode: '', reason: '', note: '' });

  const rows = data?.rows ?? [];
  const keyLen = data?.sapKeyLen ?? 6;
  const unmatched = rows.filter((r) => r.skuCount === 0);
  const late = rows.filter((r) => (r.lateDays ?? 0) > 0);
  const totalStock = rows.reduce((s, r) => s + (r.stock ?? 0), 0);
  const totalSku = rows.reduce((s, r) => s + r.skuCount, 0);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      await postJson('/api/phase-out', form);
      setMsg({ tone: 'ok', text: `${form.sapCode} masuk phase out. Klik "Hitung ulang" agar DOI mengikuti.` });
      setForm({ sapCode: '', reason: '', note: '' });
      reload();
    } catch (err) { setMsg({ tone: 'error', text: err instanceof Error ? err.message : String(err) }); }
    finally { setBusy(false); }
  }

  async function upload() {
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData(); fd.append('file', file);
      const r = await postForm('/api/phase-out', fd);
      const dup = r.duplicates ? ` ${r.duplicates} baris kode kembar digabung.` : '';
      const skip = r.skipped ? ` ${r.skipped} dilewati${r.problems?.length ? `: ${r.problems.join('; ')}` : ''}.` : '';
      setMsg({ tone: r.skipped ? 'warn' : 'ok', text: `${r.upserted} kode phase out tersimpan.${dup}${skip} Klik "Hitung ulang" agar DOI mengikuti.` });
      setFile(null); reload();
    } catch (err) { setMsg({ tone: 'error', text: err instanceof Error ? err.message : String(err) }); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!edit) return;
    try { await postJson('/api/phase-out', edit, 'PATCH'); setEdit(null); reload(); }
    catch (err) { setMsg({ tone: 'error', text: err instanceof Error ? err.message : String(err) }); }
  }

  async function remove(r: Row) {
    if (!confirm(`Keluarkan ${r.sapCode ?? r.matchValue} dari phase out? SKU-nya dihitung normal lagi setelah Hitung ulang.`)) return;
    const res = await fetch(`/api/phase-out?key=${encodeURIComponent(r.key)}`, { method: 'DELETE' });
    if (!res.ok) { setMsg({ tone: 'error', text: 'Gagal menghapus' }); return; }
    reload();
  }

  async function clearAll() {
    if (!confirm('Kosongkan SELURUH daftar phase out?')) return;
    const res = await fetch('/api/phase-out?all=1', { method: 'DELETE' });
    if (!res.ok) { setMsg({ tone: 'error', text: 'Gagal mengosongkan' }); return; }
    reload();
  }

  const columns = useMemo<Column<Row>[]>(() => [
    { key: 'code', label: 'Kode SAP', get: (r) => r.sapCode ?? r.matchValue, mono: true, width: 150, sticky: true, isTitle: true,
      render: (r) => <span className="font-semibold" title={r.matchType === 'SAP' ? `Dicocokkan lewat ${keyLen} digit terakhir: ${r.matchValue}` : 'Dicocokkan lewat SKU'}>{r.sapCode ?? r.matchValue}</span> },
    { key: 'tail', label: `${keyLen} digit`, get: (r) => r.matchValue, mono: true, width: 96, title: `Kunci pencocokan — ${keyLen} karakter terakhir kode SAP` },
    { key: 'match', label: 'Cocok', get: (r) => matchState(r).text, width: 150,
      render: (r) => { const m = matchState(r); return <span className={`chip chip-noicon ${TONE[m.tone]}`}>{m.text}</span>; } },
    { key: 'skus', label: 'SKU terkena', get: (r) => r.skus, mono: true, width: 260,
      render: (r) => r.skus ? <span title={r.skus}>{r.skus}</span> : <span className="empty">—</span> },
    { key: 'stock', label: 'Stok', get: (r) => r.stock, type: 'number', mono: true, width: 90 },
    { key: 'ads', label: 'ADS', get: (r) => r.ads, type: 'number', mono: true, width: 80, title: 'Rata-rata jual harian (Opsi 1)', render: (r) => r.ads === null ? <span className="empty">—</span> : fmt(r.ads, 1) },
    { key: 'runout', label: 'Perkiraan habis', get: (r) => r.runOutDate, type: 'date', mono: true, width: 130, prio: 'p2' },
    { key: 'target', label: 'Target habis', get: (r) => r.targetOutDate, type: 'date', mono: true, width: 130, prio: 'p2',
      title: 'Opsional — diisi hanya bila ingin memantau tenggat sell-down',
      render: (r) => edit?.key === r.key
        ? <input className="input w-36" type="date" value={edit.targetOutDate} onChange={(e) => setEdit({ ...edit, targetOutDate: e.target.value })} onClick={(e) => e.stopPropagation()} />
        : (r.targetOutDate ?? <span className="empty">—</span>) },
    { key: 'verdict', label: 'Kesimpulan', get: (r) => verdict(r).text, width: 210, prio: 'p2',
      render: (r) => { const v = verdict(r); return <span className={`chip chip-noicon ${TONE[v.tone]}`}>{v.text}</span>; } },
    { key: 'reason', label: 'Alasan', get: (r) => r.reason, width: 200, prio: 'p3',
      render: (r) => edit?.key === r.key
        ? <input className="input w-44" value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} />
        : (r.reason ?? <span className="empty">—</span>) },
    { key: 'rep', label: 'SKU pengganti', get: (r) => r.replacementSku, mono: true, width: 180, prio: 'p3',
      render: (r) => edit?.key === r.key
        ? <input className="input w-44" value={edit.replacementSku} onChange={(e) => setEdit({ ...edit, replacementSku: e.target.value })} />
        : (r.replacementSku ?? <span className="empty">—</span>) },
    { key: 'dispo', label: 'Disposisi', get: (r) => DISPO[r.disposition] ?? r.disposition, width: 140, prio: 'p3',
      render: (r) => edit?.key === r.key
        ? <select className="input w-36" value={edit.disposition} onChange={(e) => setEdit({ ...edit, disposition: e.target.value })}>
            {Object.entries(DISPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        : (DISPO[r.disposition] ?? r.disposition) },
    { key: 'note', label: 'Catatan', get: (r) => r.note, width: 200, prio: 'p3',
      render: (r) => edit?.key === r.key
        ? <input className="input w-44" value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
        : (r.note ?? <span className="empty">—</span>) },
    { key: 'upd', label: 'Diperbarui', get: (r) => r.updatedAt, type: 'date', mono: true, width: 140, prio: 'p3', render: (r) => fmtDateTime(r.updatedAt) },
    { key: 'act', label: '', get: () => null, noSort: true, noFilter: true, width: 170,
      render: (r) => edit?.key === r.key
        ? <span className="space-x-1"><button className="btn btn-sm btn-primary" onClick={save}>Simpan</button><button className="btn btn-sm" onClick={() => setEdit(null)}>Batal</button></span>
        : <span className="space-x-1">
            <button className="btn btn-sm" onClick={() => setEdit({ key: r.key, targetOutDate: r.targetOutDate ?? '', reason: r.reason ?? '', replacementSku: r.replacementSku ?? '', disposition: r.disposition, note: r.note ?? '' })}>Edit</button>
            <button className="btn btn-sm btn-danger" onClick={() => remove(r)} title="Keluarkan dari phase out">Keluarkan</button>
          </span> },
  ], [edit, keyLen]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Phase Out</h1>
          <div className="mt-1 text-[12.5px] text-label">
            Produk yang dihentikan tapi <b>masih dijual sampai habis</b>. Dicocokkan lewat <b>{keyLen} digit terakhir kode SAP</b>,
            jadi dua kode untuk barang yang sama (prefiks 1222 / 1201) otomatis mengenai SKU yang sama.
            SKU yang terkena tidak pernah dapat saran PO, tidak dihitung sebagai overstock, dan dikeluarkan dari DOI total serta kelas ABC.
          </div>
        </div>
        <RefreshButton withStock={false} onDone={reload} />
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
      {unmatched.length ? (
        <Alert tone="warn">
          {fmt(unmatched.length)} kode belum ketemu di snapshot terakhir — cek apakah kodenya benar, atau SKU-nya memang tidak ada di stok OCS.
        </Alert>
      ) : null}

      <div className="kpi-grid">
        <Kpi label="Kode phase out" value={fmt(rows.length)} hint={`${fmt(totalSku)} SKU terkena`} />
        <Kpi label="Stok tersisa" value={fmt(totalStock)} unit="pcs" hint="dari snapshot terakhir" />
        <Kpi label="Belum ketemu" value={fmt(unmatched.length)} unit="kode" hint="tidak ada SKU yang cocok" tone={unmatched.length ? 'text-negative' : undefined} />
        <Kpi label="Melewati target" value={fmt(late.length)} unit="kode" hint="hanya untuk yang diberi target habis" tone={late.length ? 'text-negative' : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="card card-pad">
          <div className="card-title mb-2">Unggah daftar kode SAP</div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1"><label className="label">Berkas XLSX — kolom Kode SAP (wajib), Alasan, SKU Pengganti, Catatan</label>
              <input type="file" accept=".xlsx" className="input h-auto py-1" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
            <button className="btn btn-primary" onClick={upload} disabled={!file || busy}>{busy ? 'Mengunggah…' : 'Unggah'}</button>
            <a className="btn" href="/api/template?kind=phaseout">Template</a>
          </div>
          <div className="mt-2 text-[12px] text-label">
            Bersifat tambah/perbarui, bukan replace — kode lama tetap ada. Kode yang ekor {keyLen} digitnya sama dianggap satu barang dan digabung.
            Tanggal tidak perlu diisi.
          </div>
        </div>
        <form onSubmit={add} className="card card-pad">
          <div className="card-title mb-2">Tambah satu kode</div>
          <div className="space-y-2">
            <div><label className="label">Kode SAP</label><input className="input" value={form.sapCode} onChange={(e) => setForm({ ...form, sapCode: e.target.value })} required autoComplete="off" placeholder="mis. 1222123456" /></div>
            <div><label className="label">Alasan (opsional)</label><input className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>
          </div>
          <button className="btn btn-primary mt-3" disabled={busy || !form.sapCode.trim()}>Tambahkan</button>
        </form>
      </div>

      <DataGrid<Row>
        id="phase-out"
        rows={rows}
        columns={columns}
        rowKey={(r) => r.key}
        loading={!data}
        rowClass={(r) => (r.skuCount === 0 ? 'opacity-60' : '')}
        emptyText="Belum ada kode phase out. Unggah daftar kode SAP untuk memulai."
        footerNote={`pencocokan memakai ${keyLen} digit terakhir kode SAP`}
        toolbarExtra={<button className="btn btn-sm btn-danger" onClick={clearAll} disabled={!rows.length}>Kosongkan</button>}
      />
    </div>
  );
}
