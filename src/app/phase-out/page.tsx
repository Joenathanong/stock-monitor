'use client';
import { useMemo, useState } from 'react';
import { Alert, Kpi, RefreshButton, fmt, fmtDateTime, postJson, useApi } from '@/components/ui';
import { DataGrid, type Column } from '@/components/DataGrid';
import { DISPOSITION_LABEL } from '@/lib/phase-out';

type Row = {
  sku: string; effectiveDate: string; reason: string | null; replacementSku: string | null;
  targetOutDate: string | null; disposition: string; note: string | null; updatedAt: string;
  name: string | null; stock: number | null; transit: number | null; ads: number | null;
  runOutDate: string | null; excessQty: number | null; lateDays: number | null;
};
type Resp = { ok: boolean; today: string; rows: Row[] };

const DISPO: Record<string, string> = DISPOSITION_LABEL;

/** Kesimpulan sell-down satu baris — inilah angka yang dipakai mengambil keputusan. */
function verdict(r: Row): { tone: 'ok' | 'warn' | 'bad' | 'muted'; text: string } {
  if (!r.targetOutDate) return { tone: 'muted', text: 'Target belum diisi' };
  if (r.stock === null) return { tone: 'muted', text: 'Belum ada snapshot' };
  if ((r.lateDays ?? 0) > 0) return { tone: 'bad', text: `Telat ${r.lateDays} hari · sisa ±${fmt(r.excessQty)} pcs` };
  if ((r.ads ?? 0) <= 0 && (r.stock ?? 0) > 0) return { tone: 'bad', text: 'Tidak ada penjualan — stok tidak akan habis' };
  return { tone: 'ok', text: 'Habis sebelum target' };
}

const TONE: Record<string, string> = { ok: 'chip-ok', warn: 'chip-warn', bad: 'chip-bad', muted: 'chip-gray' };

