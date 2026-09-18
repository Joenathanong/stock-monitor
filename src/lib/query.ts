/**
 * Pembacaan hasil perhitungan untuk UI. Semua halaman membaca doi_snapshot —
 * tidak ada yang menghitung ulang saat dibuka.
 */
import { prisma } from './prisma';
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
  const rows = await prisma.doiSnapshot.findMany({ where: { snapshotDate: summary.snapshotDate }, orderBy: { sku: 'asc' } });
  return {
    snapshotDate: toDateKeyUtc(summary.snapshotDate),
    computedAt: summary.computedAt.toISOString(),
    trigger: summary.trigger,
    summary: normalizeSummary(payload.summary),
    exclusions: payload.exclusions ?? [],
    earliestDataDate: payload.earliestDataDate ?? null,
    settings: payload.settings ?? null,
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
};

/**
 * Snapshot yang dihitung sebelum fitur phase out tidak punya `phaseOut` dan
 * `totalWithPhaseOut` di payload-nya. Tanpa ini halaman akan error sampai
 * pengguna menekan Refresh — jadi nilai lama diisi default yang masuk akal.
 */
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
  const empty = { snapshotDate: null, computedAt: null, trigger: null, summary: null, settings: null, exclusions: [], earliestDataDate: null, po: [], overstock: [], npl: [], phaseOut: [] };
  if (!summary) return empty;

  const payload = JSON.parse(summary.payload) as {
    summary: HealthSummary; exclusions: { date: DateKey; reason: string }[]; earliestDataDate: DateKey | null; settings: DoiSettings;
  };
  const snap = await latestSnapshot();

  const byRefDoi = (a: SnapshotRow, b: SnapshotRow) => (a.refDoi ?? 0) - (b.refDoi ?? 0) || b.sales90 - a.sales90;
  return {
    snapshotDate: toDateKeyUtc(summary.snapshotDate),
    computedAt: summary.computedAt.toISOString(),
    trigger: summary.trigger,
    summary: normalizeSummary(payload.summary),
    settings: payload.settings ?? null,
    exclusions: payload.exclusions ?? [],
    earliestDataDate: payload.earliestDataDate ?? null,
    po: snap.rows.filter((r) => r.status === 'CRITICAL' || r.status === 'LOW').sort(byRefDoi).slice(0, 25),
    overstock: snap.rows.filter((r) => r.status === 'OVERSTOCK').sort((a, b) => b.availableQty - a.availableQty).slice(0, 12),
    npl: snap.rows.filter((r) => r.isNpl).sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0)).slice(0, 10),
    phaseOut: snap.rows.filter((r) => r.status === 'PHASE_OUT').sort((a, b) => (b.phaseOutLateDays ?? 0) - (a.phaseOutLateDays ?? 0) || (b.phaseOutExcessQty ?? 0) - (a.phaseOutExcessQty ?? 0)).slice(0, 10),
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
