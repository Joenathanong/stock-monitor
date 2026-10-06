/**
 * Penarikan data dari OCS ke database internal.
 *
 * Dashboard TIDAK PERNAH menghubungi OCS. Semua angka dihitung dari tabel di sini,
 * supaya halaman tetap cepat walaupun OCS sedang lambat atau mati.
 */
import { prisma } from './prisma';
import { fetchProductPrices, fetchStock, fetchSalesForDate, fetchReceiveDocs, fetchReceiveLines, demandStatusCodes, ALL_STATUS_CODES, type OcsSalesRow } from './ocs';
import { mapReceive, type OcsReceiveLine } from './receive';
import { petaArea, areaAktifDb } from './area-store';
import { sapKey } from './phase-out';
import { budget, defaultBudgetMs } from './budget';
import { addDays, keyToUtcDate, toDateKeyUtc, todayKey, type DateKey } from './dates';
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
/**
 * Batas keras satu fungsi 60 dtk, jadi kunci yang lebih tua dari 2 menit PASTI
 * milik proses yang sudah mati. Sebelumnya 15 menit: satu kali fungsi dibunuh
 * platform berarti Refresh ditolak seperempat jam berikutnya tanpa penjelasan.
 */
export const STALE_LOCK_MINUTES = 2;

export async function acquireLock(name: string, owner: string, staleMinutes = STALE_LOCK_MINUTES): Promise<boolean> {
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

// ---------------------------------------------------------------- harga

/**
 * Tarik harga per SKU dari OCS ke `product_price`.
 *
 * Harga adalah data master yang jarang berubah, jadi penarikannya dilewati bila
 * data yang ada masih segar (`price_refresh_hours`). Itu menjaga tombol Refresh
 * tetap cepat — anggaran 52 detik tidak boleh habis untuk data yang sama.
 *
 * Kegagalan di sini TIDAK BOLEH menggagalkan perhitungan DOI: nilai rupiah cuma
 * pelengkap, sedangkan DOI adalah inti aplikasinya. Pemanggil menangkap errornya.
 */
export async function syncPrices(
  s: Pick<DoiSettings, 'priceSource' | 'priceRefreshHours'>,
  budgetMs = 25_000,
  force = false,
): Promise<SyncResult & { skus?: number }> {
  const t0 = Date.now();
  if (!force && s.priceRefreshHours > 0) {
    const terbaru = await prisma.productPrice.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } });
    if (terbaru && Date.now() - terbaru.updatedAt.getTime() < s.priceRefreshHours * 3_600_000) {
      return { ok: true, skipped: true, rows: 0, message: 'Harga masih segar', durationMs: Date.now() - t0 };
    }
  }

  const rows = await fetchProductPrices(budgetMs, s.priceSource);
  if (!rows.length) return { ok: true, rows: 0, message: 'OCS tidak mengembalikan harga', durationMs: Date.now() - t0 };

  const now = new Date();
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const placeholders = chunk.map(() => '(?,?,?,?,?,?,?)').join(',');
    const params = chunk.flatMap((r) => [r.sku.slice(0, 120), r.name, r.price, r.min, r.max, r.sources, now]);
    await prisma.$executeRawUnsafe(
      `INSERT INTO product_price (sku, name, price, priceMin, priceMax, sources, updatedAt) VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE name=VALUES(name), price=VALUES(price), priceMin=VALUES(priceMin),
         priceMax=VALUES(priceMax), sources=VALUES(sources), updatedAt=VALUES(updatedAt)`,
      ...params,
    );
  }
  return { ok: true, rows: rows.length, skus: rows.length, durationMs: Date.now() - t0 };
}

// ------------------------------------------ barang dalam perjalanan (SIT)

