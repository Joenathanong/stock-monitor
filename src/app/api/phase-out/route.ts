import { prisma } from '@/lib/prisma';
import { keyToUtcDate, toDateKeyUtc, todayKey } from '@/lib/dates';
import { fail, json, safe } from '@/lib/http';
import { DISPOSITIONS, type Disposition } from '@/lib/phase-out';

export const dynamic = 'force-dynamic';

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Daftar SKU phase out, digabung dengan stok & DOI dari snapshot terakhir. */
export async function GET() {
  const summary = await prisma.doiSummary.findFirst({ orderBy: { snapshotDate: 'desc' } });
  const [rows, snaps] = await Promise.all([
    prisma.phaseOut.findMany({ orderBy: { sku: 'asc' } }),
    summary
      ? prisma.doiSnapshot.findMany({ where: { snapshotDate: summary.snapshotDate } })
      : Promise.resolve([]),
  ]);
  const snap = new Map(snaps.map((s) => [s.sku, s]));

  return json(safe({
    ok: true,
    today: todayKey(),
    rows: rows.map((r) => {
      const s = snap.get(r.sku);
      return {
        sku: r.sku,
        effectiveDate: toDateKeyUtc(r.effectiveDate),
        reason: r.reason,
        replacementSku: r.replacementSku,
        targetOutDate: r.targetOutDate ? toDateKeyUtc(r.targetOutDate) : null,
        disposition: r.disposition,
        note: r.note,
        updatedAt: r.updatedAt.toISOString(),
        // dari snapshot terakhir — null bila SKU belum pernah ikut perhitungan
        name: s?.name ?? null,
        stock: s?.availableQty ?? null,
        transit: s?.transitQty ?? null,
        ads: s?.ads1 ?? null,
        runOutDate: s?.runOutDate ? toDateKeyUtc(s.runOutDate) : null,
        excessQty: s?.phaseOutExcessQty ?? null,
        lateDays: s?.phaseOutLateDays ?? null,
      };
    }),
  }));
}

/** Tambah satu SKU ke phase out. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return fail('Body tidak valid');
  const b = body as Record<string, unknown>;

  const sku = String(b.sku ?? '').trim();
  if (!sku) return fail('SKU wajib diisi');
  if (await prisma.phaseOut.findUnique({ where: { sku } })) return fail(`${sku} sudah ada di daftar phase out`);

  const effectiveDate = isDate(b.effectiveDate) ? b.effectiveDate : todayKey();
  if (b.targetOutDate && !isDate(b.targetOutDate)) return fail('Target habis harus format YYYY-MM-DD');
  if (isDate(b.targetOutDate) && b.targetOutDate < effectiveDate) return fail('Target habis tidak boleh sebelum tanggal efektif');

  const disposition = DISPOSITIONS.includes(b.disposition as Disposition) ? (b.disposition as Disposition) : 'SELL_DOWN';
  const replacementSku = String(b.replacementSku ?? '').trim() || null;
  if (replacementSku === sku) return fail('SKU pengganti tidak boleh sama dengan SKU-nya sendiri');

  await prisma.phaseOut.create({
    data: {
      sku,
      effectiveDate: keyToUtcDate(effectiveDate),
      reason: String(b.reason ?? '').trim().slice(0, 120) || null,
      replacementSku,
      targetOutDate: isDate(b.targetOutDate) ? keyToUtcDate(b.targetOutDate) : null,
      disposition,
      note: String(b.note ?? '').trim().slice(0, 300) || null,
    },
  });
  return json({ ok: true, sku });
}

/** Ubah satu baris. Hanya field yang dikirim yang diubah. */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return fail('Body tidak valid');
  const b = body as Record<string, unknown>;
  const sku = String(b.sku ?? '').trim();
  if (!sku) return fail('SKU wajib diisi');

  const current = await prisma.phaseOut.findUnique({ where: { sku } });
  if (!current) return fail(`${sku} tidak ada di daftar phase out`, 404);

  const data: Record<string, unknown> = {};
  if (b.effectiveDate !== undefined) {
    if (!isDate(b.effectiveDate)) return fail('Tanggal efektif harus format YYYY-MM-DD');
    data.effectiveDate = keyToUtcDate(b.effectiveDate);
  }
  if (b.targetOutDate !== undefined) {
    if (b.targetOutDate === null || b.targetOutDate === '') data.targetOutDate = null;
    else if (!isDate(b.targetOutDate)) return fail('Target habis harus format YYYY-MM-DD');
    else data.targetOutDate = keyToUtcDate(b.targetOutDate);
  }
  if (b.reason !== undefined) data.reason = String(b.reason ?? '').trim().slice(0, 120) || null;
  if (b.note !== undefined) data.note = String(b.note ?? '').trim().slice(0, 300) || null;
  if (b.replacementSku !== undefined) {
    const rep = String(b.replacementSku ?? '').trim() || null;
    if (rep === sku) return fail('SKU pengganti tidak boleh sama dengan SKU-nya sendiri');
    data.replacementSku = rep;
  }
  if (b.disposition !== undefined) {
    if (!DISPOSITIONS.includes(b.disposition as Disposition)) return fail('Disposisi tidak dikenal');
    data.disposition = b.disposition;
  }

  await prisma.phaseOut.update({ where: { sku }, data });
  return json({ ok: true, sku });
}

/** Keluarkan SKU dari phase out (kembali dihitung normal setelah Hitung ulang). */
export async function DELETE(req: Request) {
  const sku = new URL(req.url).searchParams.get('sku');
  if (!sku) return fail('SKU wajib diisi');
  await prisma.phaseOut.deleteMany({ where: { sku } });
  return json({ ok: true, sku });
}
