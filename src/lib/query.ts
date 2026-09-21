/**
 * Pembacaan hasil perhitungan untuk UI. Semua halaman membaca doi_snapshot —
 * tidak ada yang menghitung ulang saat dibuka.
 */
import { prisma } from './prisma';
import { sapKey } from './phase-out';
import { toDateKeyUtc, type DateKey } from './dates';
import type { HealthSummary, ProductStatus } from './doi';
import type { DoiSettings } from './settings';

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
  computedAt: string | null;
  trigger: string | null;
  summary: HealthSummary | null;
  exclusions: { date: DateKey; reason: string }[];
  earliestDataDate: DateKey | null;
  settings: DoiSettings | null;
  rows: SnapshotRow[];
};

/** Snapshot terakhir (hari ini bila ada, kalau tidak yang paling baru). */
export async function latestSnapshot(): Promise<SnapshotView> {
  const summary = await prisma.doiSummary.findFirst({ orderBy: { snapshotDate: 'desc' } });
  if (!summary) {
    return { snapshotDate: null, computedAt: null, trigger: null, summary: null, exclusions: [], earliestDataDate: null, settings: null, rows: [] };
  }
  const payload = JSON.parse(summary.payload) as {
    summary: HealthSummary; exclusions: { date: DateKey; reason: string }[]; earliestDataDate: DateKey | null; settings: DoiSettings;
  };
  const [rows, poRows] = await Promise.all([
    prisma.doiSnapshot.findMany({ where: { snapshotDate: summary.snapshotDate }, orderBy: { sku: 'asc' } }),
    prisma.phaseOut.findMany().catch(() => []),
  ]);
  // Keterangan phase out dicocokkan sama persis seperti saat compute: lewat SKU,
  // atau lewat 6 digit terakhir kode SAP.
  const poBySku = new Map(poRows.filter((p) => p.matchType === 'SKU').map((p) => [p.matchValue, p]));
  const poBySap = new Map(poRows.filter((p) => p.matchType === 'SAP').map((p) => [p.matchValue, p]));
  const poFor = (sku: string, sap: string | null) => poBySku.get(sku) ?? poBySap.get(sapKey(sap) ?? '\u0000') ?? null;
  return {
    snapshotDate: toDateKeyUtc(summary.snapshotDate),
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
};

const groupTotals = (rows: SnapshotRow[]): GroupTotals => ({
  count: rows.length,
  stock: rows.reduce((a, r) => a + r.availableQty, 0),
  transit: rows.reduce((a, r) => a + r.transitQty, 0),
  sales90: rows.reduce((a, r) => a + r.sales90, 0),
  suggested: rows.reduce((a, r) => a + Math.max(r.suggested1, r.suggested2), 0),
  excessQty: rows.reduce((a, r) => a + (r.phaseOutExcessQty ?? 0), 0),
  lateCount: rows.filter((r) => (r.phaseOutLateDays ?? 0) > 0).length,
});

const NOL: GroupTotals = { count: 0, stock: 0, transit: 0, sales90: 0, suggested: 0, excessQty: 0, lateCount: 0 };
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
  return {
    ...sum,
    byStatus,
    totalWithPhaseOut: sum.totalWithPhaseOut ?? sum.total,
    phaseOut: sum.phaseOut ?? { count: 0, stock: 0, excessQty: 0, lateCount: 0 },
  };
}

/**
 * Data dashboard saja — ringkasan (sudah tersimpan utuh di doi_summary.payload)
 * plus empat daftar pendek. Jauh lebih ringan daripada mengirim seluruh SKU:
 * ±20 KB, bukan ratusan KB, dan hanya satu query ke doi_snapshot.
 */
export async function dashboardView(): Promise<DashboardView> {
  const summary = await prisma.doiSummary.findFirst({ orderBy: { snapshotDate: 'desc' } });
  const empty = { snapshotDate: null, computedAt: null, trigger: null, summary: null, settings: null, exclusions: [], earliestDataDate: null, po: [], overstock: [], npl: [], phaseOut: [], totals: { po: NOL, overstock: NOL, npl: NOL, phaseOut: NOL } };
  if (!summary) return empty;

  const payload = JSON.parse(summary.payload) as {
    summary: HealthSummary; exclusions: { date: DateKey; reason: string }[]; earliestDataDate: DateKey | null; settings: DoiSettings;
  };
  const snap = await latestSnapshot();

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
export async function skuHistory(sku: string, days = 60) {
  const rows = await prisma.doiSnapshot.findMany({
    where: { sku },
    orderBy: { snapshotDate: 'desc' },
    take: days,
    select: { snapshotDate: true, availableQty: true, transitQty: true, ads1: true, ads2: true, doi1: true, doi2: true, status: true },
  });
  return rows.map((r) => ({ ...r, snapshotDate: toDateKeyUtc(r.snapshotDate) }));
}

/** Ringkasan harian untuk tren DOI total (terbaru dulu). */
export async function summaryHistory(days = 90) {
  const rows = await prisma.doiSummary.findMany({ orderBy: { snapshotDate: 'desc' }, take: days });
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
