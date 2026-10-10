'use client';
import { useEffect, useState } from 'react';
import { Alert, Empty, postJson, useApi } from '@/components/ui';
import { ambangDoi, ringkasPita, peringatanArea } from '@/lib/area-master';
import { KODE_GABUNGAN } from '@/lib/areas';

type BarisArea = {
  code: string; name: string; isActive: boolean; sortOrder: number;
  doiCritical: number | null; doiMin: number | null; doiMax: number | null;
  leadTimeDays: number | null; atpTarget: number | null;
  startDate: string | null; note: string | null;
};
type Resp = { ok: boolean; areas: BarisArea[]; belumTerdaftar: string[] };

const kosong: BarisArea = {
  code: '', name: '', isActive: true, sortOrder: 100,
  doiCritical: null, doiMin: null, doiMax: null,
  leadTimeDays: null, atpTarget: null, startDate: null, note: null,
};

/** Baris ambang laporan gabungan — bukan cabang, jadi diperlakukan berbeda. */
const isGabungan = (r: BarisArea) => r.code === KODE_GABUNGAN;

/**
 * Pratinjau pita untuk satu baris, dihitung dengan fungsi yang SAMA dengan
 * perhitungan DOI (`ambangDoi` + `ringkasPita`).
 *
 * Sengaja memakai fungsi yang sama, bukan menyusun teksnya sendiri di komponen:
 * kalau layar dan perhitungan punya rumus pita masing-masing, keduanya bisa
 * berbeda tanpa ada yang kelihatan keliru — dan yang dipercaya user adalah yang
 * di layar.
 */
function Pita({ r }: { r: BarisArea }) {
  const a = ambangDoi(r);
  const bentrok = (r.doiCritical ?? -1) >= (r.doiMin ?? Infinity)
    || (r.doiMax !== null && r.doiMin !== null && r.doiMax < r.doiMin);
  if (!a) {
    // Tidak ada lagi "(global)". Sejak 10 Okt 2026 tidak ada angka global yang
    // bisa dipakai diam-diam: baris yang belum lengkap memang belum berfungsi,
    // dan itu harus terbaca begitu — bukan ditampilkan seolah punya pita.
    return <span className="text-[11px]" style={{ color: 'var(--critical)' }}>belum lengkap — isi ketiganya</span>;
  }
  return (
    <span className={bentrok ? 'text-[11px]' : 'text-[11px] text-label'} style={bentrok ? { color: 'var(--critical)' } : undefined}>
      {ringkasPita(a)}
      {bentrok ? ' — batas salah urut, dikoreksi otomatis saat dihitung' : ''}
    </span>
  );
}

/** Peringatan baris (tidak memblokir simpan) — mis. lead time > ambang kritis. */
function Peringatan({ r }: { r: BarisArea }) {
  const p = peringatanArea(r).filter((x) => x.field === 'doiCritical');
  if (!p.length) return null;
  return <div className="text-[11px]" style={{ color: 'var(--critical)' }}>{p[0].pesan}</div>;
}

const num = (v: string): number | null => (v.trim() === '' ? null : Number(v));

/**
 * Daftar cabang / gudang — satu-satunya tempat area didaftarkan.
 *
 * Sebelum ini daftar area ditulis di kode (`KODE_AREA` di `receive.ts`), jadi
 * membuka cabang baru butuh deploy. Di sini cukup menambah baris.
 *
 * Kolom yang paling mudah salah dan paling mahal akibatnya adalah `code`: itu
 * kode gudang OCS (`AddressCode` di dokumen receive). Kalau salah, SIT cabang
 * itu tidak ketemu areanya dan qty-nya tidak ikut DOI mana pun.
 */