export type TransitSyncResult = SyncResult & {
  areas?: Record<string, number>;
  takCocok?: number;
  docs?: number;
  /// Dokumen yang ditarik dari OCS pada panggilan ini.
  docsBaru?: number;
  /// Dokumen yang dipakai dari cache receive_doc.
  docsCache?: number;
  /// Dokumen yang belum terbaca sama sekali — hasilnya belum lengkap.
  docsKurang?: number;
  /// false kalau tabel receive_doc belum ada (db:push belum dijalankan).
  cacheSiap?: boolean;
  /**
   * Sebagian, bukan gagal.
   *
   * Dulu keadaan ini dikembalikan sebagai `ok: false`, dan karena `fail()` tidak
   * dipakai (statusnya tetap 200) layar user hanya menampilkan "HTTP 200" — pesan
   * yang tidak memberi tahu apa pun. Penarikan sebagian MENULIS baris dan
   * melewatkan pembersihan dengan sengaja, jadi itu keberhasilan sebagian.
   */
  partial?: boolean;
  /**
   * Kode gudang di baris transit yang TIDAK terdaftar di Pengaturan → Area.
   *
   * Dibawa keluar supaya layar bisa menyebut kodenya, bukan cuma menghitungnya:
   * kode asing berarti barisnya tidak bisa dipasangkan ke area mana pun, jadi
   * stoknya hilang dari perhitungan DOI tanpa jejak kalau tidak ditampilkan.
   * Sengaja TIDAK dipetakan diam-diam ke "Pusat" (lihat namaAreaDari).
   */
  kodeAsing?: { kode: string; baris: number; qty: number }[];
  totalDoQty?: number;
  totalBatchQty?: number;
};

/**
 * Tarik barang dalam perjalanan dari OCS ke `transit_stock`.
 *
 * Baris `source='ocs'` sepenuhnya diganti tiap kali sinkron; baris
 * `source='manual'` (hasil unggahan orang) TIDAK PERNAH disentuh, supaya barang
 * yang belum tercatat di OCS tidak hilang tiap sinkronisasi.
 *
 * Biayanya 1 + N panggilan (N = jumlah dokumen terbuka, ±22 pada 25 Sep 2026)
 * dan dikerjakan BERURUTAN. Endpoint laporan OCS berbasis SAP dan melambat
 * tajam kalau ditanya beberapa hal sekaligus — pelajaran dari backfill
 * penjualan hari yang sama. Karena itu ada anggaran waktu: kalau habis,
 * penarikan berhenti dan melapor, bukan ditinggal separuh diam-diam.
 */
