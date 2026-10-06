'use client';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Empty, postJson, useApi } from '@/components/ui';

type Sistem = 'OCS' | 'SAP';
type Baris = {
  id?: number; groupKey: string; system: Sistem; code: string;
  priority: number; perCtn: number | null;
};
type Bentrok = { code: string; system: Sistem; groups: string[] };
type Resp = { ok: boolean; rows: Baris[]; siap: boolean; bentrok: Bentrok[]; pesan: string };
type Usul = { groupKey: string; baris: Baris[]; alasan: string };
type RespUsul = { ok: boolean; usul: Usul[]; takCocok: string[]; supplierSiap: boolean; pesan: string };

const num = (v: string): number | null => (v.trim() === '' ? null : Number(v));

/**
 * Pemetaan SKU OCS ↔ kode SAP.
 *
 * Kenapa ini tabel dan bukan rumus: dulu kode dianggap sepasang kalau 6 digit
 * terakhirnya sama. Itu batal — ada produk yang berbagi SKU dengan 6 digit
 * BERBEDA, dan satu produk bisa punya lebih dari tiga kode. Heuristiknya tetap
 * ada sebagai tombol "Lihat usulan", tapi hasilnya WAJIB ditinjau: salah
 * memetakan berarti PO dikirim ke kode yang salah.
 *
 * Prioritas: kecil = diambil lebih dulu. 122x → 1, 120x → 2, lainnya 9.
 * Isi karton per kode, bukan per produk — dari 51 pasangan di GBJD, 35 pasangan
 * isi kartonnya berbeda antar wadah.
 */
