/**
 * ATP (Available to Promise) — modul MURNI: tanpa jaringan, tanpa database.
 *
 * Pertanyaan yang dijawab halaman ATP: dari SKU yang MEMANG DISEBAR ke sebuah
 * cabang, berapa persen yang stoknya cukup untuk dijanjikan?
 *
 * Keputusan user 7-8 Okt 2026, semuanya terkunci:
 *   - available  = `availableQty > 5` (LEBIH DARI 5), ambang GLOBAL
 *   - Reserve    = TIDAK dikurangkan
 *   - cakupan    = hanya SKU aktif di OCS, lalu difilter lagi
 *   - pembagi    = SKU yang tidak disebar KELUAR dari pembagi
 *   - bawaan     = tidak ada yang tercentang sampai diisi manual
 *   - brand      = dari OCS, tidak diterka dari nama; bentrok -> urutan prioritas
 *
 * KENAPA PEMBAGINYA PENTING. Di ATP lama, EOMMA tercatat 0/29 di Yogyakarta,
 * Makassar, dan Medan — padahal EOMMA memang tidak disebar ke cabang. 29 SKU itu
 * tetap jadi pembagi dan menarik ATP cabang turun, jadi Yogyakarta 68,6% itu
 * sebagian hukuman untuk barang yang tidak pernah dimaksudkan ada di sana.
 * Modul ini mengeluarkannya dari pembagi, dan MELAPORKAN berapa yang dikeluarkan
 * supaya pengecualian tidak jadi tempat sembunyi.
 */

/** Ambang bawaan: available bila availableQty LEBIH DARI angka ini. */
export const AMBANG_ATP_BAWAAN = 5;

/**
 * Urutan prioritas brand untuk SKU yang punya lebih dari satu.
 *
 * Diukur 8 Okt 2026: 16 SKU punya dua brand, semuanya pasangan Hanasui/NCO
 * (BBS-CHEERFUL-BLISS, BBS-JOYFULL-DAYS, BBS-SUNSHINE-GLOW, BBS-HAPPY-VIBES,
 * NCO-EDP-VANILLA-ORCHID, NCO-EDP-SUGAR-CREME, dan 10 lainnya).
 *
 * Harus deterministik: tanpa urutan tetap, brand BBS-CHEERFUL-BLISS bisa
 * Hanasui hari ini dan NCO besok hanya karena urutan baris OCS bergeser — dan
 * filter brand jadi tidak stabil tanpa ada yang sadar.
 */
export const PRIORITAS_BRAND = ['Hanasui', 'NCO', 'FYNE', 'EOMMA'] as const;

/** Brand yang menang dari beberapa kandidat. Kosong = belum diketahui. */
export function brandMenang(
  kandidat: (string | null | undefined)[],
  prioritas: readonly string[] = PRIORITAS_BRAND,
): string {
  const ada = [...new Set(kandidat.map((b) => String(b ?? '').trim()).filter(Boolean))];
  if (!ada.length) return '';
  // Cocokkan tanpa peduli besar-kecil huruf, tapi KEMBALIKAN ejaan prioritasnya
  // supaya "hanasui" dan "Hanasui" tidak jadi dua brand berbeda di layar.
  for (const p of prioritas) {
    const k = ada.find((b) => b.toLowerCase() === p.toLowerCase());
    if (k) return p;
  }
  // Di luar daftar prioritas: urut abjad, supaya tetap sama di setiap penarikan.
  return [...ada].sort((a, b) => a.localeCompare(b))[0];
}

export type BarisStokAtp = {
  sku: string;
  areaId: string;
  availableQty: number;
  isActive: boolean;
  category?: string | null;
  sapCode?: string | null;
  /** Nama produk — hanya untuk ditampilkan di daftar SKU baru. */
  name?: string;
  /**
   * Kapan baris ini PERTAMA terlihat di OCS (`stock_current.firstSeenAt`).
   *
   * Dipakai `skuBelumDiset` untuk mengurutkan yang paling baru di atas. Kolomnya
   * TIDAK ikut di `ON DUPLICATE KEY UPDATE` milik syncStock, jadi Refresh tidak
   * menyetelnya ulang — itu yang membuatnya bisa dipercaya sebagai "sejak kapan".
   */
  firstSeenAt?: string | null;
};

