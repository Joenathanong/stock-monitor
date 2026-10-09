/** Disposisi stok sisa untuk produk phase out. */
export const DISPOSITIONS = ['SELL_DOWN', 'RETURN_VENDOR', 'WRITE_OFF', 'BUNDLING'] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export const DISPOSITION_LABEL: Record<Disposition, string> = {
  SELL_DOWN: 'Jual habis',
  RETURN_VENDOR: 'Retur vendor',
  WRITE_OFF: 'Write-off',
  BUNDLING: 'Bundling',
};

export type MatchType = 'SAP' | 'SKU';

/** Berapa digit belakang kode SAP yang dipakai mencocokkan. */
export const SAP_KEY_LEN = 6;

/**
 * Kunci pencocokan kode SAP: 6 karakter terakhir setelah spasi/pemisah dibuang.
 * Satu barang dipelihara dengan dua kode yang hanya beda 4 karakter di depan
 * (mis. 1222xxxxxx dan 1201xxxxxx), jadi ekor 6 digitnya yang identik.
 * Mengembalikan null bila kode tidak layak dipakai sebagai kunci.
 */
export function sapKey(code: string | null | undefined): string | null {
  if (!code) return null;
  const clean = String(code).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  if (clean.length < SAP_KEY_LEN) return null;
  return clean.slice(-SAP_KEY_LEN);
}

/** Kunci baris phase out — berprefiks agar SAP dan SKU tidak pernah bertabrakan. */
export const phaseOutKey = (type: MatchType, value: string) => `${type}:${value}`;

/**
 * Satu baris phase out, sebatas yang dibutuhkan pencocokan.
 *
 * Sengaja tipe lepas, bukan tipe Prisma: modul ini harus tetap murni supaya
 * bisa diuji tanpa database.
 */
export type BarisCocok = { matchType: string; matchValue: string };

/**
 * Pencocok SKU → baris phase out.
 *
 * DUA JALUR, dan urutannya berarti: cocokkan lewat SKU dulu, baru lewat 6
 * digit terakhir kode SAP. Baris SKU lebih khusus daripada baris SAP — satu
 * baris SAP bisa mengenai beberapa SKU sekaligus karena satu barang dipelihara
 * dengan dua kode yang hanya beda 4 karakter di depan.
 *
 * ADA DI SINI, bukan disalin ke tiap pemakai. Aturan ini sebelumnya hanya
 * hidup di `compute.ts`; ketika halaman ATP ikut menampilkan phase out (9 Okt
 * 2026), menyalinnya berarti dua tempat yang bisa berbeda diam-diam — dan
 * gejalanya cuma "kenapa SKU ini phase out di satu layar tapi tidak di layar
 * lain". `phase-out-sama.test.ts` menjaga agar keduanya tetap memakai fungsi
 * ini.
 *
 * `sapKey` mengembalikan null untuk kode yang tidak layak; kunci `'\u0000'`
 * dipakai supaya null tidak pernah tidak sengaja cocok dengan entri bernilai
 * kosong.
 */
export function pencocokPhaseOut<R extends BarisCocok, T>(
  rows: R[],
  ubah: (r: R) => T,
): (sku: string, sapCode: string | null | undefined) => T | null {
  const bySku = new Map<string, T>();
  const bySap = new Map<string, T>();
  for (const r of rows) {
    if (r.matchType === 'SKU') bySku.set(r.matchValue, ubah(r));
    else if (r.matchType === 'SAP') bySap.set(r.matchValue, ubah(r));
  }
  return (sku, sapCode) => bySku.get(sku) ?? bySap.get(sapKey(sapCode) ?? '\u0000') ?? null;
}
