/**
 * Penarikan data dari OCS ke database internal.
 *
 * Dashboard TIDAK PERNAH menghubungi OCS. Semua angka dihitung dari tabel di sini,
 * supaya halaman tetap cepat walaupun OCS sedang lambat atau mati.
 */
import { prisma } from './prisma';
import { fetchStock, fetchSalesForDate, demandStatusCodes, type OcsSalesRow } from './ocs';
import { addDays, keyToUtcDate, todayKey, type DateKey } from './dates';
import type { DoiSettings } from './settings';

/** Baris per perintah INSERT. Menjaga ukuran paket ke TiDB tetap wajar. */
const BATCH = 400;

const int = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

/**
 * Kunci antar-proses. Cron Vercel dan tombol Refresh di web bisa jalan
 * bersamaan; tanpa ini keduanya menulis snapshot yang sama dan saling menghapus.
 * Kunci yang lebih tua dari `staleMinutes` dianggap yatim dan boleh direbut.
 */
export async function acquireLock(name: string, owner: string, staleMinutes = 15): Promise<boolean> {
  const cutoff = new Date(Date.now() - staleMinutes * 60_000);
  const taken = await prisma.$executeRaw`
    INSERT INTO sync_lock (name, owner, acquiredAt) VALUES (${name}, ${owner}, NOW())
    ON DUPLICATE KEY UPDATE
      owner = IF(acquiredAt < ${cutoff}, VALUES(owner), owner),
      acquiredAt = IF(acquiredAt < ${cutoff}, VALUES(acquiredAt), acquiredAt)`;
  if (taken === 1) return true;
  const row = await prisma.syncLock.findUnique({ where: { name } });
  return row?.owner === owner;
}

export async function releaseLock(name: string, owner: string) {
  await prisma.$executeRaw`DELETE FROM sync_lock WHERE name = ${name} AND owner = ${owner}`;
}

export const lockOwner = () => `${process.env.VERCEL ? 'vercel' : 'local'}:${process.pid}:${Date.now()}`;

export async function startLog(kind: 'STOCK' | 'SALES' | 'COMPUTE', trigger: string) {
  return prisma.syncLog.create({ data: { kind, trigger, status: 'running' } });
}

export async function finishLog(id: bigint, status: string, rows: number, message?: string) {
  await prisma.syncLog.update({
    where: { id },
    data: { status, rows, message: message?.slice(0, 500) ?? null, finishedAt: new Date() },
  });
}

// ---------------------------------------------------------------- stok

export type SyncResult = { ok: boolean; rows: number; skipped?: boolean; message?: string; durationMs: number };

/**
 * Tarik seluruh stok OCS ke stock_current, lalu simpan potret harinya ke
 * stock_daily (hanya area yang dihitung, kategori Sku). Potret hari yang sama
 * ditimpa — Refresh siang hari memperbarui angka hari ini, bukan menambah baris.
 */
