/** Nilai bawaan seluruh pengaturan. Semuanya bisa diubah dari halaman Pengaturan. */
export const DEFAULT_SETTINGS = {
  // --- Cakupan data ---
  area_scope: 'Pusat',         // area OCS yang dihitung (stok & penjualan)
  include_inactive: 0,          // ikutkan SKU berstatus Tidak Aktif di OCS
  include_clearance: 0,         // ikutkan SKU CS-*

  // --- Jendela ADS ---
  opsi1_window_days: 90,        // Opsi 1: 3 bulan terakhir
  opsi2_w8_days: 56,            // Opsi 2: 8 minggu
  opsi2_w4_days: 28,            // Opsi 2: 4 minggu
  opsi2_w2_days: 14,            // Opsi 2: 2 minggu
  opsi2_apply_exclusion: 0,     // Opsi 2 ikut mengecualikan tanggal campaign? (bawaan: tidak)
  exclude_stockout_days: 0,     // keluarkan hari stok kosong dari pembagi (butuh riwayat stock_daily)

  // --- Pengecualian tanggal (Opsi 1) ---
  payday_day: 25,               // tanggal gajian tiap bulan (0 = nonaktif)
  exclude_double_dates: 1,      // 1.1, 2.2, ... 12.12

  // --- Produk baru (NPL) ---
  npl_days: 90,                 // umur jual < N hari → NPL
  npl_min_days: 14,             // umur jual < N hari → data belum cukup, tanpa saran PO
  dead_stock_window_days: 90,   // 0 penjualan selama N hari + stok > 0 → dead stock

  // --- Ambang tindakan ---
  target_doi_days: 14,          // DOI target maksimum; di atas ini overstock
  safety_days: 3,               // cadangan di atas lead time
  default_lead_time_days: 7,    // lead time bila SKU tidak ada di master
  action_basis: 'KONSERVATIF',  // KONSERVATIF (DOI terkecil) | OPSI1 | OPSI2

  exclude_phase_out: 1,         // SKU phase out tidak dihitung di DOI total & ABC

  // --- Tampilan ---
  doi_display: 'BOTH',          // opsi DOI yang ditampilkan di layar: OPSI1 | OPSI2 | BOTH

  // --- ABC ---
  abc_a_pct: 70,                // kumulatif ≤ 70% → A
  abc_b_pct: 90,                // kumulatif ≤ 90% → B, sisanya C

  // --- Sinkronisasi ---
  sales_sync_lookback_days: 7,  // tarik ulang N hari terakhir tiap 01.00
  sales_include_ready: 1,       // ikutkan status READY_TO_PROCESS (20000)
  sales_include_return: 1,      // ikutkan status RETURN* (70000-72000)
  sales_include_cancel: 0,      // ikutkan qty order batal/belum bayar ke ADS (bawaan: tidak)
  sales_pull_areas: '',         // area yang ditarik; kosong = dideteksi dari stok. TIDAK PERNAH area=All
  sales_area_start: '',         // tanggal mulai operasional per area, mis. "Surabaya=2026-06-01,Medan=2026-06-01"
  auto_sync_sales: 1,
  auto_compute: 1,

  // --- Dashboard TV (layar penuh, tanpa login) ---
  tv_slide_seconds: 15,         // detik per slide
  tv_rows_per_slide: 12,        // baris tabel per slide
  tv_refresh_minutes: 5,        // muat ulang data tiap N menit

  // --- Barang dalam perjalanan (SIT) dari OCS /api/receive-stock ---
  transit_enabled: 1,           // tarik SIT otomatis dari OCS
  transit_refresh_hours: 3,     // dokumen receive jarang berubah; jangan tarik tiap Refresh

  // --- Nilai stok (harga dari OCS /Products/GetProductSkus)
  price_enabled: 1,             // tampilkan nilai rupiah di dashboard & tabel
  price_source: 'MIN',          // MIN | MAX | AVG dari SalePrice antar marketplace
  price_refresh_hours: 12,      // harga master jarang berubah; jangan tarik tiap Refresh

  // --- Poster WhatsApp (/wa) — satu gambar 1600×900 berisi 5 area ---
  // Blok mana yang ikut digambar. Dimatikan = kartunya lebih lega, bukan kosong:
  // tata letak poster menyesuaikan sendiri.
  wa_blok_angka: 1,             // DOI opsi 1 & 2, nilai stok, SIT, jumlah SKU
  wa_blok_status: 1,            // batang sebaran status per area
  wa_blok_tren: 1,              // garis tren DOI 30 hari per area
  wa_blok_po: 1,                // saran open PO + SKU kritis teratas
  wa_kritis_maks: 3,            // berapa SKU kritis yang disebut namanya per area
  wa_judul: 'Ringkasan DOI Harian — IEG',
} as const;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;
export type SettingsMap = Record<string, string>;

