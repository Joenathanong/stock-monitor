/**
 * Pembacaan hasil perhitungan untuk UI. Semua halaman membaca doi_snapshot —
 * tidak ada yang menghitung ulang saat dibuka.
 */
import { prisma } from './prisma';
import { sapKey } from './phase-out';
import { keyToUtcDate, toDateKeyUtc, type DateKey } from './dates';
import type { HealthSummary, ProductStatus } from './doi';
import type { DoiSettings } from './settings';
import { AREA_GABUNGAN } from './areas';

/**
 * Area mana yang dibaca kalau pemanggil tidak menyebut.
 *
 * GABUNGAN kalau ada, karena itu angka perusahaan; kalau cuma satu kota
 * (mis. sebelum cabang punya data), kota itu sendiri. Diambil dari snapshot
 * TERBARU, jadi daftar area ikut berubah sendiri saat cabang baru muncul.
 */
export async function areaTersedia(): Promise<{ areas: string[]; bawaan: string | null; snapshotDate: DateKey | null }> {
  const terbaru = await prisma.doiSummary.findFirst({ orderBy: { snapshotDate: 'desc' }, select: { snapshotDate: true } });
  if (!terbaru) return { areas: [], bawaan: null, snapshotDate: null };
  const rows = await prisma.doiSummary.findMany({
    where: { snapshotDate: terbaru.snapshotDate }, select: { areaId: true },
  });
  const areas = rows.map((r) => r.areaId).sort((a, b) =>
    (a === AREA_GABUNGAN ? -1 : b === AREA_GABUNGAN ? 1 : a.localeCompare(b)));
  return { areas, bawaan: areas[0] ?? null, snapshotDate: toDateKeyUtc(terbaru.snapshotDate) };
}

/** Pilih area yang diminta kalau memang ada snapshot-nya; kalau tidak, bawaan. */
async function pilihArea(minta?: string | null): Promise<{ areaId: string | null; areas: string[]; snapshotDate: DateKey | null }> {
  const { areas, bawaan, snapshotDate } = await areaTersedia();
  const areaId = minta && areas.includes(minta) ? minta : bawaan;
  return { areaId, areas, snapshotDate };
}

export type SnapshotRow = {
  sku: string;
  name: string;
  sapCode: string | null;
  availableQty: number;
  qtyOnHand: number;
  qtyOnOrder: number;
  transitQty: number;
  leadTimeDays: number;
  firstSalesDate: DateKey | null;
  ageDays: number | null;
  isNpl: boolean;
  nplNote: string | null;
  sales90: number;
  salesEx: number;
  daysEx: number;
  ads1: number;
  ads8w: number;
  ads4w: number;
  ads2w: number;
  ads2: number;
  ads2Source: string;
  doi1: number | null;
  doi2: number | null;
  doi1Transit: number | null;
  doi2Transit: number | null;
  refDoi: number | null;
  refDoiTransit: number | null;
  status: ProductStatus;
  action: string;
  suggested1: number;
  suggested2: number;
  abcClass: 'A' | 'B' | 'C';
  abcShare: number;
  abcCumShare: number;
  /** Harga satuan saat snapshot (rupiah); 0 = tidak diketahui. */
  unitPrice: number;
  /** Nilai stok = stok × harga satuan. */
  stockValue: number;
  runOutDate: DateKey | null;
  isPhaseOut: boolean;
  /** Keterangan dari tabel phase_out — kode SAP yang dipakai mencocokkan, alasan, catatan. */
  phaseOutSapCode: string | null;
  phaseOutReason: string | null;
  phaseOutNote: string | null;
  phaseOutTargetDate: DateKey | null;
  phaseOutExcessQty: number | null;
  phaseOutLateDays: number | null;
};

export type SnapshotView = {
  snapshotDate: DateKey | null;
  /** Area yang sedang ditampilkan; null bila belum ada snapshot sama sekali. */
  areaId: string | null;
  /** Seluruh area yang punya snapshot pada tanggal itu — untuk pemilih area. */
  areas: string[];
  computedAt: string | null;
  trigger: string | null;
  summary: HealthSummary | null;
  exclusions: { date: DateKey; reason: string }[];
  earliestDataDate: DateKey | null;
  settings: DoiSettings | null;
  rows: SnapshotRow[];
};

