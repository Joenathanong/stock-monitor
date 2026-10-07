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

/** Kanvas tetap: bot cukup mengunduh, tidak perlu mengatur ukuran jendela. */
export const KANVAS = { w: 1600, h: 900 } as const;

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
export const BIAYA_BLOK = {
  kepala: 30 + 12,
  angka: 26 + 34 + 26 + (3 * 46 - 6 + 8),
  /** Judul + jeda + penutup, di luar barisnya sendiri. */
  statusTetap: 16 + 8 + 8,
  tren: 16 + 6 + 56 + 20,
  /** Judul + jeda, di luar daftar SKU-nya. */
  poTetap: 16 + 6,
  poPerBaris: 30,
  /** Jarak antar baris status. Dipilih adaptif, lihat `tataLetakStatus`. */
  pitchPilihan: [20, 18, 16, 14, 13] as const,
  /** Garis pemisah antara 4 pita DOI dan 6 keterangan. */
  pemisah: 10,
} as const;

export type BlokPoster = { angka?: boolean; status?: boolean; tren?: boolean; po?: boolean };

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

/** Jeda minimal antara label dan batang. Kelipatan 8 → 8px (ISO 9241-125 §5). */
export const JEDA_LABEL = 8;

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
export function labelPita(
  key: StatusPoster,
  ambang: AmbangDoi | null | undefined,
): string {
  const dasar = STATUS_POSTER[key]?.label ?? String(key);
  if (!ambang) return key === 'OVERSTOCK' ? 'Over' : dasar;
  switch (key) {
    case 'CRITICAL': return `Kritis ≤${ambang.kritis}D`;
    case 'LOW': return `Low ≤${ambang.min}D`;
    case 'HEALTHY': return `Aman ≤${ambang.max}D`;
    case 'OVERSTOCK': return `Over >${ambang.max}D`;
    default: return dasar;
  }
}
