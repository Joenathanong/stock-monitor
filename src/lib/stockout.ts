/**
 * Analisis Stok Kosong — mencari hari-hari ketika sebuah SKU yang biasanya laku
 * tiba-tiba tidak punya penjualan sama sekali, lalu memperkirakan berapa
 * penjualan yang hilang karenanya.
 *
 * Dua jenis temuan, sengaja dipisah karena penanganannya berbeda:
 *
 *   1. STOK KOSONG   — qty total = 0 (otomatis semua platform nol).
 *                      Dikonfirmasi lewat stock_daily bila tanggalnya sudah
 *                      terekam; sebelum itu statusnya "dugaan".
 *   2. MASALAH LISTING — satu platform nol beberapa hari sementara platform lain
 *                      tetap jalan. Total qty-nya TIDAK nol, jadi tidak mungkin
 *                      masuk kategori pertama. Ini bukan urusan stok.
 *
 * Yang sengaja TIDAK dilakukan: menebak "anjlok" (qty kecil tapi bukan nol).
 * Ambangnya nol bulat, sesuai keputusan pemakai — lebih sedikit temuan, tapi
 * yang muncul tidak perlu diperdebatkan.
 */
import { addDays, diffDays, type DateKey } from './dates';

export type Platform = 'shopee' | 'tiktok' | 'tokped' | 'lazada' | 'other';
export const PLATFORMS: Platform[] = ['shopee', 'tiktok', 'tokped', 'lazada', 'other'];
export const PLATFORM_LABEL: Record<Platform, string> = {
  shopee: 'Shopee', tiktok: 'TikTok', tokped: 'Tokopedia', lazada: 'Lazada', other: 'Lainnya',
};

export type DaySales = { qty: number } & Record<Platform, number>;

/** Keadaan stok pada hari itu menurut stock_daily. */
export type StockState = 'KOSONG' | 'ADA' | 'TIDAK_TAHU';

/** Dari mana angka "normal"-nya diambil. */
export type AdsSource = 'SNAPSHOT' | 'PENJUALAN';

export type Episode = {
  from: DateKey; to: DateKey; days: number;
  /** Angka "normal" yang dipakai: ADS snapshot, atau median penjualan bila tidak ada. */
  ads: number;
  adsSource: AdsSource;
  /** true bila ADS diambil dari snapshot yang lebih baru dari episodenya. */
  adsEstimated: boolean;
  lostLow: number; lostHigh: number;
  stockState: StockState;
  /** Berapa hari dari episode ini yang stoknya terbukti 0 / terbukti ada. */
  stockZeroDays: number; stockPositiveDays: number;
  /** Hari campaign (double date / gajian) yang ikut kosong — kehilangan paling mahal. */
  campaignDays: number;
  /** Masih berlangsung sampai ujung rentang. */
  ongoing: boolean;
};

export type SkuStockout = {
  sku: string;
  episodes: Episode[];
  outDays: number;
  episodeCount: number;
  longestDays: number;
  lastFrom: DateKey | null;
  lastTo: DateKey | null;
  ongoing: boolean;
  lostLow: number;
  lostHigh: number;
  campaignDays: number;
  /** Angka normal terakhir yang dipakai — untuk ditampilkan di tabel. */
  ads: number;
  adsSource: AdsSource;
  adsEstimated: boolean;
  /** ADS hari-laku: total penjualan ÷ jumlah hari yang ADA penjualannya. */
  adsSelling: number;
  sellDays: number;
  /** Pangsa hari laku di rentang (%) — makin tinggi makin meyakinkan temuannya. */
  sellSharePct: number;
  totalQty: number;
  /** Status gabungan seluruh episode SKU ini. */
  status: 'TERKONFIRMASI' | 'DUGAAN' | 'STOK_ADA';
};

export type PlatformGap = {
  sku: string;
  platform: Platform;
  from: DateKey; to: DateKey; days: number;
  /** Pangsa platform ini sebelum gap — kecil berarti temuannya tidak penting. */
  sharePct: number;
  /** Penjualan platform LAIN selama gap — bukti bahwa produknya masih laku. */
  otherQty: number;
  /** Perkiraan kehilangan = hari × rata-rata harian platform ini saat normal. */
  lostQty: number;
  ongoing: boolean;
};

export type StockoutOptions = {
  /** Hari yang benar-benar dipakai — hari tanpa data sinkronisasi sudah dibuang. */
  days: DateKey[];
  minRunDays: number;
  minAds: number;
  /**
   * Pangsa minimum hari laku (0–1). Inilah yang membedakan "biasanya laku tiap
   * hari lalu tiba-tiba nol" dari produk slow-moving yang memang bolong-bolong.
   * Tanpa ini, SKU yang laku 1 pcs seminggu dua kali akan memenuhi laporan.
   */
  minSellShare: number;
  /** Pangsa minimum sebuah platform agar gap-nya dilaporkan (0–1). */
  platformMinShare: number;
  platformMinRunDays: number;
  /** Tanggal campaign (double date / gajian / manual) di dalam rentang. */
  campaignDates: Set<DateKey>;
};