/**
 * Kategori yang ikut dihitung ATP — KETIGANYA (keputusan user 8 Okt 2026).
 *
 * Sebelumnya hanya 'Sku'. Diubah setelah diukur langsung ke OCS: Bundle 1.215
 * SKU aktif dan Gimmick 68 SKU aktif, dan keduanya BISA dipesan/dikeluarkan —
 * jadi keduanya termasuk barang yang dijanjikan. "Available to Promise" yang
 * hanya menghitung 375 dari 1.662 bukan menggambarkan katalog yang dijual.
 *
 * Catatan yang harus diingat saat membaca angkanya: stok Bundle itu TURUNAN.
 * Terbukti 8 Okt 2026 — 975 dari 975 baris bundle Pusat yang punya stok tidak
 * menempati satu pun lokasi rak maupun bulk, sementara Sku dan Gimmick 0 dari
 * sekian yang tanpa lokasi. Jadi satu komponen habis bisa menjatuhkan puluhan
 * bundle sekaligus, dan ATP% akan bergerak lebih tajam dari sebelumnya. Itu
 * memang keadaan sebenarnya, bukan cacat hitungan.
 *
 * DOI Monitor TIDAK ikut berubah: penyaring `category = 'Sku'` miliknya ada di
 * tujuh tempat terpisah (compute.ts, query.ts, sync.ts, api/sku-master,
 * api/transit) dan tidak satu pun disentuh dari sini.
 */
export const KATEGORI_ATP = ['Sku', 'Bundle', 'Gimmick'] as const;

export type SebabTolak =
  | 'TIDAK_AKTIF'
  | 'BUKAN_KATEGORI_SKU';

export type Kelayakan = { layak: boolean; sebab?: SebabTolak; kotor: boolean };

/** Saringan status aktif. `SEMUA` = aktif dan non-aktif sama-sama ditampilkan. */
export type SaringAktif = 'AKTIF' | 'NONAKTIF' | 'SEMUA';

/**
 * Apakah SKU ini bundle?
 *
 * `Category` TIDAK bisa dipakai: terbukti 8 Okt 2026 ada baris
 * `Category: "Sku"` dengan SKU `"- BDL-HANASUI-0000001615"` dan `SapCode`
 * kosong. Jadi prefiks `BDL-` diperiksa di mana pun ia muncul, bukan hanya di
 * awal — karena SKU di OCS kotor dan bisa berawalan `"- "` atau `"90 "`.
 */
export const adalahBundle = (sku: string) => /(^|[^A-Za-z0-9])BDL-/i.test(String(sku ?? ''));

/**
 * SKU "kotor": ada spasi/karakter aneh di awal, atau spasi di dalamnya.
 *
 * Contoh nyata: `"- BDL-HANASUI-0000001615"`, `"90 FYNE-BRIGHT-BARRIER-MOIST"`.
 *
 * Kotor TIDAK membuat barisnya dikeluarkan — `"90 FYNE-BRIGHT-BARRIER-MOIST"`
 * kemungkinan produk nyata dengan prefiks salah tulis, dan membuangnya berarti
 * kehilangan produk. Ditandai supaya bisa dibereskan, bukan disembunyikan.
 */
export const skuKotor = (sku: string) => {
  const s = String(sku ?? '');
  return s !== s.trim() || /^[^A-Za-z]/.test(s.trim()) || /\s/.test(s.trim());
};

/**
 * Layak masuk hitungan ATP? Menolak dengan SEBAB, bukan diam-diam.
 *
 * `saring` menentukan status aktif mana yang dianggap layak — BUKAN kategori.
 * Bawaannya `AKTIF`: barang yang sudah dinonaktifkan di OCS tidak bisa
 * dijanjikan ke siapa pun, jadi ia tidak boleh ikut pembagi ATP kecuali memang
 * diminta. Halaman /atp memakai `SEMUA`/`NONAKTIF` untuk MELIHAT barisnya —
 * persennya tetap dihitung dengan `AKTIF`, supaya arti angka itu tidak berubah
 * diam-diam hanya karena seseorang menggeser filter tampilan.
 *
 * Bundle TIDAK lagi ditolak. `adalahBundle()` tetap ada dan tetap dipakai —
 * sekarang untuk menentukan brand dari kodenya, bukan untuk membuang barisnya.
 */
