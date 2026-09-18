/**
 * Perhitungan DOI: baca stok + penjualan dari database, jalankan mesin, simpan
 * hasilnya ke doi_snapshot (per SKU) dan doi_summary (KPI). Dijalankan oleh cron
 * 07.30 WIB dan tombol Refresh — bukan tiap kali halaman dibuka.
 */
import { prisma } from './prisma';
import { DEFAULT_SETTINGS, longestWindow, toDoiSettings, type DoiSettings, type SettingsMap } from './settings';
import { assignAbc, computeSku, summarize, type DoiResult, type HealthSummary } from './doi';
import { buildExclusionMap } from './exclusion';
import { addDays, keyToUtcDate, todayKey, toDateKeyUtc, type DateKey } from './dates';
import { acquireLock, finishLog, lockOwner, releaseLock, startLog, syncStock } from './sync';

export async function getSettingsMap(): Promise<SettingsMap> {
  const rows = await prisma.appSetting.findMany();
  const map: SettingsMap = {};
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) map[k] = String(v);
  for (const r of rows) map[r.key] = r.value;
  return map;
}

export async function getSettings(): Promise<DoiSettings> {
  return toDoiSettings(await getSettingsMap());
}

type StockRow = {
  sku: string; name: string; sapCode: string | null;
  availableQty: number; qtyOnHand: number; qtyOnOrder: number;
};

/** Stok per SKU untuk area yang dihitung. Hanya Category = Sku. */
async function loadStock(s: DoiSettings): Promise<StockRow[]> {
  const areaClause = s.areaScope === 'All' ? '' : 'AND areaId = ?';
  const activeClause = s.includeInactive ? '' : 'AND isActive = 1';
  const clearanceClause = s.includeClearance ? '' : "AND sku NOT LIKE 'CS-%'";
  const params: unknown[] = s.areaScope === 'All' ? [] : [s.areaScope];
  return prisma.$queryRawUnsafe<StockRow[]>(
    `SELECT sku, MAX(name) AS name, MAX(sapCode) AS sapCode,
            SUM(availableQty) AS availableQty, SUM(qtyOnHand) AS qtyOnHand, SUM(qtyOnOrder) AS qtyOnOrder
       FROM stock_current
      WHERE category = 'Sku' ${areaClause} ${activeClause} ${clearanceClause}
      GROUP BY sku`,
    ...params,
  );
}

/**
 * Penjualan harian di dalam jendela terpanjang. Dengan satu area, volumenya
 * ≈ 300 SKU × 90 hari ≈ 30 ribu baris — ringan, dan membuat mesin tetap fungsi
 * murni yang bisa diuji.
 */
async function loadSales(s: DoiSettings, today: DateKey, windowDays: number) {
  const areaClause = s.areaScope === 'All' ? '' : 'AND areaId = ?';
  const params: unknown[] = s.areaScope === 'All' ? [] : [s.areaScope];
  const start = keyToUtcDate(addDays(today, -windowDays));
  const end = keyToUtcDate(addDays(today, -1));
  const rows = await prisma.$queryRawUnsafe<{ sku: string; d: Date; qty: number }[]>(
    `SELECT sku, salesDate AS d, SUM(qty) AS qty
       FROM sales_daily
      WHERE salesDate BETWEEN ? AND ? ${areaClause}
      GROUP BY sku, salesDate`,
    start, end, ...params,
  );
  const map = new Map<string, Record<DateKey, number>>();
  for (const r of rows) {
    const key = toDateKeyUtc(new Date(r.d));
    let m = map.get(r.sku);
    if (!m) { m = {}; map.set(r.sku, m); }
    m[key] = (m[key] ?? 0) + Number(r.qty);
  }

  const firstRows = await prisma.$queryRawUnsafe<{ sku: string; firstDate: Date }[]>(
    `SELECT sku, MIN(salesDate) AS firstDate FROM sales_daily WHERE qty > 0 ${areaClause} GROUP BY sku`,
    ...params,
  );
  const first = new Map(firstRows.map((r) => [r.sku, toDateKeyUtc(new Date(r.firstDate))]));

  const earliest = await prisma.$queryRawUnsafe<{ d: Date | null }[]>(
    `SELECT MIN(salesDate) AS d FROM sales_daily WHERE qty > 0 ${areaClause}`, ...params,
  );
  const earliestDataDate = earliest[0]?.d ? toDateKeyUtc(new Date(earliest[0].d)) : null;

  return { salesBySku: map, firstBySku: first, earliestDataDate };
}

