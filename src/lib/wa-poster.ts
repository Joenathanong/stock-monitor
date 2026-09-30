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
 * Sebaran status yang ditampilkan.
 *
 * Empat status yang bisa ditindaklanjuti disebut satu per satu; sisanya
 * (NPL, phase out, dead stock, belum terjual, dikecualikan) dilipat jadi "Lain".
 * Warna status adalah warna CADANGAN — tidak pernah dipakai untuk hal lain — dan
 * selalu ditemani label + angka, tidak pernah warna saja.
 */
export const URUT_STATUS = ['CRITICAL', 'LOW', 'HEALTHY', 'OVERSTOCK'] as const;
export type StatusPoster = (typeof URUT_STATUS)[number] | 'LAIN';

export const STATUS_POSTER: Record<StatusPoster, { label: string; warna: string }> = {
  CRITICAL: { label: 'Kritis', warna: WARNA.kritisSolid },
  LOW: { label: 'Low', warna: WARNA.lowSolid },
  HEALTHY: { label: 'Aman', warna: WARNA.amanSolid },
  OVERSTOCK: { label: 'Overstock', warna: WARNA.violet },
  LAIN: { label: 'Lain', warna: WARNA.netralSolid },
};

export type Segmen = { key: StatusPoster; label: string; warna: string; n: number };

export function segmenStatus(byStatus: Record<string, number> | null | undefined): Segmen[] {
  const b = byStatus ?? {};
  const inti = URUT_STATUS.map((k) => ({ key: k as StatusPoster, ...STATUS_POSTER[k], n: Number(b[k] ?? 0) }));
  const dipakai = new Set<string>(URUT_STATUS);
  const lain = Object.entries(b).reduce((t, [k, v]) => (dipakai.has(k) ? t : t + Number(v || 0)), 0);
  return lain > 0 ? [...inti, { key: 'LAIN' as StatusPoster, ...STATUS_POSTER.LAIN, n: lain }] : inti;
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