export async function syncTransit(
  budgetMs = 40_000,
  refreshHours = 3,
  force = false,
): Promise<TransitSyncResult> {
  const t0 = Date.now();
  const anggaran = budget(budgetMs);

  if (!force && refreshHours > 0) {
    const terbaru = await prisma.transitStock.findFirst({
      where: { source: 'ocs' }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true },
    });
    if (terbaru && Date.now() - terbaru.updatedAt.getTime() < refreshHours * 3_600_000) {
      return { ok: true, skipped: true, rows: 0, message: 'Transit masih segar', durationMs: Date.now() - t0 };
    }
  }

  const docs = await fetchReceiveDocs(Math.min(30_000, anggaran.slice(10_000, 10_000)));

  // Cache per dokumen. Daftar dokumen SELALU ditarik ulang — itu satu-satunya
  // cara mengetahui ada dokumen baru — tapi isi dokumen yang sudah pernah
  // dibaca dan masih dalam jendela kesegaran diambil dari database.
  //
  // Kalau tabelnya belum dibuat (`npm run db:push` belum dijalankan), penarikan
  // TIDAK boleh gagal — cache itu percepatan, bukan syarat. Tanpa penjagaan ini
  // satu error Prisma menjatuhkan seluruh langkah transit, dan yang terbaca user
  // hanya "transit GAGAL (Invalid `prisma.receiveDoc.findMany()` invocation…)".
  const nomor = docs.map((d) => d.DoDocNum);
  let cache: { docNum: number; lines: string; pulledAt: Date }[] = [];
  let cacheSiap = true;
  try {
    if (nomor.length) cache = await prisma.receiveDoc.findMany({ where: { docNum: { in: nomor } } });
  } catch {
    cacheSiap = false;
  }
  const batasSegar = Date.now() - Math.max(1, refreshHours) * 3_600_000;
  const tersimpan = new Map<number, OcsReceiveLine[]>();
  for (const c of cache) {
    if (c.pulledAt.getTime() < batasSegar) continue;   // basi: tarik ulang
    try {
      const isi = JSON.parse(c.lines) as OcsReceiveLine[];
      if (Array.isArray(isi)) tersimpan.set(c.docNum, isi);
    } catch {
      // JSON rusak diperlakukan seperti tidak ada cache-nya.
    }
  }

  const lines: OcsReceiveLine[] = [];
  let dariCache = 0, dariOcs = 0, kurang = 0;
  for (const d of docs) {
    const simpan = tersimpan.get(d.DoDocNum);
    if (simpan) { lines.push(...simpan); dariCache++; continue; }
    // Sisakan waktu untuk menulis; dokumen yang belum sempat ditarik dilaporkan.
    if (anggaran.left() < 12_000) { kurang++; continue; }
    try {
      const isi = await fetchReceiveLines(d.DoDocNum, Math.min(20_000, anggaran.slice(8_000, 8_000)), 1);
      lines.push(...isi);
      dariOcs++;
      if (cacheSiap) {
        try {
          await prisma.receiveDoc.upsert({
            where: { docNum: d.DoDocNum },
            create: { docNum: d.DoDocNum, lines: JSON.stringify(isi), lineCount: isi.length, pulledAt: new Date() },
            update: { lines: JSON.stringify(isi), lineCount: isi.length, pulledAt: new Date() },
          });
        } catch {
          cacheSiap = false;   // sekali gagal, berhenti mencoba
        }
      }
    } catch {
      // Satu dokumen gagal tidak boleh menggagalkan semuanya; dilaporkan sebagai
      // kurang supaya pembersihan dilewati dan transit lama tidak terhapus.
      kurang++;
    }
  }

  // Pemetaan kode SAP → SKU dibangun dari stok yang sudah ada di database.
  const stok = await prisma.$queryRawUnsafe<{ sku: string; sapCode: string; name: string }[]>(
    `SELECT sku, MAX(sapCode) AS sapCode, MAX(name) AS name
       FROM stock_current WHERE sapCode IS NOT NULL AND sapCode <> '' AND sapCode <> '0'
      GROUP BY sku`,
  );
  const idx = new Map<string, { sku: string; name: string }>();
  for (const r of stok) {
    const k = sapKey(r.sapCode);
    // SKU pertama menang; prefiks 1222/1228 dan 1201/1208 berbagi 6 digit yang sama.
    if (k && !idx.has(k)) idx.set(k, { sku: r.sku, name: r.name ?? '' });
  }

  // Kode gudang → area datang dari tabel `area`, bukan dari konstanta di kode.
  // Kode yang belum terdaftar TIDAK lagi dihitung sebagai Pusat; dilaporkan.
  const hasil = mapReceive(lines, idx, await petaArea());
  const now = new Date();

  if (hasil.transit.length) {
    for (let i = 0; i < hasil.transit.length; i += BATCH) {
      const chunk = hasil.transit.slice(i, i + BATCH);
      const ph = chunk.map(() => '(?,?,?,?,?,?,?,?,?)').join(',');
      await prisma.$executeRawUnsafe(
        `INSERT INTO transit_stock (sku, areaId, qty, qtyBatch, eta, note, docNums, source, updatedAt) VALUES ${ph}
         ON DUPLICATE KEY UPDATE qty=VALUES(qty), qtyBatch=VALUES(qtyBatch), eta=VALUES(eta),
           note=VALUES(note), docNums=VALUES(docNums), source=VALUES(source), updatedAt=VALUES(updatedAt)`,
        ...chunk.flatMap((r) => [
          r.sku.slice(0, 120), r.areaId.slice(0, 60), r.qty, r.qtyBatch,
          r.eta ? keyToUtcDate(r.eta as DateKey) : null,
          `OCS · ${r.sapCode}`, r.docNums.slice(0, 300), 'ocs', now,
        ]),
      );
    }
  }
  // Baris OCS yang tidak ikut ditulis barusan memang sudah tidak dalam perjalanan.
  // Kalau ada dokumen yang belum sempat ditarik, pembersihan DILEWATI —
  // menghapus berdasarkan data separuh akan menghilangkan transit yang masih ada.
  let dihapus = 0;
  if (!kurang) {
    dihapus = await prisma.$executeRawUnsafe(
      "DELETE FROM transit_stock WHERE source = 'ocs' AND updatedAt < ?", now,
    );
  }

  if (hasil.box.length) {
    for (let i = 0; i < hasil.box.length; i += BATCH) {
      const chunk = hasil.box.slice(i, i + BATCH);
      const ph = chunk.map(() => '(?,?,?,?,?,?,?)').join(',');
      await prisma.$executeRawUnsafe(
        `INSERT INTO sku_box (sku, perCtn, fromOcs, fromName, mismatch, name, updatedAt) VALUES ${ph}
         ON DUPLICATE KEY UPDATE perCtn=VALUES(perCtn), fromOcs=VALUES(fromOcs), fromName=VALUES(fromName),
           mismatch=VALUES(mismatch), name=VALUES(name), updatedAt=VALUES(updatedAt)`,
        ...chunk.flatMap((b) => [b.sku.slice(0, 120), b.perCtn, b.fromOcs, b.fromName, b.mismatch ? 1 : 0, b.name, now]),
      );
    }
  }

  const areas: Record<string, number> = {};
  for (const t of hasil.transit) areas[t.areaId] = (areas[t.areaId] ?? 0) + t.qty;

  return {
    // Sebagian TETAP ok: barisnya ditulis. `partial` yang menandai belum tuntas.
    ok: true,
    partial: kurang > 0,
    rows: hasil.transit.length,
    docs: docs.length,
    docsBaru: dariOcs,
    docsCache: dariCache,
    docsKurang: kurang,
    areas,
    takCocok: hasil.takCocok.length,
    kodeAsing: hasil.kodeAsing,
    totalDoQty: hasil.totalDoQty,
    totalBatchQty: hasil.totalBatchQty,
    cacheSiap,
    message: (hasil.kodeAsing.length
      ? `${hasil.kodeAsing.length} kode gudang belum terdaftar di Pengaturan → Area `
        + `(${hasil.kodeAsing.slice(0, 4).map((k) => `${k.kode} ${k.qty} pcs`).join(', ')})`
        + ' — qty-nya TIDAK ikut DOI area mana pun sampai didaftarkan. '
      : '')
      + (cacheSiap ? '' : 'Cache dokumen belum aktif — jalankan "npm run db:push" supaya penarikan berikutnya cepat. ')
      + (kurang
        ? `${dariOcs + dariCache} dari ${docs.length} dokumen terbaca (${dariCache} dari cache), ${kurang} belum — `
          + 'pembersihan dilewati supaya transit lama tidak hilang. Klik lagi untuk melanjutkan; dokumen yang sudah terbaca tidak ditarik ulang.'
        : `${hasil.transit.length} baris dari ${docs.length} dokumen (${dariCache} dari cache) · ${dihapus} baris lama dihapus`),
    durationMs: Date.now() - t0,
  };
}