export function kelayakan(r: BarisStokAtp, saring: SaringAktif = 'AKTIF'): Kelayakan {
  const kotor = skuKotor(r.sku);
  const cocokAktif = saring === 'SEMUA' || (saring === 'AKTIF' ? r.isActive : !r.isActive);
  if (!cocokAktif) return { layak: false, sebab: 'TIDAK_AKTIF', kotor };
  if (!(KATEGORI_ATP as readonly string[]).includes(String(r.category ?? ''))) {
    return { layak: false, sebab: 'BUKAN_KATEGORI_SKU', kotor };
  }
  return { layak: true, kotor };
}

/** Keputusan sebaran. Tidak ada baris = belum diputuskan. */
export type Sebaran = Map<string, boolean>;

/** Kunci peta sebaran. Satu SKU di dua area adalah DUA keputusan. */
export const kunciSebaran = (sku: string, areaId: string) => `${areaId}\u0000${sku}`;

export type HasilArea = {
  areaId: string;
  /** Pembagi: layak ATP DAN dibagikan ke area ini. */
  dihitung: number;
  /** Dari `dihitung`, yang availableQty > ambang. */
  siap: number;
  /** Persen siap dari `dihitung`. null bila pembaginya 0 — BUKAN 0%. */
  persen: number | null;
  /** Layak ATP tapi sengaja TIDAK disebar — keluar dari pembagi. */
  takDisebar: number;
  /** Layak ATP tapi belum ada keputusannya — keluar dari pembagi. */
  belumDiputus: number;
  /** Tidak layak ATP, dirinci sebabnya. */
  ditolak: Record<SebabTolak, number>;
  /**
   * Pembagi dipecah per kategori — supaya terlihat SIAPA yang menggerakkan
   * angkanya. Bundle 1.215 dari 1.662 SKU aktif (73%), jadi tanpa perincian ini
   * ATP% akan lebih banyak bercerita tentang bundle daripada produk satuan dan
   * tidak ada yang bisa melihatnya dari persennya saja.
   */
  perKategori: Record<string, { dihitung: number; siap: number }>;
  /** SKU dengan penulisan kotor — peringatan, bukan pengecualian. */
  kotor: number;
};

/**
 * Hitung ATP per area.
 *
 * `persen` sengaja `null` saat pembaginya 0, bukan 0%. Cabang baru yang belum
 * diisi checklist-nya punya pembagi 0; menampilkannya sebagai "0%" akan terbaca
 * seperti bencana stok, padahal artinya "belum ada yang diputuskan".
 */
export function hitungAtp(
  rows: BarisStokAtp[],
  sebaran: Sebaran,
  ambang: number = AMBANG_ATP_BAWAAN,
  saring: SaringAktif = 'AKTIF',
): HasilArea[] {
  const per = new Map<string, HasilArea>();
  const ambil = (areaId: string): HasilArea => {
    let h = per.get(areaId);
    if (!h) {
      h = {
        areaId, dihitung: 0, siap: 0, persen: null, takDisebar: 0, belumDiputus: 0,
        ditolak: { TIDAK_AKTIF: 0, BUKAN_KATEGORI_SKU: 0 },
        perKategori: Object.fromEntries(KATEGORI_ATP.map((k) => [k, { dihitung: 0, siap: 0 }])),
        kotor: 0,
      };
      per.set(areaId, h);
    }
    return h;
  };

  for (const r of rows) {
    const h = ambil(r.areaId);
    const k = kelayakan(r, saring);
    if (k.kotor) h.kotor++;
    if (!k.layak) { h.ditolak[k.sebab!]++; continue; }

    const putusan = sebaran.get(kunciSebaran(r.sku, r.areaId));
    if (putusan === undefined) { h.belumDiputus++; continue; }
    if (putusan === false) { h.takDisebar++; continue; }

    const siap = Number(r.availableQty) > ambang;
    h.dihitung++;
    if (siap) h.siap++;

    // Perincian per kategori memakai kunci yang SAMA dengan yang sudah lolos
    // `kelayakan()`, jadi jumlah seluruh kategori selalu sama dengan `dihitung`
    // — diuji, bukan diandaikan.
    const kat = String(r.category ?? '');
    const pk = h.perKategori[kat];
    if (pk) { pk.dihitung++; if (siap) pk.siap++; }
  }

  for (const h of per.values()) {
    h.persen = h.dihitung > 0 ? (h.siap / h.dihitung) * 100 : null;
  }
  return [...per.values()].sort((a, b) => a.areaId.localeCompare(b.areaId));
}