/** Snapshot terakhir (hari ini bila ada, kalau tidak yang paling baru). */
export async function latestSnapshot(area?: string | null): Promise<SnapshotView> {
  const { areaId, areas, snapshotDate } = await pilihArea(area);
  const summary = areaId && snapshotDate
    ? await prisma.doiSummary.findFirst({ where: { snapshotDate: keyToUtcDate(snapshotDate), areaId } })
    : null;
  if (!summary) {
    return { snapshotDate: null, computedAt: null, trigger: null, summary: null, exclusions: [], earliestDataDate: null, settings: null, rows: [], areaId, areas };
  }
  const payload = JSON.parse(summary.payload) as {
    summary: HealthSummary; exclusions: { date: DateKey; reason: string }[]; earliestDataDate: DateKey | null; settings: DoiSettings;
  };
  const [rows, poRows] = await Promise.all([
    prisma.doiSnapshot.findMany({ where: { snapshotDate: summary.snapshotDate, areaId: summary.areaId }, orderBy: { sku: 'asc' } }),
    prisma.phaseOut.findMany().catch(() => []),
  ]);
  // Keterangan phase out dicocokkan sama persis seperti saat compute: lewat SKU,
  // atau lewat 6 digit terakhir kode SAP.
  const poBySku = new Map(poRows.filter((p) => p.matchType === 'SKU').map((p) => [p.matchValue, p]));
  const poBySap = new Map(poRows.filter((p) => p.matchType === 'SAP').map((p) => [p.matchValue, p]));
  const poFor = (sku: string, sap: string | null) => poBySku.get(sku) ?? poBySap.get(sapKey(sap) ?? '\u0000') ?? null;
  return {
    snapshotDate: toDateKeyUtc(summary.snapshotDate),
    areaId: summary.areaId,
    areas,
    computedAt: summary.computedAt.toISOString(),
    trigger: summary.trigger,
    summary: normalizeSummary(payload.summary),
    exclusions: payload.exclusions ?? [],
    earliestDataDate: payload.earliestDataDate ?? null,
    settings: await withLiveDisplay(payload.settings ?? null),
    rows: rows.map((r) => ({
      sku: r.sku,
      name: r.name,
      sapCode: r.sapCode,
      availableQty: r.availableQty,
      qtyOnHand: r.qtyOnHand,
      qtyOnOrder: r.qtyOnOrder,
      transitQty: r.transitQty,
      leadTimeDays: r.leadTimeDays,
      firstSalesDate: r.firstSalesDate ? toDateKeyUtc(r.firstSalesDate) : null,
      ageDays: r.ageDays,
      isNpl: r.isNpl,
      nplNote: r.nplNote,
      sales90: r.sales90,
      salesEx: r.salesEx,
      daysEx: r.daysEx,
      ads1: r.ads1,
      ads8w: r.ads8w,
      ads4w: r.ads4w,
      ads2w: r.ads2w,
      ads2: r.ads2,
      ads2Source: r.ads2Source,
      doi1: r.doi1,
      doi2: r.doi2,
      doi1Transit: r.doi1Transit,
      doi2Transit: r.doi2Transit,
      refDoi: r.refDoi,
      refDoiTransit: r.refDoiTransit,
      status: r.status as ProductStatus,
      action: r.action,
      suggested1: r.suggested1,
      suggested2: r.suggested2,
      abcClass: (r.abcClass as 'A' | 'B' | 'C') || 'C',
      abcShare: r.abcShare,
      abcCumShare: r.abcCumShare,
      unitPrice: r.unitPrice ?? 0,
      stockValue: (r.unitPrice ?? 0) * r.availableQty,
      runOutDate: r.runOutDate ? toDateKeyUtc(r.runOutDate) : null,
      isPhaseOut: r.isPhaseOut,
      phaseOutSapCode: poFor(r.sku, r.sapCode)?.sapCode ?? null,
      phaseOutReason: poFor(r.sku, r.sapCode)?.reason ?? null,
      phaseOutNote: poFor(r.sku, r.sapCode)?.note ?? null,
      phaseOutTargetDate: r.phaseOutTargetDate ? toDateKeyUtc(r.phaseOutTargetDate) : null,
      phaseOutExcessQty: r.phaseOutExcessQty,
      phaseOutLateDays: r.phaseOutLateDays,
    })),
  };
}