/** Tanggal ketika stok SKU tercatat ≤ 0 di dalam jendela (hanya bila fitur diaktifkan). */
async function loadStockouts(s: DoiSettings, today: DateKey, windowDays: number): Promise<Map<string, Set<DateKey>>> {
  const out = new Map<string, Set<DateKey>>();
  if (!s.excludeStockoutDays) return out;
  const areaClause = s.areaScope === 'All' ? '' : 'AND areaId = ?';
  const params: unknown[] = s.areaScope === 'All' ? [] : [s.areaScope];
  const rows = await prisma.$queryRawUnsafe<{ sku: string; d: Date }[]>(
    `SELECT sku, snapshotDate AS d FROM stock_daily
      WHERE snapshotDate BETWEEN ? AND ? AND availableQty <= 0 ${areaClause}`,
    keyToUtcDate(addDays(today, -windowDays)), keyToUtcDate(addDays(today, -1)), ...params,
  );
  for (const r of rows) {
    let set = out.get(r.sku);
    if (!set) { set = new Set(); out.set(r.sku, set); }
    set.add(toDateKeyUtc(new Date(r.d)));
  }
  return out;
}

export type ComputeOutput = {
  today: DateKey;
  settings: DoiSettings;
  rows: DoiResult[];
  summary: HealthSummary;
  exclusions: { date: DateKey; reason: string }[];
  earliestDataDate: DateKey | null;
};

/** Hitung seluruh SKU sekali (tanpa menyimpan). */
export async function computeAll(now = new Date()): Promise<ComputeOutput> {
  const today = todayKey(now);
  const settings = await getSettings();
  const windowDays = longestWindow(settings);

  const [stock, sales, stockouts, transitRows, masterRows, manualEx, phaseOutRows] = await Promise.all([
    loadStock(settings),
    loadSales(settings, today, windowDays),
    loadStockouts(settings, today, windowDays),
    prisma.transitStock.findMany(),
    prisma.skuMaster.findMany(),
    prisma.exclusionDate.findMany(),
    prisma.phaseOut.findMany(),
  ]);

  const exclusionMap = buildExclusionMap(
    addDays(today, -windowDays), addDays(today, -1),
    { paydayDay: settings.paydayDay, excludeDoubleDates: settings.excludeDoubleDates },
    manualEx.map((m) => ({ date: toDateKeyUtc(m.date), reason: m.reason })),
  );
  const ctx = { today, exclusionDates: new Set(exclusionMap.keys()), earliestDataDate: sales.earliestDataDate };

  const transit = new Map(transitRows.map((r) => [r.sku, r.qty]));
  const master = new Map(masterRows.map((r) => [r.sku, r]));
  const phaseOut = new Map(phaseOutRows.map((r) => [r.sku, {
    effectiveDate: toDateKeyUtc(r.effectiveDate),
    targetOutDate: r.targetOutDate ? toDateKeyUtc(r.targetOutDate) : null,
    replacementSku: r.replacementSku,
    disposition: r.disposition,
  }]));

  const rows = stock.map((st) => {
    const m = master.get(st.sku);
    return computeSku(
      {
        sku: st.sku,
        name: st.name,
        sapCode: st.sapCode,
        availableQty: Number(st.availableQty) || 0,
        qtyOnHand: Number(st.qtyOnHand) || 0,
        qtyOnOrder: Number(st.qtyOnOrder) || 0,
        transitQty: transit.get(st.sku) ?? 0,
        leadTimeDays: m?.leadTimeDays ?? null,
        isExcluded: m?.isExcluded ?? false,
        phaseOut: phaseOut.get(st.sku) ?? null,
        salesByDate: sales.salesBySku.get(st.sku) ?? {},
        firstSalesDate: sales.firstBySku.get(st.sku) ?? null,
        stockoutDates: stockouts.get(st.sku),
      },
      settings,
      ctx,
    );
  });
  assignAbc(rows, settings.abcAPct, settings.abcBPct);

  return {
    today,
    settings,
    rows,
    summary: summarize(rows, settings.excludePhaseOut),
    exclusions: [...exclusionMap.entries()].map(([date, reason]) => ({ date, reason })).sort((a, b) => a.date.localeCompare(b.date)),
    earliestDataDate: sales.earliestDataDate,
  };
}

const BATCH = 200;

