import { prisma } from '@/lib/prisma';
import { readSheet, pickDate, pickInt, pickString, type SheetRow } from '@/lib/xlsx';
import { upsertSales, type SalesRowInput } from '@/lib/sync';
import { addDays, todayKey, type DateKey } from '@/lib/dates';
import { getSettings } from '@/lib/compute';
import { fail, json } from '@/lib/http';
import { randomUUID } from 'node:crypto';

export const dynamic = 'force-dynamic';
// Vercel Hobby membatasi satu fungsi 60 dtk. Menulis 300 tidak menaikkannya —
// prosesnya tetap dibunuh di detik ke-60, dan kuncinya ikut tertinggal.
export const maxDuration = 60;

/**
 * Unggah histori penjualan awal (minimal 90 hari).
 *
 * Dua bentuk berkas diterima:
 *   1. Panjang  — kolom Date | SKU | Qty (opsional Area)
 *   2. Melebar  — kolom SKU lalu satu kolom per tanggal
 * Bentuk kedua muncul kalau report OCS di-pivot lebih dulu di Excel, dan itu
 * sering terjadi; menolaknya hanya memaksa orang menyusun ulang berkas.
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return fail('Kirim sebagai multipart/form-data');
  const file = form.get('file');
  if (!(file instanceof File)) return fail('Berkas belum dipilih');
  const settings = await getSettings();
  const defaultArea = String(form.get('area') || settings.areaScope || 'Pusat');

  let sheet: SheetRow[];
  try {
    sheet = await readSheet(await file.arrayBuffer());
  } catch (err) {
    return fail(`Berkas tidak bisa dibaca: ${err instanceof Error ? err.message : err}`);
  }
  if (!sheet.length) return fail('Berkas kosong');

  const problems: string[] = [];
  const rows: SalesRowInput[] = [];
  const first = sheet[0];
  const isLongFormat = pickDate(first, 'date', 'tanggal', 'tgl') !== null;

  if (isLongFormat) {
    sheet.forEach((r, i) => {
      const line = i + 2;
      const date = pickDate(r, 'date', 'tanggal', 'tgl');
      const sku = pickString(r, 'sku', 'seller sku', 'sellersku');
      const qty = pickInt(r, 'qty', 'quantity', 'jumlah', 'total');
      if (!date) { problems.push(`Baris ${line}: tanggal tidak terbaca`); return; }
      if (!sku) { problems.push(`Baris ${line}: SKU kosong`); return; }
      if (qty === null) { problems.push(`Baris ${line}: Qty tidak valid`); return; }
      rows.push({ salesDate: date, sku, areaId: pickString(r, 'area', 'areaid') || defaultArea, qty });
    });
  } else {
    // Bentuk melebar: setiap kolom yang judulnya terbaca sebagai tanggal jadi satu baris.
    const dateColumns: { key: string; date: DateKey }[] = [];
    for (const key of Object.keys(first)) {
      const asDate = pickDate({ [key]: key } as SheetRow, key);
      if (asDate) dateColumns.push({ key, date: asDate });
    }
    if (!dateColumns.length) {
      return fail('Kolom tanggal tidak ditemukan. Pakai kolom Date | SKU | Qty, atau satu kolom per tanggal.');
    }
    sheet.forEach((r, i) => {
      const sku = pickString(r, 'sku', 'seller sku', 'sellersku');
      if (!sku) { problems.push(`Baris ${i + 2}: SKU kosong`); return; }
      const area = pickString(r, 'area', 'areaid') || defaultArea;
      for (const col of dateColumns) {
        const raw = r[col.key];
        const qty = raw === null || raw === '' ? 0 : Number(String(raw).replace(/[^\d.-]/g, ''));
        if (!Number.isFinite(qty) || qty === 0) continue;
        rows.push({ salesDate: col.date, sku, areaId: area, qty: Math.round(qty) });
      }
    });
  }

  if (!rows.length) return fail(`Tidak ada baris valid. ${problems.slice(0, 5).join('; ')}`);

  // Baris ganda (SKU sama, tanggal sama, area sama) dijumlahkan lebih dulu.
  // Kalau tidak, ON DUPLICATE KEY di dalam satu batch akan saling menimpa dan
  // yang tersimpan hanya baris terakhir.
  const merged = new Map<string, SalesRowInput>();
  for (const r of rows) {
    const key = `${r.salesDate}|${r.sku}|${r.areaId}`;
    const prev = merged.get(key);
    if (prev) prev.qty += r.qty;
    else merged.set(key, { ...r });
  }
  const finalRows = [...merged.values()];

  const written = await upsertSales(finalRows, 'upload');

  const dates = finalRows.map((r) => r.salesDate).sort();
  const batchId = randomUUID().slice(0, 36);
  await prisma.uploadBatch.create({
    data: {
      id: batchId,
      kind: 'SALES',
      filename: file.name.slice(0, 260),
      rowCount: written,
      mode: 'UPSERT',
      note: `${dates[0]} s/d ${dates[dates.length - 1]}`,
    },
  });
  await prisma.auditLog.create({
    data: { action: 'SALES_UPLOAD', entity: 'sales_daily', entityId: batchId, detail: `${written} baris` },
  });

  const coverageDays = new Set(dates).size;
  const windowDays = settings.opsi1WindowDays;
  return json({
    ok: true,
    format: isLongFormat ? 'panjang' : 'melebar',
    written,
    skipped: problems.length,
    problems: problems.slice(0, 20),
    firstDate: dates[0],
    lastDate: dates[dates.length - 1],
    coverageDays,
    warning:
      coverageDays < windowDays
        ? `Berkas ini memuat ${coverageDays} hari. Opsi 1 memakai ${windowDays} hari, dan tanggal listing dicari sampai awal tahun — unggah histori sejak Januari bila ada.`
        : null,
  });
}

/** Ringkasan cakupan data penjualan — dipakai halaman impor untuk menunjukkan lubang data. */
export async function GET() {
  const today = todayKey();
  const agg = await prisma.salesDaily.aggregate({
    _min: { salesDate: true },
    _max: { salesDate: true },
    _count: true,
  });
  const distinct = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(DISTINCT salesDate) AS n FROM sales_daily WHERE salesDate >= ${new Date(`${addDays(today, -90)}T00:00:00Z`)} AND salesDate < ${new Date(`${today}T00:00:00Z`)}`;
  const gaps = await prisma.$queryRaw<{ d: Date }[]>`
    SELECT DISTINCT salesDate AS d FROM sales_daily WHERE salesDate >= ${new Date(`${addDays(today, -90)}T00:00:00Z`)} AND salesDate < ${new Date(`${today}T00:00:00Z`)} ORDER BY salesDate`;
  const have = new Set(gaps.map((g) => new Date(g.d).toISOString().slice(0, 10)));
  const missing: string[] = [];
  for (let i = 90; i >= 1; i--) { const k = addDays(today, -i); if (!have.has(k)) missing.push(k); }
  const batches = await prisma.uploadBatch.findMany({
    where: { kind: 'SALES' },
    orderBy: { uploadedAt: 'desc' },
    take: 20,
  });
  return json({
    ok: true,
    today,
    rowCount: agg._count,
    firstDate: agg._min.salesDate ? agg._min.salesDate.toISOString().slice(0, 10) : null,
    lastDate: agg._max.salesDate ? agg._max.salesDate.toISOString().slice(0, 10) : null,
    daysCoveredLast90: Number(distinct[0]?.n ?? 0),
    missingLast90: missing,
    batches: batches.map((b) => ({ ...b, uploadedAt: b.uploadedAt.toISOString() })),
  });
}