// ---------------------------------------------------------------- stok

export type SyncResult = { ok: boolean; rows: number; skipped?: boolean; message?: string; durationMs: number };

/**
 * Tarik seluruh stok OCS ke stock_current, lalu simpan potret harinya ke
 * stock_daily (hanya area yang dihitung, kategori Sku). Potret hari yang sama
 * ditimpa — Refresh siang hari memperbarui angka hari ini, bukan menambah baris.
 */
export async function syncStock(trigger = 'cron', _areaScope = 'All', ocsBudgetMs = 30_000): Promise<SyncResult> {
  const t0 = Date.now();
  const owner = lockOwner();
  if (!(await acquireLock('stock', owner))) {
    return { ok: true, skipped: true, rows: 0, message: 'Sinkronisasi stok lain sedang berjalan', durationMs: 0 };
  }
  const log = await startLog('STOCK', trigger);
  try {
    const rows = await fetchStock(ocsBudgetMs);
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
    // SELURUH area disimpan, bukan hanya area yang sedang dihitung: riwayat yang
    // tidak sempat direkam tidak bisa dibuat ulang belakangan.
    const today = keyToUtcDate(todayKey(now));
    await prisma.$executeRawUnsafe(
      `INSERT INTO stock_daily (snapshotDate, sku, areaId, availableQty, qtyOnHand, qtyOnOrder)
       SELECT ?, sku, areaId, availableQty, qtyOnHand, qtyOnOrder
         FROM stock_current
        WHERE category = 'Sku'
       ON DUPLICATE KEY UPDATE
         availableQty=VALUES(availableQty), qtyOnHand=VALUES(qtyOnHand), qtyOnOrder=VALUES(qtyOnOrder)`,
      today,
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
  /** Qty order batal / belum bayar. Tidak ikut ADS kecuali diaktifkan di Pengaturan. */
  qtyCancel?: number;
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
      qtyCancel: 0,
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
    '(salesDate, sku, areaId, qty, qtyCancel, qtyShopee, qtyTiktok, qtyTokped, qtyLazada, qtyOther, source, createdAt, updatedAt)';
  let written = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
    const params = chunk.flatMap((r) => [
      keyToUtcDate(r.salesDate), r.sku, r.areaId, r.qty, r.qtyCancel ?? 0,
      r.qtyShopee ?? 0, r.qtyTiktok ?? 0, r.qtyTokped ?? 0, r.qtyLazada ?? 0, r.qtyOther ?? 0,
      source, now, now,
    ]);
    await prisma.$executeRawUnsafe(
      `INSERT INTO sales_daily ${cols} VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE
         qty=VALUES(qty), qtyCancel=VALUES(qtyCancel), qtyShopee=VALUES(qtyShopee), qtyTiktok=VALUES(qtyTiktok),
         qtyTokped=VALUES(qtyTokped), qtyLazada=VALUES(qtyLazada), qtyOther=VALUES(qtyOther),
         source=VALUES(source), updatedAt=VALUES(updatedAt)`,
      ...params,
    );
    written += chunk.length;
  }
  return written;
}

/**
 * Gabungkan hasil dua penarikan menjadi satu baris per (sku, area):
 * `qty` dari status yang memakan stok, `qtyCancel` = sisanya (semua − konsumsi).
 *
 * Respons OrderPerSkuReport tidak memuat kolom status, jadi memisahkan order
 * batal memang harus lewat dua panggilan lalu diselisihkan di sini. Selisih
 * negatif (mungkin kalau status order berubah di antara dua panggilan)
 * dijadikan 0 — lebih baik kurang lapor daripada mengarang angka.
 */
export function gabungSales(semua: SalesRowInput[], konsumsi: SalesRowInput[]): SalesRowInput[] {
  const out = new Map<string, SalesRowInput>();
  const kunci = (r: SalesRowInput) => `${r.salesDate}\u0000${r.sku}\u0000${r.areaId}`;
  for (const r of konsumsi) out.set(kunci(r), { ...r, qtyCancel: 0 });
  for (const r of semua) {
    const k = kunci(r);
    const inti = out.get(k);
    if (inti) inti.qtyCancel = Math.max(0, r.qty - inti.qty);
    // SKU yang HANYA punya order batal tidak muncul di penarikan konsumsi.
    else out.set(k, { ...r, qty: 0, qtyCancel: r.qty, qtyShopee: 0, qtyTiktok: 0, qtyTokped: 0, qtyLazada: 0, qtyOther: 0 });
  }
  return [...out.values()];
}

/**
 * Sumber daftar area yang ditarik. `area=All` TIDAK PERNAH dipakai: akun OCS
 * yang menentukan cakupan, dan `All` pernah diam-diam menyusut jadi satu area
 * tanpa galat apa pun. Setiap area selalu diminta dengan namanya sendiri,
 * supaya yang tersimpan memang per kota.
 *
 * Urutan sumber:
 *   1. Pengaturan `sales_pull_areas` — daftar eksplisit, menang atas apa pun.
 *   2. Area yang ada di stock_current (diisi penarikan stok dari OCS).
 * Kalau dua-duanya kosong, ini GAGAL — bukan diam-diam jatuh ke 'All'.
 */
export async function areaUntukTarik(s: DoiSettings): Promise<string[]> {
  if (s.salesPullAreas.length) return s.salesPullAreas;
  // Tabel `area` menang atas deteksi dari stok: di situlah cabang baru
  // didaftarkan, dan cabang yang BARU dibuka belum punya baris stok sama sekali.
  const aktif = await areaAktifDb();
  if (aktif.length) return aktif.map((a) => a.name);
  const rows = await prisma.$queryRawUnsafe<{ areaId: string }[]>(
    "SELECT DISTINCT areaId FROM stock_current WHERE areaId <> '' ORDER BY areaId",
  );
  const dariStok = rows.map((r) => r.areaId);
  if (dariStok.length) return dariStok;
  throw new Error(
    'Daftar area kosong. Daftarkan area di Pengaturan → Area (atau jalankan "npm run seed:area" ' +
    'untuk mengisi dari data yang sudah ada), atau isi Pengaturan sales_pull_areas secara manual. ' +
    'Penarikan tidak pernah memakai area=All.',
  );
}

/** Nama area yang terlihat oleh akun OCS saat ini, langsung dari respons stok. */
export async function areaDariOcs(timeoutMs = 90_000): Promise<string[]> {
  const stock = await fetchStock(timeoutMs);
  return [...new Set(stock.map((r) => String(r.AreaId ?? '').trim()).filter(Boolean))].sort();
}

/**
 * Tarik SATU tanggal untuk SATU area, dan jadikan hasilnya otoritatif untuk
 * pasangan itu: baris (tanggal, area) yang tidak lagi dikembalikan OCS ikut
 * dihapus, bukan dibiarkan dengan angka lama.
 *
 * Dua panggilan:
 *   1. SELURUH status      → total permintaan apa adanya
 *   2. status konsumsi stok → yang dipakai ADS
 * Selisihnya jadi kolom `qtyCancel`.
 *
 * Pembersihannya DISARING PER AREA. Kalau tidak, menarik Medan akan menghapus
 * baris Surabaya yang baru saja ditulis di pasangan sebelumnya.
 */
export async function pullSalesDayArea(
  day: DateKey, area: string, s: DoiSettings,
  /**
   * Batas waktu SATU PANGGILAN OCS, bukan total untuk sepasang.
   *
   * Sengaja ditegaskan: sebelumnya parameter ini adalah total lalu dibagi
   * (2 panggilan × jumlah percobaan). Menambah percobaan jadi 2 diam-diam
   * memangkas batas tiap panggilan dari 60 dtk ke 22,5 dtk — dan hari-hari
   * Pusat yang berat langsung berguguran "This operation was aborted".
   */
  perPanggilanMs = 20_000,
  percobaan = 1,
): Promise<number> {
  if (!area || area.toLowerCase() === 'all') {
    throw new Error(`Nama area tidak sah: "${area}". Penarikan harus menyebut satu kota, bukan All.`);
  }
  const codes = demandStatusCodes({ includeReady: s.salesIncludeReady, includeReturn: s.salesIncludeReturn });
  const t = Math.max(8_000, perPanggilanMs);
  const semua = mapSalesRows(await fetchSalesForDate(day, area, ALL_STATUS_CODES, t, percobaan), day);
  const konsumsi = mapSalesRows(await fetchSalesForDate(day, area, codes, t, percobaan), day);
  // OCS mengisi kolom Area sendiri; kalau kosong, pakai area yang diminta —
  // supaya baris tidak terlempar ke 'Pusat' oleh nilai bawaan mapSalesRows.
  const betulkan = (rows: SalesRowInput[]) => rows.map((r) => ({ ...r, areaId: r.areaId || area }));
  const now = new Date();
  const written = await upsertSales(gabungSales(betulkan(semua), betulkan(konsumsi)), 'sync', now);
  await prisma.$executeRawUnsafe(
    'DELETE FROM sales_daily WHERE salesDate = ? AND areaId = ? AND updatedAt < ? AND source = ?',
    keyToUtcDate(day), area, now, 'sync',
  );
  // Catat bahwa pasangan ini SUDAH ditarik, walau hasilnya nol baris. Inilah
  // yang membedakan "hari tanpa penjualan" dari "hari yang belum pernah
  // ditarik" — dua hal yang tampak sama kalau hanya melihat sales_daily.
  await prisma.$executeRawUnsafe(
    `INSERT INTO sales_pull (salesDate, areaId, rowCount, pulledAt) VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE rowCount=VALUES(rowCount), pulledAt=VALUES(pulledAt)`,
    keyToUtcDate(day), area, written, now,
  );
  return written;
}

/** Satu tanggal untuk beberapa area sekaligus. Dipakai backfill. */
export async function pullSalesDay(
  day: DateKey, s: DoiSettings, timeoutMs = 25_000, areas?: string[],
): Promise<number> {
  const daftar = areas?.length ? areas : await areaUntukTarik(s);
  // timeoutMs di sini adalah total untuk seluruh area; dibagi rata, lalu dibagi
  // dua karena tiap area butuh dua panggilan.
  const perPanggilan = Math.max(8_000, Math.floor(timeoutMs / (daftar.length * 2)));
  let written = 0;
  for (const area of daftar) written += await pullSalesDayArea(day, area, s, perPanggilan);
  return written;
}

/**
 * Antrean kerja: satu baris = satu pasangan (tanggal, area).
 *
 * Dipasangkan, bukan per tanggal, karena satu fungsi Vercel cuma 60 detik
 * sementara satu tanggal × 5 area = 10 panggilan OCS. Kalau satuannya tanggal,
 * jalan berikutnya selalu mengulang tanggal yang sama dari area pertama dan
 * area terakhir tidak pernah kebagian.
 *
 * Urutan: seluruh area untuk 2 tanggal terbaru dulu (status ordernya paling
 * sering berubah), lalu sisanya dari pasangan yang PALING LAMA tidak ditarik.
 */
export type TugasTarik = { day: DateKey; area: string };

/**
 * Apakah pasangan (tanggal, area) memang layak ditarik?
 *
 * Cabang baru beroperasi pertengahan tahun; tanggal sebelum itu tidak akan
 * pernah punya penjualan, jadi menariknya membuang waktu dan membuat laporan
 * lubang penuh lubang palsu.
 */
export function areaSudahJalan(area: string, day: DateKey, mulai: Record<string, string>): boolean {
  const m = mulai[area];
  return !m || day >= m;
}

export async function antreanTarik(
  first: DateKey, last: DateKey, areas: string[], mulai: Record<string, string> = {},
): Promise<TugasTarik[]> {
  const hari: DateKey[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) hari.push(d);
  const baru = new Set(hari.slice(-2));

  const rows = await prisma.$queryRawUnsafe<{ d: Date; a: string; t: Date | null }[]>(
    `SELECT salesDate AS d, areaId AS a, MAX(updatedAt) AS t FROM sales_daily
      WHERE salesDate BETWEEN ? AND ? GROUP BY salesDate, areaId`,
    keyToUtcDate(first), keyToUtcDate(last),
  );
  const umur = new Map<string, number>();
  for (const r of rows) {
    umur.set(`${toDateKeyUtc(new Date(r.d))}|${r.a}`, r.t ? new Date(r.t).getTime() : 0);
  }

  const prioritas: TugasTarik[] = [];
  const sisa: TugasTarik[] = [];
  for (const day of hari) {
    for (const area of areas) {
      if (!areaSudahJalan(area, day, mulai)) continue;
      (baru.has(day) ? prioritas : sisa).push({ day, area });
    }
  }
  // Belum pernah ditarik (umur 0) otomatis paling depan — itu memang yang paling mendesak.
  sisa.sort((x, y) =>
    (umur.get(`${x.day}|${x.area}`) ?? 0) - (umur.get(`${y.day}|${y.area}`) ?? 0)
    || (x.day < y.day ? 1 : x.day > y.day ? -1 : 0));
  return [...prioritas, ...sisa];
}

/**
 * Sinkronisasi harian (01.00 WIB). Menarik ulang `days` hari terakhir yang
 * berakhir kemarin: status order OCS masih berubah selama beberapa hari
 * (pembatalan, retur), jadi jendela 7 hari membuat data ikut terkoreksi.
 *
 * Satuan kerjanya (tanggal × area), dan tiap pasangan butuh 2 panggilan OCS.
 * Dengan 5 area dan jendela 7 hari itu 70 panggilan, sementara satu fungsi
 * Vercel dibunuh di detik ke-60 — jadi mustahil selesai sekali jalan, dan
 * memang tidak dipaksakan. Loop-nya beranggaran: berhenti rapi selagi masih
 * sempat menutup log & melepas kunci, lalu melapor apa yang belum sempat.
 * Karena antreannya diurut dari pasangan yang paling lama tidak ditarik,
 * jalan-jalan berikutnya menyapu sisanya — bukan mengulang yang itu-itu saja.
 */
export async function syncSales(
  s: DoiSettings,
  { trigger = 'cron', days, from, to, budgetMs = defaultBudgetMs(), areas }:
    { trigger?: string; days?: number; from?: DateKey; to?: DateKey; budgetMs?: number; areas?: string[] } = {},
): Promise<SyncResult & {
  dates: DateKey[]; failed: DateKey[]; tertunda: DateKey[];
  areas: string[]; selesai: number; sisa: number;
}> {
  const t0 = Date.now();
  const owner = lockOwner();
  const kosong = { dates: [], failed: [], tertunda: [], areas: [], selesai: 0, sisa: 0 };
  if (!(await acquireLock('sales', owner))) {
    return { ok: true, skipped: true, rows: 0, ...kosong, message: 'Sinkronisasi penjualan lain sedang berjalan', durationMs: 0 };
  }
  const log = await startLog('SALES', trigger);
  const anggaran = budget(budgetMs);
  const done = new Set<DateKey>();
  const failed = new Set<DateKey>();
  const tertunda = new Set<DateKey>();
  let selesai = 0, sisa = 0, total = 0;
  let daftarArea: string[] = [];
  try {
    daftarArea = areas?.length ? areas : await areaUntukTarik(s);
    const last = to ?? addDays(todayKey(), -1);
    const first = from ?? addDays(last, -((days ?? s.salesSyncLookbackDays) - 1));
    const antre = await antreanTarik(first, last, daftarArea, s.salesAreaStart);
    let gagalBeruntun = 0;
    for (let i = 0; i < antre.length; i++) {
      const { day, area } = antre[i];
      // Satu pasangan = 2 panggilan + tulis; sisakan 6 dtk untuk menutup log.
      if (anggaran.left() < 14_000) {
        for (const t of antre.slice(i)) tertunda.add(t.day);
        sisa = antre.length - i;
        break;
      }
      try {
        // Satu pasangan = 2 panggilan, jadi sisa waktunya dibagi dua.
        // Satu percobaan saja: di Vercel percobaan kedua membuat fungsi dibunuh
        // di tengah jalan, dan pasangannya lebih baik ditunda ke jalan berikutnya.
        total += await pullSalesDayArea(day, area, s, Math.floor(anggaran.slice(8_000, 10_000) / 2), 1);
        done.add(day); selesai++; gagalBeruntun = 0;
      } catch (err) {
        failed.add(day);
        if (++gagalBeruntun >= 3) throw err; // OCS bermasalah — berhenti, jangan menumpuk galat
      }
    }
    const status = failed.size ? 'error' : 'ok';
    await finishLog(log.id, status, total,
      `${selesai}/${selesai + sisa} pasangan (tanggal × area) · area: ${daftarArea.join(', ')}` +
      `${failed.size ? ` | GAGAL: ${[...failed].join(', ')}` : ''}` +
      `${sisa ? ` | BELUM SEMPAT: ${sisa} pasangan` : ''}`);
    return {
      ok: !failed.size, rows: total, dates: [...done].sort(), failed: [...failed].sort(),
      tertunda: [...tertunda].sort(), areas: daftarArea, selesai, sisa, durationMs: Date.now() - t0,
      message: sisa ? `${sisa} pasangan (tanggal × area) belum sempat — dilanjutkan jalan berikutnya` : undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishLog(log.id, 'error', total, message);
    throw err;
  } finally {
    await releaseLock('sales', owner);
  }
}
