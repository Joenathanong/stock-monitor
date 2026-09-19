'use client';
import { useEffect, useState } from 'react';
import { Alert, Empty, RefreshButton, postJson, useApi } from '@/components/ui';

type Resp = { ok: boolean; settings: Record<string, string>; defaults: Record<string, string | number> };
type Exclusions = { ok: boolean; today: string; rows: { date: string; reason: string; manual: boolean }[] };

type Field = { key: string; label: string; hint?: string; type?: 'number' | 'bool' | 'select' | 'text'; options?: { v: string; l: string }[] };
const GROUPS: { title: string; fields: Field[] }[] = [
  {
    title: 'Cakupan data',
    fields: [
      { key: 'area_scope', label: 'Area OCS', type: 'select', options: ['Pusat', 'All', 'Surabaya', 'Medan', 'Yogyakarta', 'Makassar'].map((v) => ({ v, l: v })), hint: 'Stok dan penjualan dihitung untuk area ini saja.' },
      { key: 'include_inactive', label: 'Ikutkan SKU Tidak Aktif', type: 'bool' },
      { key: 'include_clearance', label: 'Ikutkan SKU CS- (clearance)', type: 'bool' },
    ],
  },
  {
    title: 'ADS Opsi 1 — rata-rata 3 bulan, exclude campaign',
    fields: [
      { key: 'opsi1_window_days', label: 'Jendela (hari)', type: 'number' },
      { key: 'payday_day', label: 'Tanggal gajian yang dikecualikan', type: 'number', hint: '0 = tidak ada' },
      { key: 'exclude_double_dates', label: 'Kecualikan double date (1.1 … 12.12)', type: 'bool' },
      { key: 'exclude_stockout_days', label: 'Keluarkan hari stok kosong dari pembagi', type: 'bool', hint: 'Butuh riwayat stok harian; efektif setelah aplikasi berjalan beberapa minggu.' },
    ],
  },
  {
    title: 'ADS Opsi 2 — maksimum dari tiga jendela',
    fields: [
      { key: 'opsi2_w8_days', label: '8 minggu (hari)', type: 'number' },
      { key: 'opsi2_w4_days', label: '4 minggu (hari)', type: 'number' },
      { key: 'opsi2_w2_days', label: '2 minggu (hari)', type: 'number' },
      { key: 'opsi2_apply_exclusion', label: 'Opsi 2 ikut mengecualikan tanggal campaign', type: 'bool', hint: 'Bawaan: tidak — Opsi 2 dimaksudkan menangkap tren terbaru termasuk lonjakan.' },
    ],
  },
  {
    title: 'Produk baru (NPL) & dead stock',
    fields: [
      { key: 'npl_days', label: 'Umur jual < N hari = NPL', type: 'number' },
      { key: 'npl_min_days', label: 'Umur jual < N hari = data belum cukup', type: 'number', hint: 'Di bawah ini tidak ada saran PO.' },
      { key: 'dead_stock_window_days', label: 'Dead stock: 0 penjualan selama (hari)', type: 'number' },
    ],
  },
  {
    title: 'Ambang tindakan',
    fields: [
      { key: 'target_doi_days', label: 'Target DOI maksimum (hari)', type: 'number', hint: 'Di atas ini = overstock. Saran qty PO mengisi sampai angka ini.' },
      { key: 'safety_days', label: 'Safety di atas lead time (hari)', type: 'number', hint: 'DOI ≤ lead time → kritis; ≤ lead time + safety → low stock.' },
      { key: 'default_lead_time_days', label: 'Lead time default (hari)', type: 'number' },
      { key: 'action_basis', label: 'DOI yang dipakai untuk status', type: 'select', options: [{ v: 'KONSERVATIF', l: 'Konservatif — DOI terkecil dari kedua opsi' }, { v: 'OPSI1', l: 'Opsi 1' }, { v: 'OPSI2', l: 'Opsi 2' }] },
    ],
  },
  {
    title: 'ABC',
    fields: [
      { key: 'abc_a_pct', label: 'Kelas A sampai kumulatif (%)', type: 'number' },
      { key: 'abc_b_pct', label: 'Kelas B sampai kumulatif (%)', type: 'number' },
    ],
  },
  {
    title: 'Tampilan',
    fields: [
      { key: 'doi_display', label: 'Opsi DOI yang ditampilkan', type: 'select', options: [
        { v: 'BOTH', l: 'Keduanya — Opsi 1 & Opsi 2' },
        { v: 'OPSI1', l: 'Opsi 1 saja — 3 bulan ex campaign' },
        { v: 'OPSI2', l: 'Opsi 2 saja — max(8w, 4w, 2w)' },
      ] },
    ],
  },
  {
    title: 'Phase out',
    fields: [
      { key: 'exclude_phase_out', label: 'Keluarkan SKU phase out dari DOI total & kelas ABC', type: 'bool' },
    ],
  },
  {
    title: 'Sinkronisasi & jadwal',
    fields: [
      { key: 'auto_compute', label: 'Hitung otomatis 07.30 WIB', type: 'bool' },
      { key: 'auto_sync_sales', label: 'Tarik penjualan otomatis 01.00 WIB', type: 'bool' },
      { key: 'sales_sync_lookback_days', label: 'Tarik ulang N hari terakhir', type: 'number' },
      { key: 'sales_include_ready', label: 'Ikutkan status READY_TO_PROCESS', type: 'bool', hint: 'Order sudah dibayar, belum diproses gudang.' },
      { key: 'sales_include_return', label: 'Ikutkan status RETURN', type: 'bool', hint: 'Order yang berakhir retur tetap dihitung sebagai permintaan.' },
    ],
  },
  {
    title: 'Dashboard TV (/tv — tanpa login)',
    fields: [
      { key: 'tv_slide_seconds', label: 'Detik per slide', type: 'number' },
      { key: 'tv_rows_per_slide', label: 'Baris tabel per slide', type: 'number', hint: 'Daftar panjang dipecah ke beberapa slide.' },
      { key: 'tv_refresh_minutes', label: 'Muat ulang data tiap (menit)', type: 'number' },
    ],
  },
];

