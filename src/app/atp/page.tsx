'use client';
import { useMemo, useState } from 'react';
import { Alert, Kpi, RefreshButton, postForm, postJson, useApi, fmt } from '@/components/ui';
import { lingkupBorongan } from '@/lib/atp';
import { DataGrid, type Column } from '@/components/DataGrid';

type Putusan = boolean | null;

type SelArea = {
  dibagikan: Putusan;
  availableQty: number;
  siap: boolean;
  tolak: 'TIDAK_AKTIF' | 'BUKAN_KATEGORI_SKU' | null;
  /** Komponen bundling yang tidak disebar ke cabang ini — bundling keluar dari pembagi. */
  blokir: string[];
  note: string;
};
/** Keadaan satu komponen bundling di satu cabang. */
type SelTurunan = { stok: number | null; aktif: boolean | null; muat: number | null };
type Turunan = {
  itemSku: string; name: string; qty: number;
  area: Record<string, SelTurunan>;
  nAktif: number; nNonaktif: number;
};
type RingkasTurunan = {
  n: number;
  turunan: Turunan[];
  /** Per cabang: berapa bundle yang bisa dibentuk komponennya. null = tidak diketahui. */
  muat: Record<string, number | null>;
  pembatas: Record<string, string>;
  adaNonaktif: boolean;
};

type BarisSku = {
  sku: string; name: string; brand: string; brandManual: boolean;
  kategori: string;
  /** Total available seluruh cabang — kolom "Stok total" yang bisa diurutkan. */
  stokTotal: number;
  /** Turunan bundling — tampilan saja; komposisinya milik OCS. */
  turunan: RingkasTurunan;
  area: Record<string, SelArea>;
  /** Area yang barisnya ada tapi tersaring keluar oleh filter status. */
  lain?: Record<string, 'AKTIF' | 'NONAKTIF'>;
};
type Saring = 'AKTIF' | 'NONAKTIF' | 'SEMUA';
type HasilArea = {
  areaId: string; dihitung: number; siap: number; persen: number | null;
  takDisebar: number; belumDiputus: number;
  ditolak: Record<string, number>; kotor: number;
  /** Bagian dari takDisebar yang keluar karena komponen bundling-nya tidak disebar. */
  takDisebarTurunan: number;
};
type Resp = {
  ok: boolean; areas: string[]; sku: BarisSku[]; hasil: HasilArea[];
  keseluruhan: { dihitung: number; siap: number; persen: number | null; terlemah: HasilArea | null };
  ambang: number; siap: boolean; tanpaBrand: string[]; pesan: string;
  saring: Saring;
  cacah: { aktif: number; nonaktif: number; semua: number };
  baru: SkuBaru[];
  /** false = tabel bundle_item belum ada (db:push belum dijalankan). */
  bundleSiap: boolean;
  /** Berapa bundle yang komposisinya sudah tersimpan. */
  bundleTersimpan: number;
};

/** SKU yang belum punya satu pun keputusan sebaran — isi pengingat. */
type SkuBaru = { sku: string; name: string; kategori: string; areas: string[]; firstSeenAt: string };

type Pratinjau = {
  barisDibaca: number;
  ringkas: { jadiYa: number; jadiTidak: number; dikosongkan: number; takBerubah: number };
  masalah: { baris: number; sku: string; areaId?: string; pesan: string }[];
  masalahTotal: number;
  kolomAsing: string[];
  pesan: string;
};

const LABEL_SARING: Record<Saring, string> = {
  AKTIF: 'Aktif saja', NONAKTIF: 'Non-aktif saja', SEMUA: 'Aktif + non-aktif',
};

const persenTeks = (p: number | null | undefined) =>
  (p === null || p === undefined ? '—' : `${p.toFixed(1).replace('.', ',')}%`);

const SEBAB: Record<string, string> = {
  TIDAK_AKTIF: 'status tidak cocok filter',
  BUKAN_KATEGORI_SKU: 'kategori di luar ATP',
};

/** Kunci perubahan yang belum disimpan. Sama bentuknya dengan kunciSebaran(). */
const kunci = (sku: string, areaId: string) => `${areaId}\u0000${sku}`;