export default function PhaseOutPage() {
  const { data, error, reload } = useApi<Resp>('/api/phase-out');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error' | 'warn'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<{ sku: string; targetOutDate: string; reason: string; replacementSku: string; disposition: string; note: string } | null>(null);
  const [form, setForm] = useState({ sku: '', effectiveDate: '', reason: '', replacementSku: '', targetOutDate: '', disposition: 'SELL_DOWN', note: '' });

  const rows = data?.rows ?? [];
  const late = rows.filter((r) => (r.lateDays ?? 0) > 0);
  const totalStock = rows.reduce((s, r) => s + (r.stock ?? 0), 0);
  const totalExcess = rows.reduce((s, r) => s + (r.excessQty ?? 0), 0);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      await postJson('/api/phase-out', { ...form, effectiveDate: form.effectiveDate || data?.today });
      setMsg({ tone: 'ok', text: `${form.sku} masuk phase out. Klik "Hitung ulang" agar DOI mengikuti.` });
      setForm({ sku: '', effectiveDate: '', reason: '', replacementSku: '', targetOutDate: '', disposition: 'SELL_DOWN', note: '' });
      reload();
    } catch (err) { setMsg({ tone: 'error', text: err instanceof Error ? err.message : String(err) }); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!edit) return;
    try {
      await postJson('/api/phase-out', edit, 'PATCH');
      setEdit(null); reload();
    } catch (err) { setMsg({ tone: 'error', text: err instanceof Error ? err.message : String(err) }); }
  }

  async function remove(r: Row) {
    if (!confirm(`Keluarkan ${r.sku} dari phase out? SKU ini akan dihitung normal lagi setelah Hitung ulang.`)) return;
    setMsg(null);
    const res = await fetch(`/api/phase-out?sku=${encodeURIComponent(r.sku)}`, { method: 'DELETE' });
    if (!res.ok) { setMsg({ tone: 'error', text: 'Gagal menghapus' }); return; }
    reload();
  }

  const columns = useMemo<Column<Row>[]>(() => [
    { key: 'sku', label: 'SKU', get: (r) => r.sku, mono: true, width: 220, sticky: true, isTitle: true,
      render: (r) => <span className="font-semibold" title={r.name ?? undefined}>{r.sku}</span> },
    { key: 'eff', label: 'Efektif', get: (r) => r.effectiveDate, type: 'date', mono: true, width: 110 },
    { key: 'target', label: 'Target habis', get: (r) => r.targetOutDate, type: 'date', mono: true, width: 130,
      render: (r) => edit?.sku === r.sku
        ? <input className="input w-36" type="date" value={edit.targetOutDate} onChange={(e) => setEdit({ ...edit, targetOutDate: e.target.value })} onClick={(e) => e.stopPropagation()} />
        : (r.targetOutDate ?? <span className="empty">—</span>) },
    { key: 'stock', label: 'Stok', get: (r) => r.stock, type: 'number', mono: true, width: 90 },
    { key: 'ads', label: 'ADS', get: (r) => r.ads, type: 'number', mono: true, width: 80, title: 'Rata-rata jual harian (Opsi 1)', render: (r) => fmt(r.ads, 1) },
    { key: 'runout', label: 'Perkiraan habis', get: (r) => r.runOutDate, type: 'date', mono: true, width: 140 },
    { key: 'excess', label: 'Sisa saat target', get: (r) => r.excessQty, type: 'number', mono: true, width: 130,
      title: 'Perkiraan stok yang masih tersisa pada tanggal target — dasar keputusan diskon / bundling / retur' },
    { key: 'verdict', label: 'Kesimpulan', get: (r) => verdict(r).text, width: 230,
      render: (r) => { const v = verdict(r); return <span className={`chip chip-noicon ${TONE[v.tone]}`}>{v.text}</span>; } },
    { key: 'dispo', label: 'Disposisi', get: (r) => DISPO[r.disposition] ?? r.disposition, width: 140, prio: 'p2',
      render: (r) => edit?.sku === r.sku
        ? <select className="input w-36" value={edit.disposition} onChange={(e) => setEdit({ ...edit, disposition: e.target.value })}>
            {Object.entries(DISPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        : (DISPO[r.disposition] ?? r.disposition) },
    { key: 'rep', label: 'SKU pengganti', get: (r) => r.replacementSku, mono: true, width: 190, prio: 'p2',
      render: (r) => edit?.sku === r.sku
        ? <input className="input w-44" value={edit.replacementSku} onChange={(e) => setEdit({ ...edit, replacementSku: e.target.value })} />
        : (r.replacementSku ?? <span className="empty">—</span>) },
    { key: 'reason', label: 'Alasan', get: (r) => r.reason, width: 200, prio: 'p3',
      render: (r) => edit?.sku === r.sku
        ? <input className="input w-44" value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} />
        : (r.reason ?? <span className="empty">—</span>) },
    { key: 'note', label: 'Catatan', get: (r) => r.note, width: 200, prio: 'p3',
      render: (r) => edit?.sku === r.sku
        ? <input className="input w-44" value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
        : (r.note ?? <span className="empty">—</span>) },
    { key: 'upd', label: 'Diperbarui', get: (r) => r.updatedAt, type: 'date', mono: true, width: 140, prio: 'p3', render: (r) => fmtDateTime(r.updatedAt) },
    { key: 'act', label: '', get: () => null, noSort: true, noFilter: true, width: 170,
      render: (r) => edit?.sku === r.sku
        ? <span className="space-x-1"><button className="btn btn-sm btn-primary" onClick={save}>Simpan</button><button className="btn btn-sm" onClick={() => setEdit(null)}>Batal</button></span>
        : <span className="space-x-1">
            <button className="btn btn-sm" onClick={() => setEdit({ sku: r.sku, targetOutDate: r.targetOutDate ?? '', reason: r.reason ?? '', replacementSku: r.replacementSku ?? '', disposition: r.disposition, note: r.note ?? '' })}>Edit</button>
            <button className="btn btn-sm btn-danger" onClick={() => remove(r)} title="Keluarkan dari phase out">Keluarkan</button>
          </span> },
  ], [edit]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Phase Out</h1>
          <div className="mt-1 text-[12.5px] text-label">
            Produk yang dihentikan tapi <b>masih dijual sampai habis</b>. SKU di sini tidak pernah dapat saran PO,
            tidak dihitung sebagai overstock, dan (sesuai Pengaturan) dikeluarkan dari DOI total serta kelas ABC.
          </div>
        </div>
        <RefreshButton withStock={false} onDone={reload} />
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}

      <div className="kpi-grid">
        <Kpi label="SKU phase out" value={fmt(rows.length)} hint={`${fmt(rows.filter((r) => r.targetOutDate).length)} punya target habis`} />
        <Kpi label="Stok tersisa" value={fmt(totalStock)} unit="pcs" hint="dari snapshot terakhir" />
        <Kpi label="Perkiraan sisa saat target" value={fmt(totalExcess)} unit="pcs" hint="yang perlu didiskon / dibundling / diretur" tone={totalExcess > 0 ? 'text-negative' : undefined} />
        <Kpi label="Melewati target" value={fmt(late.length)} unit="SKU" hint="habisnya lebih lambat dari target" tone={late.length ? 'text-negative' : undefined} />
      </div>

      <form onSubmit={add} className="card card-pad">
        <div className="card-title mb-3">Tambah SKU ke phase out</div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div><label className="label">SKU</label><input className="input" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} required autoComplete="off" placeholder="mis. BALMTINT-SASSY-3" /></div>
          <div><label className="label">Tanggal efektif</label><input className="input" type="date" value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} /></div>
          <div><label className="label">Target habis</label><input className="input" type="date" value={form.targetOutDate} onChange={(e) => setForm({ ...form, targetOutDate: e.target.value })} /></div>
          <div><label className="label">Disposisi</label>
            <select className="input" value={form.disposition} onChange={(e) => setForm({ ...form, disposition: e.target.value })}>
              {Object.entries(DISPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div><label className="label">Alasan</label><input className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="mis. diganti formula baru" /></div>
          <div><label className="label">SKU pengganti</label><input className="input" value={form.replacementSku} onChange={(e) => setForm({ ...form, replacementSku: e.target.value })} autoComplete="off" /></div>
          <div className="xl:col-span-2"><label className="label">Catatan</label><input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button className="btn btn-primary" disabled={busy || !form.sku.trim()}>{busy ? 'Menyimpan…' : 'Tambahkan'}</button>
          <span className="text-[12px] text-label">Tanggal efektif kosong = hari ini. Target habis boleh diisi belakangan.</span>
        </div>
      </form>

      <DataGrid<Row>
        id="phase-out"
        rows={rows}
        columns={columns}
        rowKey={(r) => r.sku}
        loading={!data}
        emptyText="Belum ada SKU phase out."
        footerNote="Sisa saat target = stok + transit − (ADS × sisa hari sampai target)"
      />
    </div>
  );
}
