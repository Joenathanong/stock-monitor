'use client';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Empty, RefreshButton, opsi2Label, postJson, useApi, windowLabel } from '@/components/ui';
import AreaMaster from '@/components/AreaMaster';
import SkuLinkMaster from '@/components/SkuLinkMaster';

type Resp = { ok: boolean; settings: Record<string, string>; defaults: Record<string, string | number> };
type Exclusions = { ok: boolean; today: string; rows: { date: string; reason: string; manual: boolean }[] };

type Field = { key: string; label: string; hint?: string; type?: 'number' | 'bool' | 'select' | 'text'; options?: { v: string; l: string }[] };
type AreaRow = { areaId: string; skuCount: number; stock: number; transit: number; sales30: number; cancel30: number; lastSales: string | null };
type Batal = { salesMulai: string | null; batalMulai: string | null; hariTanpaBatal: number };
type Areas = { ok: boolean; areas: AreaRow[]; batal?: Batal };
/**
 * Judul & pilihan ikut angka yang sedang diisi di form — kalau jendela diubah
 * jadi 30 hari, keterangannya berubah jadi "1 bln", bukan tetap "3 bulan".
 */
const groupsFor = (v: Record<string, string>, areas: AreaRow[] = []): { title: string; fields: Field[] }[] => {
  const win1 = windowLabel(Number(v.opsi1_window_days));
  const win2 = opsi2Label(Number(v.opsi2_w8_days), Number(v.opsi2_w4_days), Number(v.opsi2_w2_days));
  return [
  {
    title: 'Cakupan data',
    fields: [
      { key: 'area_scope', label: 'Area bawaan di layar', type: 'select',
        options: [{ v: 'All', l: 'All — semua area digabung' },
          ...areas.map((a) => ({ v: a.areaId, l: `${a.areaId} — ${a.skuCount.toLocaleString('id-ID')} SKU` })),
          ...(v.area_scope && v.area_scope !== 'All' && !areas.some((a) => a.areaId === v.area_scope)
            ? [{ v: v.area_scope, l: `${v.area_scope} — belum ada datanya` }] : [])],
        hint: 'DOI dihitung untuk SEMUA kota sekaligus, plus satu baris gabungan — pengaturan ini tidak lagi membatasi apa pun, hanya jadi bawaan lama. Pilih area di pojok kanan atas tiap halaman.' },
      { key: 'include_inactive', label: 'Ikutkan SKU Tidak Aktif', type: 'bool' },
      { key: 'include_clearance', label: 'Ikutkan SKU CS- (clearance)', type: 'bool' },
    ],
  },
  {
    title: `ADS Opsi 1 — rata-rata ${win1}, exclude campaign`,
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
        { v: 'OPSI1', l: `Opsi 1 saja — ${win1} ex campaign` },
        { v: 'OPSI2', l: `Opsi 2 saja — ${win2}` },
      ] },
    ],
  },
  {
    title: 'Nilai stok (harga dari OCS)',
    fields: [
      { key: 'price_enabled', label: 'Tampilkan nilai rupiah', type: 'bool', hint: 'Harga ditarik dari /Products/GetProductSkus. OCS tidak punya HET; yang tersedia harga jual marketplace.' },
      { key: 'price_source', label: 'Harga yang dipakai', type: 'select', options: [
        { v: 'MIN', l: 'Terendah antar marketplace (paling konservatif)' },
        { v: 'AVG', l: 'Rata-rata antar marketplace' },
        { v: 'MAX', l: 'Tertinggi antar marketplace' },
      ] },
      { key: 'price_refresh_hours', label: 'Tarik ulang harga tiap (jam)', type: 'number', hint: '0 = tiap kali hitung ulang. Harga jarang berubah; makin besar, Refresh makin cepat.' },
    ],
  },
  {
    title: 'Barang dalam perjalanan (SIT)',
    fields: [
      { key: 'transit_enabled', label: 'Tarik otomatis dari OCS Receive Stock', type: 'bool',
        hint: 'Qty diambil dari DoQty — angka itu sudah total pcs, jadi tidak dikalikan isi karton. Baris unggahan manual tidak pernah ditimpa.' },
      { key: 'transit_refresh_hours', label: 'Tarik ulang transit tiap (jam)', type: 'number',
        hint: 'Dokumen receive jarang berubah; 0 = tarik setiap kali Refresh (Refresh jadi lebih lambat).' },
    ],
  },
  {
    title: 'Poster WhatsApp (/wa)',
    fields: [
      { key: 'wa_judul', label: 'Judul di poster', type: 'text',
        hint: 'Muncul besar di kiri atas gambar. Halaman dibuka dengan /wa?k=<token>; tokennya dari environment variable WA_PAGE_TOKEN, bukan dari sini — supaya tidak ikut terbaca siapa pun yang bisa membuka Pengaturan.' },
      { key: 'wa_blok_angka', label: 'Tampilkan angka inti (DOI, nilai, SIT, stok)', type: 'bool' },
      { key: 'wa_blok_status', label: 'Tampilkan sebaran status', type: 'bool',
        hint: 'Batang Kritis / Low / Aman / Overstock per area; sisanya dilipat jadi "Lain".' },
      { key: 'wa_blok_tren', label: 'Tampilkan tren DOI 30 hari', type: 'bool',
        hint: 'Garis kecil per area. Hari yang belum pernah dihitung memutus garis, tidak disambung lurus.' },
      { key: 'wa_blok_po', label: 'Tampilkan open PO & SKU paling mendesak', type: 'bool' },
      { key: 'wa_kritis_maks', label: 'Berapa SKU mendesak disebut per area', type: 'number',
        hint: 'Maksimal 6. Lebih dari 3 mulai sempit di lebar kartu 294px.' },
    ],
  },
  {
    title: 'Komposisi bundling (kolom Turunan di /atp)',
    fields: [
      { key: 'bundle_refresh_hours', label: 'Tarik ulang komposisi tiap (jam)', type: 'number',
        hint: 'Sumbernya OCS /master/bundle (2.029 bundle, 6.040 baris komponen, payload 2,5 MB). '
          + 'Master data yang jarang berubah, jadi TIDAK ditarik tiap Refresh — ada tombolnya sendiri di /atp. '
          + '0 = selalu tarik saat tombolnya ditekan. Menekan tombolnya selalu menarik, apa pun angka ini.' },
    ],
  },
  {
    title: 'Sugest PO — gudang pemasok & pembulatan karton',
    fields: [
      { key: 'po_whs_order', label: 'Urutan gudang pemasok', type: 'text',
        hint: 'Dipisah koma, dan URUTANNYA BERARTI: gudang pertama dihabiskan dulu, baru pindah ke berikutnya. '
          + 'Mis. GBJD2,GBJD = cek GBJD2 dulu; GBJD,GBJD2 = sebaliknya. Gudang menentukan lebih dulu daripada kode SAP, '
          + 'jadi kode 120 dari gudang pertama bisa terpakai walau 122 masih ada di gudang kedua. '
          + 'Kosongkan untuk memakai env EJI_WHS.' },
      { key: 'po_toleransi_ctn', label: 'Boleh melewati DOI max (karton)', type: 'number',
        hint: 'Kebutuhan hampir tidak pernah pas sekelipatan karton. 1 = boleh dibulatkan naik walau melewati batas '
          + 'DOI max sebanyak satu karton, supaya kebutuhan terpenuhi penuh. 0 = batas keras, kekurangannya dilaporkan.' },
      { key: 'po_lipat_maks', label: 'Toleransi hanya bila karton ≤ N× kebutuhan', type: 'number',
        hint: 'Penjaga kasus karton raksasa: isi 1000 pcs/karton untuk kebutuhan 50 pcs itu 20× — bukan "lewat sedikit". '
          + 'Di luar batas ini barisnya TIDAK dikirim otomatis, tapi dilaporkan untuk diputuskan orang. 0 = tanpa syarat.' },
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
      { key: 'sales_pull_areas', label: 'Area yang ditarik', type: 'text',
        hint: 'Dipisah koma, dipanggil satu per satu. Kosongkan untuk mendeteksi otomatis dari data stok. Diisi otomatis oleh npm run backfill:sales.' },
      { key: 'sales_area_start', label: 'Mulai operasional per area', type: 'text',
        hint: 'Format Area=YYYY-MM-DD dipisah koma, mis. Surabaya=2026-06-01,Medan=2026-06-01. Tanggal sebelum ini tidak ditarik untuk area tersebut dan tidak dihitung sebagai lubang data.' },
      { key: 'sales_include_cancel', label: 'Ikutkan qty order batal ke ADS', type: 'bool', hint: 'Seluruh status selalu ditarik; qty NA/UNPAID/IN_CANCEL/CANCELLED disimpan terpisah. Menyalakan ini menaikkan ADS dan MENURUNKAN DOI — order batal tidak pernah memakan stok.' },
    ],
  },
  {
    title: 'Dashboard TV (/tv — tanpa login)',
    fields: [
      { key: 'tv_slide_seconds', label: 'Detik per slide', type: 'number' },
            { key: 'tv_refresh_minutes', label: 'Muat ulang data tiap (menit)', type: 'number' },
    ],
  },
  ];
};