export default function SkuLinkMaster() {
  const { data, error, reload } = useApi<Resp>('/api/sku-link');
  const [rows, setRows] = useState<Baris[]>([]);
  const [baru, setBaru] = useState<Baris>({ groupKey: '', system: 'SAP', code: '', priority: 9, perCtn: null });
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error' | 'warn'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cari, setCari] = useState('');
  const [usul, setUsul] = useState<RespUsul | null>(null);
  const [pilih, setPilih] = useState<Set<string>>(new Set());

  useEffect(() => { if (data?.rows) setRows(data.rows); }, [data]);

  /** Dikelompokkan per produk supaya hubungan antar kode terlihat, bukan daftar rata. */
  const grup = useMemo(() => {
    const q = cari.trim().toUpperCase();
    const m = new Map<string, Baris[]>();
    for (const r of rows) {
      if (q && !r.groupKey.toUpperCase().includes(q) && !r.code.toUpperCase().includes(q)) continue;
      const a = m.get(r.groupKey) ?? [];
      a.push(r); m.set(r.groupKey, a);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows, cari]);

  const kunci = (b: Baris) => `${b.system}\u0000${b.code}`;
  const ubah = (id: number | undefined, patch: Partial<Baris>) =>
    setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  async function simpan(r: Baris) {
    setBusy(kunci(r)); setMsg(null);
    try {
      await postJson('/api/sku-link', r, 'PUT');
      setMsg({ tone: 'ok', text: `${r.code} tersimpan.` });
      reload();
    } catch (e) { setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(null); }
  }

  async function hapus(r: Baris) {
    setBusy(kunci(r));
    try {
      const res = await fetch(`/api/sku-link?id=${r.id}`, { method: 'DELETE' });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || 'Gagal');
      setMsg({ tone: 'ok', text: `${r.code} dihapus dari mapping.` });
      reload();
    } catch (e) { setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(null); }
  }

  async function tambah() {
    setBusy('baru'); setMsg(null);
    try {
      await postJson('/api/sku-link', baru, 'PUT');
      setBaru({ groupKey: baru.groupKey, system: 'SAP', code: '', priority: 9, perCtn: null });
      setMsg({ tone: 'ok', text: 'Mapping ditambahkan.' });
      reload();
    } catch (e) { setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(null); }
  }

  async function lihatUsulan() {
    setBusy('usul'); setMsg(null);
    try {
      const res = await fetch('/api/sku-link?usul=1');
      const j = (await res.json()) as RespUsul;
      if (!j.ok) throw new Error('Gagal mengambil usulan');
      setUsul(j);
      // Sengaja TIDAK dicentang otomatis: mencentang semua membuat tombol
      // simpan terasa seperti "terima saja", padahal ini tebakan.
      setPilih(new Set());
      setMsg({ tone: j.supplierSiap ? 'warn' : 'error', text: j.pesan });
    } catch (e) { setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(null); }
  }

  async function simpanUsulan() {
    if (!usul) return;
    const baris = usul.usul.filter((g) => pilih.has(g.groupKey)).flatMap((g) => g.baris);
    if (!baris.length) { setMsg({ tone: 'warn', text: 'Belum ada produk yang dicentang.' }); return; }
    setBusy('simpanUsul');
    try {
      const j = (await postJson('/api/sku-link', { baris })) as { tersimpan: number; gagal: { code: string; pesan: string }[]; pesan: string };
      setMsg({ tone: j.gagal.length ? 'warn' : 'ok', text: j.pesan });
      setUsul(null); setPilih(new Set());
      reload();
    } catch (e) { setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(null); }
  }

  const togglePilih = (k: string) => {
    const s = new Set(pilih);
    if (s.has(k)) s.delete(k); else s.add(k);
    setPilih(s);
  };

  return (
    <div className="card card-pad lg:col-span-2">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="card-title">Mapping SKU (OCS ↔ SAP)</div>
        <div className="flex flex-wrap gap-2">
          <input className="input w-40" placeholder="Cari SKU / kode…" value={cari} onChange={(e) => setCari(e.target.value)} />
          <button className="btn" onClick={lihatUsulan} disabled={busy === 'usul'}>
            {busy === 'usul' ? 'Menghitung…' : 'Lihat usulan dari 6 digit'}
          </button>
        </div>
      </div>
      <div className="mb-3 text-[12px] text-label">
        Satu produk bisa punya beberapa kode SAP (IEG <span className="mono">1222…</span>, EJI <span className="mono">1201…</span>).
        Daftar inilah yang menentukan dari kode mana Sugest PO mengambil barang.
        <b> Prioritas</b> kecil diambil dulu; <b>isi karton</b> diisi per kode, karena wadah yang berbeda
        sering isinya berbeda walau produknya sama.
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {data && !data.siap ? (
        <Alert tone="error">
          Tabel <span className="mono">sku_link</span> belum ada. Jalankan <code>npm run db:push</code> dulu.
        </Alert>
      ) : null}
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}

      {data?.bentrok.length ? (
        <Alert tone="error">
          <b>{data.bentrok.length} kode dipakai lebih dari satu produk</b> — Sugest PO tidak bisa menentukan
          barangnya milik produk mana, jadi ini harus diselesaikan:
          <ul className="mt-1 list-disc pl-5">
            {data.bentrok.slice(0, 10).map((b) => (
              <li key={`${b.system}-${b.code}`}>
                <span className="mono">{b.code}</span> ({b.system}) → {b.groups.join(', ')}
              </li>
            ))}
          </ul>
          {data.bentrok.length > 10 ? <div className="mt-1">…dan {data.bentrok.length - 10} lagi.</div> : null}
        </Alert>
      ) : null}

      {/* ---- Panel usulan: ditinjau dulu, baru disimpan ---- */}
      {usul ? (
        <div className="mt-3 rounded-lg p-3" style={{ background: 'var(--bg-sunken)', border: '1px solid var(--border-subtle)' }}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-[13px]">
              <b>Usulan ({usul.usul.length} produk)</b> — semuanya tebakan dari 6 digit terakhir.
              Centang yang sudah Anda periksa.
            </div>
            <div className="flex gap-2">
              <button className="btn btn-sm" onClick={() => setPilih(new Set(usul.usul.map((g) => g.groupKey)))}>Centang semua</button>
              <button className="btn btn-sm" onClick={() => setPilih(new Set())}>Kosongkan</button>
              <button className="btn btn-sm" onClick={() => { setUsul(null); setPilih(new Set()); }}>Tutup</button>
              <button className="btn btn-primary btn-sm" onClick={simpanUsulan} disabled={busy === 'simpanUsul' || !pilih.size}>
                {busy === 'simpanUsul' ? 'Menyimpan…' : `Simpan ${pilih.size} yang dicentang`}
              </button>
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-[12px]">
              <thead><tr className="text-label">
                <th className="py-1 text-left">✓</th>
                <th className="py-1 text-left">SKU OCS</th>
                <th className="py-1 text-left">Kode SAP yang diusulkan</th>
              </tr></thead>
              <tbody>
                {usul.usul.map((g) => (
                  <tr key={g.groupKey} className={pilih.has(g.groupKey) ? '' : 'text-label'}>
                    <td className="py-1">
                      <label className="check">
                        <input type="checkbox" checked={pilih.has(g.groupKey)} onChange={() => togglePilih(g.groupKey)} />
                      </label>
                    </td>
                    <td className="mono">{g.groupKey}</td>
                    <td>
                      {g.baris.filter((b) => b.system === 'SAP').map((b) => (
                        <span key={b.code} className="mono mr-2">
                          {b.code}<span className="text-label">·p{b.priority}{b.perCtn ? `·${b.perCtn}/ctn` : '·? /ctn'}</span>
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
                {!usul.usul.length ? <tr><td colSpan={3}><Empty>Tidak ada usulan baru — semua kode sudah terpetakan.</Empty></td></tr> : null}
              </tbody>
            </table>
          </div>
          {usul.takCocok.length ? (
            <div className="mt-2 text-[12px] text-label">
              <b>{usul.takCocok.length} kode SAP di gudang pemasok tidak cocok dengan SKU mana pun</b> —
              sengaja tidak dipaksakan masuk kelompok apa pun. Petakan manual di bawah kalau memang dipakai:{' '}
              <span className="mono">{usul.takCocok.slice(0, 20).join(', ')}</span>
              {usul.takCocok.length > 20 ? ` …(+${usul.takCocok.length - 20})` : ''}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ---- Tabel mapping yang tersimpan ---- */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead><tr className="text-label">
            <th className="py-1 text-left">Produk (SKU OCS)</th>
            <th className="py-1 text-left">Sistem</th>
            <th className="py-1 text-left">Kode</th>
            <th className="num">Prioritas</th>
            <th className="num">Isi karton</th>
            <th />
          </tr></thead>
          <tbody>
            {grup.map(([groupKey, baris]) => baris.map((r, i) => (
              <tr key={r.id ?? `${r.system}-${r.code}`}>
                <td className="py-1 mono">{i === 0 ? groupKey : ''}</td>
                <td>{r.system}</td>
                <td className="mono">{r.code}</td>
                <td><input className="input w-16 num" type="number" value={r.priority} onChange={(e) => ubah(r.id, { priority: Number(e.target.value) })} /></td>
                <td><input className="input w-20 num" type="number" value={r.perCtn ?? ''} placeholder="?" onChange={(e) => ubah(r.id, { perCtn: num(e.target.value) })} /></td>
                <td className="whitespace-nowrap">
                  <button className="btn btn-sm" onClick={() => simpan(r)} disabled={busy === kunci(r)}>Simpan</button>
                  <button className="btn btn-sm ml-1" onClick={() => hapus(r)} disabled={busy === kunci(r)}>Hapus</button>
                </td>
              </tr>
            )))}
            {!grup.length ? (
              <tr><td colSpan={6}>
                <Empty>
                  {cari ? 'Tidak ada yang cocok dengan pencarian.' : 'Belum ada mapping — klik "Lihat usulan dari 6 digit".'}
                </Empty>
              </td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* ---- Tambah manual ---- */}
      <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="mb-2 text-[13px]">Tambah mapping manual</div>
        <div className="flex flex-wrap items-end gap-2">
          <div><label className="label">Produk (SKU OCS)</label><input className="input w-40 mono" value={baru.groupKey} onChange={(e) => setBaru({ ...baru, groupKey: e.target.value })} /></div>
          <div>
            <label className="label">Sistem</label>
            <select className="input w-24" value={baru.system} onChange={(e) => setBaru({ ...baru, system: e.target.value as Sistem })}>
              <option value="SAP">SAP</option>
              <option value="OCS">OCS</option>
            </select>
          </div>
          <div><label className="label">Kode</label><input className="input w-36 mono" value={baru.code} placeholder="1222010118" onChange={(e) => setBaru({ ...baru, code: e.target.value.toUpperCase() })} /></div>
          <div><label className="label">Prioritas</label><input className="input w-20 num" type="number" value={baru.priority} onChange={(e) => setBaru({ ...baru, priority: Number(e.target.value) })} /></div>
          <div><label className="label">Isi karton</label><input className="input w-20 num" type="number" value={baru.perCtn ?? ''} placeholder="48" onChange={(e) => setBaru({ ...baru, perCtn: num(e.target.value) })} /></div>
          <button className="btn btn-primary" onClick={tambah} disabled={busy === 'baru' || !baru.groupKey || !baru.code}>
            {busy === 'baru' ? 'Menambah…' : 'Tambah'}
          </button>
        </div>
        <div className="mt-2 text-[12px] text-label">
          Isi karton dibiarkan kosong = tidak diketahui. Barisnya tetap diproses, tapi dikirim dalam
          <b> pcs</b> dan ditandai <span className="mono">TANPA_ISI_KARTON</span> — sengaja tidak ditebak,
          karena menebak isi karton berarti menebak jumlah kiriman.
        </div>
      </div>
    </div>
  );
}