/**
 * ATP keseluruhan dari hasil per area.
 *
 * Dijumlahkan dari pembagi dan pembilangnya, BUKAN dirata-rata dari persen per
 * area: rata-rata persen memberi bobot sama ke cabang yang punya 356 SKU dan
 * cabang baru yang punya 3, sehingga angka keseluruhan bisa bergerak tajam
 * hanya karena satu cabang kecil.
 */
// ---------------------------------------------------------------------------
// Turunan bundling — hanya untuk DITAMPILKAN (permintaan user 9 Okt 2026)
// ---------------------------------------------------------------------------

/** Komposisi: bundleSku -> daftar { itemSku, qty }. Dari tabel `bundle_item`. */
export type PetaBundle = Map<string, { itemSku: string; qty: number }[]>;

/** Keadaan satu komponen di satu area. */
export type SelTurunan = {
  /** null = komponen tidak terdaftar sama sekali di area itu. */
  stok: number | null;
  /** null = tidak terdaftar; true/false = isActive OCS di area itu. */
  aktif: boolean | null;
  /**
   * Berapa bundle yang bisa dibentuk komponen ini sendirian di area ini:
   * floor(stok / qty). null kalau stoknya tidak diketahui.
   */
  muat: number | null;
};

export type Turunan = {
  itemSku: string;
  name: string;
  qty: number;
  /** Per area. Area yang tidak ada barisnya tetap diisi, dengan nilai null. */
  area: Record<string, SelTurunan>;
  /** Jumlah area tempat komponen ini aktif. */
  nAktif: number;
  /** Jumlah area tempat komponen ini terdaftar tapi NONAKTIF. */
  nNonaktif: number;
};

export type RingkasTurunan = {
  /** Jumlah jenis komponen. 0 = bukan bundle, atau komposisinya belum ditarik. */
  n: number;
  turunan: Turunan[];
  /**
   * Per area: berapa bundle yang BISA dibentuk menurut komponennya —
   * min(floor(stok komponen / qty)) atas seluruh komponen.
   *
   * INI ANGKA TURUNAN KITA SENDIRI, bukan angka OCS. Dipakai menjelaskan
   * "kenapa bundle ini kosong padahal komponennya ada": kalau satu komponen
   * habis, seluruh bundle tidak bisa dijanjikan. Ditampilkan BERDAMPINGAN
   * dengan angka OCS, tidak menggantikannya — kalau keduanya beda, itu
   * informasi, bukan sesuatu yang boleh ditimpa diam-diam.
   */
  muat: Record<string, number | null>;
  /** Komponen yang paling membatasi per area (yang `muat`-nya terkecil). */
  pembatas: Record<string, string>;
  /** Komponen yang nonaktif di SETIDAKNYA satu area. */
  adaNonaktif: boolean;
};

/**
 * Susun turunan sebuah bundle dari komposisi + baris stok yang SUDAH dimuat.
 *
 * `stokPerSku` dibangun sekali oleh pemanggil dari baris `stock_current` yang
 * memang sudah dibaca halaman ATP — jadi fitur ini TIDAK menambah satu pun
 * kueri stok. Yang ditambah cuma satu bacaan tabel `bundle_item`.
 *
 * Komponen yang tidak ada di `stokPerSku` TIDAK dibuang: ia muncul dengan
 * stok/aktif = null. Komponen yang hilang dari daftar stok adalah justru hal
 * yang perlu dilihat orang — membuangnya membuat bundle terlihat lengkap.
 */