export default function AtpPage() {
  // Dua keadaan untuk satu angka, dengan sengaja: `ambang` yang dipakai memanggil
  // server, dan `ambangDraf` yang sedang diketik. `useApi` menarik ulang setiap
  // kali URL-nya berubah, jadi kalau input ini terikat langsung ke `ambang`,
  // mengetik "15" memicu tiga penarikan (1, 15, dan 0 saat dikosongkan) — dan
  // tiap penarikan membaca SELURUH stock_current. Jadi diterapkan saat Enter
  // atau saat kursor keluar, bukan tiap ketukan.
  const [ambang, setAmbang] = useState(5);
  const [ambangDraf, setAmbangDraf] = useState('5');
  // Saringan aktif/non-aktif ditangani SERVER, bukan di layar: ia menentukan
  // baris mana yang dikirim, jadi tabel 1.662 SKU x 5 cabang tidak perlu
  // dikirim utuh hanya untuk dibuang separuhnya di browser.
  const [saring, setSaring] = useState<Saring>('AKTIF');
  const { data, error, reload } = useApi<Resp>(`/api/atp?ambang=${ambang}&saring=${saring}`);

  function terapkanAmbang() {
    // Kotak kosong dikembalikan ke nilai lama, TIDAK diterapkan sebagai 0:
    // `Number('')` itu 0, jadi tanpa penjaga ini menghapus isi kotak akan
    // mengubah aturannya jadi "available kalau lebih dari 0" — perubahan arti
    // yang besar, dari gerakan yang tidak dimaksudkan mengubah apa pun.
    if (ambangDraf.trim() === '') { setAmbangDraf(String(ambang)); return; }
    const v = Math.max(0, Math.trunc(Number(ambangDraf)));
    if (!Number.isFinite(v)) { setAmbangDraf(String(ambang)); return; }
    setAmbangDraf(String(v));
    if (v !== ambang) setAmbang(v);
  }

  const [brand, setBrand] = useState('ALL');
  const [kategori, setKategori] = useState('ALL');
  const [cari, setCari] = useState('');
  const [hanyaBelum, setHanyaBelum] = useState(false);
  // Pengingat SKU baru. `tutupBaru` hanya menutup untuk kunjungan ini — TIDAK
  // disimpan: kalau disimpan, SKU baru berikutnya tidak akan pernah terlihat
  // lagi oleh orang yang pernah menutupnya sekali.
  const [tutupBaru, setTutupBaru] = useState(false);
  const [hanyaBaru, setHanyaBaru] = useState(false);
  // SKU yang baris turunannya sedang dibuka. Satu saja — membuka banyak baris
  // sekaligus membuat tabel 1.662 baris tidak bisa dibaca lagi.
  const [buka, setBuka] = useState<string | null>(null);
  // Perubahan ditahan dulu, baru disimpan sekali. 375 SKU x 6 cabang = 2.250
  // sel; menyimpan tiap klik berarti 2.250 permintaan saat pengisian awal, dan
  // satu yang gagal di tengah meninggalkan keadaan separuh tanpa ada yang tahu
  // bagian mana. Satu tombol Simpan membuat batasnya jelas.
  const [ubah, setUbah] = useState<Map<string, Putusan>>(new Map());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error' | 'warn'; text: string } | null>(null);
  const [editBrand, setEditBrand] = useState<{ sku: string; brand: string } | null>(null);
  const [berkas, setBerkas] = useState<File | null>(null);
  const [abaikanKosong, setAbaikanKosong] = useState(true);
  const [pratinjau, setPratinjau] = useState<Pratinjau | null>(null);

  const areas = data?.areas ?? [];
  const daftarBrand = useMemo(() => {
    const s = new Set((data?.sku ?? []).map((r) => r.brand || '(tanpa brand)'));
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [data]);

  /** Keadaan sel setelah perubahan yang belum disimpan ikut diperhitungkan. */
  const nilai = (r: BarisSku, a: string): Putusan => {
    const k = kunci(r.sku, a);
    if (ubah.has(k)) return ubah.get(k)!;
    return r.area[a]?.dibagikan ?? null;
  };

  const baruList = data?.baru ?? [];
  const setBaru = useMemo(() => new Set(baruList.map((b) => b.sku)), [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const lolosFilter = (r: BarisSku) => {
    if (kategori !== 'ALL' && r.kategori !== kategori) return false;
    if (brand !== 'ALL' && (r.brand || '(tanpa brand)') !== brand) return false;
    const q = cari.trim().toLowerCase();
    if (q && !r.sku.toLowerCase().includes(q) && !r.name.toLowerCase().includes(q)) return false;
    if (hanyaBelum && !areas.some((a) => r.area[a] && nilai(r, a) === null)) return false;
    if (hanyaBaru && !setBaru.has(r.sku)) return false;
    return true;
  };

  const baris = useMemo(
    () => (data?.sku ?? []).filter(lolosFilter),
    [data, brand, kategori, cari, hanyaBelum, hanyaBaru, ubah], // eslint-disable-line react-hooks/exhaustive-deps
  );

  function putar(r: BarisSku, a: string) {
    // belum → Ya → Tidak → belum. Tiga keadaan, jadi tidak bisa satu checkbox:
    // checkbox hanya punya dua, dan "belum diputuskan" bukan sama dengan
    // "tidak disebar" — yang pertama masih menunggu orang.
    const s = nilai(r, a);
    const berikut: Putusan = s === null ? true : s === true ? false : null;
    setUbah((prev) => {
      const n = new Map(prev);
      const k = kunci(r.sku, a);
      const asal = r.area[a]?.dibagikan ?? null;
      if (berikut === asal) n.delete(k); else n.set(k, berikut);
      return n;
    });
  }

  /**
   * Isi borongan untuk SATU kolom cabang, hanya baris yang lolos filter di atas.
   *
   * Sengaja dibatasi ke filter halaman (brand, pencarian, "belum diputuskan"),
   * BUKAN ke filter kolom di dalam tabel: tabelnya menyaring sendiri dan
   * halaman ini tidak tahu hasilnya, jadi mengklaim "semua yang tampil" akan
   * bohong begitu user memakai filter kolom. Jumlahnya ditulis di tombol supaya
   * yang akan terjadi terlihat sebelum diklik.
   */

  /** `a === null` berarti SEMUA cabang sekaligus. */
  function borongan(a: string | null, ke: Putusan) {
    const areaKena = a === null ? areas : [a];
    const { target, nKeputusan } = lingkupBorongan(baris, areaKena);
    if (!target.length) return;

    const kata = ke === null ? 'DIKOSONGKAN (kembali belum diputuskan)' : ke ? 'DISEBAR' : 'TIDAK disebar';
    const diMana = a === null ? `SEMUA ${areas.length} cabang` : a;
    const dari = 'yang lolos filter';
    // Jumlah SKU dan jumlah KEPUTUSAN disebut terpisah — lihat lingkupBorongan().
    if (!confirm(
      `Tandai ${target.length} SKU ${dari} di ${diMana} sebagai ${kata}?\n\n`
      + `${nKeputusan} keputusan akan berubah. Belum tersimpan sampai tombol Simpan ditekan.`,
    )) return;

    setUbah((prev) => {
      const n = new Map(prev);
      for (const r of target) {
        for (const x of areaKena) {
          if (!r.area[x]) continue;
          const k = kunci(r.sku, x);
          const asal = r.area[x]?.dibagikan ?? null;
          if (ke === asal) n.delete(k); else n.set(k, ke);
        }
      }
      return n;
    });
  }

  async function simpan() {
    if (!ubah.size) return;
    setBusy(true);
    try {
      const putusan = [...ubah.entries()].map(([k, dibagikan]) => {
        const [areaId, sku] = k.split('\u0000');
        return { sku, areaId, dibagikan };
      });
      const r = await postJson(`/api/atp?ambang=${ambang}`, { putusan });
      setMsg({ tone: r.gagal?.length ? 'warn' : 'ok', text: r.pesan });
      setUbah(new Map());
      reload();
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); }
  }

  async function unggah(terap: boolean) {
    if (!berkas) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', berkas);
      const q = `?${terap ? 'terap=1&' : ''}abaikanKosong=${abaikanKosong ? 1 : 0}`;
      const r = await postForm(`/api/atp/import${q}`, form);
      if (terap) {
        setMsg({ tone: r.gagal?.length ? 'warn' : 'ok', text: r.pesan });
        setPratinjau(null); setBerkas(null); setUbah(new Map());
        reload();
      } else {
        setPratinjau(r as Pratinjau);
      }
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
      setPratinjau(null);
    } finally { setBusy(false); }
  }

  async function simpanBrand() {
    if (!editBrand) return;
    try {
      await postJson('/api/atp', { sku: editBrand.sku, brand: editBrand.brand }, 'PUT');
      setEditBrand(null);
      reload();
    } catch (e) { setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) }); }
  }

  const unduh = `/api/atp/export?ambang=${ambang}&brand=${encodeURIComponent(brand)}`
    + `&q=${encodeURIComponent(cari.trim())}&saring=${saring}&kategori=${encodeURIComponent(kategori)}`;

  /**
   * Tarik komposisi bundling dari OCS.
   *
   * Tombol SENDIRI, bukan ikut Refresh: komposisinya master data yang jarang
   * berubah dan payload-nya 2,5 MB, sementara Refresh harus selesai dalam 60
   * detik. `force=1` supaya menekan tombolnya memang menarik — jeda
   * `bundle_refresh_hours` untuk penarikan otomatis, bukan untuk orang yang
   * sengaja menekan.
   */
  async function tarikBundle() {
    setBusy(true);
    setMsg(null);
    try {
      const j = await postJson('/api/atp/bundle?force=1', {});
      if (!j?.ok) throw new Error(j?.error || j?.message || 'Penarikan gagal');
      setMsg({
        tone: 'ok',
        text: j.message || `${fmt(j.bundle ?? 0)} bundle, ${fmt(j.komponen ?? 0)} baris komponen tersimpan.`,
      });
      reload();
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof Error ? e.message : 'Penarikan komposisi gagal' });
    } finally {
      setBusy(false);
    }
  }

  /**
   * Baris rincian turunan — dibuka dari kolom "Turunan Bundling".
   *
   * Yang ditampilkan dan alasannya:
   *   qty/bundle   — tanpa ini "stok 100" tidak berarti apa-apa; kalau butuh 2
   *                  pcs per bundle, 100 pcs cuma cukup untuk 50 bundle;
   *   status       — PER CABANG, bukan satu nilai global: `isActive` OCS memang
   *                  per (sku, area), jadi satu komponen bisa aktif di Makassar
   *                  dan nonaktif di Medan. Satu nilai global akan bohong;
   *   muat         — floor(stok / qty) per cabang, dan baris PEMBATAS ditandai.
   *                  Inilah yang menjawab "kenapa bundle ini kosong padahal
   *                  komponennya ada": satu komponen habis = seluruh bundle
   *                  tidak bisa dijanjikan.
   *
   * Baris "bisa dibentuk" adalah hitungan KITA, dan disebut begitu di layar —
   * angka OCS tetap yang dipakai ATP. Kalau keduanya beda, itu informasi yang
   * perlu dilihat orang, bukan sesuatu yang boleh ditimpa diam-diam.
   */
  function rincianTurunan(r: BarisSku) {
    const t = r.turunan;
    if (!t.n) return null;
    const sel = (v: number | null) => (v === null ? '—' : fmt(v));
    return (
      <div className="space-y-2 py-1">
        <div className="text-[12px] text-label">
          <b>{t.n} turunan</b> dari <span className="mono">{r.sku}</span> — komposisinya dari OCS
          (<span className="mono">/master/bundle</span>), hanya ditampilkan di sini.
        </div>
        <div className="overflow-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-muted">
                <th className="px-2 py-1">Komponen</th>
                <th className="px-2 py-1 text-right">Qty/bundle</th>
                {areas.map((a) => <th key={a} className="px-2 py-1 text-right">{a}</th>)}
              </tr>
            </thead>
            <tbody>
              {t.turunan.map((k) => (
                <tr key={k.itemSku} className="border-t">
                  <td className="px-2 py-1">
                    <span className="mono">{k.itemSku}</span>
                    {k.name ? <span className="ml-2 text-muted">{k.name}</span> : null}
                  </td>
                  <td className="px-2 py-1 text-right mono">{fmt(k.qty)}</td>
                  {areas.map((a) => {
                    const x = k.area[a];
                    const batas = t.pembatas[a] === k.itemSku;
                    return (
                      <td key={a} className="px-2 py-1 text-right">
                        <span className={`mono ${x?.aktif === false ? 'text-negative' : ''}`}>{sel(x?.stok ?? null)}</span>
                        <span className="ml-1 text-[11px] text-muted">
                          {x?.aktif === null || x?.aktif === undefined
                            ? '(tidak terdaftar)'
                            : x.aktif ? '' : '(nonaktif)'}
                        </span>
                        {batas ? <span className="ml-1" title={`Komponen paling membatasi di ${a}`}>←</span> : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="border-t-2 font-semibold">
                <td className="px-2 py-1" colSpan={2}>
                  Bisa dibentuk menurut komponen
                  <span className="ml-1 text-[11px] font-normal text-muted">(hitungan kami, bukan angka OCS)</span>
                </td>
                {areas.map((a) => (
                  <td key={a} className="px-2 py-1 text-right mono" title={t.pembatas[a] ? `Pembatas: ${t.pembatas[a]}` : ''}>
                    {sel(t.muat[a] ?? null)}
                  </td>
                ))}
              </tr>
              <tr className="border-t">
                <td className="px-2 py-1 text-muted" colSpan={2}>Tercatat OCS (yang dipakai ATP)</td>
                {areas.map((a) => (
                  <td key={a} className="px-2 py-1 text-right mono text-muted">
                    {r.area[a] ? fmt(r.area[a].availableQty) : '—'}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        {t.adaNonaktif ? (
          <div className="text-[12px] text-critical">
            Ada komponen yang <b>nonaktif</b> di salah satu cabang — bundling ini tidak bisa
            dijanjikan di cabang itu walau komponen lainnya tersedia.
          </div>
        ) : null}
      </div>
    );
  }

  const columns = useMemo<Column<BarisSku>[]>(() => {
    const KOLOM_SEBARAN = (a: string): Column<BarisSku> => ({
      key: `a_${a}`,
      label: a,
      // Nilai mentah untuk sort/filter adalah TEKSNYA, bukan boolean: user
      // memfilter dengan kata yang ia lihat di sel.
      get: (r) => {
        const v = nilai(r, a);
        return v === null ? 'Belum' : v ? 'Ya' : 'Tidak';
      },
      width: 112,
      render: (r) => {
        const sel = r.area[a];
        if (!sel) {
          // Sel kosong HARUS menjelaskan dirinya. "—" polos membuat orang
          // mengira keputusannya belum diisi, padahal artinya SKU ini memang
          // tidak dijual di cabang itu — dua hal yang butuh tindakan berbeda.
          const lain = r.lain?.[a];
          return (
            <span
              className="empty"
              title={
                lain === 'NONAKTIF'
                  ? `${r.sku} NONAKTIF di ${a} menurut OCS, jadi tidak bisa dijanjikan di sana.\n`
                    + 'Ganti filter "Status di OCS" ke "Aktif + non-aktif" untuk melihat barisnya.'
                  : lain === 'AKTIF'
                    ? `${r.sku} aktif di ${a}, tapi tersaring oleh filter status yang sedang dipakai.`
                    : `${r.sku} tidak terdaftar sama sekali di ${a} pada data stok OCS.`
              }
            >
              {lain === 'NONAKTIF' ? 'nonaktif' : lain === 'AKTIF' ? 'tersaring' : '—'}
            </span>
          );
        }
        const v = nilai(r, a);
        const berubah = ubah.has(kunci(r.sku, a));
        const label = v === null ? 'Belum' : v ? 'Ya' : 'Tidak';
        // Terblokir komponen: centangnya TETAP milik user dan tetap ditampilkan
        // apa adanya — yang berubah cuma perlakuannya di pembagi. Menukar
        // labelnya jadi "Tidak" akan membuat orang mengira keputusannya sudah
        // diubah, lalu mengklik untuk mengembalikan sesuatu yang tidak pernah
        // berubah.
        const diblokir = v === true && sel.blokir.length > 0;
        const warna = v === null ? '' : v ? 'chip-ok' : 'chip-bad';
        return (
          <span className="flex items-center gap-1">
            <button
              className={`chip ${diblokir ? 'chip-bad' : warna} ${berubah ? 'ring-1 ring-offset-1' : ''}`}
              style={diblokir ? { textDecoration: 'line-through' } : undefined}
              title={
                `${r.sku} di ${a}\n`
                + `Available: ${fmt(sel.availableQty)} pcs — ${sel.siap ? `siap (lebih dari ${ambang})` : `belum siap (${ambang} atau kurang)`}\n`
                + (sel.tolak ? `TIDAK layak ATP: ${SEBAB[sel.tolak]}\n` : '')
                + (diblokir
                  ? `TIDAK ikut pembagi: ${sel.blokir.length} komponen bundling tidak disebar ke ${a} —\n`
                    + `  ${sel.blokir.slice(0, 6).join('\n  ')}${sel.blokir.length > 6 ? `\n  … ${sel.blokir.length - 6} lagi` : ''}\n`
                    + 'Centang Anda TIDAK diubah. Sebar lagi komponennya, bundling ini ikut kembali sendiri.\n'
                  : '')
                + 'Klik untuk ganti: Belum → Ya → Tidak → Belum'
              }
              onClick={() => putar(r, a)}
            >
              {label}
            </button>
            {diblokir ? <span className="text-[11px] text-critical" title="Komponennya tidak disebar">⛔</span> : null}
            <span className={`text-[11px] ${sel.siap ? 'text-label' : 'text-muted'}`}>{fmt(sel.availableQty)}</span>
          </span>
        );
      },
    });
    // Satu kolom angka per cabang, supaya stok tiap cabang bisa DIURUTKAN dan
    // DIFILTER sendiri ("Pusat < 5" + sel Ya = janji yang tidak bisa dipenuhi).
    // Chip di kolom cabang tetap menampilkan angkanya untuk dibaca cepat; yang
    // ini untuk diurutkan. Sembunyikan lewat tombol kolom di toolbar tabel
    // kalau tabelnya terasa lebar.
    const KOLOM_STOK = (a: string): Column<BarisSku> => ({
      key: `s_${a}`,
      label: `Stok ${a}`,
      get: (r) => (r.area[a] ? r.area[a].availableQty : null),
      type: 'number', align: 'right', mono: true, width: 108, prio: 'p3',
      title: `Available ${a} (pcs). Kosong = SKU ini tidak ada barisnya di ${a}.`,
      render: (r) => {
        const sel = r.area[a];
        if (!sel) return <span className="empty">—</span>;
        return <span className={`mono ${sel.siap ? '' : 'text-muted'}`}>{fmt(sel.availableQty)}</span>;
      },
    });
    return [
    { key: 'sku', label: 'SKU', get: (r) => r.sku, mono: true, width: 240, sticky: true, isTitle: true },
    {
      /*
        Turunan bundling (permintaan user 9 Okt 2026) — TAMPILAN SAJA, tidak bisa
        diedit di sini: komposisinya milik OCS (/master/bundle).

        Selnya memuat RINGKASAN + tombol, bukan daftar komponennya. Terukur saat
        endpoint-nya dibongkar: rata-rata 2,98 komponen dan PALING BANYAK 14 —
        daftar 14 SKU tidak mungkin terbaca di dalam satu sel. Rinciannya muncul
        sebagai baris yang dibuka di bawah barisnya.

        Nilai sort/filter-nya JUMLAH komponen (angka), bukan teks ringkasannya:
        yang berguna adalah "urutkan dari bundle paling rumit" dan "filter > 5
        komponen", bukan mengurutkan menurut kata "turunan".
      */
      key: 'turunan', label: 'Turunan Bundling', get: (r) => r.turunan.n,
      type: 'number', width: 150, noFilter: false,
      title: 'Jumlah SKU komponen bundling. Klik untuk membuka rinciannya: qty per bundle, '
        + 'status aktif/nonaktif per cabang, dan komponen mana yang paling membatasi.',
      render: (r) => {
        if (!r.turunan.n) {
          // Bukan bundle, ATAU komposisinya belum ditarik. Dua hal berbeda, dan
          // selnya harus menjelaskan yang mana — "—" polos membuat orang mengira
          // bundle-nya memang tidak punya komponen.
          const bundle = r.kategori === 'Bundle';
          return (
            <span
              className="empty"
              title={
                !bundle
                  ? `${r.sku} bukan kategori Bundle, jadi tidak punya turunan.`
                  : data?.bundleSiap === false
                    ? 'Tabel bundle_item belum ada — jalankan npm run db:push.'
                    : 'Komposisinya belum ada di database. Tekan "Tarik komposisi bundling" di atas.'
              }
            >
              {bundle ? 'belum ditarik' : '—'}
            </span>
          );
        }
        return (
          <button
            className={`chip ${r.turunan.adaNonaktif ? 'chip-bad' : 'chip-ok'}`}
            title={
              `${r.turunan.n} komponen`
              + (r.turunan.adaNonaktif ? ' — ADA yang nonaktif di salah satu cabang' : ' — semua aktif')
              + '\nKlik untuk membuka rinciannya'
            }
            onClick={() => setBuka(buka === r.sku ? null : r.sku)}
          >
            {r.turunan.n} turunan {buka === r.sku ? '▴' : '▾'}
            {r.turunan.adaNonaktif ? ' ⚠' : ''}
          </button>
        );
      },
    },
    {
      // Angka, BUKAN teks: kolom cabang nilai sortnya "Ya"/"Tidak"/"Belum",
      // jadi sebelum ini tidak ada satu pun kolom yang bisa mengurutkan stok.
      key: 'stok', label: 'Stok total', get: (r) => r.stokTotal,
      type: 'number', align: 'right', mono: true, width: 104,
      title: 'Jumlah available seluruh cabang yang barisnya tampil. Bisa diurutkan & difilter (mis. "< 5").',
      render: (r) => <span className="mono">{fmt(r.stokTotal)}</span>,
    },
    // Keputusan dan stok BERDAMPINGAN per cabang (permintaan user 9 Okt 2026):
    // Makassar, Stok Makassar, Medan, Stok Medan, dst. Dulu semua kolom
    // keputusan dulu lalu semua kolom stok, sehingga membaca satu cabang
    // berarti melompat melewati seluruh tabel.
    ...areas.flatMap((a): Column<BarisSku>[] => [
      KOLOM_SEBARAN(a),
      KOLOM_STOK(a),
    ]),
    // Nama, Kategori & Brand DI BELAKANG — urutan yang diminta user menaruh
    // cabang lebih dulu. Ketiganya tetap bisa diurutkan, difilter, dan Brand
    // tetap bisa diklik untuk diedit; Nama juga tetap jadi judul kartu di HP.
    {
      key: 'name', label: 'Nama', get: (r) => r.name, width: 280, prio: 'p2',
      render: (r) => <span className="text-label" title={r.name}>{r.name}</span>,
    },
    {
      key: 'kat', label: 'Kategori', get: (r) => r.kategori, width: 100,
      render: (r) => <span className={`chip ${r.kategori === 'Sku' ? 'chip-ok' : ''}`}>{r.kategori}</span>,
    },
    {
      key: 'brand', label: 'Brand', get: (r) => r.brand || '', width: 130,
      render: (r) => (editBrand?.sku === r.sku ? (
        <span className="flex gap-1">
          <input
            className="input w-24" value={editBrand.brand} aria-label={`Brand ${r.sku}`}
            onChange={(e) => setEditBrand({ ...editBrand, brand: e.target.value })}
          />
          <button className="btn btn-sm btn-primary" onClick={simpanBrand}>OK</button>
        </span>
      ) : (
        <button
          className={`chip ${r.brand ? '' : 'chip-bad'}`}
          title={r.brandManual ? 'diisi manual — tidak akan tertimpa sync:brand' : 'dari OCS'}
          onClick={() => setEditBrand({ sku: r.sku, brand: r.brand })}
        >
          {r.brand || 'kosong'}{r.brandManual ? ' ✎' : ''}
        </button>
      )),
    },
    ];
  }, [areas, ubah, editBrand, ambang, buka, data?.bundleSiap]); // eslint-disable-line react-hooks/exhaustive-deps

  const k = data?.keseluruhan;
  const belumTotal = (data?.hasil ?? []).reduce((t, h) => t + h.belumDiputus, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">ATP Monitoring</h1>
          <div className="mt-1 text-[12px] text-label">
            Dari SKU yang <b>memang disebar</b> ke sebuah cabang, berapa persen yang stoknya
            lebih dari <b>{ambang} pcs</b> sehingga bisa dijanjikan. SKU yang tidak disebar
            dan yang belum diputuskan <b>tidak ikut pembagi</b> — itu sebabnya checklist di
            bawah menentukan angkanya.
          </div>
        </div>
        <RefreshButton withStock onDone={reload} />
      </div>

      {/*
        Pengingat SKU baru (permintaan user 8 Okt 2026).

        Modal, bukan cuma banner, untuk kemunculan PERTAMA tiap kunjungan: SKU
        yang belum diputuskan tidak ikut pembagi ATP, jadi produk baru yang
        terlewat membuat ATP% terlihat bagus justru karena barangnya tidak
        dihitung. Itu kesalahan yang tidak menimbulkan gejala apa pun di layar,
        jadi harus menghalangi sekali.

        Sesudah ditutup, banner-nya TETAP ada — ditutup bukan berarti selesai.
      */}
      {data?.siap && baruList.length > 0 && !tutupBaru ? (
        <div
          className="sheet-backdrop"
          role="dialog" aria-modal="true" aria-labelledby="judul-sku-baru"
        >
          {/*
            Memakai `.sheet` milik aplikasi, BUKAN latar rakitan sendiri.
            Kejadian 9 Okt 2026: versi pertama memasang latar dari token
            `--surface` — nama itu TIDAK ADA (yang benar `--bg-surface`), dan
            nilai yang tidak sah bukannya diabaikan melainkan membatalkan latar
            dari kelas `.card`, jadi popup-nya TEMBUS PANDANG. `.sheet` memakai
            token yang benar, z-index yang benar, dan di lebar 360px (PDT)
            berubah jadi bottom sheet. Dijaga oleh `token-css.test.ts`.
          */}
          <div className="sheet">
            <div className="sheet-head">
              <div>
                <div id="judul-sku-baru" className="card-title">
                  {fmt(baruList.length)} SKU belum diatur sebarannya
                </div>
                <div className="mt-1 text-[13px] text-label">
                  Produk ini ada di stok OCS tapi <b>belum pernah diputuskan</b> disebar ke mana.
                  Selama belum diputuskan, SKU-nya <b>tidak ikut pembagi ATP</b> — jadi angka ATP
                  sekarang belum memperhitungkannya.
                </div>
              </div>
              <button className="btn btn-sm" onClick={() => setTutupBaru(true)} aria-label="Tutup">✕</button>
            </div>
            <div className="sheet-body">
              <div className="max-h-64 overflow-auto rounded-control border">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-muted">
                      <th className="px-2 py-1">SKU</th>
                      <th className="px-2 py-1">Kategori</th>
                      <th className="px-2 py-1">Cabang</th>
                      <th className="px-2 py-1">Terlihat sejak</th>
                    </tr>
                  </thead>
                  <tbody>
                    {baruList.slice(0, 50).map((b) => (
                      <tr key={b.sku} className="border-t">
                        <td className="px-2 py-1 mono">{b.sku}</td>
                        <td className="px-2 py-1">{b.kategori}</td>
                        <td className="px-2 py-1">{b.areas.join(', ')}</td>
                        <td className="px-2 py-1 mono">{b.firstSeenAt ? b.firstSeenAt.slice(0, 10) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {baruList.length > 50 ? (
                <div className="text-[12px] text-muted">
                  50 teratas yang ditampilkan (terbaru di atas) — {fmt(baruList.length - 50)} lagi ada di tabel.
                </div>
              ) : null}
            </div>
            <div className="sheet-foot">
              <button
                className="btn btn-primary"
                onClick={() => { setHanyaBaru(true); setTutupBaru(true); }}
              >
                Atur sekarang — filter ke {fmt(baruList.length)} SKU ini
              </button>
              <button className="btn" onClick={() => setTutupBaru(true)}>Nanti</button>
            </div>
          </div>
        </div>
      ) : null}

      {data?.siap && baruList.length > 0 ? (
        <Alert tone="warn">
          <b>{fmt(baruList.length)} SKU belum diatur sebarannya</b> dan karena itu belum ikut
          pembagi ATP.{' '}
          <button className="underline" onClick={() => setHanyaBaru(true)}>Filter ke SKU tersebut</button>
          {baruList.length <= 8 ? <> — {baruList.map((b) => b.sku).join(', ')}</> : null}
        </Alert>
      ) : null}

      {(() => {
        // Aturan turunan (keputusan user 9 Okt 2026) harus TERLIHAT, bukan cuma
        // ada di tooltip: ia memindahkan bundling keluar dari pembagi, dan
        // perubahan pembagi yang tidak diumumkan adalah cara angka ATP berubah
        // tanpa ada yang bisa menjelaskan sebabnya.
        const per = (data?.hasil ?? []).filter((h) => h.takDisebarTurunan > 0);
        const total = per.reduce((t, h) => t + h.takDisebarTurunan, 0);
        if (!total) return null;
        return (
          <Alert tone="info">
            <b>{fmt(total)} bundling keluar dari pembagi</b> karena ada komponennya yang
            sengaja <b>tidak disebar</b> ke cabang itu ({per.map((h) => `${h.areaId} ${fmt(h.takDisebarTurunan)}`).join(', ')}).
            Centangnya tidak diubah dan selnya ditandai <span className="mono">⛔</span> —
            begitu komponennya disebar lagi, bundling-nya ikut kembali sendiri.
          </Alert>
        );
      })()}

      {hanyaBaru ? (
        <Alert tone="info">
          Tabel sedang dibatasi ke <b>{fmt(baruList.length)} SKU yang belum diatur</b>. Tombol
          borongan di bawah juga hanya mengenai SKU ini.{' '}
          <button className="underline" onClick={() => setHanyaBaru(false)}>Tampilkan semua lagi</button>
        </Alert>
      ) : null}

      {error ? <Alert tone="error">{error}</Alert> : null}
      {data && !data.siap ? (
        <Alert tone="error">Tabel <code>atp_share</code> belum ada — jalankan <code>npm run db:push</code>.</Alert>
      ) : null}
      {data?.pesan ? <Alert tone="warn">{data.pesan}</Alert> : null}
      {data && data.bundleSiap === false ? (
        <Alert tone="warn">
          Tabel <code>bundle_item</code> belum ada — kolom <b>Turunan Bundling</b> akan kosong.
          Jalankan <code>npm run check:push</code> lalu <code>npm run db:push</code>.
        </Alert>
      ) : null}
      {data?.bundleSiap && data.bundleTersimpan === 0 ? (
        <Alert tone="warn">
          Komposisi bundling belum pernah ditarik dari OCS, jadi kolom <b>Turunan Bundling</b>
          masih kosong. Tekan <b>Tarik komposisi bundling</b> di toolbar tabel di bawah
          (atau jalankan <code>npm run sync:bundle</code>).
        </Alert>
      ) : null}
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
      {saring !== 'AKTIF' ? (
        <Alert tone="warn">
          Filter status sedang <b>{LABEL_SARING[saring]}</b> — itu mengubah baris yang
          <b> ditampilkan</b> di tabel. Persen ATP dan kartu per cabang di atas <b>tetap dihitung
          dari SKU aktif saja</b>, karena barang yang sudah dinonaktifkan di OCS tidak bisa
          dijanjikan ke siapa pun.
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="ATP keseluruhan" value={persenTeks(k?.persen)}
          hint={k ? `${fmt(k.siap)} siap dari ${fmt(k.dihitung)} yang disebar` : ''} />
        <Kpi label="Cabang terlemah" value={k?.terlemah?.areaId ?? '—'}
          hint={k?.terlemah ? persenTeks(k.terlemah.persen) : 'belum ada pembagi'} />
        <Kpi label="Belum diputuskan" value={fmt(belumTotal)} unit="keputusan"
          hint="di luar pembagi, dan masih menunggu orang" />
        <Kpi label="Brand kosong" value={fmt(data?.tanpaBrand.length ?? 0)} unit="SKU"
          hint="layak ATP tapi OCS tidak menyebut brand-nya" />
      </div>

      <div className="card card-pad">
        <div className="card-title mb-2">Per cabang</div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {(data?.hasil ?? []).map((h) => (
            <div key={h.areaId} className="rounded border border-[var(--border)] p-2">
              <div className="flex items-baseline justify-between">
                <b className="text-[13px]">{h.areaId}</b>
                <span className="font-mono text-[15px]">{persenTeks(h.persen)}</span>
              </div>
              <div className="mt-1 h-1.5 w-full rounded bg-[var(--border)]">
                <div className="h-1.5 rounded bg-[var(--c1)]" style={{ width: `${h.persen ?? 0}%` }} />
              </div>
              <div className="mt-1 text-[11px] text-label">
                {fmt(h.siap)} siap / {fmt(h.dihitung)} disebar
              </div>
              <div className="text-[11px] text-muted">
                {fmt(h.takDisebar)} tidak disebar · {fmt(h.belumDiputus)} belum diputuskan
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card card-pad">
        <div className="card-title mb-2">Filter & isi borongan</div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label">Status di OCS</label>
            <select
              className="input w-44" value={saring}
              onChange={(e) => setSaring(e.target.value as Saring)}
            >
              {(['AKTIF', 'NONAKTIF', 'SEMUA'] as Saring[]).map((v) => (
                <option key={v} value={v}>
                  {LABEL_SARING[v]}
                  {data ? ` (${fmt(v === 'AKTIF' ? data.cacah.aktif : v === 'NONAKTIF' ? data.cacah.nonaktif : data.cacah.semua)} baris)` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Kategori</label>
            <select className="input w-36" value={kategori} onChange={(e) => setKategori(e.target.value)}>
              <option value="ALL">Semua kategori</option>
              {['Sku', 'Bundle', 'Gimmick'].map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Brand</label>
            <select className="input w-40" value={brand} onChange={(e) => setBrand(e.target.value)}>
              <option value="ALL">Semua brand</option>
              {daftarBrand.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Cari SKU / nama</label>
            <input className="input w-48" value={cari} onChange={(e) => setCari(e.target.value)} />
          </div>
          <div>
            <label className="label">Ambang available (pcs)</label>
            <input
              className="input w-24 text-right" type="number" min={0} value={ambangDraf}
              onChange={(e) => setAmbangDraf(e.target.value)}
              onBlur={terapkanAmbang}
              onKeyDown={(e) => { if (e.key === 'Enter') terapkanAmbang(); }}
              title="Tekan Enter atau klik di luar kotak untuk menerapkan"
            />
          </div>
          <label className="check">
            <input type="checkbox" checked={hanyaBelum} onChange={(e) => setHanyaBelum(e.target.checked)} />
            Hanya yang belum diputuskan
          </label>
          <a className="btn" href={unduh}>Unduh Excel</a>
        </div>

        <div className="mt-3 border-t border-[var(--border)] pt-3">
          <div className="card-title mb-1">Ubah lewat Excel</div>
          <div className="text-[12px] text-label">
            Unduh dulu lewat tombol di atas, atur kolom cabang di lembar <b>Sebaran</b>
            (<b>Ya</b> / <b>Tidak</b> / kosong), lalu unggah kembali berkasnya di sini.
          </div>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[220px]">
              <label className="label">Berkas XLSX hasil unduhan yang sudah diedit</label>
              <input
                type="file" accept=".xlsx" className="input h-auto py-1"
                onChange={(e) => { setBerkas(e.target.files?.[0] ?? null); setPratinjau(null); }}
              />
            </div>
            <label className="check" title="Matikan kalau Anda memang ingin mengosongkan keputusan lewat sel kosong">
              <input
                type="checkbox" checked={abaikanKosong}
                onChange={(e) => { setAbaikanKosong(e.target.checked); setPratinjau(null); }}
              />
              Abaikan sel kosong
            </label>
            <button className="btn" onClick={() => unggah(false)} disabled={!berkas || busy}>
              Periksa dulu
            </button>
          </div>

          {/* Peringatan muncul HANYA saat pengamannya dimatikan. Kalau selalu
              tampil, orang berhenti membacanya tepat saat ia paling perlu. */}
          {!abaikanKosong ? (
            <div className="mt-2">
              <Alert tone="warn">
                <b>Sel kosong akan MENGOSONGKAN keputusan.</b> Itu yang membuat berkas unduhan
                bisa dipakai bolak-balik dengan setia — tapi berkas yang hanya diisi sebagian
                akan menghapus keputusan di semua baris lainnya. Periksa angka
                &quot;dikosongkan&quot; sebelum menerapkan.
              </Alert>
            </div>
          ) : null}

          {pratinjau ? (
            <div className="mt-2 rounded border border-[var(--border)] p-2">
              <div className="text-[12px] text-label">
                {fmt(pratinjau.barisDibaca)} baris dibaca. {pratinjau.pesan}
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[13px]">
                <span className="chip chip-ok">Jadi disebar: <b>{fmt(pratinjau.ringkas.jadiYa)}</b></span>
                <span className="chip">Jadi tidak: <b>{fmt(pratinjau.ringkas.jadiTidak)}</b></span>
                <span className={`chip ${pratinjau.ringkas.dikosongkan ? 'chip-bad' : ''}`}>
                  Dikosongkan: <b>{fmt(pratinjau.ringkas.dikosongkan)}</b>
                </span>
                <span className="chip">Tidak berubah: <b>{fmt(pratinjau.ringkas.takBerubah)}</b></span>
              </div>

              {pratinjau.kolomAsing.length ? (
                <div className="mt-2 text-[12px] text-label">
                  Kolom yang bukan nama cabang dan diabaikan: <b>{pratinjau.kolomAsing.join(', ')}</b>
                </div>
              ) : null}

              {pratinjau.masalahTotal ? (
                <div className="mt-2">
                  <Alert tone="warn">
                    {fmt(pratinjau.masalahTotal)} baris bermasalah dan akan dilewati:
                    <ul className="mt-1 list-disc pl-4">
                      {pratinjau.masalah.slice(0, 8).map((m, i) => (
                        <li key={i}>
                          Baris {m.baris} · {m.sku}{m.areaId ? ` · ${m.areaId}` : ''} — {m.pesan}
                        </li>
                      ))}
                    </ul>
                  </Alert>
                </div>
              ) : null}

              <div className="mt-2 flex gap-2">
                <button
                  className="btn btn-primary"
                  onClick={() => unggah(true)}
                  disabled={busy || (pratinjau.ringkas.jadiYa + pratinjau.ringkas.jadiTidak + pratinjau.ringkas.dikosongkan) === 0}
                >
                  {busy ? 'Menerapkan…' : 'Terapkan ke database'}
                </button>
                <button className="btn" onClick={() => setPratinjau(null)} disabled={busy}>Batal</button>
              </div>
              <div className="mt-1 text-[12px] text-muted">
                Terapkan menulis LANGSUNG ke database — berbeda dari centang manual di tabel,
                yang masih ditahan sampai tombol Simpan.
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-3 border-t border-[var(--border)] pt-3">
          <div className="text-[12px]">
            Berlaku ke <b>{fmt(baris.length)} SKU yang lolos filter di atas</b>.
          </div>
          <div className="mt-1 text-[12px] text-label">
            Mau mengubah sebagian saja? <b>Persempit filternya</b> — brand, kategori, pencarian,
            status — lalu tekan tombolnya. Yang terlihat di layar itulah yang berubah. (Filter kolom
            di dalam tabel tidak ikut dihitung.) Perubahannya ditahan dulu — belum tersimpan sampai
            tombol <b>Simpan</b> ditekan.
          </div>
          <div className="mt-2 space-y-1">
            {/* Baris "semua cabang" didahulukan: untuk SKU terpilih, itu yang
                paling sering dipakai — satu klik, bukan lima. */}
            {([null, ...areas] as (string | null)[]).map((a) => (
              <div key={a ?? 'SEMUA'} className="flex flex-wrap items-center gap-2">
                <span className={`w-24 text-[12px] ${a === null ? 'font-bold' : 'font-medium'}`}>
                  {a ?? 'Semua cabang'}
                </span>
                <button className="btn btn-sm" onClick={() => borongan(a, true)}>Semua disebar</button>
                <button className="btn btn-sm" onClick={() => borongan(a, false)}>Semua tidak</button>
                <button className="btn btn-sm" onClick={() => borongan(a, null)}>Kosongkan</button>
                {a === null ? <span className="h-px w-full bg-[var(--border)]" /> : null}
              </div>
            ))}
          </div>
        </div>
      </div>

      {ubah.size ? (
        <div className="card card-pad flex flex-wrap items-center justify-between gap-2 border-[var(--c1)]">
          <div className="text-[13px]">
            <b>{fmt(ubah.size)} perubahan belum disimpan.</b>{' '}
            <span className="text-label">Persen ATP di atas belum ikut berubah — ia dihitung dari yang tersimpan.</span>
          </div>
          <div className="flex gap-2">
            <button className="btn" onClick={() => setUbah(new Map())} disabled={busy}>Batalkan semua</button>
            <button className="btn btn-primary" onClick={simpan} disabled={busy}>
              {busy ? 'Menyimpan…' : `Simpan ${ubah.size} perubahan`}
            </button>
          </div>
        </div>
      ) : null}

      <DataGrid<BarisSku>
        id="atp"
        rows={baris}
        columns={columns}
        rowKey={(r) => r.sku}
        loading={!data}
        expanded={buka}
        renderExpanded={rincianTurunan}
        emptyText="Tidak ada SKU. Jalankan Refresh dulu agar stok dari OCS terisi."
        toolbarExtra={<>
          <span className="text-[12px] text-label">{fmt(baris.length)} SKU · {areas.length} cabang</span>
          <button className="btn btn-sm" onClick={tarikBundle} disabled={busy}>
            {busy ? 'Menarik…' : 'Tarik komposisi bundling'}
          </button>
        </>}
      />
    </div>
  );
}
