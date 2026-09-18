/** Disposisi stok sisa untuk produk phase out. */
export const DISPOSITIONS = ['SELL_DOWN', 'RETURN_VENDOR', 'WRITE_OFF', 'BUNDLING'] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export const DISPOSITION_LABEL: Record<Disposition, string> = {
  SELL_DOWN: 'Jual habis',
  RETURN_VENDOR: 'Retur vendor',
  WRITE_OFF: 'Write-off',
  BUNDLING: 'Bundling',
};