export type DoiSettings = {
  areaScope: string;
  includeInactive: boolean;
  includeClearance: boolean;
  opsi1WindowDays: number;
  opsi2W8Days: number;
  opsi2W4Days: number;
  opsi2W2Days: number;
  opsi2ApplyExclusion: boolean;
  excludeStockoutDays: boolean;
  paydayDay: number;
  excludeDoubleDates: boolean;
  nplDays: number;
  nplMinDays: number;
  deadStockWindowDays: number;
  targetDoiDays: number;
  safetyDays: number;
  defaultLeadTimeDays: number;
  actionBasis: 'KONSERVATIF' | 'OPSI1' | 'OPSI2';
  abcAPct: number;
  abcBPct: number;
  excludePhaseOut: boolean;
  /** Opsi DOI yang ditampilkan (tidak mengubah perhitungan, hanya tampilan). */
  doiDisplay: 'OPSI1' | 'OPSI2' | 'BOTH';
  /** Nilai rupiah stok ditampilkan atau tidak. */
  priceEnabled: boolean;
  /** Angka mana yang diambil dari array SalePrice OCS. */
  priceSource: 'MIN' | 'MAX' | 'AVG';
  priceRefreshHours: number;
  /** Tarik barang dalam perjalanan dari OCS? Bawaan: ya. */
  transitEnabled: boolean;
  transitRefreshHours: number;
  salesSyncLookbackDays: number;
  salesIncludeReady: boolean;
  salesIncludeReturn: boolean;
  /** Qty order batal/belum bayar ikut jadi permintaan di ADS? Bawaan: tidak. */
  salesIncludeCancel: boolean;
  /**
   * Area yang ditarik, dipanggil satu per satu dengan namanya masing-masing.
   * `area=All` tidak pernah dipakai — cakupannya ditentukan akun OCS dan pernah
   * menyusut diam-diam jadi satu area tanpa galat.
   *
   * Kosong = dideteksi dari `stock_current`. Diisi oleh `npm run backfill:sales`
   * supaya cron malam menarik area yang sama persis.
   */
  salesPullAreas: string[];
  /**
   * Tanggal mulai operasional per area. Sebelum tanggal ini area tersebut
   * memang belum ada penjualannya, jadi menariknya cuma membuang waktu —
   * dan membuat laporan lubang penuh "lubang" palsu.
   *
   * Format pengaturan: `Surabaya=2026-06-01,Medan=2026-06-01`.
   */
  salesAreaStart: Record<string, string>;
  autoSyncSales: boolean;
  autoCompute: boolean;
};

const num = (raw: SettingsMap, key: SettingKey): number => {
  const v = Number(raw[key] ?? DEFAULT_SETTINGS[key]);
  return Number.isFinite(v) ? v : Number(DEFAULT_SETTINGS[key]);
};
const bool = (raw: SettingsMap, key: SettingKey): boolean => num(raw, key) === 1;
const str = (raw: SettingsMap, key: SettingKey): string => String(raw[key] ?? DEFAULT_SETTINGS[key]);