export default function SettingsPage() {
  const { data, error, reload } = useApi<Resp>('/api/settings');
  const ex = useApi<Exclusions>('/api/exclusion');
  const ar = useApi<Areas>('/api/areas');
  const [form, setForm] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newReason, setNewReason] = useState('');

  useEffect(() => { if (data) setForm(data.settings); }, [data]);

  // "Area=YYYY-MM-DD,..." → objek, supaya tabel area bisa menampilkan kolom Mulai.
  const mulaiArea = useMemo(() => {
    const out: Record<string, string> = {};
    for (const bagian of (form.sales_area_start ?? '').split(',')) {
      const i = bagian.indexOf('=');
      if (i > 0) out[bagian.slice(0, i).trim()] = bagian.slice(i + 1).trim();
    }
    return out;
  }, [form.sales_area_start]);


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
      return <label className="check"><input type="checkbox" checked={v === '1'} onChange={(e) => setForm({ ...form, [f.key]: e.target.checked ? '1' : '0' })} /> {v === '1' ? 'Ya' : 'Tidak'}</label>;
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
        {groupsFor(form, ar.data?.areas ?? []).map((g) => (
          <div key={g.title} className="card card-pad">
            <div className="card-title mb-3">{g.title}</div>
            <div className="space-y-3">
              {g.fields.map((f) => (
                <div key={f.key} className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_200px] md:items-center items-center gap-3">
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

        <AreaMaster />
        <SkuLinkMaster />

        <div className="card card-pad lg:col-span-2">
          <div className="card-title mb-1">Area yang terdeteksi di data</div>
          <div className="mb-3 text-[12px] text-label">
            Ini bukan daftar pendaftaran — ini apa yang BENAR-BENAR ada di data. Daftar cabangnya ada di kartu
            &quot;Cabang / Area&quot; di atas. Membandingkan keduanya memperlihatkan area yang sudah didaftarkan tapi
            datanya belum masuk, dan sebaliknya.
          </div>
          {ar.data?.batal && form.sales_include_cancel === '1' && ar.data.batal.hariTanpaBatal > 3 ? (
            <Alert tone="warn">
              Toggle <b>Ikutkan qty order batal ke ADS</b> menyala, tapi histori order batal baru ada sejak{' '}
              <b>{ar.data.batal.batalMulai ?? 'belum ada sama sekali'}</b> sementara data penjualan dimulai{' '}
              <b>{ar.data.batal.salesMulai}</b> — ada <b>{ar.data.batal.hariTanpaBatal} hari</b> yang angka batalnya masih nol
              karena ditarik dengan aturan lama. ADS jadi timpang: hari baru terhitung lebih tinggi daripada hari lama.
              Jalankan <code>npm run backfill:sales</code> dulu, baru nyalakan toggle ini.
            </Alert>
          ) : null}
          {ar.data?.areas.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead><tr className="text-label">
                  <th className="py-1 text-left">Area</th><th className="num">SKU</th><th className="num">Stok</th>
                  <th className="num">Jual 30 hr</th><th className="num">Batal 30 hr</th><th className="num">% batal</th><th className="num">Jual terakhir</th><th className="num">Mulai</th>
                </tr></thead>
                <tbody>
                  {ar.data.areas.map((a) => {
                    const dipakai = form.area_scope === a.areaId || form.area_scope === 'All';
                    const total = a.sales30 + a.cancel30;
                    return (
                      <tr key={a.areaId} className={dipakai ? '' : 'text-label'}>
                        <td className="py-1">{a.areaId}{dipakai ? <span className="ml-1.5 chip chip-brand">dihitung</span> : null}</td>
                        <td className="num mono">{a.skuCount.toLocaleString('id-ID')}</td>
                        <td className="num mono">{a.stock.toLocaleString('id-ID')}</td>
                        <td className="num mono">{a.sales30.toLocaleString('id-ID')}</td>
                        <td className="num mono">{a.cancel30.toLocaleString('id-ID')}</td>
                        <td className="num mono">{total ? `${((a.cancel30 / total) * 100).toFixed(1)}%` : '—'}</td>
                        <td className="num mono">{a.lastSales ?? '—'}</td>
                        <td className="num mono">{mulaiArea[a.areaId] ?? <span className="empty">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <Empty>Belum ada data area — jalankan Refresh atau tunggu cron 01.00.</Empty>}
        </div>

        <div className="card card-pad lg:col-span-2">
          <div className="card-title mb-1">Tanggal yang dikecualikan (Opsi 1)</div>
          <div className="mb-3 text-[12px] text-label">Dihasilkan otomatis dari aturan di atas (gajian & double date), ditambah tanggal manual di bawah — misalnya flash sale khusus atau hari libur besar.</div>
          <div className="flex flex-wrap items-end gap-2">
            <div><label className="label">Tanggal</label><input type="date" className="input w-44" value={newDate} onChange={(e) => setNewDate(e.target.value)} /></div>
            <div className="w-64"><label className="label">Alasan</label><input className="input" value={newReason} onChange={(e) => setNewReason(e.target.value)} placeholder="mis. Flash sale brand" /></div>
            <button className="btn" onClick={addDate} disabled={!newDate}>Tambah tanggal manual</button>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {ex.data?.rows.length ? ex.data.rows.map((r) => (
              <span key={r.date} className={`tag ${r.manual ? 'tag-brand' : ''}`}>
                <span><span className="mono">{r.date}</span> · {r.reason}</span>
                {r.manual ? <button className="tag-x" aria-label={`Hapus ${r.date}`} onClick={() => removeDate(r.date)}>×</button> : null}
              </span>
            )) : <Empty>—</Empty>}
          </div>
        </div>
      </div>
    </div>
  );
}