export function susunTurunan(
  bundleSku: string,
  peta: PetaBundle,
  stokPerSku: Map<string, Map<string, { availableQty: number; isActive: boolean; name: string }>>,
  areas: string[],
): RingkasTurunan {
  const komposisi = peta.get(bundleSku) ?? [];
  const kosong: RingkasTurunan = {
    n: 0, turunan: [], muat: {}, pembatas: {}, adaNonaktif: false,
  };
  if (!komposisi.length) return kosong;

  const turunan: Turunan[] = komposisi.map((k) => {
    const perArea = stokPerSku.get(k.itemSku);
    const area: Record<string, SelTurunan> = {};
    let nAktif = 0; let nNonaktif = 0;
    let name = '';
    for (const a of areas) {
      const r = perArea?.get(a);
      if (!r) { area[a] = { stok: null, aktif: null, muat: null }; continue; }
      if (!name && r.name) name = r.name;
      if (r.isActive) nAktif++; else nNonaktif++;
      area[a] = {
        stok: r.availableQty,
        aktif: r.isActive,
        muat: Math.floor(r.availableQty / Math.max(1, k.qty)),
      };
    }
    return { itemSku: k.itemSku, name, qty: k.qty, area, nAktif, nNonaktif };
  });

  const muat: Record<string, number | null> = {};
  const pembatas: Record<string, string> = {};
  for (const a of areas) {
    let min: number | null = null;
    let siapa = '';
    for (const t of turunan) {
      const m = t.area[a]?.muat;
      // Komponen yang stoknya TIDAK DIKETAHUI membuat seluruh hitungan tidak
      // bisa dipercaya, jadi jawabannya null — bukan diam-diam dilewati, yang
      // akan menghasilkan angka terlalu optimistis dari komponen yang tersisa.
      if (m === null || m === undefined) { min = null; siapa = t.itemSku; break; }
      if (min === null || m < min) { min = m; siapa = t.itemSku; }
    }
    muat[a] = min;
    pembatas[a] = siapa;
  }

  return {
    n: turunan.length,
    turunan,
    muat,
    pembatas,
    adaNonaktif: turunan.some((t) => t.nNonaktif > 0),
  };
}

/** Satu SKU yang belum punya keputusan sebaran sama sekali. */
export type SkuBelumDiset = {
  sku: string;
  name: string;
  kategori: string;
  /** Area tempat SKU ini ada barisnya — inilah yang perlu diputuskan. */
  areas: string[];
  /** Paling awal dari `firstSeenAt` barisnya. '' = tidak diketahui. */
  firstSeenAt: string;
};

/**
 * SKU yang BELUM pernah diputuskan sebarannya di area mana pun.
 *
 * Inilah definisi "produk baru yang belum diset di daftar ATP" (permintaan user
 * 8 Okt 2026). Sengaja TIDAK memakai "firstSeenAt < N hari":
 *
 *   - SKU yang sudah 3 bulan ada tapi belum pernah diputuskan juga tetap
 *     merusak angka ATP, dan tidak boleh hilang dari pengingat hanya karena
 *     sudah lama diabaikan;
 *   - begitu user memutuskan — Ya MAUPUN Tidak — SKU-nya langsung berhenti
 *     muncul. Jadi daftarnya mengosongkan dirinya sendiri dan tidak bisa jadi
 *     peringatan yang selalu menyala lalu diabaikan.
 *
 * `firstSeenAt` tetap dibawa, tapi hanya untuk MENGURUTKAN (terbaru di atas)
 * dan memberi tahu sejak kapan — bukan untuk menyaring.
 *
 * SKU tanpa satu pun baris area tidak dihitung: `Object.values([]).every(...)`
 * itu `true`, jadi tanpa penjaga ini baris hampa akan ikut terlapor sebagai
 * "belum diset".
 *
 * Yang dibaca `rows` penuh, BUKAN baris yang sudah disaring tampilan — kalau
 * tidak, memasang filter apa pun akan menyembunyikan pengingatnya.
 */
export function skuBelumDiset(
  rows: BarisStokAtp[],
  sebaran: Sebaran,
  saring: SaringAktif = 'AKTIF',
): SkuBelumDiset[] {
  const per = new Map<string, SkuBelumDiset & { adaPutusan: boolean }>();
  for (const r of rows) {
    if (!kelayakan(r, saring).layak) continue;   // nonaktif / di luar kategori tidak perlu diputuskan
    let e = per.get(r.sku);
    if (!e) {
      e = { sku: r.sku, name: String(r.name ?? ''), kategori: String(r.category ?? ''), areas: [], firstSeenAt: '', adaPutusan: false };
      per.set(r.sku, e);
    }
    if (!e.name && r.name) e.name = String(r.name);
    e.areas.push(r.areaId);
    const f = String(r.firstSeenAt ?? '');
    if (f && (!e.firstSeenAt || f < e.firstSeenAt)) e.firstSeenAt = f;
    if (sebaran.get(kunciSebaran(r.sku, r.areaId)) !== undefined) e.adaPutusan = true;
  }
  return [...per.values()]
    .filter((e) => !e.adaPutusan && e.areas.length > 0)
    .map(({ adaPutusan, ...e }) => ({ ...e, areas: [...new Set(e.areas)].sort((a, b) => a.localeCompare(b)) }))
    // Terbaru di atas; yang tanggalnya tidak diketahui paling bawah.
    .sort((a, b) => (b.firstSeenAt || '').localeCompare(a.firstSeenAt || '') || a.sku.localeCompare(b.sku));
}

