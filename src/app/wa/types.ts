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
  /**
   * ATP area ini. OPSIONAL dengan sengaja.
   *
   * Poster memuat datanya dari /api/public/wa lewat HTTP, dan dua sisi itu bisa
   * berbeda versi untuk sementara saat deploy berjalan. Kalau medan ini wajib,
   * poster yang menerima balasan tanpa `atp` akan gagal total — seluruh gambar
   * hilang karena satu angka tambahan. Opsional: kotaknya menampilkan "—".
   *
   * `persen: null` BUKAN 0%: artinya belum ada SKU yang diputuskan sebarannya
   * di area itu, jadi pembaginya 0. Menggambarnya sebagai 0% akan terbaca
   * seperti bencana stok.
   */
  atp?: { persen: number | null; siap: number; dihitung: number };
  /**
   * Ketersediaan stok di area ini, dihitung dari SKU YANG SAMA dengan `sku`
   * (yaitu baris snapshot DOI, angka yang sudah tertulis di "SEBARAN STATUS").
   *
   * Sengaja TIDAK memakai `isActive` OCS (356 cabang / 375 Pusat). Poster sudah
   * menyebut dua angka SKU — strip atas dan sebaran status — dan angka ketiga
   * yang berbeda tanpa penjelasan hanya membuat orang bertanya mana yang benar.
   * `available` dan `kosong` di sini selalu bisa dijumlahkan terhadap `sku`.
   *
   * `ambang` direkam, bukan diasumsikan: kalau nanti diubah dari 5, poster lama
   * tetap bisa dibaca dengan ambang yang memang berlaku saat itu.
   */
  stok?: {
    available: number;
    /** Pembagi: SKU yang layak ATP di area ini (ketiga kategori, aktif). */
    dasar: number;
    kosong: number;
    ambang: number;
  };
  /**
   * DOI kalau SIT ikut dihitung = (stok + SIT) ÷ ADS, per opsi.
   *
   * Dikirim dari server, BUKAN dihitung di komponen: pembilang dan penyebutnya
   * harus persis sama dengan yang dipakai `doi1`/`doi2` (keduanya sudah
   * mengeluarkan SKU EXCLUDED). Kalau layar menghitung sendiri dari `stock` dan
   * `transit`, selisihnya bisa bukan murni SIT dan tidak ada yang akan sadar.
   */
  doiSit?: { doi1: number | null; doi2: number | null };
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