export async function syncStock(trigger = 'cron', areaScope = 'Pusat'): Promise<SyncResult> {
  const t0 = Date.now();
  const owner = lockOwner();
  if (!(await acquireLock('stock', owner))) {
    return { ok: true, skipped: true, rows: 0, message: 'Sinkronisasi stok lain sedang berjalan', durationMs: 0 };
  }
  const log = await startLog('STOCK', trigger);
  try {
    const rows = await fetchStock();
    const now = new Date();
    const values: unknown[][] = [];

    for (const r of rows) {
      const sku = String(r.Sku ?? '').trim();
      if (!sku) continue;
      values.push([
        sku,
        String(r.AreaId ?? '').trim() || 'Pusat',
        String(r.Name ?? '').slice(0, 500),
        r.SapCode ? String(r.SapCode).slice(0, 60) : null,
        r.Category ? String(r.Category).slice(0, 40) : null,
        int(r.QtyGudangKecil),
        int(r.QtyGudangBesar),
        int(r.QtyOnHand),
        int(r.QtyOnOrder),
        int(r.AvailableQty),
        int(r.ReserveQty),
        r.IsActive ? 1 : 0,
        now,
        now,
      ]);
    }

    const cols =
      '(sku, areaId, name, sapCode, category, qtyRack, qtyBulk, qtyOnHand, qtyOnOrder, availableQty, reserveQty, isActive, firstSeenAt, updatedAt)';
    for (let i = 0; i < values.length; i += BATCH) {
      const chunk = values.slice(i, i + BATCH);
      const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
      await prisma.$executeRawUnsafe(
        `INSERT INTO stock_current ${cols} VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           name=VALUES(name), sapCode=VALUES(sapCode), category=VALUES(category),
           qtyRack=VALUES(qtyRack), qtyBulk=VALUES(qtyBulk), qtyOnHand=VALUES(qtyOnHand),
           qtyOnOrder=VALUES(qtyOnOrder), availableQty=VALUES(availableQty),
           reserveQty=VALUES(reserveQty), isActive=VALUES(isActive), updatedAt=VALUES(updatedAt)`,
        ...chunk.flat(),
      );
    }

    // Snapshot bersifat otoritatif: baris yang tidak ikut ditulis barusan
    // memang sudah tidak ada lagi di OCS.
    await prisma.stockCurrent.deleteMany({ where: { updatedAt: { lt: now } } });

    // Potret harian untuk riwayat (dipakai mengeluarkan hari stok kosong & tren).
    const today = keyToUtcDate(todayKey(now));
    const areaClause = areaScope === 'All' ? '' : 'AND areaId = ?';
    await prisma.$executeRawUnsafe(
      `INSERT INTO stock_daily (snapshotDate, sku, areaId, availableQty, qtyOnHand, qtyOnOrder)
       SELECT ?, sku, areaId, availableQty, qtyOnHand, qtyOnOrder
         FROM stock_current
        WHERE category = 'Sku' ${areaClause}
       ON DUPLICATE KEY UPDATE
         availableQty=VALUES(availableQty), qtyOnHand=VALUES(qtyOnHand), qtyOnOrder=VALUES(qtyOnOrder)`,
      today, ...(areaScope === 'All' ? [] : [areaScope]),
    );

    await finishLog(log.id, 'ok', values.length);
    return { ok: true, rows: values.length, durationMs: Date.now() - t0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishLog(log.id, 'error', 0, message);
    throw err;
  } finally {
    await releaseLock('stock', owner);
  }
}

// --------------------------------------------------------------- penjualan

const PLATFORM_COLUMN: Record<string, 'qtyShopee' | 'qtyTiktok' | 'qtyTokped' | 'qtyLazada'> = {
  SHOPEE: 'qtyShopee',
  TIKTOK_SHOP: 'qtyTiktok',
  TOKOPEDIA: 'qtyTokped',
  LAZADA: 'qtyLazada',
};

export type SalesRowInput = {
  salesDate: DateKey;
  sku: string;
  areaId: string;
  qty: number;
  qtyShopee?: number;
  qtyTiktok?: number;
  qtyTokped?: number;
  qtyLazada?: number;
  qtyOther?: number;
};

/** Ubah baris OCS menjadi baris tabel. Dipisah agar bisa diuji tanpa jaringan. */
export function mapSalesRows(rows: OcsSalesRow[], fallbackDate: DateKey): SalesRowInput[] {
  const out: SalesRowInput[] = [];
  for (const r of rows) {
    const sku = String(r.SellerSku ?? '').trim();
    if (!sku) continue;
    const acc: SalesRowInput = {
      salesDate: (typeof r.Date === 'string' ? r.Date.slice(0, 10) : fallbackDate) as DateKey,
      sku,
      areaId: String(r.Area ?? '').trim() || 'Pusat',
      qty: int(r.Qty),
      qtyShopee: 0,
      qtyTiktok: 0,
      qtyTokped: 0,
      qtyLazada: 0,
      qtyOther: 0,
    };
    let known = 0;
    for (const d of r.Detail ?? []) {
      const col = PLATFORM_COLUMN[String(d.CommercePlatform ?? '').toUpperCase()];
      const q = int(d.Qty);
      if (col) { acc[col] = (acc[col] ?? 0) + q; known += q; }
    }
    acc.qtyOther = Math.max(0, acc.qty - known);
    out.push(acc);
  }
  return out;
}

/**
 * Tulis baris penjualan. Kunci unik (tanggal, sku, area) membuat operasi ini
 * idempoten: menarik ulang hari yang sama menimpa, bukan menggandakan.
 */
export async function upsertSales(rows: SalesRowInput[], source: 'sync' | 'upload', now = new Date()): Promise<number> {
  if (!rows.length) return 0;
  const cols =
    '(salesDate, sku, areaId, qty, qtyShopee, qtyTiktok, qtyTokped, qtyLazada, qtyOther, source, createdAt, updatedAt)';
  let written = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
    const params = chunk.flatMap((r) => [
      keyToUtcDate(r.salesDate), r.sku, r.areaId, r.qty,
      r.qtyShopee ?? 0, r.qtyTiktok ?? 0, r.qtyTokped ?? 0, r.qtyLazada ?? 0, r.qtyOther ?? 0,
      source, now, now,
    ]);
    await prisma.$executeRawUnsafe(
      `INSERT INTO sales_daily ${cols} VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE
         qty=VALUES(qty), qtyShopee=VALUES(qtyShopee), qtyTiktok=VALUES(qtyTiktok),
         qtyTokped=VALUES(qtyTokped), qtyLazada=VALUES(qtyLazada), qtyOther=VALUES(qtyOther),
         source=VALUES(source), updatedAt=VALUES(updatedAt)`,
      ...params,
    );
    written += chunk.length;
  }
  return written;
}