/** Simpan hasil ke doi_snapshot + doi_summary. Baris hari yang sama ditimpa. */
export async function persistSnapshot(out: ComputeOutput, trigger: string) {
  const date = keyToUtcDate(out.today);
  const now = new Date();
  const cols =
    '(snapshotDate, sku, name, sapCode, availableQty, qtyOnHand, qtyOnOrder, transitQty, leadTimeDays, firstSalesDate, ageDays, isNpl, nplNote, ' +
    'sales90, salesEx, daysEx, ads1, ads8w, ads4w, ads2w, ads2, ads2Source, doi1, doi2, doi1Transit, doi2Transit, refDoi, refDoiTransit, status, action, ' +
    'suggested1, suggested2, abcClass, abcShare, abcCumShare, runOutDate, isPhaseOut, phaseOutTargetDate, phaseOutExcessQty, phaseOutLateDays, computedAt)';
  const n = 41;
  const update = [
    'name', 'sapCode', 'availableQty', 'qtyOnHand', 'qtyOnOrder', 'transitQty', 'leadTimeDays', 'firstSalesDate', 'ageDays', 'isNpl', 'nplNote',
    'sales90', 'salesEx', 'daysEx', 'ads1', 'ads8w', 'ads4w', 'ads2w', 'ads2', 'ads2Source', 'doi1', 'doi2', 'doi1Transit', 'doi2Transit', 'refDoi', 'refDoiTransit',
    'status', 'action', 'suggested1', 'suggested2', 'abcClass', 'abcShare', 'abcCumShare', 'runOutDate',
    'isPhaseOut', 'phaseOutTargetDate', 'phaseOutExcessQty', 'phaseOutLateDays', 'computedAt',
  ].map((c) => `${c}=VALUES(${c})`).join(', ');

  for (let i = 0; i < out.rows.length; i += BATCH) {
    const chunk = out.rows.slice(i, i + BATCH);
    const placeholders = chunk.map(() => `(${Array(n).fill('?').join(',')})`).join(',');
    const params = chunk.flatMap((r) => [
      date, r.sku, r.name.slice(0, 500), r.sapCode, r.availableQty, r.qtyOnHand, r.qtyOnOrder, r.transitQty, r.leadTimeDays,
      r.firstSalesDate ? keyToUtcDate(r.firstSalesDate) : null, r.ageDays, r.isNpl ? 1 : 0, r.nplNote,
      r.sales90, r.w1.sum, r.w1.days, r.ads1, r.w8.ads, r.w4.ads, r.w2.ads, r.ads2, r.ads2Source,
      r.doi1, r.doi2, r.doi1Transit, r.doi2Transit, r.refDoi, r.refDoiTransit, r.status, r.action.slice(0, 60),
      r.suggested1, r.suggested2, r.abcClass, r.abcShare, r.abcCumShare,
      r.runOutDate ? keyToUtcDate(r.runOutDate) : null,
      r.isPhaseOut ? 1 : 0, r.phaseOutTargetDate ? keyToUtcDate(r.phaseOutTargetDate) : null, r.phaseOutExcessQty, r.phaseOutLateDays, now,
    ]);
    await prisma.$executeRawUnsafe(
      `INSERT INTO doi_snapshot ${cols} VALUES ${placeholders} ON DUPLICATE KEY UPDATE ${update}`,
      ...params,
    );
  }
  // SKU yang hilang dari stok hari ini (tidak ditulis barusan) dibuang dari snapshot hari ini.
  await prisma.$executeRawUnsafe(`DELETE FROM doi_snapshot WHERE snapshotDate = ? AND computedAt < ?`, date, now);

  const payload = JSON.stringify({
    summary: out.summary,
    exclusions: out.exclusions,
    earliestDataDate: out.earliestDataDate,
    settings: out.settings,
    rowCount: out.rows.length,
  });
  await prisma.doiSummary.upsert({
    where: { snapshotDate: date },
    create: { snapshotDate: date, trigger, payload, computedAt: now },
    update: { trigger, payload, computedAt: now },
  });
}

export type RunResult = {
  ok: boolean;
  skipped?: boolean;
  message?: string;
  today?: DateKey;
  skuCount?: number;
  stockRows?: number;
  durationMs: number;
};

/**
 * Alur lengkap: tarik stok dari OCS → hitung → simpan. Dipakai cron 07.30 dan
 * tombol Refresh. `withStockSync=false` menghitung ulang dari stok yang sudah ada
 * (mis. setelah unggah transit atau ubah pengaturan) tanpa memanggil OCS.
 */
export async function runCompute(trigger: string, withStockSync = true): Promise<RunResult> {
  const t0 = Date.now();
  const owner = lockOwner();
  if (!(await acquireLock('compute', owner, 10))) {
    return { ok: true, skipped: true, message: 'Perhitungan lain sedang berjalan', durationMs: 0 };
  }
  const log = await startLog('COMPUTE', trigger);
  try {
    let stockRows: number | undefined;
    if (withStockSync) {
      const settings = await getSettings();
      const st = await syncStock(trigger, settings.areaScope);
      stockRows = st.rows;
    }
    const out = await computeAll();
    await persistSnapshot(out, trigger);
    await finishLog(log.id, 'ok', out.rows.length, withStockSync ? `stok ${stockRows} baris` : 'tanpa tarik stok');
    return { ok: true, today: out.today, skuCount: out.rows.length, stockRows, durationMs: Date.now() - t0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishLog(log.id, 'error', 0, message);
    throw err;
  } finally {
    await releaseLock('compute', owner);
  }
}
