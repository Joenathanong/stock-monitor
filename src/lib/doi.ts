/**
 * Mesin perhitungan DOI — dua opsi ADS, NPL, saran tindakan, dan ABC.
 *
 * Seluruh berkas ini murni fungsi: tanpa database, tanpa jaringan, tanpa
 * `new Date()` tersembunyi. Semua yang bergantung waktu masuk lewat `ctx.today`,
 * sehingga hasilnya bisa diuji dan diulang persis.
 *
 * Konvensi jendela: SEMUA jendela berakhir KEMARIN. Hari ini masih berjalan;
 * memasukkannya menyeret rata-rata turun sepanjang pagi lalu naik lagi malam.
 */
import { addDays, diffDays, type DateKey } from './dates';
import type { DoiSettings } from './settings';

export type ProductStatus =
  | 'CRITICAL'   // stok (+transit) habis sebelum barang PO datang
  | 'LOW'        // habis di dalam lead time + safety
  | 'WAITING'    // stok di tangan tipis, tapi kiriman yang sedang jalan menutupnya
  | 'HEALTHY'    // di antara lead time + safety dan target DOI
  | 'OVERSTOCK'  // di atas target DOI
  | 'DEAD_STOCK' // pernah terjual, 0 penjualan di jendela dead stock, stok > 0
  | 'NO_SALES'   // belum pernah terjual sama sekali
  | 'NPL_WAIT'   // produk baru, umur jual belum cukup untuk dihitung
  | 'PHASE_OUT'  // masa phase out: masih dijual sampai habis, tidak di-PO lagi
  | 'EXCLUDED';  // dikecualikan manual (discontinued, dsb.)

export const STATUS_LABEL: Record<ProductStatus, string> = {
  CRITICAL: 'Kritis',
  LOW: 'Low Stock',
  WAITING: 'Tunggu Kiriman',
  HEALTHY: 'Aman',
  OVERSTOCK: 'Overstock',
  DEAD_STOCK: 'Dead Stock',
  NO_SALES: 'Belum Terjual',
  NPL_WAIT: 'NPL',
  PHASE_OUT: 'Phase Out',
  EXCLUDED: 'Dikecualikan',
};

export const STATUS_ACTION: Record<ProductStatus, string> = {
  CRITICAL: 'SEGERA OPEN PO — stok habis sebelum barang datang',
  LOW: 'Low stock, segera open PO',
  WAITING: 'Tunggu kiriman, pantau ETA',
  HEALTHY: 'Aman',
  OVERSTOCK: 'Overstock — tahan PO',
  DEAD_STOCK: 'Dead stock — review / promo',
  NO_SALES: 'Belum terjual — pantau',
  NPL_WAIT: 'NPL — data belum cukup, pantau',
  PHASE_OUT: 'Phase out — habiskan stok, jangan PO',
  EXCLUDED: 'Dikecualikan dari perhitungan',
};

export type SkuInput = {
  sku: string;
  name: string;
  sapCode?: string | null;
  availableQty: number;
  qtyOnHand?: number;
  qtyOnOrder?: number;
  transitQty: number;
  leadTimeDays?: number | null;
  isExcluded?: boolean;
  /** Data phase out bila SKU sedang dihabiskan. */
  phaseOut?: { effectiveDate: DateKey | null; targetOutDate: DateKey | null; replacementSku: string | null; disposition: string } | null;
  /** Penjualan harian `YYYY-MM-DD` → qty di dalam jendela terpanjang. Hari tanpa penjualan boleh tidak ada. */
  salesByDate: Record<DateKey, number>;
  /** Tanggal penjualan pertama sepanjang histori (bukan hanya di jendela). Null bila belum pernah terjual. */
  firstSalesDate: DateKey | null;
  /** Tanggal ketika stok tercatat 0 (dari stock_daily) — dipakai bila `excludeStockoutDays` aktif. */
  stockoutDates?: Set<DateKey>;
  /** Harga satuan (rupiah) dari OCS. 0 = harganya tidak diketahui. */
  unitPrice?: number;
};

export type DoiContext = {
  today: DateKey;
  /** Tanggal yang dikecualikan dari Opsi 1 (payday, double date, manual). */
  exclusionDates: Set<DateKey>;
  /** Tanggal paling awal yang ada di database penjualan — untuk menandai "≥ awal data". */
  earliestDataDate?: DateKey | null;
};