export type DashboardView = {
  snapshotDate: string | null; computedAt: string | null; trigger: string | null;
  /** Area yang ditampilkan, dan seluruh area yang bisa dipilih. */
  areaId: string | null; areas: string[];
  summary: HealthSummary | null; settings: DoiSettings | null;
  exclusions: { date: DateKey; reason: string }[]; earliestDataDate: DateKey | null;
  po: SnapshotRow[]; overstock: SnapshotRow[]; npl: SnapshotRow[]; phaseOut: SnapshotRow[];
  /**
   * Resume tiap kelompok, dihitung dari SELURUH barisnya — bukan dari 20/25 baris
   * yang dikirim. Tanpa ini angka resume ikut terpotong dan menyesatkan.
   */
  totals: { po: GroupTotals; overstock: GroupTotals; npl: GroupTotals; phaseOut: GroupTotals };
};

export type GroupTotals = {
  count: number; stock: number; transit: number; sales90: number;
  suggested: number; excessQty: number; lateCount: number;
  /** Nilai stok kelompok ini (rupiah) memakai harga saat snapshot. */
  value: number;
};

const groupTotals = (rows: SnapshotRow[]): GroupTotals => ({
  count: rows.length,
  stock: rows.reduce((a, r) => a + r.availableQty, 0),
  transit: rows.reduce((a, r) => a + r.transitQty, 0),
  sales90: rows.reduce((a, r) => a + r.sales90, 0),
  suggested: rows.reduce((a, r) => a + Math.max(r.suggested1, r.suggested2), 0),
  excessQty: rows.reduce((a, r) => a + (r.phaseOutExcessQty ?? 0), 0),
  lateCount: rows.filter((r) => (r.phaseOutLateDays ?? 0) > 0).length,
  value: rows.reduce((a, r) => a + r.stockValue, 0),
});

const NOL: GroupTotals = { count: 0, stock: 0, transit: 0, sales90: 0, suggested: 0, excessQty: 0, lateCount: 0, value: 0 };
/** Panel qty-terbesar mengirim 20 baris; prioritas open PO 25 karena urutannya soal urgensi. */
export const TOP_QTY = 20;
export const TOP_PO = 25;

/**
 * Snapshot yang dihitung sebelum fitur phase out tidak punya `phaseOut` dan
 * `totalWithPhaseOut` di payload-nya. Tanpa ini halaman akan error sampai
 * pengguna menekan Refresh — jadi nilai lama diisi default yang masuk akal.
 */
/**
 * `doi_display` hanya mengatur tampilan, tapi settings di payload snapshot dibekukan
 * saat compute — tanpa ini, mengganti pilihan di Pengaturan tidak berefek apa pun
 * sampai Hitung ulang dijalankan. Nilai lainnya sengaja tetap dari snapshot, karena
 * itulah parameter yang benar-benar dipakai menghitung angkanya.
 */
async function withLiveDisplay(frozen: DoiSettings | null): Promise<DoiSettings | null> {
  if (!frozen) return null;
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: 'doi_display' } });
    const v = (row?.value ?? '').toUpperCase();
    if (v === 'OPSI1' || v === 'OPSI2' || v === 'BOTH') return { ...frozen, doiDisplay: v };
  } catch { /* tampilan bukan hal kritis — pakai nilai snapshot */ }
  return frozen;
}

function normalizeSummary(sum: HealthSummary | null): HealthSummary | null {
  if (!sum) return null;
  const byStatus = { ...sum.byStatus } as HealthSummary['byStatus'];
  if (byStatus.PHASE_OUT === undefined) byStatus.PHASE_OUT = 0;
  // Snapshot lama tidak punya angka nilai — diisi 0 supaya UI tidak error,
  // dan 0 memang jujur: harga saat itu tidak tercatat.
  type Tot = HealthSummary['total'];
  const withValue = (t: Partial<Tot> | undefined | null, fallback: Tot): Tot =>
    ({ ...fallback, ...(t ?? {}), value: t?.value ?? 0, noPrice: t?.noPrice ?? 0 });
  const total = withValue(sum.total, sum.total);
  const kelas = (k: HealthSummary['byAbc']['A']) => ({ ...k, total: withValue(k?.total, total) });
  return {
    ...sum,
    byStatus,
    total,
    totalWithPhaseOut: withValue(sum.totalWithPhaseOut ?? total, total),
    byAbc: { A: kelas(sum.byAbc.A), B: kelas(sum.byAbc.B), C: kelas(sum.byAbc.C) },
    phaseOut: {
      count: sum.phaseOut?.count ?? 0,
      stock: sum.phaseOut?.stock ?? 0,
      value: sum.phaseOut?.value ?? 0,
      excessQty: sum.phaseOut?.excessQty ?? 0,
      lateCount: sum.phaseOut?.lateCount ?? 0,
    },
  };
}

