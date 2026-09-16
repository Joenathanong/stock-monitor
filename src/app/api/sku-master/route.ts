import { prisma } from '@/lib/prisma';
import { readSheet, pickInt, pickString } from '@/lib/xlsx';
import { fail, json, safe } from '@/lib/http';
import { randomUUID } from 'node:crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Daftar SKU dari stok (Category = Sku) digabung dengan master — supaya yang belum diisi pun terlihat. */
export async function GET() {
  const [stock, master] = await Promise.all([
    prisma.$queryRawUnsafe<{ sku: string; name: string }[]>(
      `SELECT sku, MAX(name) AS name FROM stock_current WHERE category = 'Sku' GROUP BY sku ORDER BY sku`,
    ),
    prisma.skuMaster.findMany(),
  ]);
  const m = new Map(master.map((r) => [r.sku, r]));
  const seen = new Set<string>();
  const rows = stock.map((s) => {
    seen.add(s.sku);
    const r = m.get(s.sku);
    return { sku: s.sku, name: s.name, leadTimeDays: r?.leadTimeDays ?? null, isExcluded: r?.isExcluded ?? false, note: r?.note ?? null };
  });
  // master untuk SKU yang sudah tidak ada di stok tetap ditampilkan agar bisa dibersihkan
  for (const r of master) if (!seen.has(r.sku)) rows.push({ sku: r.sku, name: '(tidak ada di stok)', leadTimeDays: r.leadTimeDays, isExcluded: r.isExcluded, note: r.note });
  return json(safe({ ok: true, rows }));
}

/** Unggah XLSX: kolom SKU | Lead Time (hari) — opsional Exclude (1/0), Catatan. Mode UPSERT per SKU. */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return fail('Kirim sebagai multipart/form-data');
  const file = form.get('file');
  if (!(file instanceof File)) return fail('Berkas belum dipilih');

  const sheet = await readSheet(await file.arrayBuffer());
  const problems: string[] = [];
  const rows: { sku: string; leadTimeDays: number | null; isExcluded?: boolean; note?: string | null }[] = [];
  sheet.forEach((r, i) => {
    const sku = pickString(r, 'sku', 'seller sku', 'sellersku');
    const days = pickInt(r, 'lead time', 'leadtime', 'lead time hari', 'leadtimedays', 'hari', 'lead time (hari)');
    if (!sku) { problems.push(`Baris ${i + 2}: SKU kosong`); return; }
    if (days !== null && days < 0) { problems.push(`Baris ${i + 2}: lead time negatif`); return; }
    const ex = pickString(r, 'exclude', 'dikecualikan', 'kecualikan');
    rows.push({
      sku, leadTimeDays: days,
      isExcluded: ex === null ? undefined : /^(1|ya|yes|true|y)$/i.test(ex),
      note: pickString(r, 'note', 'catatan', 'keterangan', 'supplier'),
    });
  });
  if (!rows.length) return fail(`Tidak ada baris valid. ${problems.slice(0, 5).join('; ')}`);

  for (const r of rows) {
    const update: Record<string, unknown> = {};
    if (r.leadTimeDays !== null) update.leadTimeDays = r.leadTimeDays;
    if (r.isExcluded !== undefined) update.isExcluded = r.isExcluded;
    if (r.note) update.note = r.note.slice(0, 300);
    await prisma.skuMaster.upsert({
      where: { sku: r.sku },
      create: { sku: r.sku, leadTimeDays: r.leadTimeDays, isExcluded: r.isExcluded ?? false, note: r.note?.slice(0, 300) ?? null },
      update,
    });
  }
  const batchId = randomUUID().slice(0, 36);
  await prisma.uploadBatch.create({
    data: { id: batchId, kind: 'LEAD_TIME', filename: file.name.slice(0, 260), rowCount: rows.length, mode: 'UPSERT' },
  });
  return json({ ok: true, upserted: rows.length, skipped: problems.length, problems: problems.slice(0, 20) });
}

/**
 * Edit satu SKU, atau massal:
 *   { sku, leadTimeDays?, isExcluded?, note? }
 *   { bulk: { skus?: string[]; leadTimeDays } }   — skus kosong/absen = SEMUA SKU stok
 */
export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { sku?: string; leadTimeDays?: number | null; isExcluded?: boolean; note?: string | null; bulk?: { skus?: string[]; leadTimeDays: number } }
    | null;
  if (!body) return fail('Body harus JSON');

  if (body.bulk) {
    const days = Math.max(0, Math.round(Number(body.bulk.leadTimeDays)));
    if (!Number.isFinite(days)) return fail('leadTimeDays tidak valid');
    let skus = body.bulk.skus?.filter(Boolean) ?? [];
    if (!skus.length) {
      const all = await prisma.$queryRawUnsafe<{ sku: string }[]>(`SELECT DISTINCT sku FROM stock_current WHERE category = 'Sku'`);
      skus = all.map((r) => r.sku);
    }
    for (let i = 0; i < skus.length; i += 300) {
      const chunk = skus.slice(i, i + 300);
      const placeholders = chunk.map(() => '(?,?,0,NOW())').join(',');
      await prisma.$executeRawUnsafe(
        `INSERT INTO sku_master (sku, leadTimeDays, isExcluded, updatedAt) VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE leadTimeDays=VALUES(leadTimeDays), updatedAt=NOW()`,
        ...chunk.flatMap((s) => [s, days]),
      );
    }
    await prisma.auditLog.create({ data: { action: 'LEAD_TIME_BULK', entity: 'sku_master', detail: `${skus.length} SKU → ${days} hari` } });
    return json({ ok: true, updated: skus.length, leadTimeDays: days });
  }

  if (!body.sku) return fail('sku wajib diisi');
  const data: Record<string, unknown> = {};
  if (body.leadTimeDays === null) data.leadTimeDays = null;
  else if (typeof body.leadTimeDays === 'number') data.leadTimeDays = Math.max(0, Math.round(body.leadTimeDays));
  if (typeof body.isExcluded === 'boolean') data.isExcluded = body.isExcluded;
  if (body.note !== undefined) data.note = body.note ? String(body.note).slice(0, 300) : null;
  if (!Object.keys(data).length) return fail('Tidak ada perubahan');
  const row = await prisma.skuMaster.upsert({
    where: { sku: body.sku },
    create: { sku: body.sku, leadTimeDays: (data.leadTimeDays as number | null) ?? null, isExcluded: (data.isExcluded as boolean) ?? false, note: (data.note as string | null) ?? null },
    update: data,
  });
  await prisma.auditLog.create({ data: { action: 'SKU_MASTER_EDIT', entity: 'sku_master', entityId: body.sku, detail: JSON.stringify(data) } });
  return json(safe({ ok: true, row }));
}

export async function DELETE(req: Request) {
  const sku = new URL(req.url).searchParams.get('sku');
  if (!sku) return fail('sku wajib diisi');
  await prisma.skuMaster.deleteMany({ where: { sku } });
  return json({ ok: true });
}
