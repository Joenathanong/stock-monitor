import { prisma } from '@/lib/prisma';
import { readSheet, pickDate, pickInt, pickString } from '@/lib/xlsx';
import { keyToUtcDate, toDateKeyUtc } from '@/lib/dates';
import { fail, json, safe } from '@/lib/http';
import { randomUUID } from 'node:crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET() {
  const [rows, batches] = await Promise.all([
    prisma.transitStock.findMany({ orderBy: { sku: 'asc' } }),
    prisma.uploadBatch.findMany({ where: { kind: 'TRANSIT' }, orderBy: { uploadedAt: 'desc' }, take: 10 }),
  ]);
  return json(safe({
    ok: true,
    rows: rows.map((r) => ({ ...r, eta: r.eta ? toDateKeyUtc(r.eta) : null, updatedAt: r.updatedAt.toISOString() })),
    batches: batches.map((b) => ({ ...b, uploadedAt: b.uploadedAt.toISOString() })),
  }));
}

/**
 * Unggah stok dalam perjalanan — kolom SKU | Qty (opsional ETA, Catatan).
 * Sistemnya REPLACE: seluruh isi tabel diganti dengan isi berkas ini.
 * SKU yang muncul dua kali dijumlahkan.
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return fail('Kirim sebagai multipart/form-data');
  const file = form.get('file');
  if (!(file instanceof File)) return fail('Berkas belum dipilih');

  let sheet;
  try {
    sheet = await readSheet(await file.arrayBuffer());
  } catch (err) {
    return fail(`Berkas tidak bisa dibaca: ${err instanceof Error ? err.message : err}`);
  }

  const problems: string[] = [];
  const merged = new Map<string, { sku: string; qty: number; eta: Date | null; note: string | null }>();
  sheet.forEach((r, i) => {
    const line = i + 2;
    const sku = pickString(r, 'sku', 'seller sku', 'sellersku', 'kode');
    const qty = pickInt(r, 'qty', 'quantity', 'jumlah', 'stok dalam perjalanan', 'transit');
    if (!sku) { problems.push(`Baris ${line}: SKU kosong`); return; }
    if (qty === null || qty < 0) { problems.push(`Baris ${line}: Qty tidak valid`); return; }
    const etaKey = pickDate(r, 'eta', 'estimasi', 'tanggal tiba', 'arrival');
    const note = pickString(r, 'note', 'catatan', 'keterangan', 'po', 'no po');
    const prev = merged.get(sku);
    if (prev) { prev.qty += qty; if (!prev.eta && etaKey) prev.eta = keyToUtcDate(etaKey); }
    else merged.set(sku, { sku, qty, eta: etaKey ? keyToUtcDate(etaKey) : null, note: note?.slice(0, 300) ?? null });
  });
  const rows = [...merged.values()].filter((r) => r.qty > 0);
  if (!rows.length && problems.length) return fail(`Tidak ada baris valid. ${problems.slice(0, 5).join('; ')}`);

  const batchId = randomUUID().slice(0, 36);
  await prisma.$transaction([
    prisma.transitStock.deleteMany({}),
    prisma.transitStock.createMany({ data: rows.map((r) => ({ ...r, batchId })) }),
    prisma.uploadBatch.create({
      data: { id: batchId, kind: 'TRANSIT', filename: file.name.slice(0, 260), rowCount: rows.length, mode: 'REPLACE' },
    }),
    prisma.auditLog.create({
      data: { action: 'TRANSIT_UPLOAD', entity: 'transit_stock', entityId: batchId, detail: `${rows.length} SKU (replace)` },
    }),
  ]);
  return json({ ok: true, batchId, inserted: rows.length, skipped: problems.length, problems: problems.slice(0, 20) });
}

/** Edit satu SKU (qty / eta / note). Qty 0 menghapus barisnya. */
export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => null)) as { sku?: string; qty?: number; eta?: string | null; note?: string } | null;
  if (!body?.sku) return fail('sku wajib diisi');
  const qty = typeof body.qty === 'number' ? Math.max(0, Math.round(body.qty)) : undefined;
  if (qty === 0) {
    await prisma.transitStock.deleteMany({ where: { sku: body.sku } });
    return json({ ok: true, deleted: true });
  }
  const data: { qty?: number; eta?: Date | null; note?: string } = {};
  if (qty !== undefined) data.qty = qty;
  if (body.eta === null) data.eta = null;
  else if (typeof body.eta === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.eta)) data.eta = keyToUtcDate(body.eta);
  if (typeof body.note === 'string') data.note = body.note.slice(0, 300);
  const row = await prisma.transitStock.upsert({
    where: { sku: body.sku },
    create: { sku: body.sku, qty: qty ?? 0, eta: data.eta ?? null, note: data.note ?? null },
    update: data,
  });
  await prisma.auditLog.create({ data: { action: 'TRANSIT_EDIT', entity: 'transit_stock', entityId: body.sku, detail: JSON.stringify(data) } });
  return json(safe({ ok: true, row: { ...row, eta: row.eta ? toDateKeyUtc(row.eta) : null } }));
}

/** Kosongkan seluruh tabel transit. */
export async function DELETE() {
  const res = await prisma.transitStock.deleteMany({});
  await prisma.auditLog.create({ data: { action: 'TRANSIT_CLEAR', entity: 'transit_stock', detail: `${res.count} baris` } });
  return json({ ok: true, deleted: res.count });
}