export type WindowStat = {
  /** Jumlah qty pada hari yang dihitung. */
  sum: number;
  /** Jumlah hari yang dihitung (setelah pengecualian & pemotongan NPL). */
  days: number;
  /** Rata-rata harian; 0 bila tidak ada hari yang dihitung. */
  ads: number;
  /** Hari yang dibuang karena pengecualian tanggal. */
  excludedDays: number;
  /** Hari yang dibuang karena stok kosong. */
  stockoutDays: number;
};

export type DoiResult = {
  sku: string;
  name: string;
  sapCode: string | null;
  availableQty: number;
  qtyOnHand: number;
  qtyOnOrder: number;
  transitQty: number;
  leadTimeDays: number;
  firstSalesDate: DateKey | null;
  /** True bila tanggal pertama = awal data, jadi tanggal listing sebenarnya bisa lebih tua. */
  firstSalesTruncated: boolean;
  ageDays: number | null;
  isNpl: boolean;
  nplNote: string | null;
  /** Total penjualan di jendela Opsi 1 TANPA pengecualian (dipakai ABC & dead stock). */
  sales90: number;
  w1: WindowStat;
  w8: WindowStat;
  w4: WindowStat;
  w2: WindowStat;
  ads1: number;
  ads2: number;
  ads2Source: '8w' | '4w' | '2w' | '';
  doi1: number | null;
  doi2: number | null;
  doi1Transit: number | null;
  doi2Transit: number | null;
  /** DOI yang dipakai untuk menentukan status — mengikuti `action_basis`. */
  refDoi: number | null;
  refDoiTransit: number | null;
  refAds: number;
  status: ProductStatus;
  action: string;
  suggested1: number;
  suggested2: number;
  runOutDate: DateKey | null;
  abcClass: 'A' | 'B' | 'C';
  /** Harga satuan saat dihitung; 0 bila OCS tidak punya harganya. */
  unitPrice: number;
  /** Nilai stok = stok × harga satuan. */
  stockValue: number;
  /** Phase out: penanda + metrik sell-down. */
  isPhaseOut: boolean;
  phaseOutTargetDate: DateKey | null;
  phaseOutReplacement: string | null;
  /** Perkiraan sisa stok pada tanggal target (0 bila habis tepat waktu). */
  phaseOutExcessQty: number | null;
  /** Berapa hari perkiraan habis melewati tanggal target (0 bila tidak telat). */
  phaseOutLateDays: number | null;
  abcShare: number;
  abcCumShare: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Statistik satu jendela `windowDays` hari yang berakhir kemarin.
 * Jendela dipotong pada `firstSalesDate` (produk baru tidak dibagi 90 hari).
 */
export function windowStat(
  input: Pick<SkuInput, 'salesByDate' | 'firstSalesDate' | 'stockoutDates'>,
  today: DateKey,
  windowDays: number,
  opts: { exclusionDates?: Set<DateKey>; excludeStockout?: boolean } = {},
): WindowStat {
  const end = addDays(today, -1);
  let start = addDays(today, -windowDays);
  if (input.firstSalesDate && input.firstSalesDate > start) start = input.firstSalesDate;

  let sum = 0, days = 0, excludedDays = 0, stockoutDays = 0;
  for (let k = start; k <= end; k = addDays(k, 1)) {
    if (opts.exclusionDates?.has(k)) { excludedDays++; continue; }
    if (opts.excludeStockout && input.stockoutDates?.has(k) && !(input.salesByDate[k] > 0)) { stockoutDays++; continue; }
    sum += input.salesByDate[k] ?? 0;
    days++;
  }
  return { sum, days, ads: days > 0 ? round2(sum / days) : 0, excludedDays, stockoutDays };
}

/** Total penjualan `windowDays` hari terakhir (berakhir kemarin), tanpa pengecualian apa pun. */
export function sumWindow(salesByDate: Record<DateKey, number>, today: DateKey, windowDays: number): number {
  let total = 0;
  for (let i = 1; i <= windowDays; i++) total += salesByDate[addDays(today, -i)] ?? 0;
  return total;
}

const doiOf = (stock: number, ads: number): number | null => (ads > 0 ? round2(stock / ads) : null);

/** Perhitungan satu SKU. ABC diisi belakangan oleh `assignAbc` karena butuh seluruh populasi. */
export function computeSku(input: SkuInput, s: DoiSettings, ctx: DoiContext): DoiResult {
  const today = ctx.today;
  const first = input.firstSalesDate;
  const ageDays = first ? diffDays(first, today) : null;
  const firstSalesTruncated = !!first && !!ctx.earliestDataDate && first <= ctx.earliestDataDate;

  const po = input.phaseOut ?? null;
  const isPhaseOut = !!po && !input.isExcluded;
  // Harga negatif/NaN diperlakukan sebagai "tidak diketahui", bukan dipaksa dipakai.
  const unitPrice = Number.isFinite(input.unitPrice) && (input.unitPrice as number) > 0 ? Math.round(input.unitPrice as number) : 0;

  const exOpts = { exclusionDates: ctx.exclusionDates, excludeStockout: s.excludeStockoutDays };
  const w1 = windowStat(input, today, s.opsi1WindowDays, exOpts);
  const opts2 = { exclusionDates: s.opsi2ApplyExclusion ? ctx.exclusionDates : undefined, excludeStockout: s.excludeStockoutDays };
  const w8 = windowStat(input, today, s.opsi2W8Days, opts2);
  const w4 = windowStat(input, today, s.opsi2W4Days, opts2);
  const w2 = windowStat(input, today, s.opsi2W2Days, opts2);

  const ads1 = w1.ads;
  let ads2 = 0;
  let ads2Source: DoiResult['ads2Source'] = '';
  for (const [src, w] of [['8w', w8], ['4w', w4], ['2w', w2]] as const) {
    if (w.days > 0 && w.ads > ads2) { ads2 = w.ads; ads2Source = src; }
  }
  if (ads2 === 0 && (w8.days || w4.days || w2.days)) ads2Source = '8w';

  const sales90 = sumWindow(input.salesByDate, today, s.opsi1WindowDays);
  const salesDead = sumWindow(input.salesByDate, today, s.deadStockWindowDays);

  const stock = input.availableQty;
  const position = stock + input.transitQty;
  const doi1 = doiOf(stock, ads1);
  const doi2 = doiOf(stock, ads2);
  const doi1Transit = doiOf(position, ads1);
  const doi2Transit = doiOf(position, ads2);

  // --- ADS acuan tindakan ---
  let refAds: number;
  if (s.actionBasis === 'OPSI1') refAds = ads1;
  else if (s.actionBasis === 'OPSI2') refAds = ads2;
  else refAds = Math.max(ads1, ads2); // konservatif: ADS terbesar = DOI terkecil
  const refDoi = doiOf(stock, refAds);
  const refDoiTransit = doiOf(position, refAds);

  const leadTimeDays = input.leadTimeDays ?? s.defaultLeadTimeDays;

  // --- NPL ---
  const isNpl = ageDays !== null && ageDays < s.nplDays && !firstSalesTruncated;
  let nplNote: string | null = null;
  if (isNpl) nplNote = ageDays! < s.nplMinDays ? `NPL — ${ageDays} hari, data belum cukup` : `NPL — umur jual ${ageDays} hari`;

  // --- Status ---
  let status: ProductStatus;
  if (input.isExcluded) status = 'EXCLUDED';
  else if (isPhaseOut) status = 'PHASE_OUT';
  else if (first === null) status = 'NO_SALES';
  else if (isNpl && ageDays! < s.nplMinDays) status = 'NPL_WAIT';
  else if (salesDead === 0 && stock > 0) status = 'DEAD_STOCK';
  else if (refAds === 0) status = stock > 0 ? 'DEAD_STOCK' : 'NO_SALES';
  else {
    const dT = refDoiTransit!;
    const dS = refDoi!;
    const lt = leadTimeDays;
    if (dT <= lt) status = 'CRITICAL';
    else if (dT <= lt + s.safetyDays) status = 'LOW';
    else if (dS <= lt + s.safetyDays) status = 'WAITING';
    else if (dT > s.targetDoiDays) status = 'OVERSTOCK';
    else status = 'HEALTHY';
  }

  // --- Saran qty: cukup untuk mencapai target DOI, dikurangi stok + transit ---
  const suggest = (ads: number) =>
    ads > 0 && status !== 'DEAD_STOCK' && status !== 'NO_SALES' && status !== 'EXCLUDED' && status !== 'NPL_WAIT' && status !== 'PHASE_OUT'
      ? Math.max(0, Math.ceil(s.targetDoiDays * ads - position))
      : 0;

  const runOutDate = refDoi !== null ? addDays(today, Math.max(0, Math.floor(refDoi))) : null;

  // --- Phase out: apakah stok sisa habis sebelum tanggal target? ---
  let phaseOutExcessQty: number | null = null;
  let phaseOutLateDays: number | null = null;
  if (isPhaseOut && po?.targetOutDate) {
    const daysToTarget = Math.max(0, diffDays(today, po.targetOutDate));
    // Yang bisa terjual sampai tanggal target, dibandingkan posisi stok + transit.
    phaseOutExcessQty = Math.max(0, Math.round(position - refAds * daysToTarget));
    phaseOutLateDays = runOutDate && runOutDate > po.targetOutDate ? diffDays(po.targetOutDate, runOutDate) : 0;
  }

  return {
    sku: input.sku,
    name: input.name,
    sapCode: input.sapCode ?? null,
    availableQty: stock,
    qtyOnHand: input.qtyOnHand ?? 0,
    qtyOnOrder: input.qtyOnOrder ?? 0,
    transitQty: input.transitQty,
    leadTimeDays,
    firstSalesDate: first,
    firstSalesTruncated,
    ageDays,
    isNpl,
    nplNote,
    sales90,
    w1, w8, w4, w2,
    ads1,
    ads2,
    ads2Source,
    doi1, doi2, doi1Transit, doi2Transit,
    refDoi, refDoiTransit, refAds,
    status,
    action: STATUS_ACTION[status],
    suggested1: suggest(ads1),
    suggested2: suggest(ads2),
    runOutDate,
    abcClass: 'C',
    abcShare: 0,
    abcCumShare: 0,
    unitPrice,
    stockValue: unitPrice * stock,
    isPhaseOut,
    phaseOutTargetDate: po?.targetOutDate ?? null,
    phaseOutReplacement: po?.replacementSku ?? null,
    phaseOutExcessQty,
    phaseOutLateDays,
  };
}

/**
 * Kelas ABC berdasarkan pangsa qty penjualan (jendela Opsi 1, tanpa pengecualian).
 * Item yang melewati batas ikut kelas di atasnya — praktik yang lazim.
 * Mengubah `rows` di tempat, mengembalikan rows yang sama untuk kenyamanan.
 */
export function assignAbc(rows: DoiResult[], aPct: number, bPct: number): DoiResult[] {
  // Hanya SKU aktif yang menentukan batas kelas: produk yang dikecualikan atau sedang
  // di-phase-out akan menggeser ambang 70/90 dan membuat produk aktif turun kelas.
  const active = rows.filter((r) => r.status !== 'EXCLUDED' && r.status !== 'PHASE_OUT');
  for (const r of rows) { r.abcShare = 0; r.abcCumShare = 0; r.abcClass = 'C'; }
  const total = active.reduce((sum, r) => sum + Math.max(0, r.sales90), 0);
  const sorted = [...active].sort((a, b) => b.sales90 - a.sales90 || a.sku.localeCompare(b.sku));
  let cum = 0;
  for (const r of sorted) {
    const share = total > 0 ? (Math.max(0, r.sales90) / total) * 100 : 0;
    const before = cum;
    cum += share;
    r.abcShare = round2(share);
    r.abcCumShare = round2(Math.min(100, cum));
    r.abcClass = r.sales90 <= 0 ? 'C' : before < aPct ? 'A' : before < bPct ? 'B' : 'C';
  }
  return rows;
}

export type TotalDoi = {
  stock: number; transit: number; ads1: number; ads2: number;
  doi1: number | null; doi2: number | null; skuCount: number;
  /** Nilai stok (rupiah) memakai harga satuan saat snapshot. */
  value: number;
  /** Berapa SKU yang harganya TIDAK diketahui — nilai di atas belum lengkap sebanyak ini. */
  noPrice: number;
};

/** DOI keseluruhan = total stok ÷ total ADS. Dihitung untuk semua SKU dan per kelas ABC. */
export function totalDoi(rows: DoiResult[], excludePhaseOut = false): TotalDoi {
  const skip = (r: DoiResult) => r.status === 'EXCLUDED' || (excludePhaseOut && r.status === 'PHASE_OUT');
  let stock = 0, transit = 0, ads1 = 0, ads2 = 0, value = 0, noPrice = 0;
  for (const r of rows) {
    if (skip(r)) continue;
    stock += r.availableQty;
    transit += r.transitQty;
    ads1 += r.ads1;
    ads2 += r.ads2;
    value += r.stockValue;
    // SKU berstok yang harganya tidak diketahui membuat total nilai lebih kecil
    // dari kenyataan — dihitung supaya bisa diberi tahu, bukan disembunyikan.
    if (!r.unitPrice && r.availableQty > 0) noPrice++;
  }
  return {
    stock, transit,
    ads1: round2(ads1),
    ads2: round2(ads2),
    doi1: ads1 > 0 ? round2(stock / ads1) : null,
    doi2: ads2 > 0 ? round2(stock / ads2) : null,
    skuCount: rows.filter((r) => !skip(r)).length,
    value, noPrice,
  };
}

export type HealthSummary = {
  totalSku: number;
  byStatus: Record<ProductStatus, number>;
  byAbc: Record<'A' | 'B' | 'C', { count: number; stock: number; sales: number; total: TotalDoi }>;
  total: TotalDoi;
  /** Total bila SKU phase out ikut dihitung — untuk toggle di layar, tanpa hitung ulang. */
  totalWithPhaseOut: TotalDoi;
  phaseOut: { count: number; stock: number; value: number; excessQty: number; lateCount: number };
  npl: number;
  suggestedQty1: number;
  suggestedQty2: number;
  buckets: { label: string; count: number }[];
};

export function summarize(rows: DoiResult[], excludePhaseOut = false): HealthSummary {
  const byStatus = Object.fromEntries((Object.keys(STATUS_LABEL) as ProductStatus[]).map((k) => [k, 0])) as Record<ProductStatus, number>;
  for (const r of rows) byStatus[r.status]++;
  const cls = (c: 'A' | 'B' | 'C') => {
    // Kelas ABC hanya berisi SKU aktif (lihat assignAbc), jadi phase out tidak ikut.
    const part = rows.filter((r) => r.abcClass === c && r.status !== 'EXCLUDED' && r.status !== 'PHASE_OUT');
    return {
      count: part.length,
      stock: part.reduce((s, r) => s + r.availableQty, 0),
      sales: part.reduce((s, r) => s + r.sales90, 0),
      total: totalDoi(part),
    };
  };
  const inBuckets = excludePhaseOut ? rows.filter((r) => r.status !== 'PHASE_OUT') : rows;
  const bucket = (lo: number, hi: number) =>
    inBuckets.filter((r) => r.refDoi !== null && r.refDoi >= lo && r.refDoi < hi).length;
  const pos = rows.filter((r) => r.status === 'PHASE_OUT');
  return {
    totalSku: rows.length,
    byStatus,
    byAbc: { A: cls('A'), B: cls('B'), C: cls('C') },
    total: totalDoi(rows, excludePhaseOut),
    totalWithPhaseOut: totalDoi(rows, false),
    phaseOut: {
      count: pos.length,
      stock: pos.reduce((a, r) => a + r.availableQty, 0),
      value: pos.reduce((a, r) => a + r.stockValue, 0),
      excessQty: pos.reduce((a, r) => a + (r.phaseOutExcessQty ?? 0), 0),
      lateCount: pos.filter((r) => (r.phaseOutLateDays ?? 0) > 0).length,
    },
    npl: rows.filter((r) => r.isNpl).length,
    suggestedQty1: rows.reduce((s, r) => s + r.suggested1, 0),
    suggestedQty2: rows.reduce((s, r) => s + r.suggested2, 0),
    buckets: [
      { label: '0–7 hari', count: bucket(0, 7) },
      { label: '7–14 hari', count: bucket(7, 14) },
      { label: '14–30 hari', count: bucket(14, 30) },
      { label: '30–60 hari', count: bucket(30, 60) },
      { label: '> 60 hari', count: inBuckets.filter((r) => r.refDoi !== null && r.refDoi >= 60).length },
    ],
  };
}