export default function SettingsPage() {
  const { data, error, reload } = useApi<Resp>('/api/settings');
  const ex = useApi<Exclusions>('/api/exclusion');
  const [form, setForm] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newReason, setNewReason] = useState('');

  useEffect(() => { if (data) setForm(data.settings); }, [data]);

  async function save() {
    setBusy(true); setMsg(null);
    try {
      await postJson('/api/settings', form, 'PUT');
      setMsg({ tone: 'ok', text: 'Tersimpan. Klik "Hitung ulang" agar snapshot memakai pengaturan baru.' });
      reload(); ex.reload();
    } catch (e) { setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  }

  async function addDate() {
    if (!newDate) return;
    try { await postJson('/api/exclusion', { date: newDate, reason: newReason }); setNewDate(''); setNewReason(''); ex.reload(); }
    catch (e) { setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) }); }
  }
  async function removeDate(date: string) {
    await fetch(`/api/exclusion?date=${date}`, { method: 'DELETE' }); ex.reload();
  }

  const field = (f: Field) => {
    const v = form[f.key] ?? '';
    if (f.type === 'bool') {
      return <label className="flex h-8 items-center gap-2 text-[13px]"><input type="checkbox" checked={v === '1'} onChange={(e) => setForm({ ...form, [f.key]: e.target.checked ? '1' : '0' })} /> {v === '1' ? 'Ya' : 'Tidak'}</label>;
    }
    if (f.type === 'select') {
      return <select className="input" value={v} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}>{f.options!.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select>;
    }
    return <input className="input" type={f.type === 'number' ? 'number' : 'text'} value={v} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Pengaturan</h1>
        <div className="flex items-center gap-2">
          <RefreshButton withStock={false} />
          <button className="btn btn-primary" onClick={save} disabled={busy || !data}>{busy ? 'Menyimpan…' : 'Simpan pengaturan'}</button>
        </div>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {GROUPS.map((g) => (
          <div key={g.title} className="card card-pad">
            <div className="card-title mb-3">{g.title}</div>
            <div className="space-y-3">
              {g.fields.map((f) => (
                <div key={f.key} className="grid grid-cols-[1fr_200px] items-center gap-3">
                  <div>
                    <div className="text-[13px]">{f.label}</div>
                    {f.hint ? <div className="text-[12px] text-label">{f.hint}</div> : null}
                  </div>
                  <div>{data ? field(f) : null}</div>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="card card-pad lg:col-span-2">
          <div className="card-title mb-1">Tanggal yang dikecualikan (Opsi 1)</div>
          <div className="mb-3 text-[12.5px] text-label">Dihasilkan otomatis dari aturan di atas (gajian & double date), ditambah tanggal manual di bawah — misalnya flash sale khusus atau hari libur besar.</div>
          <div className="flex flex-wrap items-end gap-2">
            <div><label className="label">Tanggal</label><input type="date" className="input w-44" value={newDate} onChange={(e) => setNewDate(e.target.value)} /></div>
            <div className="w-64"><label className="label">Alasan</label><input className="input" value={newReason} onChange={(e) => setNewReason(e.target.value)} placeholder="mis. Flash sale brand" /></div>
            <button className="btn" onClick={addDate} disabled={!newDate}>Tambah tanggal manual</button>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {ex.data?.rows.length ? ex.data.rows.map((r) => (
              <span key={r.date} className={`chip ${r.manual ? 'chip-brand' : 'chip-gray'}`}>
                {r.date} · {r.reason}
                {r.manual ? <button className="ml-1 text-negative" title="hapus" onClick={() => removeDate(r.date)}>×</button> : null}
              </span>
            )) : <Empty>—</Empty>}
          </div>
        </div>
      </div>
    </div>
  );
}
