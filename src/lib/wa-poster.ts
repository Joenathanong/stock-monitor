import type { AmbangDoi } from './area-master';
/**
 * Poster WhatsApp — bagian yang murni hitungan, terpisah dari komponennya.
 *
 * Kenapa warnanya HEX TELANJANG, bukan var(--token) seperti di seluruh aplikasi:
 * poster ini diserialkan jadi SVG mandiri lalu digambar ke <canvas> untuk
 * menghasilkan JPG. SVG yang berdiri sendiri TIDAK mewarisi custom property dari
 * dokumen induknya — semua var(--x) akan berubah jadi hitam. Jadi nilainya harus
 * tertulis apa adanya. Ini satu-satunya tempat di repo yang boleh begitu, dan
 * angkanya disalin dari design-ocs.md §2 (tema Morning).
 *
 * Tema gelap sengaja tidak dibuat: hasilnya dikirim ke grup WhatsApp sebagai
 * gambar, dan latar terang terbaca di semua perangkat.
 */
export const WARNA = {
  kanvas: '#F5F6FA',
  permukaan: '#FFFFFF',
  permukaanAlt: '#FAFBFD',
  garis: '#D9DDE7',
  garisHalus: '#E5E7EF',
  tinta: '#131E29',
  tintaLabel: '#556B82',
  primary: '#4F46E5',
  onPrimary: '#FFFFFF',
  // Status (SAP Horizon, §2.4). Solid untuk batang, fg untuk teks kecil.
  kritisSolid: '#E90B0B', kritisFg: '#AA0808', kritisBg: '#FFEAF4',
  lowSolid: '#E76500', lowFg: '#A85A00', lowBg: '#FFF8D6',
  amanSolid: '#30914C', amanFg: '#256F3A', amanBg: '#F5FAE5',
  infoSolid: '#0070F2', infoFg: '#0070F2', infoBg: '#E1F4FF',
  netralSolid: '#788FA6', netralFg: '#556B82', netralBg: '#EFF1F2',
  violet: '#7445F7',
} as const;

/**
 * Kanvas tetap: bot cukup mengunduh, tidak perlu mengatur ukuran jendela.
 *
 * Tingginya 1000, naik dari 900 pada 8 Okt 2026 saat ATP masuk ke blok angka.
 * Blok itu jadi 4 baris kotak (dari 3), +46px, dan di kanvas 900 tambahan itu
 * memaksa jarak baris status turun lagi. Yang dibayar kanvas lebih tinggi:
 * jarak baris status naik dari 16 ke 20 (yang paling longgar yang tersedia) DAN
 * daftar mendesak tetap kebagian satu baris seperti sebelumnya — jadi ATP masuk
 * tanpa ada yang dikorbankan. Angkanya diuji, bukan dikira: lihat
 * wa-poster.test.ts.
 */
export const KANVAS = { w: 1600, h: 1000 } as const;

/**
 * Posisi & sisa ruang kartu area. SATU sumber, dipakai poster DAN tesnya.
 *
 * Dulu tingginya ditulis `900 - 216 - 56` di poster.tsx dan `628` di tesnya.
 * Dua tempat untuk satu angka: begitu kanvasnya diubah, tesnya menjaga tinggi
 * yang sudah tidak dipakai siapa pun, dan luberan yang mestinya ketahuan jadi
 * lolos. Sekarang tesnya memanggil fungsi ini.
 */
export const KARTU = { y: 216, bawah: 56, pad: 16 } as const;
export const tinggiKartuTersedia = (kanvas: { h: number } = KANVAS) =>
  kanvas.h - KARTU.y - KARTU.bawah;

export const FONT = "Arial, Helvetica, 'Liberation Sans', sans-serif";
export const FONT_MONO = "'DejaVu Sans Mono', Menlo, Consolas, monospace";

/**
 * Sebaran status, DUA kelompok yang digambar berbeda.
 *
 * PERUBAHAN 7 Okt 2026 atas permintaan user: dulu enam status non-DOI dilipat
 * jadi satu baris "Lain", dan itu menyembunyikan hal yang perlu dilihat —
 * terutama Dead Stock (uang mengendap) dan SIT (barang sudah jalan).
 *
 *   PITA DOI (4)  : posisi stok pada skala hari yang SAMA, jadi layak
 *                   dibandingkan satu sama lain -> digambar sebagai batang.
 *   KETERANGAN (6): bukan tingkat keparahan dan bukan satu skala, jadi TIDAK
 *                   diberi batang — batang akan mengundang perbandingan yang
 *                   tidak ada artinya. Cukup label + angka.
 *
 * Warna status adalah warna CADANGAN dan selalu ditemani label + angka, tidak
 * pernah warna saja. Kelompok keterangan sengaja memakai nada netral yang
 * berulang: yang membedakannya adalah labelnya, bukan warnanya, dan memberi
 * enam warna baru di sana akan terbaca seolah ada urutan keparahan.
 */
export const URUT_STATUS = ['CRITICAL', 'LOW', 'HEALTHY', 'OVERSTOCK'] as const;

/** Status non-DOI, urut dari yang paling perlu dilihat. */
export const URUT_LAIN = ['WAITING', 'DEAD_STOCK', 'NO_SALES', 'NPL_WAIT', 'PHASE_OUT', 'EXCLUDED'] as const;