/** Ubah baris `app_setting` mentah menjadi objek bertipe yang dipakai mesin DOI. */
export function toDoiSettings(raw: SettingsMap = {}): DoiSettings {
  const basis = str(raw, 'action_basis').toUpperCase();
  const disp = str(raw, 'doi_display').toUpperCase();
  return {
    areaScope: str(raw, 'area_scope'),
    includeInactive: bool(raw, 'include_inactive'),
    includeClearance: bool(raw, 'include_clearance'),
    opsi1WindowDays: Math.max(1, num(raw, 'opsi1_window_days')),
    opsi2W8Days: Math.max(1, num(raw, 'opsi2_w8_days')),
    opsi2W4Days: Math.max(1, num(raw, 'opsi2_w4_days')),
    opsi2W2Days: Math.max(1, num(raw, 'opsi2_w2_days')),
    opsi2ApplyExclusion: bool(raw, 'opsi2_apply_exclusion'),
    excludeStockoutDays: bool(raw, 'exclude_stockout_days'),
    paydayDay: num(raw, 'payday_day'),
    excludeDoubleDates: bool(raw, 'exclude_double_dates'),
    nplDays: num(raw, 'npl_days'),
    nplMinDays: num(raw, 'npl_min_days'),
    deadStockWindowDays: Math.max(1, num(raw, 'dead_stock_window_days')),
    targetDoiDays: num(raw, 'target_doi_days'),
    safetyDays: num(raw, 'safety_days'),
    defaultLeadTimeDays: num(raw, 'default_lead_time_days'),
    actionBasis: basis === 'OPSI1' || basis === 'OPSI2' ? basis : 'KONSERVATIF',
    abcAPct: num(raw, 'abc_a_pct'),
    abcBPct: num(raw, 'abc_b_pct'),
    excludePhaseOut: bool(raw, 'exclude_phase_out'),
    doiDisplay: disp === 'OPSI1' || disp === 'OPSI2' ? disp : 'BOTH',
    priceEnabled: bool(raw, 'price_enabled'),
    priceSource: (() => {
      const v = str(raw, 'price_source').toUpperCase();
      return v === 'MAX' || v === 'AVG' ? v : 'MIN';
    })(),
    priceRefreshHours: Math.max(0, num(raw, 'price_refresh_hours')),
    transitEnabled: bool(raw, 'transit_enabled'),
    transitRefreshHours: Math.max(0, num(raw, 'transit_refresh_hours')),
    salesSyncLookbackDays: Math.max(1, num(raw, 'sales_sync_lookback_days')),
    salesIncludeReady: bool(raw, 'sales_include_ready'),
    salesIncludeReturn: bool(raw, 'sales_include_return'),
    salesIncludeCancel: bool(raw, 'sales_include_cancel'),
    salesPullAreas: str(raw, 'sales_pull_areas').split(',').map((v) => v.trim()).filter(Boolean),
    salesAreaStart: parseAreaStart(str(raw, 'sales_area_start')),
    autoSyncSales: bool(raw, 'auto_sync_sales'),
    autoCompute: bool(raw, 'auto_compute'),
  };
}

/** Jendela terpanjang yang dibutuhkan mesin — menentukan berapa hari histori yang dibaca. */
export function longestWindow(s: DoiSettings): number {
  return Math.max(s.opsi1WindowDays, s.opsi2W8Days, s.opsi2W4Days, s.opsi2W2Days, s.deadStockWindowDays);
}

/**
 * Baca "Area=YYYY-MM-DD,Area2=YYYY-MM-DD" jadi objek. Entri yang formatnya
 * salah dilewati diam-diam: pengaturan yang salah ketik tidak boleh membuat
 * seluruh penarikan gagal, cukup area itu ikut ditarik penuh seperti biasa.
 */
export function parseAreaStart(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const bagian of raw.split(',')) {
    const i = bagian.indexOf('=');
    if (i < 1) continue;
    const area = bagian.slice(0, i).trim();
    const tgl = bagian.slice(i + 1).trim();
    if (area && /^\d{4}-\d{2}-\d{2}$/.test(tgl)) out[area] = tgl;
  }
  return out;
}