export function atpKeseluruhan(hasil: HasilArea[]): {
  dihitung: number; siap: number; persen: number | null; terlemah: HasilArea | null;
} {
  const dihitung = hasil.reduce((t, h) => t + h.dihitung, 0);
  const siap = hasil.reduce((t, h) => t + h.siap, 0);
  const berisi = hasil.filter((h) => h.persen !== null);
  const terlemah = berisi.length
    ? berisi.reduce((m, h) => (h.persen! < m.persen! ? h : m))
    : null;
  return { dihitung, siap, persen: dihitung > 0 ? (siap / dihitung) * 100 : null, terlemah };
}

/** "71,0%" — satu desimal, koma, sesuai lokal yang dipakai seluruh aplikasi. */
export const persenTeks = (p: number | null) =>
  (p === null ? '—' : `${p.toFixed(1).replace('.', ',')}%`);

/** Satu baris mentah pencarian brand dari OCS (hanya medan yang dipakai). */
export type BarisBrandOcs = { SellerSku?: string; ShopCode?: string; ShopName?: string };

export type HasilPetaBrand = {
  /** SKU -> brand yang menang. */
  brand: Map<string, string>;
  /** SKU -> semua brand yang OCS sebut, dipisah ", " — untuk audit. */
  asal: Map<string, string>;
  /** SKU yang OCS sebut dengan LEBIH DARI satu brand. */
  bentrok: {
    sku: string; brand: string[]; menang: string;
    /** true = diputus oleh kode SKU-nya, bukan oleh urutan prioritas. */
    dariKode?: boolean;
  }[];
};

/**
 * Bangun peta SKU -> brand dari baris mentah OCS.
 *
 * Dipisah dari penariknya supaya bisa diuji tanpa jaringan. `ShopCode` dipakai
 * lebih dulu; `ShopName` hanya cadangan kalau `ShopCode` kosong.
 *
 * Bentrokan DIKEMBALIKAN, bukan diselesaikan diam-diam: 16 SKU punya dua brand,
 * dan orang yang membaca filter brand berhak tahu mana saja yang dipaksa pilih.
 */
/**
 * Brand dari KODE SKU bundle — `BDL-<BRAND>-<angka>`.
 *
 * Diukur langsung ke OCS 8 Okt 2026: **1.215 dari 1.215** SKU bundle aktif
 * cocok pola ini, NOL yang meleset, dan brand-nya persis empat yang sudah
 * dikenal — HANASUI 924, NCO 216, FYNE 49, EOMMA 26.
 *
 * KENAPA INI TIDAK MELANGGAR ATURAN "jangan ambil brand dari nama".
 * Yang user larang adalah menerka dari medan `Name` — teks bebas seperti
 * "Hanasui Serum 30ml x 48 MP", yang bentuknya tidak dijamin dan menebak dari
 * situ akan salah mengelompokkan tanpa ada yang tahu. Ini medan yang berbeda:
 * KODE SKU, tetap dari OCS, bentuknya baku, dan kebenarannya bisa dihitung —
 * 0 gagal dari 1.215.
 *
 * KENAPA PERLU SAMA SEKALI. `DTO_LookupStockDetailedData` — satu-satunya tempat
 * brand ada di OCS — memuat NOL bundle (cakupan 0,0%). Tanpa ini 1.215 dari
 * 1.662 baris checklist (73%) tidak punya brand, dan filter brand adalah
 * satu-satunya cara mengisi borongan. Pekerjaannya jadi 6.075 keputusan satu
 * per satu.
 *
 * Gimmick SENGAJA tidak ikut: polanya `GIMMICK-<X>-` memang cocok 68 dari 68,
 * tapi X sering bukan brand (TAS, TUMBLER, VOUCHER, STICKER, CATOKAN). Hanya 51
 * dari 68 yang segmen keduanya brand asli — terlalu kotor untuk dipercaya, dan
 * 20 yang belum punya brand dari lookup masih wajar diisi tangan.
 */