export default function AreaMaster() {
  const { data, error, reload } = useApi<Resp>('/api/area-master');
  const [rows, setRows] = useState<BarisArea[]>([]);
  const [baru, setBaru] = useState<BarisArea>(kosong);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error' | 'warn'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { if (data?.areas) setRows(data.areas); }, [data]);

  const ubah = (i: number, patch: Partial<BarisArea>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function simpan(r: BarisArea) {
    setBusy(r.code); setMsg(null);
    try {
      await postJson('/api/area-master', r, 'PUT');
      setMsg({ tone: 'ok', text: `${r.code} → ${r.name} tersimpan. Jalankan Refresh + Hitung ulang supaya datanya memakai daftar baru.` });
      reload();
    } catch (e) { setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(null); }
  }

  async function tambah() {
    setBusy('baru'); setMsg(null);
    try {
      await postJson('/api/area-master', baru, 'PUT');
      setBaru(kosong);
      setMsg({ tone: 'ok', text: 'Area ditambahkan.' });
      reload();
    } catch (e) { setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(null); }
  }

  async function nonaktifkan(code: string) {
    setBusy(code);
    try {
      const r = await fetch(`/api/area-master?code=${encodeURIComponent(code)}`, { method: 'DELETE' });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Gagal');
      setMsg({ tone: 'ok', text: `${code} dinonaktifkan — data lamanya tetap terbaca.` });
      reload();
    } catch (e) { setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(null); }
  }

  async function isiOtomatis() {
    setBusy('isi');
    try {
      const j = (await postJson('/api/area-master')) as { dibuat: string[]; perluKode: string[] };
      const bagian = [
        j.dibuat.length ? `${j.dibuat.length} area ditambahkan: ${j.dibuat.join(', ')}` : 'Tidak ada yang perlu ditambahkan.',
        j.perluKode.length ? `${j.perluKode.length} area masih perlu diisi kode gudangnya sendiri: ${j.perluKode.join(', ')}.` : '',
      ].filter(Boolean);
      setMsg({ tone: j.perluKode.length ? 'warn' : 'ok', text: bagian.join(' ') });
      reload();
    } catch (e) { setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(null); }
  }

  return (
    <div className="card card-pad lg:col-span-2">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="card-title">Cabang / Area</div>
        <button className="btn" onClick={isiOtomatis} disabled={busy === 'isi'}>
          {busy === 'isi' ? 'Mengisi…' : 'Isi dari data yang ada'}
        </button>
      </div>
      <div className="mb-3 text-[12px] text-label">
        Daftar ini yang dipakai seluruh aplikasi — penarikan penjualan, pencocokan SIT, dan perhitungan DOI.
        Membuka cabang baru cukup menambah baris di sini, tanpa deploy.
        <b> Kode</b> adalah kode gudang OCS (<span className="mono">AddressCode</span> di dokumen Receive Stock);
        kalau salah, SIT cabang itu tidak akan ketemu areanya.
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}

      {data?.belumTerdaftar.length ? (
        <Alert tone="warn">
          Ada di data tapi belum terdaftar: <b>{data.belumTerdaftar.join(', ')}</b>.
          Tambahkan di bawah dengan <b>kode gudang OCS yang benar</b> — barisnya sengaja tidak dibuat otomatis,
          karena kodenya tidak bisa diterka dan kode itulah yang dipakai mencocokkan SIT.
          Jalankan <code>npm run check:receive</code> untuk melihat kode gudang yang dipakai OCS.
        </Alert>
      ) : null}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead><tr className="text-label">
            <th className="py-1 text-left">Kode gudang</th>
            <th className="py-1 text-left">Nama area</th>
            <th className="num">Urut</th>
            <th className="num" title="DOI <= angka ini -> CRITICAL">Kritis ≤<br /><span className="text-label">(hari)</span></th>
            <th className="num" title="DOI <= angka ini -> LOW, masuk Sugest PO">Low ≤<br /><span className="text-label">(hari)</span></th>
            <th className="num" title="DOI <= angka ini -> AMAN; di atasnya OVERSTOCK">Aman ≤<br /><span className="text-label">(hari)</span></th>
            <th className="num" title="Berapa lama barang sampai setelah PO ditekan. Dipakai saran qty PO; SKU yang punya lead time sendiri menang.">Lead time<br /><span className="text-label">(hari)</span></th>
            <th className="num" title="Ketersediaan di bawah angka ini ditandai merah di poster /wa">Target ATP<br /><span className="text-label">(%)</span></th>
            <th className="num">Mulai</th>
            <th className="py-1 text-left">Pita</th>
            <th className="py-1 text-left">Catatan</th>
            <th className="py-1 text-left">Aktif</th>
            <th />
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.code} className={r.isActive ? '' : 'text-label'}>
                <td className="py-1"><input className="input w-24 mono" value={r.code} readOnly title="Kode adalah kunci — hapus lalu buat baru kalau kodenya salah" /></td>
                <td>
                  <input className="input w-36" value={r.name} readOnly={isGabungan(r)} onChange={(e) => ubah(i, { name: e.target.value })} />
                  {isGabungan(r) ? <div className="text-[11px] text-label">ambang laporan gabungan — bukan gudang</div> : null}
                </td>
                <td><input className="input w-16 num" type="number" value={r.sortOrder} onChange={(e) => ubah(i, { sortOrder: Number(e.target.value) })} /></td>
                <td><input className="input w-16 num" type="number" value={r.doiCritical ?? ''} placeholder="wajib" onChange={(e) => ubah(i, { doiCritical: num(e.target.value) })} /></td>
                <td><input className="input w-16 num" type="number" value={r.doiMin ?? ''} placeholder="wajib" onChange={(e) => ubah(i, { doiMin: num(e.target.value) })} /></td>
                <td><input className="input w-16 num" type="number" value={r.doiMax ?? ''} placeholder="wajib" onChange={(e) => ubah(i, { doiMax: num(e.target.value) })} /></td>
                <td><input className="input w-16 num" type="number" value={r.leadTimeDays ?? ''} placeholder="—" onChange={(e) => ubah(i, { leadTimeDays: num(e.target.value) })} /></td>
                <td><input className="input w-16 num" type="number" value={r.atpTarget ?? ''} placeholder="—" onChange={(e) => ubah(i, { atpTarget: num(e.target.value) })} /></td>
                <td className="whitespace-nowrap"><Pita r={r} /><Peringatan r={r} /></td>
                <td><input className="input w-36" type="date" value={r.startDate ?? ''} onChange={(e) => ubah(i, { startDate: e.target.value || null })} /></td>
                <td><input className="input w-40" value={r.note ?? ''} onChange={(e) => ubah(i, { note: e.target.value || null })} /></td>
                <td><label className="check"><input type="checkbox" checked={r.isActive} onChange={(e) => ubah(i, { isActive: e.target.checked })} /></label></td>
                <td className="whitespace-nowrap">
                  <button className="btn btn-sm" onClick={() => simpan(r)} disabled={busy === r.code}>Simpan</button>
                  {r.isActive && !isGabungan(r) ? (
                    <button className="btn btn-sm ml-1" onClick={() => nonaktifkan(r.code)} disabled={busy === r.code}>Nonaktifkan</button>
                  ) : null}
                </td>
              </tr>
            ))}
            {!rows.length ? <tr><td colSpan={13}><Empty>Belum ada area — klik &quot;Isi dari data yang ada&quot;.</Empty></td></tr> : null}
          </tbody>
        </table>
      </div>

      <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="mb-2 text-[13px]">Tambah cabang</div>
        <div className="flex flex-wrap items-end gap-2">
          <div><label className="label">Kode gudang OCS</label><input className="input w-28 mono" value={baru.code} placeholder="GJBL" onChange={(e) => setBaru({ ...baru, code: e.target.value.toUpperCase() })} /></div>
          <div><label className="label">Nama area</label><input className="input w-40" value={baru.name} placeholder="Bali" onChange={(e) => setBaru({ ...baru, name: e.target.value })} /></div>
          <div><label className="label">Urut</label><input className="input w-16 num" type="number" value={baru.sortOrder} onChange={(e) => setBaru({ ...baru, sortOrder: Number(e.target.value) })} /></div>
          <div><label className="label">Kritis ≤ (hari)</label><input className="input w-20 num" type="number" value={baru.doiCritical ?? ''} placeholder="wajib" onChange={(e) => setBaru({ ...baru, doiCritical: num(e.target.value) })} /></div>
          <div><label className="label">Low ≤ (hari)</label><input className="input w-20 num" type="number" value={baru.doiMin ?? ''} placeholder="wajib" onChange={(e) => setBaru({ ...baru, doiMin: num(e.target.value) })} /></div>
          <div><label className="label">Aman ≤ (hari)</label><input className="input w-20 num" type="number" value={baru.doiMax ?? ''} placeholder="wajib" onChange={(e) => setBaru({ ...baru, doiMax: num(e.target.value) })} /></div>
          <div><label className="label">Lead time (hari)</label><input className="input w-20 num" type="number" value={baru.leadTimeDays ?? ''} onChange={(e) => setBaru({ ...baru, leadTimeDays: num(e.target.value) })} /></div>
          <div><label className="label">Target ATP (%)</label><input className="input w-20 num" type="number" value={baru.atpTarget ?? ''} onChange={(e) => setBaru({ ...baru, atpTarget: num(e.target.value) })} /></div>
          <div><label className="label">Mulai operasional</label><input className="input w-36" type="date" value={baru.startDate ?? ''} onChange={(e) => setBaru({ ...baru, startDate: e.target.value || null })} /></div>
          <button className="btn btn-primary" onClick={tambah} disabled={busy === 'baru' || !baru.code || !baru.name}>
            {busy === 'baru' ? 'Menambah…' : 'Tambah'}
          </button>
        </div>
        <div className="mt-2 text-[12px] text-label">
          <b>Tiga angka, empat pita, semuanya dalam HARI</b> — berapa hari stok cukup dengan
          kecepatan jual (ADS) area itu. Batasnya <b>inklusif</b>: angka yang diisi masih masuk
          pita itu.
          <table className="mt-1 w-full max-w-md">
            <tbody>
              <tr><td className="pr-2">DOI ≤ <b>Kritis</b></td><td>CRITICAL</td></tr>
              <tr><td className="pr-2">DOI ≤ <b>Low</b></td><td>LOW — <b>masuk Sugest PO</b></td></tr>
              <tr><td className="pr-2">DOI ≤ <b>Aman</b></td><td>AMAN — PO diisi sampai sini</td></tr>
              <tr><td className="pr-2">DOI &gt; <b>Aman</b></td><td>OVERSTOCK</td></tr>
            </tbody>
          </table>
          Cukup tiga angka karena batas atas satu pita adalah batas bawah pita berikutnya — jadi
          tidak mungkin ada hari yang tidak masuk pita mana pun. Harus naik:
          Kritis &lt; Low ≤ Aman.
          <div className="mt-1">
            <b>Ketiganya wajib diisi.</b> Sampai 10 Okt 2026 kolom ini boleh kosong dan jatuh ke
            tiga pengaturan global (7 / 10 / 14 hari) — dan justru itu masalahnya: ada dua tempat
            mengatur satu hal, yang satu mati diam-diam sementara angkanya tetap terpajang di
            Dashboard dan /tv sebagai &quot;Target DOI 14 hari&quot;, padahal tidak benar untuk satu
            cabang pun. Ketiga pengaturan global itu sudah dicabut; tabel ini satu-satunya sumber.
          </div>
          <div className="mt-1">
            <b>Lead time</b> adalah berapa lama barang sampai setelah PO ditekan. Ia tidak
            menentukan status — itu urusan tiga kolom di atas — tapi dipakai sebagai lead time
            cadangan untuk SKU yang tidak punya angkanya sendiri di Master SKU. Kalau lead time
            lebih lama daripada <b>Kritis ≤</b>, barisnya diberi peringatan: SKU baru ditandai
            kritis ketika kehabisan stok sudah tidak bisa dihindari.
          </div>
          <div className="mt-1">
            Laporan <b>GABUNGAN</b> punya barisnya sendiri di tabel ini (kode{' '}
            <span className="mono">{KODE_GABUNGAN}</span>), bukan cabang dan tidak punya gudang.
            Ia tidak memakai ambang kota mana pun — pitanya terlalu berbeda
            antar kota untuk dijumlahkan — ia memakai angkanya sendiri di baris itu, dan baris
            itu juga yang jadi cadangan bagi cabang yang kolomnya belum lengkap.
          </div>
        </div>
      </div>
    </div>
  );
}