export type StatusPoster = (typeof URUT_STATUS)[number] | (typeof URUT_LAIN)[number] | 'LAIN';

export const STATUS_POSTER: Record<StatusPoster, { label: string; warna: string }> = {
  CRITICAL: { label: 'Kritis', warna: WARNA.kritisSolid },
  LOW: { label: 'Low', warna: WARNA.lowSolid },
  HEALTHY: { label: 'Aman', warna: WARNA.amanSolid },
  OVERSTOCK: { label: 'Overstock', warna: WARNA.violet },
  // "SIT", bukan "Tunggu Kiriman" — istilah yang dipakai user sehari-hari.
  WAITING: { label: 'SIT', warna: WARNA.infoSolid },
  DEAD_STOCK: { label: 'Dead Stock', warna: WARNA.netralFg },
  NO_SALES: { label: 'Belum Terjual', warna: WARNA.netralSolid },
  NPL_WAIT: { label: 'NPL', warna: WARNA.netralSolid },
  PHASE_OUT: { label: 'Phase Out', warna: WARNA.netralFg },
  EXCLUDED: { label: 'Dikecualikan', warna: WARNA.netralSolid },
  // Jaring pengaman: status yang belum dikenal tidak boleh hilang tanpa jejak.
  LAIN: { label: 'Lain-lain', warna: WARNA.netralSolid },
};

export type Segmen = { key: StatusPoster; label: string; warna: string; n: number };

/**
 * Status mana yang ditampilkan, diputuskan SEKALI untuk SELURUH area.
 *
 * Aturan user 7 Okt 2026: baris yang nilainya 0 di SEMUA area tidak perlu
 * ditampilkan; begitu satu area saja terisi, barisnya muncul di semua kartu.
 *
 * Kenapa lintas area dan bukan per area: kalau tiap kartu menyembunyikan baris
 * nolnya sendiri, tinggi kartu jadi berbeda-beda dan barisnya tidak sejajar
 * antar kolom — mata tidak bisa lagi membandingkan "Dead Stock" Medan dengan
 * Makassar karena posisinya bergeser. Jadi keputusannya satu untuk semuanya.
 *
 * Kalau SEMUA nol (umumnya berarti belum ada data), empat pita DOI tetap
 * ditampilkan: blok kosong tanpa penjelasan lebih membingungkan daripada empat
 * baris bernilai 0.
 */
export function kunciTampil(
  semuaByStatus: (Record<string, number> | null | undefined)[],
): Set<StatusPoster> {
  const total = new Map<string, number>();
  for (const b of semuaByStatus) {
    for (const [k, v] of Object.entries(b ?? {})) total.set(k, (total.get(k) ?? 0) + (Number(v) || 0));
  }
  const dikenal = new Set<string>([...URUT_STATUS, ...URUT_LAIN]);
  const out = new Set<StatusPoster>();
  for (const k of [...URUT_STATUS, ...URUT_LAIN]) {
    if ((total.get(k) ?? 0) > 0) out.add(k as StatusPoster);
  }
  // Status yang belum dikenal dijumlahkan jadi satu baris "Lain-lain".
  let asing = 0;
  for (const [k, v] of total) if (!dikenal.has(k)) asing += v;
  if (asing > 0) out.add('LAIN');

  if (!out.size) for (const k of URUT_STATUS) out.add(k as StatusPoster);
  return out;
}

/**
 * Empat pita DOI — diberi batang.
 *
 * `tampil` dari `kunciTampil`; tanpa itu keempatnya ditampilkan apa adanya.
 */
export function segmenStatus(
  byStatus: Record<string, number> | null | undefined,
  tampil?: ReadonlySet<StatusPoster>,
): Segmen[] {
  const b = byStatus ?? {};
  return URUT_STATUS
    .filter((k) => !tampil || tampil.has(k as StatusPoster))
    .map((k) => ({ key: k as StatusPoster, ...STATUS_POSTER[k], n: Number(b[k] ?? 0) }));
}

/**
 * Enam status keterangan, dirinci satu per satu.
 *
 * Yang bernilai 0 di area INI tetap ditampilkan kalau area LAIN punya isinya
 * (lihat `kunciTampil`): tinggi kartu harus sama supaya barisnya sejajar antar
 * kolom. Yang 0 di SEMUA area disembunyikan. Status di luar sepuluh yang dikenal
 * dijumlahkan jadi "Lain-lain" supaya penambahan status baru di `doi.ts` tidak
 * lenyap dari poster.
 */
export function segmenLain(
  byStatus: Record<string, number> | null | undefined,
  tampil?: ReadonlySet<StatusPoster>,
): Segmen[] {
  const b = byStatus ?? {};
  const inti = URUT_LAIN
    .filter((k) => !tampil || tampil.has(k as StatusPoster))
    .map((k) => ({ key: k as StatusPoster, ...STATUS_POSTER[k], n: Number(b[k] ?? 0) }));
  const dikenal = new Set<string>([...URUT_STATUS, ...URUT_LAIN]);
  const sisa = Object.entries(b).reduce((t, [k, v]) => (dikenal.has(k) ? t : t + Number(v || 0)), 0);
  // Baris "Lain-lain" muncul kalau area INI punya sisa, atau kalau area LAIN
  // punya (lewat `tampil`) — supaya barisnya sejajar di semua kartu.
  const perlu = tampil ? tampil.has('LAIN') : sisa > 0;
  return perlu ? [...inti, { key: 'LAIN' as StatusPoster, ...STATUS_POSTER.LAIN, n: sisa }] : inti;
}

