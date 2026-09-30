import { prisma } from '@/lib/prisma';
import { readSheet, pickDate, pickInt, pickString } from '@/lib/xlsx';
import { keyToUtcDate, toDateKeyUtc } from '@/lib/dates';
import { fail, json, safe } from '@/lib/http';
import { getSettings } from '@/lib/compute';
import { formatCtnPcs } from '@/lib/receive';
import { randomUUID } from 'node:crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Transit hanya ikut terhitung kalau pasangan (SKU, area) ada di daftar stok
 * OCS aktif — mesin DOI menempel transit ke baris stok, bukan sebaliknya — DAN
 * perhitungan sudah dijalankan setelah datanya berubah. Dua sebab berbeda,
 * jadi dua status berbeda: angka 0 di dashboard tidak boleh jadi teka-teki.
 */
type Hitung = 'IKUT' | 'BELUM_HITUNG' | 'TIDAK_ADA_STOK';

async function statusHitung(): Promise<{
  aktif: Set<string>;
  snapshot: Map<string, number>;
  snapshotDate: string | null;
}> {
  const s = await getSettings();
  const activeClause = s.includeInactive ? '' : 'AND isActive = 1';
  const clearanceClause = s.includeClearance ? '' : "AND sku NOT LIKE 'CS-%'";
  const [stok, terakhir] = await Promise.all([
    // Seluruh area — transit ke Surabaya dinilai terhadap stok Surabaya.
    prisma.$queryRawUnsafe<{ sku: string; areaId: string }[]>(
      `SELECT DISTINCT sku, areaId FROM stock_current
        WHERE category = 'Sku' ${activeClause} ${clearanceClause}`,
    ),
    prisma.doiSummary.findFirst({ orderBy: { snapshotDate: 'desc' }, select: { snapshotDate: true } }),
  ]);
  const snapshot = new Map<string, number>();
  let snapshotDate: string | null = null;
  if (terakhir) {
    snapshotDate = toDateKeyUtc(terakhir.snapshotDate);
    const snap = await prisma.doiSnapshot.findMany({
      where: { snapshotDate: terakhir.snapshotDate },
      select: { sku: true, areaId: true, transitQty: true },
    });
    for (const r of snap) snapshot.set(`${r.sku}\u0000${r.areaId}`, r.transitQty);
  }
  return { aktif: new Set(stok.map((r) => `${r.sku}\u0000${r.areaId}`)), snapshot, snapshotDate };
}

