import { prisma } from '@/lib/prisma';
import { getSettings } from '@/lib/compute';
import { latestSnapshot } from '@/lib/query';
import { addDays, keyToUtcDate, rangeKeys, toDateKeyUtc, todayKey, type DateKey } from '@/lib/dates';
import { buildExclusionMap } from '@/lib/exclusion';
import {
  analyzeSku, clampRange, findDataGaps, PLATFORMS,
  type DaySales, type PlatformGap, type SkuStockout,
} from '@/lib/stockout';
import { fail, json, safe } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_DAYS = 180;
/** Penjualan 7 hari terakhir masih ditarik ulang tiap malam, jadi bisa berubah. */
const VOLATILE_DAYS = 7;

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const numParam = (v: string | null, fallback: number, lo: number, hi: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/**
 * Analisis stok kosong untuk sebuah rentang tanggal.
 *
 * Perhatikan urutannya: hari yang datanya bolong dibuang DULU, baru deret
 * hari itu dipakai menganalisis tiap SKU. Kalau tidak, satu hari cron yang
 * gagal akan membuat seluruh katalog tampak kosong berbarengan.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const today = todayKey();
  const qFrom = url.searchParams.get('from');
  const qTo = url.searchParams.get('to');
  if (qFrom && !isDate(qFrom)) return fail('Tanggal mulai harus YYYY-MM-DD');
  if (qTo && !isDate(qTo)) return fail('Tanggal akhir harus YYYY-MM-DD');

  const { from, to } = clampRange(
    qFrom ?? addDays(today, -90),
    qTo ?? addDays(today, -1),
    today, MAX_DAYS,
  );

  const minRunDays = numParam(url.searchParams.get('minRun'), 1, 1, 60);
  const minAds = numParam(url.searchParams.get('minAds'), 1, 0, 10_000);
  const minSellShare = numParam(url.searchParams.get('minSell'), 80, 0, 100) / 100;
  const platformMinRunDays = numParam(url.searchParams.get('minRunPlatform'), 3, 2, 60);
  const platformMinShare = numParam(url.searchParams.get('minShare'), 5, 0, 100) / 100;
  const withPhaseOut = url.searchParams.get('phaseOut') === '1';
  const withExcluded = url.searchParams.get('excluded') === '1';

  const settings = await getSettings();
  const areaClause = settings.areaScope === 'All' ? {} : { areaId: settings.areaScope };

  const [snap, salesRows, adsRows, stockRows, master, manualEx, stokOcs] = await Promise.all([
    latestSnapshot(),
    prisma.salesDaily.findMany({
      where: { salesDate: { gte: keyToUtcDate(from), lte: keyToUtcDate(to) }, ...areaClause },
      select: { sku: true, salesDate: true, qty: true, qtyShopee: true, qtyTiktok: true, qtyTokped: true, qtyLazada: true, qtyOther: true },
    }),
    prisma.doiSnapshot.findMany({
      where: { snapshotDate: { lte: keyToUtcDate(to) } },
      select: { sku: true, snapshotDate: true, ads1: true, ads2: true },
      orderBy: { snapshotDate: 'asc' },
    }),
    prisma.stockDaily.findMany({
      where: { snapshotDate: { gte: keyToUtcDate(from), lte: keyToUtcDate(to) }, ...areaClause },
      select: { sku: true, snapshotDate: true, availableQty: true },
    }),
    prisma.skuMaster.findMany({ select: { sku: true, isExcluded: true } }),
    prisma.exclusionDate.findMany(),
    // TANPA saringan kategori/aktif/clearance — justru dipakai menjelaskan
    // kenapa sebuah SKU tidak muncul di daftar stok yang dihitung.
    prisma.stockCurrent.findMany({ select: { sku: true, areaId: true, category: true, isActive: true } }),
  ]);

  if (!snap.rows.length) return fail('Belum ada snapshot DOI — jalankan Refresh dulu', 409);

  // ---- deret hari, dikurangi hari yang datanya bolong
  const semuaHari = rangeKeys(from, to);
  const aktifPerHari = new Map<DateKey, number>();
  const byDate = new Map<string, Map<DateKey, DaySales>>();
  for (const r of salesRows) {
    const d = toDateKeyUtc(r.salesDate);
    if (r.qty > 0) aktifPerHari.set(d, (aktifPerHari.get(d) ?? 0) + 1);
    let m = byDate.get(r.sku);
    if (!m) { m = new Map(); byDate.set(r.sku, m); }
    m.set(d, {
      qty: r.qty, shopee: r.qtyShopee, tiktok: r.qtyTiktok,
      tokped: r.qtyTokped, lazada: r.qtyLazada, other: r.qtyOther,
    });
  }
  const dataGaps = findDataGaps(semuaHari, aktifPerHari);
  const gapSet = new Set(dataGaps);
  const days = semuaHari.filter((d) => !gapSet.has(d));
  if (!days.length) return fail('Tidak ada hari dengan data penjualan pada rentang ini', 409);

  // ---- ADS acuan per tanggal (dari doi_snapshot terdekat SEBELUM episode)
  const basis = settings.actionBasis;
  const adsHistory = new Map<string, { d: DateKey; ads: number }[]>();
  for (const r of adsRows) {
    const ads = basis === 'OPSI1' ? r.ads1 : basis === 'OPSI2' ? r.ads2 : Math.max(r.ads1, r.ads2);
    const list = adsHistory.get(r.sku) ?? [];
    list.push({ d: toDateKeyUtc(r.snapshotDate), ads });
    adsHistory.set(r.sku, list);
  }
  const adsFor = (sku: string) => (d: DateKey) => {
    const list = adsHistory.get(sku);
    if (!list?.length) return { ads: 0, estimated: true };
    let pick = list[0];
    for (const it of list) { if (it.d > d) break; pick = it; }
    // estimated = snapshot-nya lebih baru dari tanggal yang ditanya (riwayat belum ada)
    return { ads: pick.ads, estimated: pick.d > d };
  };

  const stockBy = new Map<string, Map<DateKey, number>>();
  for (const r of stockRows) {
    let m = stockBy.get(r.sku);
    if (!m) { m = new Map(); stockBy.set(r.sku, m); }
    m.set(toDateKeyUtc(r.snapshotDate), r.availableQty);
  }

  /**
   * Kenapa sebuah SKU tidak ada di daftar stok yang dihitung. Urutannya penting:
   * "tidak ada barisnya sama sekali" adalah sinyal paling kuat (barang hilang dari
   * OCS), sedangkan "kategori bukan Sku" biasanya item gimmick/hadiah — bukan OOS.
   */
  const ocsBySku = new Map<string, typeof stokOcs>();
  for (const r of stokOcs) {
    const list = ocsBySku.get(r.sku) ?? [];
    list.push(r);
    ocsBySku.set(r.sku, list);
  }
  const alasanTidakTerdaftar = (sku: string): string => {
    const semua = ocsBySku.get(sku);
    if (!semua?.length) return 'Tidak ada di stok OCS';
    const diArea = settings.areaScope === 'All' ? semua : semua.filter((r) => r.areaId === settings.areaScope);
    if (!diArea.length) return 'Ada di area lain';
    if (!settings.includeClearance && sku.startsWith('CS-')) return 'Clearance (disaring Pengaturan)';
    const kategori = [...new Set(diArea.map((r) => r.category).filter(Boolean))];
    if (kategori.length && !kategori.includes('Sku')) return `Kategori ${kategori.join('/')}`;
    if (!settings.includeInactive && diArea.every((r) => !r.isActive)) return 'Nonaktif di OCS';
    return 'Tidak ada di snapshot terakhir';
  };
  const excluded = new Set(master.filter((m) => m.isExcluded).map((m) => m.sku));
  const campaign = new Set(
    buildExclusionMap(from, to,
      { paydayDay: settings.paydayDay, excludeDoubleDates: settings.excludeDoubleDates },
      manualEx.map((m) => ({ date: toDateKeyUtc(m.date), reason: m.reason })),
    ).keys(),
  );

  const opt = { days, minRunDays, minAds, minSellShare, platformMinShare, platformMinRunDays, campaignDates: campaign };
  const info = new Map(snap.rows.map((r) => [r.sku, r]));

  type Row = SkuStockout & {
    name: string | null; sapCode: string | null; abcClass: string; status2: string;
    volatile: boolean;
    /** Kosong di SEMUA shop — selalu ya untuk baris di tabel stok kosong. */
    outAllShops: boolean;
    /** SKU ini JUGA punya hari di mana hanya sebagian shop yang nol. */
    outSomeShops: boolean;
  };
  const rows: Row[] = [];
  const gaps: (PlatformGap & { name: string | null; outAllShops: boolean; outSomeShops: boolean })[] = [];
  const series: Record<string, number[]> = {};

  // Hanya SKU yang ada di Tabel DOI (= SKU aktif hasil snapshot). SKU yang laku
  // di rentang tapi tidak ada di daftar itu dihitung dan dijelaskan alasannya,
  // tapi tidak ikut dianalisis.
  const daftar = snap.rows
    .filter((r) => (withPhaseOut || !r.isPhaseOut) && (withExcluded || !(excluded.has(r.sku) || r.status === 'EXCLUDED')));

  for (const r of daftar) {
    const sales = byDate.get(r.sku);
    if (!sales?.size) continue; // belum pernah terjual di rentang ini

    const hasil = analyzeSku({
      sku: r.sku,
      byDate: sales,
      firstSalesDate: r.firstSalesDate,
      adsAt: adsFor(r.sku),
      stockAt: (d) => stockBy.get(r.sku)?.get(d) ?? null,
    }, opt);

    const sebagian = hasil.gaps.length > 0;
    for (const g of hasil.gaps) {
      gaps.push({ ...g, name: r.name, outAllShops: !!hasil.sku, outSomeShops: true });
    }
    if (!hasil.sku) continue;

    rows.push({
      ...hasil.sku,
      name: r.name, sapCode: r.sapCode, abcClass: r.abcClass, status2: r.status,
      outAllShops: true, outSomeShops: sebagian,
      // Seluruh episodenya jatuh di jendela yang masih ditarik ulang tiap malam.
      volatile: hasil.sku.episodes.every((e) => e.from > addDays(today, -VOLATILE_DAYS - 1)),
    });
    series[r.sku] = days.map((d) => sales.get(d)?.qty ?? 0);
  }

  rows.sort((a, b) => b.lostLow - a.lostLow || b.outDays - a.outDays);
  gaps.sort((a, b) => b.days - a.days || b.lostQty - a.lostQty);

  // SKU yang laku di rentang tapi tidak ada di Tabel DOI — tidak ikut dianalisis,
  // tapi alasannya dijelaskan supaya tidak terasa ada data yang hilang diam-diam.
  const diLuarTabel = [...byDate.keys()].filter((sku) => !info.has(sku));
  const alasan: Record<string, number> = {};
  for (const sku of diLuarTabel) {
    const a = alasanTidakTerdaftar(sku);
    alasan[a] = (alasan[a] ?? 0) + 1;
  }

  return json(safe({
    ok: true,
    from, to, today, days, dataGaps,
    snapshotDate: snap.snapshotDate,
    stockSince: stockRows.length ? [...new Set(stockRows.map((r) => toDateKeyUtc(r.snapshotDate)))].sort()[0] : null,
    options: { minRunDays, minAds, minSellSharePct: minSellShare * 100, platformMinRunDays, platformMinSharePct: platformMinShare * 100, withPhaseOut, withExcluded, maxDays: MAX_DAYS, volatileDays: VOLATILE_DAYS },
    settings: { areaScope: settings.areaScope, actionBasis: settings.actionBasis, doiDisplay: settings.doiDisplay },
    summary: {
      skuAnalyzed: snap.rows.length,
      skuAffected: rows.length,
      outDays: rows.reduce((a, r) => a + r.outDays, 0),
      episodes: rows.reduce((a, r) => a + r.episodeCount, 0),
      lostLow: rows.reduce((a, r) => a + r.lostLow, 0),
      lostHigh: rows.reduce((a, r) => a + r.lostHigh, 0),
      ongoing: rows.filter((r) => r.ongoing).length,
      confirmed: rows.filter((r) => r.status === 'TERKONFIRMASI').length,
      suspected: rows.filter((r) => r.status === 'DUGAAN').length,
      stockAvailable: rows.filter((r) => r.status === 'STOK_ADA').length,
      campaignDays: rows.reduce((a, r) => a + r.campaignDays, 0),
      platformGaps: gaps.length,
      platformSkus: new Set(gaps.map((g) => g.sku)).size,
      bothProblems: rows.filter((r) => r.outSomeShops).length,
      outsideTable: diLuarTabel.length,
      outsideReasons: alasan,
      baselineFromSales: rows.filter((r) => r.adsSource === 'PENJUALAN').length,
    },
    rows, gaps, series,
    platforms: PLATFORMS,
  }));
}
