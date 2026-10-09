/**
 * Perhitungan DOI: baca stok + penjualan dari database, jalankan mesin, simpan
 * hasilnya ke doi_snapshot (per SKU) dan doi_summary (KPI). Dijalankan oleh cron
 * 07.30 WIB dan tombol Refresh — bukan tiap kali halaman dibuka.
 */
import { prisma } from './prisma';
import { DEFAULT_SETTINGS, longestWindow, toDoiSettings, type DoiSettings, type SettingsMap } from './settings';
import { assignAbc, computeSku, summarize, type DoiResult, type HealthSummary } from './doi';
import { pencocokPhaseOut } from './phase-out';
import { buildExclusionMap } from './exclusion';
import { AREA_GABUNGAN, labelArea } from './areas';
import { ambangDoi } from './area-master';
import { muatArea } from './area-store';
import { addDays, keyToUtcDate, todayKey, toDateKeyUtc, type DateKey } from './dates';
import { acquireLock, finishLog, lockOwner, releaseLock, startLog, syncPrices, syncStock, syncTransit, STALE_LOCK_MINUTES } from './sync';
import { budget, defaultBudgetMs, Timeline } from './budget';

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
async function loadStock(s: DoiSettings, area: string): Promise<StockRow[]> {
  const areaClause = area === AREA_GABUNGAN ? '' : 'AND areaId = ?';
  const activeClause = s.includeInactive ? '' : 'AND isActive = 1';
  const clearanceClause = s.includeClearance ? '' : "AND sku NOT LIKE 'CS-%'";
  const params: unknown[] = area === AREA_GABUNGAN ? [] : [area];
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
async function loadSales(s: DoiSettings, area: string, today: DateKey, windowDays: number) {
  const areaClause = area === AREA_GABUNGAN ? '' : 'AND areaId = ?';
  const params: unknown[] = area === AREA_GABUNGAN ? [] : [area];
  const start = keyToUtcDate(addDays(today, -windowDays));
  const end = keyToUtcDate(addDays(today, -1));
  // Order batal/belum bayar tidak memakan stok, jadi bawaannya TIDAK ikut ADS.
  // Kolomnya tetap ada dan bisa dinyalakan dari Pengaturan untuk membandingkan.
  const kolomQty = s.salesIncludeCancel ? 'SUM(qty + qtyCancel)' : 'SUM(qty)';
  const rows = await prisma.$queryRawUnsafe<{ sku: string; d: Date; qty: number }[]>(
    `SELECT sku, salesDate AS d, ${kolomQty} AS qty
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
async function loadStockouts(s: DoiSettings, area: string, today: DateKey, windowDays: number): Promise<Map<string, Set<DateKey>>> {
  const out = new Map<string, Set<DateKey>>();
  if (!s.excludeStockoutDays) return out;
  const areaClause = area === AREA_GABUNGAN ? '' : 'AND areaId = ?';
  const params: unknown[] = area === AREA_GABUNGAN ? [] : [area];
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
  areaId: string;
  settings: DoiSettings;
  rows: DoiResult[];
  summary: HealthSummary;
  exclusions: { date: DateKey; reason: string }[];
  earliestDataDate: DateKey | null;
};

/**
 * Hitung seluruh SKU untuk SATU area (tanpa menyimpan).
 *
 * `AREA_GABUNGAN` menjumlahkan semua kota: stok dikelompokkan per SKU lintas
 * area, penjualan dan transit ikut dijumlahkan. Itu angka perusahaan, dan
 * sengaja dihitung terpisah — bukan dijumlahkan dari hasil per kota, karena
 * DOI adalah pembagian: Σ(stok)/Σ(ADS) tidak sama dengan Σ(stok/ADS).
 */
export async function computeAll(area: string, now = new Date()): Promise<ComputeOutput> {
  const today = todayKey(now);
  const settings = await getSettings();
  const windowDays = longestWindow(settings);

  const [stock, sales, stockouts, transitRows, masterRows, manualEx, phaseOutRows, priceRows] = await Promise.all([
    loadStock(settings, area),
    loadSales(settings, area, today, windowDays),
    loadStockouts(settings, area, today, windowDays),
    area === AREA_GABUNGAN
      ? prisma.transitStock.findMany()
      : prisma.transitStock.findMany({ where: { areaId: area } }),
    prisma.skuMaster.findMany(),
    prisma.exclusionDate.findMany(),
    prisma.phaseOut.findMany(),
    settings.priceEnabled ? prisma.productPrice.findMany({ select: { sku: true, price: true } }) : Promise.resolve([]),
  ]);

  const exclusionMap = buildExclusionMap(
    addDays(today, -windowDays), addDays(today, -1),
    { paydayDay: settings.paydayDay, excludeDoubleDates: settings.excludeDoubleDates },
    manualEx.map((m) => ({ date: toDateKeyUtc(m.date), reason: m.reason })),
  );
  // Ambang DOI area ini. Dicocokkan lewat NAMA, karena `area` di sini adalah
  // nama yang dipakai stock_current/sales_daily, bukan kode gudang.
  //
  // GABUNGAN sengaja TIDAK memakai ambang area mana pun: pitanya berbeda jauh
  // antar kota (Pusat 4/5/7 vs Makassar 14/31/45), jadi memakai salah satunya
  // untuk angka gabungan akan salah untuk semua yang lain. Gabungan jatuh ke
  // pengaturan global, dan itu harus terbaca jelas di layar gabungan.
  let ambang = null as ReturnType<typeof ambangDoi> | null;
  if (area !== AREA_GABUNGAN) {
    const baris = (await muatArea()).find((a) => a.name === area) ?? null;
    // Hanya dipakai kalau area ini BENAR-BENAR punya ambang sendiri. Kalau
    // belum diisi, ctx.ambang tetap null supaya perilaku lama (relatif terhadap
    // lead time) dipertahankan apa adanya.
    if (baris && (baris.doiCritical !== null || baris.doiMin !== null || baris.doiMax !== null)) {
      ambang = ambangDoi(baris, {
        kritis: settings.defaultLeadTimeDays,
        min: settings.defaultLeadTimeDays + settings.safetyDays,
        max: settings.targetDoiDays,
      });
    }
  }
  const ctx = {
    today,
    exclusionDates: new Set(exclusionMap.keys()),
    earliestDataDate: sales.earliestDataDate,
    ambang,
  };

  // Satu SKU bisa punya beberapa baris transit (OCS + manual, atau beberapa
  // gudang saat GABUNGAN) — dijumlahkan, bukan yang terakhir menang.
  const transit = new Map<string, number>();
  for (const r of transitRows) transit.set(r.sku, (transit.get(r.sku) ?? 0) + r.qty);
  const harga = new Map(priceRows.map((r) => [r.sku, r.price]));
  const master = new Map(masterRows.map((r) => [r.sku, r]));
  // Dua jalur pencocokan: lewat SKU langsung, atau lewat 6 digit terakhir kode SAP.
  const toEntry = (r: (typeof phaseOutRows)[number]) => ({
    effectiveDate: r.effectiveDate ? toDateKeyUtc(r.effectiveDate) : null,
    targetOutDate: r.targetOutDate ? toDateKeyUtc(r.targetOutDate) : null,
    replacementSku: r.replacementSku,
    disposition: r.disposition,
  });
  // Aturannya di `phase-out.ts`, bukan di sini — halaman ATP memakai yang sama.
  // Disalin = dua tempat yang bisa berbeda diam-diam, dan gejalanya cuma
  // "kenapa SKU ini phase out di satu layar tapi tidak di layar lain".
  const cocokPo = pencocokPhaseOut(phaseOutRows, toEntry);

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
        phaseOut: cocokPo(st.sku, st.sapCode),
        salesByDate: sales.salesBySku.get(st.sku) ?? {},
        firstSalesDate: sales.firstBySku.get(st.sku) ?? null,
        stockoutDates: stockouts.get(st.sku),
        unitPrice: harga.get(st.sku) ?? 0,
      },
      settings,
      ctx,
    );
  });
  assignAbc(rows, settings.abcAPct, settings.abcBPct);

  return {
    today,
    areaId: area,
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
    '(snapshotDate, areaId, sku, name, sapCode, availableQty, qtyOnHand, qtyOnOrder, transitQty, leadTimeDays, firstSalesDate, ageDays, isNpl, nplNote, ' +
    'sales90, salesEx, daysEx, ads1, ads8w, ads4w, ads2w, ads2, ads2Source, doi1, doi2, doi1Transit, doi2Transit, refDoi, refDoiTransit, status, action, ' +
    'suggested1, suggested2, abcClass, abcShare, abcCumShare, runOutDate, isPhaseOut, phaseOutTargetDate, phaseOutExcessQty, phaseOutLateDays, unitPrice, computedAt)';
  const n = 43;
  const update = [
    'name', 'sapCode', 'availableQty', 'qtyOnHand', 'qtyOnOrder', 'transitQty', 'leadTimeDays', 'firstSalesDate', 'ageDays', 'isNpl', 'nplNote',
    'sales90', 'salesEx', 'daysEx', 'ads1', 'ads8w', 'ads4w', 'ads2w', 'ads2', 'ads2Source', 'doi1', 'doi2', 'doi1Transit', 'doi2Transit', 'refDoi', 'refDoiTransit',
    'status', 'action', 'suggested1', 'suggested2', 'abcClass', 'abcShare', 'abcCumShare', 'runOutDate',
    'isPhaseOut', 'phaseOutTargetDate', 'phaseOutExcessQty', 'phaseOutLateDays', 'unitPrice', 'computedAt',
  ].map((c) => `${c}=VALUES(${c})`).join(', ');

  for (let i = 0; i < out.rows.length; i += BATCH) {
    const chunk = out.rows.slice(i, i + BATCH);
    const placeholders = chunk.map(() => `(${Array(n).fill('?').join(',')})`).join(',');
    const params = chunk.flatMap((r) => [
      date, out.areaId, r.sku, r.name.slice(0, 500), r.sapCode, r.availableQty, r.qtyOnHand, r.qtyOnOrder, r.transitQty, r.leadTimeDays,
      r.firstSalesDate ? keyToUtcDate(r.firstSalesDate) : null, r.ageDays, r.isNpl ? 1 : 0, r.nplNote,
      r.sales90, r.w1.sum, r.w1.days, r.ads1, r.w8.ads, r.w4.ads, r.w2.ads, r.ads2, r.ads2Source,
      r.doi1, r.doi2, r.doi1Transit, r.doi2Transit, r.refDoi, r.refDoiTransit, r.status, r.action.slice(0, 60),
      r.suggested1, r.suggested2, r.abcClass, r.abcShare, r.abcCumShare,
      r.runOutDate ? keyToUtcDate(r.runOutDate) : null,
      r.isPhaseOut ? 1 : 0, r.phaseOutTargetDate ? keyToUtcDate(r.phaseOutTargetDate) : null, r.phaseOutExcessQty, r.phaseOutLateDays, r.unitPrice, now,
    ]);
    await prisma.$executeRawUnsafe(
      `INSERT INTO doi_snapshot ${cols} VALUES ${placeholders} ON DUPLICATE KEY UPDATE ${update}`,
      ...params,
    );
  }
  // SKU yang hilang dari stok hari ini (tidak ditulis barusan) dibuang dari snapshot hari ini.
  // Hanya area INI yang dibersihkan — tanpa saringan areaId, menghitung
  // Surabaya akan menghapus snapshot Pusat yang baru saja ditulis.
  await prisma.$executeRawUnsafe(
    'DELETE FROM doi_snapshot WHERE snapshotDate = ? AND areaId = ? AND computedAt < ?',
    date, out.areaId, now,
  );

  const payload = JSON.stringify({
    areaId: out.areaId,
    summary: out.summary,
    exclusions: out.exclusions,
    earliestDataDate: out.earliestDataDate,
    settings: out.settings,
    rowCount: out.rows.length,
  });
  // `trigger` adalah KATA CADANGAN di MySQL 8 / TiDB (dipakai CREATE TRIGGER), jadi
  // tanpa backtick pernyataan ini ditolak dengan error 1064 di kolom 54 — tepat di
  // kata itu. Prisma Client mengutip nama kolom sendiri, SQL mentah tidak, jadi di
  // sini setiap nama dibungkus backtick tanpa kecuali; lihat tes sql-cadangan.test.ts
  // yang menjaga aturan ini untuk seluruh repo.
  await prisma.$executeRawUnsafe(
    'INSERT INTO `doi_summary` (`snapshotDate`, `areaId`, `trigger`, `payload`, `computedAt`) VALUES (?,?,?,?,?) ' +
    'ON DUPLICATE KEY UPDATE `trigger`=VALUES(`trigger`), `payload`=VALUES(`payload`), `computedAt`=VALUES(`computedAt`)',
    date, out.areaId, trigger, payload, now,
  );
}

export type RunResult = {
  ok: boolean;
  skipped?: boolean;
  message?: string;
  today?: DateKey;
  skuCount?: number;
  stockRows?: number;
  durationMs: number;
  /** Rincian waktu per langkah — supaya "lambat" bisa ditunjuk penyebabnya. */
  steps?: string;
  /** Area yang berhasil dihitung pada putaran ini. */
  areas?: string[];
};

/**
 * Area mana saja yang dihitung DOI-nya: setiap kota yang ada stoknya, plus
 * GABUNGAN. Diambil dari data, bukan daftar tetap — cabang baru langsung ikut
 * terhitung tanpa mengubah kode.
 */
export async function areaUntukHitung(): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ areaId: string }[]>(
    "SELECT DISTINCT areaId FROM stock_current WHERE category = 'Sku' AND areaId <> '' ORDER BY areaId",
  );
  const kota = rows.map((r) => r.areaId);
  // Satu kota saja: GABUNGAN cuma akan menduplikasi angka yang sama.
  return kota.length > 1 ? [...kota, AREA_GABUNGAN] : kota;
}

/**
 * Alur lengkap: tarik stok dari OCS → hitung → simpan. Dipakai cron 07.30 dan
 * tombol Refresh. `withStockSync=false` menghitung ulang dari stok yang sudah ada
 * (mis. setelah unggah transit atau ubah pengaturan) tanpa memanggil OCS.
 */
/**
 * Satu putaran perhitungan, dengan anggaran waktu.
 *
 * Urutannya sengaja: tarik stok OCS hanya diberi SISA waktu dikurangi cadangan
 * untuk menghitung & menyimpan. Kalau OCS lambat, yang gagal cuma langkah stok
 * dengan pesan jelas — bukan seluruh fungsi dibunuh platform sambil
 * meninggalkan kunci yatim.
 */
export async function runCompute(
  trigger: string,
  withStockSync = true,
  budgetMs = defaultBudgetMs(),
  /**
   * Lewati penarikan transit di dalam sini karena pemanggil SUDAH menariknya
   * lebih dulu lewat /api/transit/sync (tombol Refresh melakukan itu).
   *
   * Bukan sekadar hemat: anggaran satu permintaan 52 dtk, dan menarik transit
   * dua kali berarti langkah kedua memakan jatah yang dibutuhkan untuk
   * menghitung 6 area. Area terakhir yang kehabisan waktu akan DILEWATI, jadi
   * pekerjaan ganda di sini membayar dengan snapshot yang tidak lengkap.
   */
  lewatiTransit = false,
): Promise<RunResult> {
  const t0 = Date.now();
  const anggaran = budget(budgetMs);
  const waktu = new Timeline();
  const owner = lockOwner();
  if (!(await acquireLock('compute', owner))) {
    return {
      ok: true, skipped: true, durationMs: Date.now() - t0,
      message: `Perhitungan lain sedang berjalan. Kunci yang lebih tua dari ${STALE_LOCK_MINUTES} menit otomatis diambil alih — coba lagi sebentar.`,
    };
  }
  const log = await startLog('COMPUTE', trigger);
  try {
    let stockRows: number | undefined;
    if (withStockSync) {
      const settings = await getSettings();
      waktu.step('pengaturan');
      // Sisakan ±20 dtk untuk hitung + simpan; sisanya untuk OCS.
      anggaran.need(12_000, 'tarik stok OCS');
      const st = await syncStock(trigger, settings.areaScope, anggaran.slice(24_000, 8_000));
      stockRows = st.rows;
      waktu.step(`stok ${st.skipped ? 'dilewati' : `${st.rows} baris`}`);

      // Harga & transit = pelengkap. Gagal di sini TIDAK BOLEH menggagalkan
      // DOI, jadi errornya ditelan dan dicatat; perhitungan lanjut dengan data
      // terakhir yang ada.
      if (settings.priceEnabled && anggaran.left() > 16_000) {
        try {
          const hp = await syncPrices(settings, anggaran.slice(14_000, 6_000));
          waktu.step(`harga ${hp.skipped ? 'masih segar' : `${hp.rows} SKU`}`);
        } catch (err) {
          waktu.step(`harga GAGAL (${err instanceof Error ? err.message.slice(0, 60) : err})`);
        }
      }
      // Barang dalam perjalanan ditarik SEBELUM perhitungan, supaya SIT yang
      // dipakai DOI adalah angka terbaru — bukan sisa penarikan tadi malam.
      //
      // Refresh manual memaksa penarikan (jendela kesegaran dilewati), karena
      // orang yang menekan Refresh justru ingin dokumen yang BARU masuk ikut
      // terhitung. Biayanya kecil: daftar dokumen memang selalu ditarik ulang,
      // dan isi dokumen yang sudah pernah dibaca datang dari cache receive_doc.
      // Cron tetap menghormati jendela kesegaran.
      if (lewatiTransit) {
        waktu.step('transit dilewati (sudah ditarik sebelum langkah ini)');
      } else if (settings.transitEnabled && anggaran.left() > 20_000) {
        try {
          const paksa = trigger === 'manual';
          // Sisa waktu diberikan ke transit, dikurangi cadangan untuk menghitung
          // dan menyimpan 6 area (±1,3 dtk per area + simpan ≈ 16 dtk).
          //
          // Jatah tetap 20 dtk dulu cuma cukup untuk 2 dari 20 dokumen (±5,5 dtk
          // per dokumen), jadi butuh 10 kali klik Refresh sebelum lengkap. Dengan
          // sisa anggaran, satu klik memakan 5–6 dokumen, dan karena isinya
          // di-cache di receive_doc, klik berikutnya hanya menarik sisanya.
          const jatah = Math.max(16_000, anggaran.left() - 18_000);
          const tr = await syncTransit(anggaran.slice(jatah, 8_000), settings.transitRefreshHours, paksa);
          waktu.step(
            tr.skipped ? 'transit masih segar'
            : tr.partial ? `transit ${tr.rows} baris SEBAGIAN (${tr.docsKurang} dari ${tr.docs} dokumen belum terbaca, ${tr.docsCache} dari cache)`
            : `transit ${tr.rows} baris dari ${tr.docs} dokumen (${tr.docsCache} dari cache)`,
          );
        } catch (err) {
          waktu.step(`transit GAGAL (${err instanceof Error ? err.message.slice(0, 60) : err})`);
        }
      }
    }

    // Satu area = satu snapshot. GABUNGAN dihitung terpisah, bukan dijumlahkan
    // dari hasil per kota — DOI itu pembagian, dan Σ(stok/ADS) ≠ Σstok/ΣADS.
    const daftarArea = await areaUntukHitung();
    let totalSku = 0;
    for (const area of daftarArea) {
      // Area terakhir tetap butuh waktu menyimpan; kalau tidak cukup, berhenti
      // dengan rapi supaya area yang sudah jadi tidak ikut hilang.
      if (anggaran.left() < 9_000) { waktu.step(`SISA AREA DILEWATI (${daftarArea.length - daftarArea.indexOf(area)})`); break; }
      const out = await computeAll(area);
      await persistSnapshot(out, trigger);
      totalSku += out.rows.length;
      waktu.step(`${labelArea(area)} ${out.rows.length} SKU`);
    }

    const catatan = `${withStockSync ? `stok ${stockRows} baris` : 'tanpa tarik stok'} · ${daftarArea.length} area · ${waktu}`;
    await finishLog(log.id, 'ok', totalSku, catatan);
    return {
      ok: true, today: todayKey(), skuCount: totalSku, stockRows, areas: daftarArea,
      durationMs: Date.now() - t0, steps: String(waktu),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishLog(log.id, 'error', 0, `${message} · ${waktu}`);
    throw err;
  } finally {
    // WAJIB jalan: kunci yang tidak dilepas membuat Refresh berikutnya ditolak.
    await releaseLock('compute', owner);
  }
}