export async function GET() {
  const [rows, batches, boxes] = await Promise.all([
    prisma.transitStock.findMany({ orderBy: [{ areaId: 'asc' }, { qty: 'desc' }] }),
    prisma.uploadBatch.findMany({ where: { kind: 'TRANSIT' }, orderBy: { uploadedAt: 'desc' }, take: 10 }),
    prisma.skuBox.findMany(),
  ]);
  const { aktif, snapshot, snapshotDate } = await statusHitung();
  const box = new Map(boxes.map((b) => [b.sku, b]));

  const out = rows.map((r) => {
    const k = `${r.sku}\u0000${r.areaId}`;
    const hitung: Hitung = !aktif.has(k)
      ? 'TIDAK_ADA_STOK'
      : snapshot.get(k) === r.qty ? 'IKUT' : 'BELUM_HITUNG';
    const b = box.get(r.sku);
    // Isi karton HANYA untuk menampilkan ctn/pcs. Qty tetap apa adanya dari
    // DoQty — tidak pernah dikalikan dengan angka ini.
    const perCtn = b?.manual ?? b?.perCtn ?? 0;
    return {
      sku: r.sku,
      areaId: r.areaId,
      qty: r.qty,
      qtyBatch: r.qtyBatch,
      source: r.source,
      docNums: r.docNums,
      eta: r.eta ? toDateKeyUtc(r.eta) : null,
      note: r.note,
      updatedAt: r.updatedAt.toISOString(),
      hitung,
      qtyDipakai: snapshot.get(k) ?? 0,
      perCtn,
      ctnPcs: formatCtnPcs(r.qty, perCtn),
      boxMismatch: b?.mismatch ?? false,
    };
  });

  const jml = (h: Hitung) => out.filter((r) => r.hitung === h);
  const perArea = new Map<string, { area: string; sku: number; qty: number; ocs: number; manual: number }>();
  for (const r of out) {
    const a = perArea.get(r.areaId) ?? { area: r.areaId, sku: 0, qty: 0, ocs: 0, manual: 0 };
    a.sku += 1; a.qty += r.qty;
    if (r.source === 'ocs') a.ocs += r.qty; else a.manual += r.qty;
    perArea.set(r.areaId, a);
  }

  return json(safe({
    ok: true,
    rows: out,
    batches: batches.map((b) => ({ ...b, uploadedAt: b.uploadedAt.toISOString() })),
    snapshotDate,
    perArea: [...perArea.values()].sort((a, b) => b.qty - a.qty),
    ringkas: {
      total: out.reduce((a, r) => a + r.qty, 0),
      ikut: jml('IKUT').reduce((a, r) => a + r.qty, 0),
      dariOcs: out.filter((r) => r.source === 'ocs').reduce((a, r) => a + r.qty, 0),
      manual: out.filter((r) => r.source !== 'ocs').reduce((a, r) => a + r.qty, 0),
      boxBeda: out.filter((r) => r.boxMismatch).length,
      belumHitung: { sku: jml('BELUM_HITUNG').length, qty: jml('BELUM_HITUNG').reduce((a, r) => a + r.qty, 0) },
      tidakAdaStok: {
        sku: jml('TIDAK_ADA_STOK').length,
        qty: jml('TIDAK_ADA_STOK').reduce((a, r) => a + r.qty, 0),
        contoh: jml('TIDAK_ADA_STOK').slice(0, 8).map((r) => `${r.sku} (${r.areaId})`),
      },
    },
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
  const merged = new Map<string, { sku: string; areaId: string; qty: number; eta: Date | null; note: string | null }>();
  sheet.forEach((r, i) => {
    const line = i + 2;
    const sku = pickString(r, 'sku', 'seller sku', 'sellersku', 'kode');
    const qty = pickInt(r, 'qty', 'quantity', 'jumlah', 'stok dalam perjalanan', 'transit');
    if (!sku) { problems.push(`Baris ${line}: SKU kosong`); return; }
    if (qty === null || qty < 0) { problems.push(`Baris ${line}: Qty tidak valid`); return; }
    // Kolom area boleh kosong → Pusat, supaya berkas lama tetap bisa diunggah.
    const areaId = pickString(r, 'area', 'areaid', 'gudang', 'warehouse', 'kota') || 'Pusat';
    const etaKey = pickDate(r, 'eta', 'estimasi', 'tanggal tiba', 'arrival');
    const note = pickString(r, 'note', 'catatan', 'keterangan', 'po', 'no po');
    const k = `${sku}\u0000${areaId}`;
    const prev = merged.get(k);
    if (prev) { prev.qty += qty; if (!prev.eta && etaKey) prev.eta = keyToUtcDate(etaKey); }
    else merged.set(k, { sku, areaId, qty, eta: etaKey ? keyToUtcDate(etaKey) : null, note: note?.slice(0, 300) ?? null });
  });
  const rows = [...merged.values()].filter((r) => r.qty > 0);
  if (!rows.length && problems.length) return fail(`Tidak ada baris valid. ${problems.slice(0, 5).join('; ')}`);

  const batchId = randomUUID().slice(0, 36);
  await prisma.$transaction([
    // HANYA baris manual yang diganti. Baris dari OCS dibiarkan — unggahan
    // orang tidak boleh menghapus data yang ditarik otomatis, dan sebaliknya.
    prisma.transitStock.deleteMany({ where: { source: 'manual' } }),
    prisma.transitStock.createMany({ data: rows.map((r) => ({ ...r, batchId, source: 'manual' })) }),
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
  const body = (await req.json().catch(() => null)) as { sku?: string; areaId?: string; qty?: number; eta?: string | null; note?: string } | null;
  if (!body?.sku) return fail('sku wajib diisi');
  const areaId = body.areaId || 'Pusat';
  const qty = typeof body.qty === 'number' ? Math.max(0, Math.round(body.qty)) : undefined;
  if (qty === 0) {
    await prisma.transitStock.deleteMany({ where: { sku: body.sku, areaId } });
    return json({ ok: true, deleted: true });
  }
  const data: { qty?: number; eta?: Date | null; note?: string } = {};
  if (qty !== undefined) data.qty = qty;
  if (body.eta === null) data.eta = null;
  else if (typeof body.eta === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.eta)) data.eta = keyToUtcDate(body.eta);
  if (typeof body.note === 'string') data.note = body.note.slice(0, 300);
  const row = await prisma.transitStock.upsert({
    where: { sku_areaId: { sku: body.sku, areaId } },
    create: { sku: body.sku, areaId, qty: qty ?? 0, eta: data.eta ?? null, note: data.note ?? null, source: 'manual' },
    update: data,
  });
  await prisma.auditLog.create({ data: { action: 'TRANSIT_EDIT', entity: 'transit_stock', entityId: `${body.sku}/${areaId}`, detail: JSON.stringify(data) } });
  return json(safe({ ok: true, row: { ...row, eta: row.eta ? toDateKeyUtc(row.eta) : null } }));
}

/**
 * Kosongkan transit. Bawaannya HANYA baris manual — baris OCS akan kembali
 * sendiri pada sinkronisasi berikutnya, jadi menghapusnya cuma membuat angka
 * dashboard salah sampai sinkronisasi berikutnya. `?semua=1` menghapus keduanya.
 */
export async function DELETE(req: Request) {
  const semua = new URL(req.url).searchParams.get('semua') === '1';
  const res = await prisma.transitStock.deleteMany(semua ? {} : { where: { source: 'manual' } });
  await prisma.auditLog.create({
    data: { action: 'TRANSIT_CLEAR', entity: 'transit_stock', detail: `${res.count} baris${semua ? ' (termasuk OCS)' : ' (manual saja)'}` },
  });
  return json({ ok: true, deleted: res.count, semua });
}
