export type StatusMap = Record<string, number>;

export type KritisWa = { sku: string; name: string; doi: number | null; status: string; sug: number };

export type AreaWa = {
  area: string;
  snapshotDate: string | null;
  sku: number;
  doi1: number | null;
  doi2: number | null;
  ads1: number;
  ads2: number;
  stock: number;
  transit: number;
  value: number;
  /** Nilai barang dalam perjalanan — TIDAK termasuk di `value`. */
  valueTransit: number;
  noPrice: number;
  byStatus: StatusMap | null;
  /**
   * Ambang DOI area ini (hari) — dipakai menulis "Kritis ≤4D" di label sebaran.
   *
   * Dikirim dari server, BUKAN dihitung ulang di komponen: kalau layar menghitung
   * sendiri, labelnya bisa menyebut ambang yang berbeda dari yang benar-benar
   * dipakai menentukan statusnya.
   */
  ambang?: { kritis: number; min: number; max: number };
  perluPo: number;
  tren: { date: string; doi1: number | null; doi2: number | null }[];
  kritis: KritisWa[];
};

export type DataWa = {
  ok: boolean;
  judul: string;
  blok: { angka: boolean; status: boolean; tren: boolean; po: boolean };
  doiDisplay: 'OPSI1' | 'OPSI2' | 'BOTH';
  dibuatPada: string;
  snapshotDate: string | null;
  computedAt: string | null;
  total: {
    sku: number; doi1: number | null; doi2: number | null;
    ads1: number; ads2: number;
    stock: number; transit: number; value: number; valueTransit: number;
    kritis: number; low: number;
  } | null;
  areas: AreaWa[];
  trenLabel: string[];
  hariIni: string;
};