export function brandDariKode(sku: string, prioritas: readonly string[] = PRIORITAS_BRAND): string {
  const s = String(sku ?? '').trim();
  // DUA segmen pertama saja yang diperiksa — dan itu batas yang disengaja.
  //
  // Brand bisa ada di segmen 1 (`NCO-EDP-AMETHYST`) atau segmen 2
  // (`CS-HANASUI-…`, `BDL-HANASUI-…`, `GIMMICK-NCO-…`), jadi keduanya dilihat.
  // Segmen ke-3 dan seterusnya TIDAK: `GIMMICK-VOUCHER-KLIKNCLEAN-EOMMA` memuat
  // EOMMA di ujung, tapi itu voucher UNTUK EOMMA — bukan produk brand EOMMA.
  // Memperluas pencarian ke seluruh kode akan mengubah aturan ini jadi menebak.
  //
  //
  // Tiap segmen juga dibersihkan sendiri dari awalan bukan-huruf, supaya
  // `"90 FYNE-BRIGHT-BARRIER-MOIST"` — bentuk nyata di OCS — terbaca FYNE dan
  // bukan "90 FYNE".
  // DUA pembersihan, dan keduanya perlu — masing-masing untuk bentuk kotor yang
  // berbeda dan nyata ada di OCS:
  //   `"- BDL-HANASUI-…"`  awalan "- " membuat segmen PERTAMA kosong dan
  //                        menggeser brand ke indeks 2, jadi dibuang dulu
  //                        sebelum dipotong.
  //   `"90 FYNE-BRIGHT-…"` awalan "90 " menempel di dalam segmennya sendiri,
  //                        jadi tiap segmen dibersihkan lagi satu per satu.
  const segmen = s
    .replace(/^[^A-Za-z0-9]+/, '')
    .split('-')
    .slice(0, 2)
    .map((x) => x.replace(/^[^A-Za-z]+/, '').trim());
  for (const seg of segmen) {
    // PENJAGA UTAMA: hanya diterima kalau segmennya BENAR-BENAR salah satu brand
    // yang dikenal. Itu yang membuat aturan ini tidak jadi terkaan —
    // `CS-MUD-MASK-JAPANESE` dan `GIMMICK-TUMBLER-OAWALA` mengembalikan kosong,
    // bukan "MUD" atau "TUMBLER". Terukur 8 Okt 2026: dari 46 SKU tanpa brand,
    // 30 tertolong dan 16 tetap kosong — tepat yang kodenya memang tidak
    // menyebut brand.
    //
    // Dikembalikan dengan ejaan daftar prioritas supaya "HANASUI" dari kode dan
    // "Hanasui" dari lookup tidak jadi dua brand berbeda di filter.
    const k = seg.toLowerCase();
    const cocok = prioritas.find((p) => p.toLowerCase() === k);
    if (cocok) return cocok;
  }
  return '';
}

export function petaBrand(
  rows: BarisBrandOcs[],
  prioritas: readonly string[] = PRIORITAS_BRAND,
): HasilPetaBrand {
  const kumpul = new Map<string, Set<string>>();
  for (const r of rows) {
    const sku = String(r.SellerSku ?? '').trim();
    if (!sku) continue;
    const b = String(r.ShopCode ?? '').trim() || String(r.ShopName ?? '').trim();
    if (!b) continue;
    (kumpul.get(sku) ?? kumpul.set(sku, new Set()).get(sku)!).add(b);
  }

  const brand = new Map<string, string>();
  const asal = new Map<string, string>();
  const bentrok: { sku: string; brand: string[]; menang: string; dariKode?: boolean }[] = [];
  for (const [sku, set] of kumpul) {
    const daftar = [...set].sort((a, b) => a.localeCompare(b));

    // KODE SKU MENANG ATAS URUTAN PRIORITAS — tapi hanya kalau brand di kodenya
    // memang SALAH SATU kandidat bentrokan itu (keputusan user 8 Okt 2026).
    //
    // Kena di hasil nyata: 11 parfum `NCO-EDP-*` muncul di toko Hanasui DAN
    // NCO, lalu urutan prioritas melabelinya Hanasui — padahal kodenya sendiri
    // menyebut NCO. Akibatnya siapa pun yang mengisi borongan dengan filter
    // brand "NCO" melewatkan sebelas parfum NCO tanpa tahu.
    //
    // Syarat "harus salah satu kandidat" penting: kalau kodenya menyebut brand
    // yang TIDAK terdaftar di OCS untuk SKU itu, kode-nya yang meragukan, bukan
    // datanya — jadi urutan prioritas yang dipakai.
    const kode = brandDariKode(sku, prioritas);
    const kodeSahih = !!kode && daftar.some((d) => d.toLowerCase() === kode.toLowerCase());
    const menang = kodeSahih ? kode : brandMenang(daftar, prioritas);

    brand.set(sku, menang);
    asal.set(sku, daftar.join(', '));
    if (daftar.length > 1) bentrok.push({ sku, brand: daftar, menang, dariKode: kodeSahih });
  }
  bentrok.sort((a, b) => a.sku.localeCompare(b.sku));
  return { brand, asal, bentrok };
}