/**
 * Data dashboard saja — ringkasan (sudah tersimpan utuh di doi_summary.payload)
 * plus empat daftar pendek. Jauh lebih ringan daripada mengirim seluruh SKU:
 * ±20 KB, bukan ratusan KB, dan hanya satu query ke doi_snapshot.
 */
export async function dashboardView(area?: string | null): Promise<DashboardView> {
  const { areaId, areas, snapshotDate } = await pilihArea(area);
  const summary = areaId && snapshotDate
    ? await prisma.doiSummary.findFirst({ where: { snapshotDate: keyToUtcDate(snapshotDate), areaId } })
    : null;
  const empty = { snapshotDate: null, areaId, areas, computedAt: null, trigger: null, summary: null, settings: null, exclusions: [], earliestDataDate: null, po: [], overstock: [], npl: [], phaseOut: [], totals: { po: NOL, overstock: NOL, npl: NOL, phaseOut: NOL } };
  if (!summary) return empty;

  const payload = JSON.parse(summary.payload) as {
    summary: HealthSummary; exclusions: { date: DateKey; reason: string }[]; earliestDataDate: DateKey | null; settings: DoiSettings;
  };
  const snap = await latestSnapshot(areaId);

  const byRefDoi = (a: SnapshotRow, b: SnapshotRow) => (a.refDoi ?? 0) - (b.refDoi ?? 0) || b.sales90 - a.sales90;
  // Qty stok terbesar; kalau seri, yang penjualannya lebih besar duluan.
  const byQty = (a: SnapshotRow, b: SnapshotRow) => b.availableQty - a.availableQty || b.sales90 - a.sales90;

  // Dipilah dulu, baru dipotong — supaya dashboard bisa menyebut "25 dari 148"
  // dan tidak terlihat seolah datanya hilang dibanding Tabel DOI.
  const semuaPo = snap.rows.filter((r) => r.status === 'CRITICAL' || r.status === 'LOW');
  const semuaOver = snap.rows.filter((r) => r.status === 'OVERSTOCK');
  const semuaNpl = snap.rows.filter((r) => r.isNpl);
  const semuaPhaseOut = snap.rows.filter((r) => r.status === 'PHASE_OUT');

  return {
    snapshotDate: toDateKeyUtc(summary.snapshotDate),
    areaId: summary.areaId,
    areas,
    computedAt: summary.computedAt.toISOString(),
    trigger: summary.trigger,
    summary: normalizeSummary(payload.summary),
    settings: await withLiveDisplay(payload.settings ?? null),
    exclusions: payload.exclusions ?? [],
    earliestDataDate: payload.earliestDataDate ?? null,
    // Prioritas open PO diurut menurut kegentingan (DOI terkecil), bukan qty —
    // SKU kritis dengan stok kecil justru yang paling perlu dilihat duluan.
    po: [...semuaPo].sort(byRefDoi).slice(0, TOP_PO),
    // Tiga panel berikut: qty stok terbesar, sesuai permintaan PPIC.
    overstock: [...semuaOver].sort(byQty).slice(0, TOP_QTY),
    npl: [...semuaNpl].sort(byQty).slice(0, TOP_QTY),
    phaseOut: [...semuaPhaseOut].sort(byQty).slice(0, TOP_QTY),
    totals: {
      po: groupTotals(semuaPo), overstock: groupTotals(semuaOver),
      npl: groupTotals(semuaNpl), phaseOut: groupTotals(semuaPhaseOut),
    },
  };
}

/** Riwayat DOI satu SKU (untuk tren), terbaru dulu. */
export async function skuHistory(sku: string, days = 60, area?: string | null) {
  const { areaId } = await pilihArea(area);
  const rows = await prisma.doiSnapshot.findMany({
    where: areaId ? { sku, areaId } : { sku },
    orderBy: { snapshotDate: 'desc' },
    take: days,
    select: { snapshotDate: true, availableQty: true, transitQty: true, ads1: true, ads2: true, doi1: true, doi2: true, status: true },
  });
  return rows.map((r) => ({ ...r, snapshotDate: toDateKeyUtc(r.snapshotDate) }));
}

