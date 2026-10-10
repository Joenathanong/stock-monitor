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
   * Ketersediaan stok di area ini — PEMBAGINYA SAMA DENGAN `atp.dihitung`,
   * yaitu SKU yang dicentang disebar ke area itu di halaman /atp.
   *
   * Diturunkan dari hasil yang sama, bukan dihitung ulang. Sampai 8 Okt 2026
   * pembaginya seluruh SKU layak, dan akibatnya Pusat menampilkan 1.158/1.663 =
   * 69,6% di kotak ini sementara ATP di kartu yang SAMA menghitung 1.158/1.659 =
   * 69,8%. Dua angka yang terlihat seharusnya cocok, beda tipis, tanpa apa pun
   * yang menjelaskan.
   *
   * Konsekuensi yang disengaja: cabang yang checklist-nya belum diisi
   * menampilkan 0 / 0 di sini dan "—" di ATP. Itu jujur — belum ada yang
   * diputuskan, jadi belum ada yang bisa dijanjikan.
   *
   * `ambang` direkam, bukan diasumsikan: kalau nanti diubah dari 5, poster lama
   * tetap bisa dibaca dengan ambang yang memang berlaku saat itu.
   */
  stok?: {
    available: number;
    /** Pembagi: SKU yang DICENTANG disebar ke area ini — sama dengan pembagi ATP%. */
    dasar: number;
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
  /**
   * Tren ATP% area ini, dari `atp_daily`. OPSIONAL dengan sengaja — alasannya
   * sama dengan `atp`: poster dan API bisa berbeda versi saat deploy berjalan,
   * dan satu medan baru tidak boleh menghilangkan seluruh gambar.
   *
   * TIDAK digabung ke `tren` di atas: DOI satuannya HARI dan ATP satuannya
   * PERSEN. Dua ukuran berbeda skala tidak boleh berbagi satu sumbu — itu
   * kesalahan grafik yang paling sering dibuat. Karena itu dua sparkline
   * terpisah, masing-masing dengan judul dan satuannya sendiri.
   */
  trenAtp?: { date: string; persen: number | null }[];
  kritis: KritisWa[];
};

export type DataWa = {
  ok: boolean;
  judul: string;
  blok: { angka: boolean; status: boolean; tren: boolean; trenAtp: boolean; po: boolean };
  doiDisplay: 'OPSI1' | 'OPSI2' | 'BOTH';
  dibuatPada: string;
  snapshotDate: string | null;
  computedAt: string | null;
  total: {
    sku: number; doi1: number | null; doi2: number | null;
    ads1: number; ads2: number;
    stock: number; transit: number; value: number; valueTransit: number;
    kritis: number; low: number;
    /**
     * ATP keseluruhan — siap dibagi dihitung, dijumlahkan LINTAS AREA.
     *
     * Bukan rata-rata persen per area: cabang 2 SKU dan cabang 1.600 SKU tidak
     * boleh berbobot sama. Lihat `atpKeseluruhan()`.
     *
     * Opsional: poster lama tetap jalan tanpanya, kotaknya menulis "—".
     */
    atp?: { persen: number | null; siap: number; dihitung: number };
  } | null;
  areas: AreaWa[];
  trenLabel: string[];
  hariIni: string;
};