export type SkuInput = {
  sku: string;
  byDate: Map<DateKey, DaySales>;
  /** Penjualan pertama sepanjang histori — hari sebelum ini tidak dihitung kosong. */
  firstSalesDate: DateKey | null;
  /**
   * ADS acuan pada sebuah tanggal (dari doi_snapshot terdekat ≤ tanggal itu).
   * Boleh mengembalikan 0 — untuk SKU yang tidak ada di snapshot sama sekali,
   * angka normalnya dihitung sendiri dari penjualan (lihat salesBaseline).
   */
  adsAt: (d: DateKey) => { ads: number; estimated: boolean };
  /** availableQty pada tanggal itu; null = belum ada riwayat stok. */
  stockAt: (d: DateKey) => number | null;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Angka "normal" dari penjualan saja — dipakai untuk SKU yang tidak punya ADS
 * di snapshot (mis. sudah tidak terdaftar di daftar stok OCS). Median hari laku
 * pada `lookback` hari SEBELUM tanggal acuan: median tahan terhadap lonjakan
 * campaign, dan jendela sebelum episode membuat stockout tidak mengencerkan
 * angkanya sendiri.
 */
export function salesBaseline(
  byDate: Map<DateKey, DaySales>, days: DateKey[], before: DateKey, lookback = 28,
): number {
  const mulai = addDays(before, -lookback);
  const nilai = days
    .filter((d) => d >= mulai && d < before)
    .map((d) => byDate.get(d)?.qty ?? 0)
    .filter((q) => q > 0)
    .sort((a, b) => a - b);
  if (!nilai.length) {
    // Jendela sebelumnya kosong (episode di awal rentang) — pakai seluruh rentang.
    const semua = days.map((d) => byDate.get(d)?.qty ?? 0).filter((q) => q > 0).sort((a, b) => a - b);
    return semua.length ? round1(semua[Math.floor(semua.length / 2)]) : 0;
  }
  return round1(nilai[Math.floor(nilai.length / 2)]);
}

/** Potong deret hari menjadi kelompok-kelompok berurutan yang memenuhi `hit`. */
function runs(days: DateKey[], hit: (d: DateKey) => boolean): DateKey[][] {
  const out: DateKey[][] = [];
  let cur: DateKey[] = [];
  for (const d of days) {
    if (hit(d)) cur.push(d);
    else if (cur.length) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Analisis satu SKU. Mengembalikan null bila SKU-nya memang tidak layak
 * dianalisis (ADS di bawah ambang, atau tidak ada episode yang memenuhi syarat).
 */
export function analyzeSku(input: SkuInput, opt: StockoutOptions): { sku: SkuStockout | null; gaps: PlatformGap[] } {
  const { days } = opt;
  const last = days[days.length - 1];

  // Hari sebelum penjualan pertama bukan "kosong" — produknya memang belum ada.
  const mulai = input.firstSalesDate && input.firstSalesDate > days[0] ? input.firstSalesDate : days[0];
  const hariDipakai = days.filter((d) => d >= mulai);
  if (!hariDipakai.length) return { sku: null, gaps: [] };

  const qtyOf = (d: DateKey) => input.byDate.get(d)?.qty ?? 0;
  const totalQty = hariDipakai.reduce((a, d) => a + qtyOf(d), 0);
  const sellDays = hariDipakai.filter((d) => qtyOf(d) > 0).length;
  const adsSelling = sellDays ? round1(totalQty / sellDays) : 0;

  // Dua saringan kelayakan. ADS acuan menyaring produk yang permintaannya memang
  // kecil; pangsa hari laku menyaring produk yang polanya memang terputus-putus.
  // adsSelling TIDAK dipakai menyaring — produk yang laku 1 pcs seminggu sekali
  // punya adsSelling 1 dan akan lolos, padahal justru itu yang harus dibuang.
  const adsNow = input.adsAt(last);
  const acuanNow = adsNow.ads > 0 ? adsNow.ads : salesBaseline(input.byDate, hariDipakai, last);
  const sellShare = hariDipakai.length ? sellDays / hariDipakai.length : 0;
  if (acuanNow < opt.minAds) return { sku: null, gaps: [] };
  if (sellShare < opt.minSellShare) return { sku: null, gaps: [] };

  // ---- 1. Episode stok kosong: qty total nol berturut-turut
  const episodes: Episode[] = [];
  for (const run of runs(hariDipakai, (d) => qtyOf(d) === 0)) {
    if (run.length < opt.minRunDays) continue;
    const from = run[0], to = run[run.length - 1];
    const dariSnapshot = input.adsAt(from);
    const adsSource: AdsSource = dariSnapshot.ads > 0 ? 'SNAPSHOT' : 'PENJUALAN';
    const ads = dariSnapshot.ads > 0 ? dariSnapshot.ads : salesBaseline(input.byDate, hariDipakai, from);
    const estimated = adsSource === 'SNAPSHOT' && dariSnapshot.estimated;
    if (ads < opt.minAds) continue;

    let zero = 0, positive = 0;
    for (const d of run) {
      const s = input.stockAt(d);
      if (s === null) continue;
      if (s <= 0) zero++; else positive++;
    }
    // Stok terbukti ADA di sebagian besar hari → ini bukan masalah stok.
    const stockState: StockState = zero > 0 && zero >= positive ? 'KOSONG'
      : positive > 0 ? 'ADA' : 'TIDAK_TAHU';

    episodes.push({
      from, to, days: run.length, ads, adsSource, adsEstimated: estimated,
      lostLow: Math.round(run.length * ads),
      lostHigh: Math.round(run.length * Math.max(ads, adsSelling)),
      stockState, stockZeroDays: zero, stockPositiveDays: positive,
      campaignDays: run.filter((d) => opt.campaignDates.has(d)).length,
      ongoing: to === last,
    });
  }

  // ---- 2. Gap platform: satu platform nol padahal platform lain masih jalan
  const gaps: PlatformGap[] = [];
  for (const p of PLATFORMS) {
    const totalP = hariDipakai.reduce((a, d) => a + (input.byDate.get(d)?.[p] ?? 0), 0);
    if (!totalQty || totalP / totalQty < opt.platformMinShare) continue;
    const sellDaysP = hariDipakai.filter((d) => (input.byDate.get(d)?.[p] ?? 0) > 0).length;
    const adsP = sellDaysP ? totalP / sellDaysP : 0;

    for (const run of runs(hariDipakai, (d) => (input.byDate.get(d)?.[p] ?? 0) === 0 && qtyOf(d) > 0)) {
      if (run.length < opt.platformMinRunDays) continue;
      gaps.push({
        sku: input.sku, platform: p,
        from: run[0], to: run[run.length - 1], days: run.length,
        sharePct: round1((totalP / totalQty) * 100),
        otherQty: run.reduce((a, d) => a + qtyOf(d), 0),
        lostQty: Math.round(run.length * adsP),
        ongoing: run[run.length - 1] === last,
      });
    }
  }

  if (!episodes.length) return { sku: null, gaps };

  const outDays = episodes.reduce((a, e) => a + e.days, 0);
  const konfirmasi = episodes.filter((e) => e.stockState === 'KOSONG').length;
  const stokAda = episodes.filter((e) => e.stockState === 'ADA').length;
  const terakhir = episodes[episodes.length - 1];

  return {
    gaps,
    sku: {
      sku: input.sku,
      episodes,
      outDays,
      episodeCount: episodes.length,
      longestDays: Math.max(...episodes.map((e) => e.days)),
      lastFrom: terakhir.from, lastTo: terakhir.to,
      ongoing: episodes.some((e) => e.ongoing),
      lostLow: episodes.reduce((a, e) => a + e.lostLow, 0),
      lostHigh: episodes.reduce((a, e) => a + e.lostHigh, 0),
      campaignDays: episodes.reduce((a, e) => a + e.campaignDays, 0),
      ads: terakhir.ads, adsSource: terakhir.adsSource, adsEstimated: episodes.some((e) => e.adsEstimated),
      adsSelling, sellDays, totalQty, sellSharePct: round1(sellShare * 100),
      status: konfirmasi > 0 ? 'TERKONFIRMASI' : stokAda > 0 && stokAda >= episodes.length / 2 ? 'STOK_ADA' : 'DUGAAN',
    },
  };
}

/**
 * Hari yang datanya tidak bisa dipercaya: tidak ada SATU PUN SKU yang berpenjualan
 * (sinkronisasi gagal), atau jumlah SKU yang laku jauh di bawah kebiasaan.
 * Tanpa ini, satu hari cron yang gagal akan membuat SELURUH katalog tampak kosong.
 */
export function findDataGaps(days: DateKey[], activeSkuPerDay: Map<DateKey, number>, minShare = 0.25): DateKey[] {
  const counts = days.map((d) => activeSkuPerDay.get(d) ?? 0);
  const positif = counts.filter((n) => n > 0).sort((a, b) => a - b);
  const median = positif.length ? positif[Math.floor(positif.length / 2)] : 0;
  return days.filter((d) => {
    const n = activeSkuPerDay.get(d) ?? 0;
    return n === 0 || (median > 0 && n < median * minShare);
  });
}

/** Rentang tanggal yang sah: berakhir kemarin, panjang dibatasi. */
export function clampRange(from: DateKey, to: DateKey, today: DateKey, maxDays: number): { from: DateKey; to: DateKey } {
  const kemarin = addDays(today, -1);
  let t = to > kemarin ? kemarin : to;
  let f = from > t ? t : from;
  if (diffDays(f, t) + 1 > maxDays) f = addDays(t, -(maxDays - 1));
  return { from: f, to: t };
}
