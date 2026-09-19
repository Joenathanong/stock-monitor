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