/**
 * Isi brand yang MASIH KOSONG dari kode SKU-nya. Lookup OCS selalu menang.
 *
 * Dipisah dari `petaBrand` dengan sengaja: `petaBrand` menerjemahkan satu
 * sumber (lookup OCS), fungsi ini menggabungkan sumber kedua. Aturan
 * gabungannya jadi terlihat dan bisa diuji sendiri, bukan tersembunyi di dalam
 * penerjemah.
 *
 * Lookup menang karena ia pernyataan OCS yang eksplisit; kode SKU hanya
 * kesimpulan dari bentuk penamaan. Kalau keduanya ada dan berbeda, yang
 * eksplisit yang benar.
 *
 * `asal` dicatat "kode BDL-" supaya baris hasil terkaan ini bisa dibedakan dari
 * baris yang OCS sebutkan sendiri — tanpa itu, tidak ada yang bisa meninjau
 * ulang kalau penamaannya berubah suatu hari.
 */
export function lengkapiDariKode(
  peta: HasilPetaBrand,
  semuaSku: string[],
  prioritas: readonly string[] = PRIORITAS_BRAND,
): { diisi: number; brand: Map<string, string>; asal: Map<string, string> } {
  const brand = new Map(peta.brand);
  const asal = new Map(peta.asal);
  let diisi = 0;
  for (const sku of semuaSku) {
    const s = String(sku ?? '').trim();
    if (!s || brand.get(s)) continue;          // lookup menang
    const b = brandDariKode(s, prioritas);
    if (!b) continue;
    brand.set(s, b);
    asal.set(s, 'kode BDL-');
    diisi++;
  }
  return { diisi, brand, asal };
}

/** Baris minimal yang dibutuhkan penentu lingkup borongan. */
export type BarisBorongan = { sku: string; area: Record<string, unknown> };

/**
 * Tentukan baris dan jumlah keputusan yang akan diubah oleh isi borongan.
 *
 * MURNI dan diuji karena inilah bagian yang bisa merusak paling banyak: satu
 * klik bisa menulis ulang ribuan keputusan sebaran, dan kalau lingkupnya salah
 * tidak ada yang akan menyadarinya sampai ATP% bergerak tanpa sebab.
 *
 * SATU aturan, tanpa pengecualian: lingkupnya adalah baris yang lolos FILTER
 * yang sedang aktif. Titik.
 *
 * Sempat ada kolom centang yang diam-diam MENANG atas filter kalau ada isinya.
 * User menolaknya 8 Okt 2026, dan benar: tombol yang artinya berubah tergantung
 * keadaan layar adalah tombol yang tidak bisa dipercaya. Mau mengubah sebagian?
 * Persempit filternya — brand, kategori, pencarian, status — lalu tekan tombolnya.
 * Yang terlihat di layar itulah yang berubah.
 *
 * `nKeputusan` dihitung terpisah dari jumlah SKU: untuk "semua cabang" keduanya
 * jauh berbeda (20 SKU x 5 cabang = 100 keputusan), dan angka yang lebih besar
 * itulah yang sebenarnya akan tersimpan — jadi itu yang harus disebut sebelum
 * user menekan OK.
 */
export function lingkupBorongan<T extends BarisBorongan>(
  baris: T[],
  areaKena: string[],
): { target: T[]; nKeputusan: number } {
  // Baris yang tidak punya SATU pun area yang kena tidak ikut: mencantumkannya
  // membuat jumlah di layar lebih besar dari yang benar-benar berubah.
  const target = baris.filter((r) => areaKena.some((a) => r.area[a] !== undefined));
  const nKeputusan = target.reduce(
    (t, r) => t + areaKena.filter((a) => r.area[a] !== undefined).length,
    0,
  );
  return { target, nKeputusan };
}