/** Ringkasan harian untuk tren DOI total (terbaru dulu). */
export async function summaryHistory(days = 90, area?: string | null) {
  const { areaId } = await pilihArea(area);
  const rows = await prisma.doiSummary.findMany({
    where: areaId ? { areaId } : undefined, orderBy: { snapshotDate: 'desc' }, take: days,
  });
  return rows.map((r) => {
    const p = JSON.parse(r.payload) as { summary: HealthSummary };
    return {
      date: toDateKeyUtc(r.snapshotDate),
      doi1: p.summary.total.doi1,
      doi2: p.summary.total.doi2,
      stock: p.summary.total.stock,
      critical: p.summary.byStatus.CRITICAL + p.summary.byStatus.LOW,
    };
  });
}

/**
 * Daftar area yang BENAR-BENAR ada datanya, bukan daftar yang dihardcode.
 * Penarikan sekarang mengambil seluruh area dan menyimpannya terpisah per
 * areaId, jadi daftar ini juga berfungsi sebagai bukti bahwa pemisahannya jalan.
 */
export type AreaRow = {
  areaId: string;
  skuCount: number;
  stock: number;
  transit: number;
  sales30: number;
  cancel30: number;
  lastSales: DateKey | null;
};

/**
 * Sampai kapan histori kolom `qtyCancel` bisa dipercaya.
 *
 * Data yang ditarik sebelum 25 Sep 2026 tidak punya angka order batal sama
 * sekali, jadi menyalakan "ikutkan qty order batal" tanpa backfill membuat ADS
 * timpang: hari baru punya angkanya, hari lama nol. Ini yang dipakai halaman
 * Pengaturan untuk memperingatkan.
 */
export type CakupanBatal = { salesMulai: DateKey | null; batalMulai: DateKey | null; hariTanpaBatal: number };

export async function cakupanBatal(): Promise<CakupanBatal> {
  const rows = await prisma.$queryRawUnsafe<{ mulai: Date | null; batal: Date | null }[]>(
    `SELECT MIN(salesDate) AS mulai, MIN(CASE WHEN qtyCancel > 0 THEN salesDate END) AS batal FROM sales_daily`,
  );
  const mulai = rows[0]?.mulai ? toDateKeyUtc(new Date(rows[0].mulai)) : null;
  const batal = rows[0]?.batal ? toDateKeyUtc(new Date(rows[0].batal)) : null;
  let hariTanpaBatal = 0;
  if (mulai && batal) {
    hariTanpaBatal = Math.max(0, Math.round((Date.parse(batal) - Date.parse(mulai)) / 86_400_000));
  } else if (mulai && !batal) {
    hariTanpaBatal = Math.max(0, Math.round((Date.now() - Date.parse(mulai)) / 86_400_000));
  }
  return { salesMulai: mulai, batalMulai: batal, hariTanpaBatal };
}

export async function areaList(days = 30): Promise<AreaRow[]> {
  const [stok, jual] = await Promise.all([
    prisma.$queryRawUnsafe<{ areaId: string; skuCount: bigint; stock: bigint }[]>(
      `SELECT areaId, COUNT(*) AS skuCount, COALESCE(SUM(availableQty),0) AS stock
         FROM stock_current WHERE category = 'Sku' GROUP BY areaId`,
    ),
    prisma.$queryRawUnsafe<{ areaId: string; sales: bigint; cancel: bigint; last: Date | null }[]>(
      `SELECT areaId, COALESCE(SUM(qty),0) AS sales, COALESCE(SUM(qtyCancel),0) AS cancel, MAX(salesDate) AS last
         FROM sales_daily WHERE salesDate >= DATE_SUB(CURDATE(), INTERVAL ? DAY) GROUP BY areaId`,
      days,
    ),
  ]);
  const map = new Map<string, AreaRow>();
  const ambil = (areaId: string) => {
    let r = map.get(areaId);
    if (!r) { r = { areaId, skuCount: 0, stock: 0, transit: 0, sales30: 0, cancel30: 0, lastSales: null }; map.set(areaId, r); }
    return r;
  };
  for (const r of stok) { const a = ambil(r.areaId); a.skuCount = Number(r.skuCount); a.stock = Number(r.stock); }
  for (const r of jual) {
    const a = ambil(r.areaId);
    a.sales30 = Number(r.sales); a.cancel30 = Number(r.cancel);
    a.lastSales = r.last ? toDateKeyUtc(new Date(r.last)) : null;
  }
  return [...map.values()].sort((a, b) => b.stock - a.stock || a.areaId.localeCompare(b.areaId));
}
