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
  /** Penjualan harian `YYYY-MM-DD` → qty di dalam jendela terpanjang. Hari tanpa penjualan boleh tidak ada. */
  salesByDate: Record<DateKey, number>;
  /** Tanggal penjualan pertama sepanjang histori (bukan hanya di jendela). Null bila belum pernah terjual. */
  firstSalesDate: DateKey | null;
  /** Tanggal ketika stok tercatat 0 (dari stock_daily) — dipakai bila `excludeStockoutDays` aktif. */
  stockoutDates?: Set<DateKey>;
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
    ads > 0 && status !== 'DEAD_STOCK' && status !== 'NO_SALES' && status !== 'EXCLUDED' && status !== 'NPL_WAIT'
      ? Math.max(0, Math.ceil(s.targetDoiDays * ads - position))
      : 0;

  const runOutDate = refDoi !== null ? addDays(today, Math.max(0, Math.floor(refDoi))) : null;

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
  };
}

/**
 * Kelas ABC berdasarkan pangsa qty penjualan (jendela Opsi 1, tanpa pengecualian).
 * Item yang melewati batas ikut kelas di atasnya — praktik yang lazim.
 * Mengubah `rows` di tempat, mengembalikan rows yang sama untuk kenyamanan.
 */
export function assignAbc(rows: DoiResult[], aPct: number, bPct: number): DoiResult[] {
  const total = rows.reduce((sum, r) => sum + Math.max(0, r.sales90), 0);
  const sorted = [...rows].sort((a, b) => b.sales90 - a.sales90 || a.sku.localeCompare(b.sku));
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

export type TotalDoi = { stock: number; transit: number; ads1: number; ads2: number; doi1: number | null; doi2: number | null; skuCount: number };

/** DOI keseluruhan = total stok ÷ total ADS. Dihitung untuk semua SKU dan per kelas ABC. */
export function totalDoi(rows: DoiResult[]): TotalDoi {
  let stock = 0, transit = 0, ads1 = 0, ads2 = 0;
  for (const r of rows) {
    if (r.status === 'EXCLUDED') continue;
    stock += r.availableQty;
    transit += r.transitQty;
    ads1 += r.ads1;
    ads2 += r.ads2;
  }
  return {
    stock, transit,
    ads1: round2(ads1),
    ads2: round2(ads2),
    doi1: ads1 > 0 ? round2(stock / ads1) : null,
    doi2: ads2 > 0 ? round2(stock / ads2) : null,
    skuCount: rows.filter((r) => r.status !== 'EXCLUDED').length,
  };
}

export type HealthSummary = {
  totalSku: number;
  byStatus: Record<ProductStatus, number>;
  byAbc: Record<'A' | 'B' | 'C', { count: number; stock: number; sales: number; total: TotalDoi }>;
  total: TotalDoi;
  npl: number;
  suggestedQty1: number;
  suggestedQty2: number;
  buckets: { label: string; count: number }[];
};

export function summarize(rows: DoiResult[]): HealthSummary {
  const byStatus = Object.fromEntries((Object.keys(STATUS_LABEL) as ProductStatus[]).map((k) => [k, 0])) as Record<ProductStatus, number>;
  for (const r of rows) byStatus[r.status]++;
  const cls = (c: 'A' | 'B' | 'C') => {
    const part = rows.filter((r) => r.abcClass === c && r.status !== 'EXCLUDED');
    return {
      count: part.length,
      stock: part.reduce((s, r) => s + r.availableQty, 0),
      sales: part.reduce((s, r) => s + r.sales90, 0),
      total: totalDoi(part),
    };
  };
  const bucket = (lo: number, hi: number) =>
    rows.filter((r) => r.refDoi !== null && r.refDoi >= lo && r.refDoi < hi).length;
  return {
    totalSku: rows.length,
    byStatus,
    byAbc: { A: cls('A'), B: cls('B'), C: cls('C') },
    total: totalDoi(rows),
    npl: rows.filter((r) => r.isNpl).length,
    suggestedQty1: rows.reduce((s, r) => s + r.suggested1, 0),
    suggestedQty2: rows.reduce((s, r) => s + r.suggested2, 0),
    buckets: [
      { label: '0–7 hari', count: bucket(0, 7) },
      { label: '7–14 hari', count: bucket(7, 14) },
      { label: '14–30 hari', count: bucket(14, 30) },
      { label: '30–60 hari', count: bucket(30, 60) },
      { label: '> 60 hari', count: rows.filter((r) => r.refDoi !== null && r.refDoi >= 60).length },
    ],
  };
}