/**
 * Tarik satu hari dari OCS dan jadikan isinya OTORITATIF untuk (tanggal, area):
 * baris yang tidak lagi dikembalikan OCS (mis. semua ordernya dibatalkan) ikut
 * dihapus, bukan dibiarkan dengan angka lama.
 */
export async function pullSalesDay(day: DateKey, s: DoiSettings): Promise<number> {
  const codes = demandStatusCodes({ includeReady: s.salesIncludeReady, includeReturn: s.salesIncludeReturn });
  const raw = await fetchSalesForDate(day, s.areaScope, codes);
  const now = new Date();
  const mapped = mapSalesRows(raw, day);
  const written = await upsertSales(mapped, 'sync', now);
  const areaClause = s.areaScope === 'All' ? '' : 'AND areaId = ?';
  await prisma.$executeRawUnsafe(
    `DELETE FROM sales_daily WHERE salesDate = ? AND updatedAt < ? ${areaClause}`,
    keyToUtcDate(day), now, ...(s.areaScope === 'All' ? [] : [s.areaScope]),
  );
  return written;
}

/**
 * Sinkronisasi harian (01.00 WIB). Menarik ulang `days` hari terakhir yang
 * berakhir kemarin: status order OCS masih berubah selama beberapa hari
 * (pembatalan, retur), jadi jendela 7 hari membuat data ikut terkoreksi.
 */
export async function syncSales(
  s: DoiSettings,
  { trigger = 'cron', days, from, to }: { trigger?: string; days?: number; from?: DateKey; to?: DateKey } = {},
): Promise<SyncResult & { dates: DateKey[]; failed: DateKey[] }> {
  const t0 = Date.now();
  const owner = lockOwner();
  if (!(await acquireLock('sales', owner))) {
    return { ok: true, skipped: true, rows: 0, dates: [], failed: [], message: 'Sinkronisasi penjualan lain sedang berjalan', durationMs: 0 };
  }
  const log = await startLog('SALES', trigger);
  const done: DateKey[] = [];
  const failed: DateKey[] = [];
  let total = 0;
  try {
    const last = to ?? addDays(todayKey(), -1);
    const first = from ?? addDays(last, -((days ?? s.salesSyncLookbackDays) - 1));
    for (let day = first; day <= last; day = addDays(day, 1)) {
      try {
        total += await pullSalesDay(day, s);
        done.push(day);
      } catch (err) {
        failed.push(day);
        if (failed.length >= 3) throw err; // OCS bermasalah — berhenti, jangan menumpuk galat
      }
    }
    const status = failed.length ? 'error' : 'ok';
    await finishLog(log.id, status, total, `Tanggal: ${done.join(', ')}${failed.length ? ` | GAGAL: ${failed.join(', ')}` : ''}`);
    return { ok: !failed.length, rows: total, dates: done, failed, durationMs: Date.now() - t0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishLog(log.id, 'error', total, message);
    throw err;
  } finally {
    await releaseLock('sales', owner);
  }
}
