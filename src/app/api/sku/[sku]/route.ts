import { prisma } from '@/lib/prisma';
import { getSettings } from '@/lib/compute';
import { addDays, keyToUtcDate, toDateKeyUtc, todayKey, type DateKey } from '@/lib/dates';
import { buildExclusionMap } from '@/lib/exclusion';
import { sapKey } from '@/lib/phase-out';
import { fail, json, safe } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Seluruh riwayat satu SKU untuk halaman analisis: penjualan harian (dengan
 * pecahan platform), stok harian, dan DOI harian — disusun sebagai satu deret
 * tanggal yang rapat supaya grafik tidak bolong di hari tanpa transaksi.
 */
export async function GET(req: Request, ctx: { params: Promise<{ sku: string }> }) {
  const sku = decodeURIComponent((await ctx.params).sku || '').trim();
  if (!sku) return fail('SKU wajib diisi');

  const url = new URL(req.url);
  const days = Math.min(365, Math.max(14, Number(url.searchParams.get('days')) || 90));
  const today = todayKey();
  const from = addDays(today, -days);

  const settings = await getSettings();

  const [snapRow, master, salesRows, stockRows, doiRows, manualEx, poRows] = await Promise.all([
    prisma.doiSnapshot.findFirst({ where: { sku }, orderBy: { snapshotDate: 'desc' } }),
    prisma.skuMaster.findUnique({ where: { sku } }),
    prisma.salesDaily.findMany({
      where: { sku, salesDate: { gte: keyToUtcDate(from), lte: keyToUtcDate(today) } },
      orderBy: { salesDate: 'asc' },
    }),
    prisma.stockDaily.findMany({
      where: { sku, snapshotDate: { gte: keyToUtcDate(from), lte: keyToUtcDate(today) } },
      orderBy: { snapshotDate: 'asc' },
    }),
    prisma.doiSnapshot.findMany({
      where: { sku, snapshotDate: { gte: keyToUtcDate(from) } },
      orderBy: { snapshotDate: 'asc' },
      select: { snapshotDate: true, doi1: true, doi2: true, refDoi: true, ads1: true, ads2: true, availableQty: true, transitQty: true, status: true },
    }),
    prisma.exclusionDate.findMany(),
    prisma.phaseOut.findMany().catch(() => []),
  ]);

  if (!snapRow && !salesRows.length && !stockRows.length) {
    return fail(`SKU "${sku}" tidak ditemukan di snapshot maupun riwayat penjualan`, 404);
  }

  // Tanggal campaign (double date / gajian / manual) — dipakai menandai batang
  // penjualan yang TIDAK ikut dihitung di ADS Opsi 1.
  const exMap = buildExclusionMap(
    from, today,
    { paydayDay: settings.paydayDay, excludeDoubleDates: settings.excludeDoubleDates },
    manualEx.map((m) => ({ date: toDateKeyUtc(m.date), reason: m.reason })),
  );

  const salesBy = new Map(salesRows.map((r) => [toDateKeyUtc(r.salesDate), r]));
  const stockBy = new Map(stockRows.map((r) => [toDateKeyUtc(r.snapshotDate), r]));
  const doiBy = new Map(doiRows.map((r) => [toDateKeyUtc(r.snapshotDate), r]));

  // Deret tanggal rapat dari `from` sampai kemarin (hari ini belum selesai).
  const series: {
    date: DateKey; qty: number | null; shopee: number; tiktok: number; tokped: number; lazada: number; other: number;
    stock: number | null; onHand: number | null; onOrder: number | null;
    doi1: number | null; doi2: number | null; refDoi: number | null;
    excluded: string | null;
  }[] = [];
  for (let d = from; d < today; d = addDays(d, 1)) {
    const s = salesBy.get(d);
    const st = stockBy.get(d);
    const dd = doiBy.get(d);
    series.push({
      date: d,
      qty: s ? s.qty : (stockBy.size || salesBy.size ? 0 : null),
      shopee: s?.qtyShopee ?? 0, tiktok: s?.qtyTiktok ?? 0, tokped: s?.qtyTokped ?? 0,
      lazada: s?.qtyLazada ?? 0, other: s?.qtyOther ?? 0,
      stock: st ? st.availableQty : null,
      onHand: st ? st.qtyOnHand : null,
      onOrder: st ? st.qtyOnOrder : null,
      doi1: dd?.doi1 ?? null, doi2: dd?.doi2 ?? null, refDoi: dd?.refDoi ?? null,
      excluded: exMap.get(d) ?? null,
    });
  }

  const totals = salesRows.reduce(
    (a, r) => ({
      qty: a.qty + r.qty, shopee: a.shopee + r.qtyShopee, tiktok: a.tiktok + r.qtyTiktok,
      tokped: a.tokped + r.qtyTokped, lazada: a.lazada + r.qtyLazada, other: a.other + r.qtyOther,
    }),
    { qty: 0, shopee: 0, tiktok: 0, tokped: 0, lazada: 0, other: 0 },
  );

  const po = poRows.find((p) => p.matchType === 'SKU' ? p.matchValue === sku
    : p.matchValue === sapKey(snapRow?.sapCode ?? null)) ?? null;

  const stockDates = stockRows.map((r) => toDateKeyUtc(r.snapshotDate));

  return json(safe({
    ok: true,
    sku,
    today,
    days,
    name: snapRow?.name ?? null,
    sapCode: snapRow?.sapCode ?? null,
    master: master ? { leadTimeDays: master.leadTimeDays, isExcluded: master.isExcluded, note: master.note } : null,
    phaseOut: po ? { sapCode: po.sapCode, reason: po.reason, note: po.note, targetOutDate: po.targetOutDate ? toDateKeyUtc(po.targetOutDate) : null } : null,
    settings: {
      targetDoiDays: settings.targetDoiDays, safetyDays: settings.safetyDays,
      defaultLeadTimeDays: settings.defaultLeadTimeDays, doiDisplay: settings.doiDisplay,
      opsi1WindowDays: settings.opsi1WindowDays,
    },
    snapshot: snapRow ? {
      snapshotDate: toDateKeyUtc(snapRow.snapshotDate),
      availableQty: snapRow.availableQty, qtyOnHand: snapRow.qtyOnHand, qtyOnOrder: snapRow.qtyOnOrder,
      transitQty: snapRow.transitQty, leadTimeDays: snapRow.leadTimeDays,
      ads1: snapRow.ads1, ads2: snapRow.ads2, ads2Source: snapRow.ads2Source,
      ads8w: snapRow.ads8w, ads4w: snapRow.ads4w, ads2w: snapRow.ads2w,
      doi1: snapRow.doi1, doi2: snapRow.doi2, doi1Transit: snapRow.doi1Transit, doi2Transit: snapRow.doi2Transit,
      refDoi: snapRow.refDoi, status: snapRow.status, action: snapRow.action,
      suggested1: snapRow.suggested1, suggested2: snapRow.suggested2,
      abcClass: snapRow.abcClass, abcShare: snapRow.abcShare,
      sales90: snapRow.sales90, salesEx: snapRow.salesEx, daysEx: snapRow.daysEx,
      firstSalesDate: snapRow.firstSalesDate ? toDateKeyUtc(snapRow.firstSalesDate) : null,
      ageDays: snapRow.ageDays, isNpl: snapRow.isNpl, nplNote: snapRow.nplNote,
      runOutDate: snapRow.runOutDate ? toDateKeyUtc(snapRow.runOutDate) : null,
      isPhaseOut: snapRow.isPhaseOut,
    } : null,
    totals,
    // Stok baru terekam sejak aplikasi pertama kali menghitung — OCS hanya
    // memberi stok saat ini, tidak ada riwayatnya.
    stockSince: stockDates.length ? stockDates[0] : null,
    stockDays: stockDates.length,
    series,
  }));
}