/** Rupiah diringkas — "Rp 52,4 M" muat di kartu selebar 294px, "Rp 52.431.882.100" tidak. */
export function rupiahRingkas(n: number): string {
  const a = Math.abs(n);
  const f = (x: number, s: string) => `Rp ${x.toFixed(x >= 100 ? 0 : 1).replace('.', ',')} ${s}`;
  if (a >= 1e12) return f(n / 1e12, 'T');
  if (a >= 1e9) return f(n / 1e9, 'M');
  if (a >= 1e6) return f(n / 1e6, 'jt');
  if (a >= 1e3) return f(n / 1e3, 'rb');
  return `Rp ${Math.round(n)}`;
}

export function angkaRingkas(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(1).replace('.', ',')} jt`;
  if (a >= 1e4) return `${Math.round(n / 1e3)} rb`;
  return n.toLocaleString('id-ID');
}

/**
 * ADS: unit per hari. Angka besar TIDAK pakai satu desimal — "33501,0/hari"
 * lebih panjang dan lebih sulit dibaca daripada "33.501/hari", dan desimalnya
 * tidak bermakna pada skala puluhan ribu.
 */
export function adsTeks(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 100) return `${Math.round(n).toLocaleString('id-ID')}/hari`;
  return `${n.toFixed(1).replace('.', ',')}/hari`;
}

export const hari = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toFixed(1).replace('.', ',');

/**
 * Jalur sparkline.
 *
 * Titik kosong (hari yang belum pernah dihitung) MEMUTUS garis, tidak
 * disambung lurus melewatinya — garis yang disambung mengarang tren yang tidak
 * pernah ada. Hasilnya satu atau beberapa potongan path.
 */
export function jalurSpark(
  nilai: (number | null)[],
  w: number,
  h: number,
  pad = 2,
): { d: string; min: number; max: number; titikAkhir: { x: number; y: number } | null } {
  const ada = nilai.filter((v): v is number => v !== null && Number.isFinite(v));
  if (ada.length < 2) return { d: '', min: 0, max: 0, titikAkhir: null };
  const min = Math.min(...ada);
  const max = Math.max(...ada);
  const rentang = max - min || 1;
  const n = nilai.length;
  const x = (i: number) => (n === 1 ? 0 : (i / (n - 1)) * w);
  const y = (v: number) => pad + (1 - (v - min) / rentang) * (h - 2 * pad);

  let d = '';
  let baru = true;
  let akhir: { x: number; y: number } | null = null;
  nilai.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) { baru = true; return; }
    const px = x(i); const py = y(v);
    d += `${baru ? 'M' : 'L'}${px.toFixed(1)} ${py.toFixed(1)} `;
    baru = false;
    akhir = { x: px, y: py };
  });
  return { d: d.trim(), min, max, titikAkhir: akhir };
}

export type DoiDisplay = 'OPSI1' | 'OPSI2' | 'BOTH';

/**
 * Opsi DOI mana yang ikut digambar — mengikuti `doi_display` di Pengaturan.
 *
 * Poster ini sebelumnya SELALU menampilkan dua-duanya, padahal seluruh halaman
 * lain sudah menghormati setelan itu lewat show1/show2 di ui.tsx. Kalau orang
 * memilih satu opsi, opsi kedua bukan sekadar mubazir: ia memakan tempat yang
 * bisa dipakai angka yang memang dipakai, dan menimbulkan pertanyaan "yang mana
 * yang benar" di grup WhatsApp.
 */
export const tampil1 = (d: DoiDisplay | undefined) => d !== 'OPSI2';
export const tampil2 = (d: DoiDisplay | undefined) => d !== 'OPSI1';

/** "DOI OPSI 1" saat keduanya tampil; "DOI" saja saat cuma satu — nomornya jadi tanpa makna. */
export const labelDoi = (n: 1 | 2, d: DoiDisplay | undefined) =>
  d === 'OPSI1' || d === 'OPSI2' ? 'DOI' : `DOI OPSI ${n}`;

/** Deret tren yang dipakai sparkline: opsi yang ditampilkan, bukan selalu opsi 1. */
export const deretTren = (
  tren: { doi1: number | null; doi2: number | null }[],
  d: DoiDisplay | undefined,
): (number | null)[] => (tampil1(d) ? tren.map((t) => t.doi1) : tren.map((t) => t.doi2));

/** Lebar kartu area supaya 5 kartu + jarak pas di dalam margin poster. */
export function lebarKartu(jumlah: number, total = KANVAS.w, margin = 32, jarak = 16): number {
  if (jumlah <= 0) return 0;
  return (total - 2 * margin - (jumlah - 1) * jarak) / jumlah;
}

/**
 * Tinggi kartu area yang DIBUTUHKAN, dalam px — supaya luberan jadi tes yang
 * gagal, bukan cacat yang tak kelihatan.
 *
 * Kenapa ini ada: 7 Okt 2026 ternyata poster SUDAH meluber. Dengan semua blok
 * aktif dan kritisMaks 6, isinya butuh 700px di kartu 628px. SVG tanpa
 * `clipPath` tidak memotong apa pun, jadi kelebihannya tergambar menimpa kaki
 * poster — dan tidak ada yang gagal, tidak ada yang memperingatkan. Angka-angka
 * di sini HARUS sama dengan kenaikan `cy` di `poster.tsx`; tesnya mengunci itu.
 */
/** Tinggi gambar sparkline (px). Dipakai poster.tsx; BIAYA_BLOK menghitungnya. */
export const TINGGI_SPARK = 44;

export const BIAYA_BLOK = {
  kepala: 30 + 12,
  /**
   * Label opsi + angka besar + jeda + GRID KOTAK.
   *
   * Gridnya 4 baris x 2 kolom sejak ATP ikut (8 Okt 2026): ATP% dan pembaginya
   * ("siap / disebar") jadi pasangan terakhir. Pembaginya ikut ditulis dengan
   * sengaja — ATP lama menampilkan persen tanpa pembagi, dan itulah yang membuat
   * "Yogyakarta 68,6%" tidak bisa ditelusuri sampai ada yang memeriksa EOMMA.
   */
  angka: 26 + 34 + 26 + (4 * 46 - 6 + 8),
  /** Judul + jeda + penutup, di luar barisnya sendiri. */
  statusTetap: 16 + 8 + 8,
  /**
   * Tinggi gambar sparkline turun 56 → 44 pada 10 Okt 2026, saat tren ATP
   * masuk sebagai grafik KEDUA.
   *
   * Kalau keduanya tetap 56, jarak baris status terpaksa turun 20 → 16 — dan
   * kanvas sengaja dinaikkan ke 1000 pada 8 Okt justru untuk membeli jarak 20
   * itu. Jadi yang mengalah tinggi grafiknya, bukan keterbacaan sebaran status:
   * sparkline membawa BENTUK tren, dan angkanya tetap ditulis di dua ujung.
   * Terukur: 2 x 44 menyisakan pitch 20; 2 x 56 memaksa 16.
   */
  tren: 16 + 6 + 44 + 20,
  /**
   * Tren ATP — ukurannya SAMA PERSIS dengan tren DOI.
   *
   * Dua sparkline terpisah, bukan dua garis di satu sumbu: DOI satuannya HARI,
   * ATP satuannya PERSEN. Menumpuknya di satu sumbu berarti salah satu skalanya
   * berbohong.
   */
  trenAtp: 16 + 6 + 44 + 20,
  /** Judul + jeda, di luar daftar SKU-nya. TIDAK DIPAKAI lagi sejak 10 Okt 2026. */
  poTetap: 16 + 6,
  poPerBaris: 30,
  /** Jarak antar baris status. Dipilih adaptif, lihat `tataLetakStatus`. */
  pitchPilihan: [20, 18, 16, 14, 13] as const,
  /** Garis pemisah antara 4 pita DOI dan 6 keterangan. */
  pemisah: 10,
} as const;

export type BlokPoster = {
  angka?: boolean; status?: boolean; tren?: boolean;
  /** Tren ATP 30 hari — blok sendiri, lihat BIAYA_BLOK.trenAtp. */
  trenAtp?: boolean;
  /**
   * Dulu menyalakan daftar "SKU paling mendesak" DI DALAM kartu. Daftar itu
   * dihapus 10 Okt 2026 atas permintaan user; `po` kini hanya menyalakan angka
   * "Perlu open PO" di blok angka, yang tidak punya biaya tinggi sendiri.
   */
  po?: boolean;
};

export function tinggiKartu(opsi: {
  blok: BlokPoster; nBaris?: number; pitch?: number; kritisMaks?: number;
}): number {
  const b = opsi.blok;
  const nBaris = opsi.nBaris ?? (URUT_STATUS.length + URUT_LAIN.length);
  const pitch = opsi.pitch ?? BIAYA_BLOK.pitchPilihan[0];
  let t = BIAYA_BLOK.kepala;
  if (b.angka) t += BIAYA_BLOK.angka;
  // SEMUA baris status berbatang, bukan hanya empat pita DOI.
  //
  // Sempat saya buat kelompok keterangan tanpa batang dengan alasan "bukan satu
  // skala". Itu SALAH, dan user yang menunjukkannya: batangnya menggambar
  // `n / total SKU` — porsi dari keseluruhan. Setiap SKU punya tepat satu
  // status, jadi kesepuluhnya potongan dari satu keseluruhan yang sama dan
  // porsinya sama-sama berarti. Yang sebenarnya menekan waktu itu ruang
  // vertikal, dan saya mendandaninya sebagai prinsip.
  if (b.status) t += BIAYA_BLOK.statusTetap + BIAYA_BLOK.pemisah + nBaris * pitch;
  if (b.tren) t += BIAYA_BLOK.tren;
  if (b.trenAtp) t += BIAYA_BLOK.trenAtp;
  if (b.po && (opsi.kritisMaks ?? 0) > 0) t += BIAYA_BLOK.poTetap + (opsi.kritisMaks ?? 0) * BIAYA_BLOK.poPerBaris;
  return t;
}

export type TataLetakStatus = { pitch: number; poMuat: number };

/**
 * Pilih jarak baris status DAN panjang daftar mendesak supaya kartu TIDAK meluber.
 *
 * Sepuluh baris berbatang tidak muat pada jarak 20px kalau semua blok aktif, dan
 * jawabannya bukan menghapus batangnya. Jadi jarak barisnya mengalah lebih dulu
 * — dari 20 turun sampai 13 — sampai daftar mendesak kebagian minimal satu baris.
 * Kalau sampai jarak terkecil pun tidak kebagian, dipakai jarak terbesar yang
 * masih memuat seluruh baris status, dan daftar mendesak ditampilkan sebagai satu
 * baris ringkas oleh pemanggil (bukan dihilangkan diam-diam).
 */
export function tataLetakStatus(opsi: {
  tinggiKartu: number; blok: BlokPoster; nBaris: number; diminta: number;
}): TataLetakStatus {
  const muatPo = (pitch: number) => {
    if (!opsi.blok.po || opsi.diminta <= 0) return 0;
    const tanpaPo = tinggiKartu({ ...opsi, pitch, blok: { ...opsi.blok, po: false }, kritisMaks: 0 });
    const sisa = opsi.tinggiKartu - tanpaPo - BIAYA_BLOK.poTetap;
    if (sisa < BIAYA_BLOK.poPerBaris) return 0;
    return Math.min(opsi.diminta, Math.floor(sisa / BIAYA_BLOK.poPerBaris));
  };

  // Jarak terbesar yang sudah memberi daftar mendesak minimal satu baris.
  for (const pitch of BIAYA_BLOK.pitchPilihan) {
    const po = muatPo(pitch);
    if (po >= 1) return { pitch, poMuat: po };
  }
  // Tidak ada yang cukup untuk daftar PO. Ambil jarak terbesar yang setidaknya
  // membuat blok status sendiri muat.
  for (const pitch of BIAYA_BLOK.pitchPilihan) {
    if (tinggiKartu({ ...opsi, pitch, blok: { ...opsi.blok, po: false }, kritisMaks: 0 }) <= opsi.tinggiKartu) {
      return { pitch, poMuat: 0 };
    }
  }
  return { pitch: BIAYA_BLOK.pitchPilihan[BIAYA_BLOK.pitchPilihan.length - 1], poMuat: 0 };
}

/**
 * Perkiraan lebar teks dalam px — untuk mencegah teks menabrak tetangganya.
 *
 * SVG tidak punya `text-overflow: ellipsis` dan tidak membungkus teks: kalau
 * terlalu panjang, ia menimpa apa pun di sebelahnya tanpa ada yang gagal. Jadi
 * lebarnya harus diperkirakan SEBELUM menggambar.
 *
 * 0,56em adalah rata-rata konservatif untuk Arial/Helvetica campuran huruf besar
 * dan kecil; 0,62em untuk mono yang lebih lebar. Sengaja perkiraan yang
 * CENDERUNG melebihkan — kelebihan ruang hanya membuat batang sedikit lebih
 * pendek, sedangkan kekurangan ruang membuat teks bertumpuk.
 */
export function lebarTeksKira(teks: string, size: number, mono = false): number {
  return String(teks ?? '').length * (mono ? 0.62 : 0.56) * size;
}

/** Ukuran angka DOI besar, dan satuan "hari" yang menempel di belakangnya. */
export const UKURAN_DOI = 38;
export const UKURAN_SATUAN = 13;
/** Jarak angka ke satuannya (atribut `dx` pada tspan-nya). */
export const JEDA_SATUAN = 6;

/** Lebar terpakai angka DOI besar BESERTA satuannya. */
export function lebarDoiBesar(teks: string): number {
  return lebarTeksKira(teks, UKURAN_DOI, true)
    + JEDA_SATUAN
    + lebarTeksKira('hari', UKURAN_SATUAN);
}

/** Pilihan ukuran ATP, dari yang paling diinginkan ke yang paling aman. */
export const UKURAN_ATP = [38, 34, 30, 26, 22] as const;

/**
 * Ukuran ATP yang MUAT di sebelah angka DOI — satu ukuran untuk SELURUH poster.
 *
 * User meminta ATP sebesar DOI (38px). Terukur 8 Okt 2026, di kartu ber-isi
 * 262px itu menabrak pada kasus nyata:
 *
 *   "105,3 hari" 153px + "71,0%"  118px = 271px  (lewat 8px)
 *   "48,1 hari"  129px + "100,0%" 141px = 271px  (lewat 8px)
 *
 * SVG tidak memotong apa pun, jadi tabrakan itu tergambar sebagai dua angka
 * saling menimpa — tanpa ada yang gagal.
 *
 * Dihitung dari SEMUA kartu sekaligus, bukan per kartu. Kalau tiap kartu
 * menyusut sendiri-sendiri, Makassar bisa ber-ATP 30px sementara Pusat 38px di
 * gambar yang sama — dan beda ukuran itu terbaca seolah punya arti, padahal
 * cuma akibat panjang angka DOI-nya. Satu ukuran untuk semua: yang terbesar
 * yang masih muat di kartu TERSEMPIT.
 */
export function ukuranAtpMuat(
  pasangan: { doi: string; atp: string }[],
  isi: number,
  jeda = JEDA_LABEL,
): number {
  for (const size of UKURAN_ATP) {
    const muatSemua = pasangan.every(
      (p) => lebarDoiBesar(p.doi) + lebarTeksKira(p.atp, size, true) + jeda <= isi,
    );
    if (muatSemua) return size;
  }
  return UKURAN_ATP[UKURAN_ATP.length - 1];
}

/**
 * DOI kalau barang dalam perjalanan ikut dihitung = (stok + SIT) ÷ ADS.
 *
 * Pembilang dan penyebutnya diambil dari ringkasan yang SAMA dengan `doi1`
 * (keduanya sudah mengeluarkan SKU berstatus EXCLUDED), jadi selisih kedua
 * angka itu memang murni SIT — bukan akibat cakupan baris yang berbeda.
 *
 * `null` kalau ADS 0: tanpa penjualan, "berapa hari stok ini bertahan" tidak
 * punya jawaban, dan menuliskannya 0 hari terbaca seperti keadaan darurat.
 */
export function doiPlusSit(
  stok: number,
  sit: number,
  ads: number | null | undefined,
): number | null {
  const a = Number(ads ?? 0);
  if (!(a > 0)) return null;
  return (Number(stok ?? 0) + Number(sit ?? 0)) / a;
}

/** Jeda minimal antara label dan batang. Kelipatan 8 → 8px (ISO 9241-125 §5). */
export const JEDA_LABEL = 8;

/**
 * Posisi sebuah angka TERHADAP targetnya. Dipakai target DOI dan target ATP.
 *
 * `null` berarti belum bisa dinilai (angkanya tidak ada, atau targetnya tidak
 * diatur) — BUKAN "aman". Menandainya aman akan menyatakan sesuatu yang belum
 * diketahui.
 */
export type ArahTarget = 'aman' | 'lewat' | 'kurang';

/**
 * DOI aktual terhadap pita AMAN area itu.
 *
 * Dua sisi, bukan satu. User meminta "merah jika aktual lebih dari target", dan
 * itu benar — tapi kalau HANYA sisi itu yang ditandai, kartu ber-DOI 2 hari
 * (kritis, berisiko kehabisan) akan menampilkan "Target 7 hari" dengan warna
 * tenang yang sama seperti kartu yang memang sehat. Sisi bawah justru yang
 * lebih mahal akibatnya, jadi ia ikut ditandai.
 *
 * Batasnya SENGAJA disalin dari `pitaDoi` di area-master.ts, bukan diimpor:
 * area-master memuat prisma, dan berkas ini ikut terbundel ke browser lewat
 * poster.tsx. Supaya penyalinan itu tidak bisa diam-diam melenceng, ada tes
 * yang membandingkan keduanya nilai demi nilai (wa-target.test.ts).
 */
export function arahDoi(
  doi: number | null | undefined,
  ambang: AmbangDoi | null | undefined,
): ArahTarget | null {
  if (doi === null || doi === undefined || !Number.isFinite(doi) || !ambang) return null;
  if (doi > ambang.max) return 'lewat';
  if (doi <= ambang.min) return 'kurang';
  return 'aman';
}

/**
 * ATP aktual terhadap target ketersediaan.
 *
 * Hanya punya sisi bawah: ATP di ATAS target bukan masalah, jadi tidak ada
 * 'lewat'. Ini kebalikan DOI, dan memang begitu sifatnya — stok berlebih itu
 * uang mengendap, ketersediaan berlebih itu tidak ada.
 */
export function arahAtp(
  persen: number | null | undefined,
  target: number | null | undefined,
): ArahTarget | null {
  if (persen === null || persen === undefined || !Number.isFinite(persen)) return null;
  // `!(target > 0)` menangkap null, undefined, NaN DAN 0 sekaligus. Nol penting:
  // itu nilai yang muncul kalau setelannya belum pernah diisi, dan "ATP >= 0%"
  // akan meluluskan SEMUA kartu diam-diam — kebalikan dari maksud setelan ini.
  if (target === null || target === undefined || !(Number(target) > 0)) return null;
  return persen < target ? 'kurang' : 'aman';
}

/**
 * Warna teks target. MERAH = di luar target, apa pun arahnya.
 *
 * Satu warna untuk satu arti. Memberi merah pada 'lewat' dan oranye pada
 * 'kurang' akan terbaca seolah kekurangan stok lebih ringan daripada
 * kelebihan — padahal kebalikannya.
 */
export const WARNA_TARGET: Record<ArahTarget, string> = {
  aman: WARNA.tintaLabel,
  lewat: WARNA.kritisFg,
  kurang: WARNA.kritisFg,
};

/**
 * Tanda arah — supaya 'lewat' dan 'kurang' tidak hanya dibedakan oleh WARNA.
 *
 * Poster ini dikirim ke grup WhatsApp dan sering diteruskan sebagai gambar,
 * dicetak, atau dilihat orang yang tidak membedakan merah-hijau. Warna sendirian
 * tidak boleh memikul arti (WCAG 2.2 §1.4.1), dan di sini ia memikul arti yang
 * BERLAWANAN di dua sisi — tanpa tanda ini, dua keadaan yang menuntut tindakan
 * berlawanan terlihat persis sama.
 *
 * Dipakai "+/-" ASCII, bukan segitiga Unicode: poster diserialkan jadi SVG lalu
 * dirender ke JPG oleh bot, dan glyph di luar Latin dasar bergantung pada font
 * yang kebetulan ada di mesin perender. Yang hilang akan jadi kotak tofu di
 * gambar yang sudah terkirim ke grup.
 */
export const TANDA_TARGET: Record<ArahTarget, string> = {
  aman: '',
  lewat: ' (+)',
  kurang: ' (-)',
};

/**
 * Teks target DOI sebuah area — SATU ejaan, dipakai poster dan tesnya.
 *
 * `max` adalah "Aman ≤ (hari)" di Pengaturan > Cabang/Area: batas atas pita
 * AMAN, dan sekaligus batas yang diisi Sugest PO ("PO diisi sampai sini").
 * Itulah yang dimaksud "Target DOI" di aplikasi ini — label global di
 * Pengaturan pun menyebutnya "Target DOI maksimum (hari)".
 *
 * Kosong kalau ambangnya tidak ada: lebih baik tidak menulis apa-apa daripada
 * menulis "Target — hari", yang terbaca seperti ada nilai yang hilang padahal
 * area itu memang memakai ambang global.
 */
export function teksTarget(max: number | null | undefined, arah: ArahTarget | null = null): string {
  if (max === null || max === undefined || !Number.isFinite(max)) return '';
  return `Target ${max} hari${arah ? TANDA_TARGET[arah] : ''}`;
}

/** Teks target ATP. Persen bulat: targetnya memang diisi bulat di Pengaturan. */
export function teksTargetAtp(target: number | null | undefined, arah: ArahTarget | null = null): string {
  if (target === null || target === undefined || !Number.isFinite(target)) return '';
  return `Target ${Math.round(target)}%${arah ? TANDA_TARGET[arah] : ''}`;
}

/**
 * Ruang untuk teks target DOI di pita 26px, SETELAH teks di sisi kanannya.
 *
 * Keduanya berbagi satu baris: target DOI rata kiri, target ATP (atau "ATP …"
 * di mode dua opsi) rata kanan. SVG tidak memotong apa pun, jadi kalau jumlah
 * kartu bertambah — lebar kartu menyusut — keduanya akan saling menimpa tanpa
 * ada yang gagal. Angka ini yang dipakai `potongTeks` supaya tabrakan itu tidak
 * mungkin terjadi.
 */
/**
 * Pilih bentuk teks sisi KANAN yang masih memberi sisi kiri lebar penuhnya.
 *
 * KEJADIAN NYATA 10 Okt 2026, ditemukan tes sebelum sempat tergambar. Saat dua
 * opsi DOI ditampilkan, sisi kanan harus memuat persen ATP DAN targetnya:
 * "ATP 100,0% · Target 100% (-)" = 172px. Di kartu 5 cabang (isi 262px) itu
 * menyisakan 82px untuk target DOI yang butuh 105px — terpotong jadi
 * "Target 7 har…". Di 7 cabang teks kanannya saja (172px) sudah melebihi
 * seluruh isi kartu (174px), jadi keduanya tergambar BERTUMPUK.
 *
 * Jadi bentuknya tidak dipatok satu. Daftarnya diurut dari yang paling
 * informatif ke yang paling pendek, dan dipilih yang PERTAMA masih memberi sisi
 * kiri lebar penuhnya. Kalau tidak ada yang cukup, dipakai yang terpendek dan
 * sisi kiri yang dipotong oleh `potongTeks` — satu teks terpotong rapi, bukan
 * dua teks saling menimpa.
 */
export function pilihKanan(
  kandidat: string[],
  isi: number,
  kiri: string,
  size = 11,
): string {
  if (!kandidat.length) return '';
  const wKiri = lebarTeksKira(kiri, size);
  for (const c of kandidat) {
    if (wKiri + JEDA_LABEL + lebarTeksKira(c, size) <= isi) return c;
  }
  return kandidat[kandidat.length - 1];
}

export function ruangTarget(isi: number, kanan: string, size = 11): number {
  return isi - (kanan ? lebarTeksKira(kanan, size) + JEDA_LABEL : 0);
}

/**
 * Lebar kolom label, dihitung dari label yang BENAR-BENAR ditampilkan.
 *
 * Dulu dipatok 62px. Saat label "Belum Terjual" (±80px) dan "Dikecualikan"
 * (±74px) ditambahkan 7 Okt 2026, keduanya menabrak batang — dan tidak ada tes
 * yang bisa melihatnya. Sekarang gutter mengikuti isinya, jadi menambah label
 * baru tidak bisa lagi merusak tata letak tanpa sepengetahuan siapa pun.
 *
 * Dibatasi `maks` supaya label yang keterlaluan panjang tidak menghabiskan
 * batangnya; di atas itu label dipotong oleh `potongTeks`.
 */
export function gutterLabel(label: string[], size: number, maks = 110): number {
  const lebar = label.reduce((m, t) => Math.max(m, lebarTeksKira(t, size)), 0);
  return Math.min(maks, Math.ceil(lebar) + JEDA_LABEL);
}

/** Potong teks agar muat dalam `maksPx`, dengan elipsis. SVG tidak melakukannya sendiri. */
export function potongTeks(teks: string, maksPx: number, size: number, mono = false): string {
  const t = String(teks ?? '');
  if (lebarTeksKira(t, size, mono) <= maksPx) return t;
  const perKarakter = (mono ? 0.62 : 0.56) * size;
  const muat = Math.max(1, Math.floor(maksPx / perKarakter) - 1);
  return `${t.slice(0, muat)}…`;
}

/**
 * Label pita DOI dengan ambang harinya — "Kritis ≤4D", "Over >7D".
 *
 * Diminta user 7 Okt 2026 supaya pembaca poster tahu batas yang dipakai area
 * itu tanpa membuka Pengaturan. Penting karena ambangnya BEDA per kota: Pusat
 * ≤4/≤5/≤7 sedangkan Makassar ≤14/≤31/≤45, jadi "Kritis 34" di dua kartu
 * sebelahan sebenarnya mengukur hal yang berbeda.
 *
 * NOTASI: tiga pita pertama memakai ≤ (batas atasnya INKLUSIF), dan Over
 * memakai ">" — BUKAN "≥". Untuk Pusat dengan max 7, hari ke-7 masih AMAN dan
 * overstock baru mulai hari ke-8. Menulis "≥7D" akan menyatakan hari ke-7 itu
 * overstock, bertentangan dengan `pitaDoi`.
 *
 * "Over", bukan "Overstock": lebih pendek, dan kolom label di kartu 294px sudah
 * harus memuat "Belum Terjual".
 */
/**
 * Label sebaran dipecah dua: NAMA dan AMBANG HARI.
 *
 * Dulu satu string ("Kritis ≤4D"), dan akibatnya angka harinya berpindah-pindah
 * ke kanan mengikuti panjang namanya — "Kritis ≤4D" / "Low ≤6D" / "Aman ≤7D"
 * membuat ≤4D, ≤6D, ≤7D berdiri di tiga tempat berbeda. Mata harus mencari
 * angkanya satu per satu, padahal justru angka itu yang dibandingkan antar
 * baris. Dipisah, ambangnya bisa ditaruh di SATU kolom tetap.
 *
 * Baris yang tidak punya ambang (SIT, Dead Stock, dst) mengembalikan `ambang`
 * kosong — bukan tanda hubung. Kolomnya memang tidak berlaku untuk mereka, dan
 * mengisinya dengan "—" menyiratkan ada nilai yang hilang.
 */
export type LabelPita = { nama: string; ambang: string };

export function labelPitaPisah(
  key: StatusPoster,
  ambang: AmbangDoi | null | undefined,
): LabelPita {
  const dasar = STATUS_POSTER[key]?.label ?? String(key);
  if (!ambang) return { nama: key === 'OVERSTOCK' ? 'Over' : dasar, ambang: '' };
  switch (key) {
    case 'CRITICAL': return { nama: 'Kritis', ambang: `≤${ambang.kritis}D` };
    case 'LOW': return { nama: 'Low', ambang: `≤${ambang.min}D` };
    case 'HEALTHY': return { nama: 'Aman', ambang: `≤${ambang.max}D` };
    case 'OVERSTOCK': return { nama: 'Over', ambang: `>${ambang.max}D` };
    default: return { nama: dasar, ambang: '' };
  }
}

export type TataLabel = {
  /** Jarak dari tepi kiri label ke awal kolom ambang. */
  xAmbang: number;
  /** Lebar seluruh kolom label (nama + ambang) termasuk jeda ke batang. */
  gutter: number;
};

/**
 * Tempatkan kolom ambang supaya angka harinya SEJAJAR di semua baris.
 *
 * Kolomnya dihitung dari nama terpanjang yang PUNYA ambang saja — bukan dari
 * sepuluh label. Kalau ikut "Belum Terjual" (80px), ambangnya terdorong jauh ke
 * kanan dan "Kritis" menggantung sendirian dengan jurang di tengahnya. Baris
 * tanpa ambang boleh memakai kolom itu, karena di situ memang tidak ada apa-apa.
 *
 * `maks` tetap dihormati: kalau mentok, kolom ambang digeser kiri supaya
 * ambangnya tetap muat utuh — teks SVG tidak terpotong sendiri, ia menimpa
 * tetangganya tanpa ada yang gagal.
 */
export function tataLabelStatus(
  label: LabelPita[],
  size: number,
  maks = 110,
): TataLabel {
  const w = (t: string) => lebarTeksKira(t, size);
  const berambang = label.filter((l) => l.ambang);
  const namaBand = berambang.reduce((m, l) => Math.max(m, w(l.nama)), 0);
  const ambangMaks = berambang.reduce((m, l) => Math.max(m, w(l.ambang)), 0);
  const tanpaAmbang = label.filter((l) => !l.ambang).reduce((m, l) => Math.max(m, w(l.nama)), 0);

  let xAmbang = Math.ceil(namaBand) + (berambang.length ? JEDA_LABEL : 0);
  let isi = Math.max(xAmbang + Math.ceil(ambangMaks), Math.ceil(tanpaAmbang));
  let gutter = Math.ceil(isi) + JEDA_LABEL;

  if (gutter > maks) {
    gutter = maks;
    // Ambang didahulukan: ia angka, dan angka yang terpotong lebih berbahaya
    // daripada nama yang terpotong ("≤14D" jadi "≤1D" membalik artinya).
    xAmbang = Math.max(0, maks - JEDA_LABEL - Math.ceil(ambangMaks));
    isi = maks - JEDA_LABEL;
  }
  return { xAmbang, gutter };
}

/**
 * Versi satu baris, DIturunkan dari `labelPitaPisah` supaya tidak ada dua
 * sumber ejaan. Dipakai halaman /wa (HTML, yang punya tata letak sendiri) dan
 * tempat lain yang tidak membutuhkan kolom sejajar. Poster memakai yang dipisah.
 */
export function labelPita(
  key: StatusPoster,
  ambang: AmbangDoi | null | undefined,
): string {
  const l = labelPitaPisah(key, ambang);
  return l.ambang ? `${l.nama} ${l.ambang}` : l.nama;
}
