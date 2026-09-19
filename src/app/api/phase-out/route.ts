import { prisma } from '@/lib/prisma';
import { keyToUtcDate, toDateKeyUtc, todayKey } from '@/lib/dates';
import { readSheet, pickString } from '@/lib/xlsx';
import { fail, json, safe } from '@/lib/http';
import { DISPOSITIONS, SAP_KEY_LEN, phaseOutKey, sapKey, type Disposition, type MatchType } from '@/lib/phase-out';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * Daftar phase out, digabung dengan angka dari snapshot terakhir.
 * Baris SAP dicocokkan lewat 6 digit terakhir kode, jadi satu baris bisa
 * mengenai lebih dari satu SKU bila kodenya memang dipelihara ganda.
 */
export async function GET() {
  const summary = await prisma.doiSummary.findFirst({ orderBy: { snapshotDate: 'desc' } });
  const [rows, snaps] = await Promise.all([
    prisma.phaseOut.findMany({ orderBy: { matchValue: 'asc' } }),
    summary ? prisma.doiSnapshot.findMany({ where: { snapshotDate: summary.snapshotDate } }) : Promise.resolve([]),
  ]);

  const bySku = new Map(snaps.map((s) => [s.sku, s]));
  const bySap = new Map<string, typeof snaps>();
  for (const s of snaps) {
    const k = sapKey(s.sapCode);
    if (!k) continue;
    const list = bySap.get(k) ?? [];
    list.push(s);
    bySap.set(k, list);
  }

  return json(safe({
    ok: true,
    today: todayKey(),
    sapKeyLen: SAP_KEY_LEN,
    rows: rows.map((r) => {
      const hits = r.matchType === 'SKU'
        ? [bySku.get(r.matchValue)].filter(Boolean) as typeof snaps
        : bySap.get(r.matchValue) ?? [];
      // Bila satu kode mengenai beberapa SKU, angkanya dijumlahkan.
      const stock = hits.reduce((a, s) => a + s.availableQty, 0);
      const transit = hits.reduce((a, s) => a + s.transitQty, 0);
      const ads = hits.reduce((a, s) => a + s.ads1, 0);
      const excess = hits.reduce((a, s) => a + (s.phaseOutExcessQty ?? 0), 0);
      const late = hits.reduce((a, s) => Math.max(a, s.phaseOutLateDays ?? 0), 0);
      const runOut = hits.map((s) => s.runOutDate).filter(Boolean).sort().pop();
      return {
        key: r.key,
        matchType: r.matchType,
        matchValue: r.matchValue,
        sapCode: r.sapCode,
        effectiveDate: r.effectiveDate ? toDateKeyUtc(r.effectiveDate) : null,
        reason: r.reason,
        replacementSku: r.replacementSku,
        targetOutDate: r.targetOutDate ? toDateKeyUtc(r.targetOutDate) : null,
        disposition: r.disposition,
        note: r.note,
        updatedAt: r.updatedAt.toISOString(),
        // hasil lookup ke snapshot
        skuCount: hits.length,
        skus: hits.map((s) => s.sku).join(', ') || null,
        name: hits[0]?.name ?? null,
        stock: hits.length ? stock : null,
        transit: hits.length ? transit : null,
        ads: hits.length ? ads : null,
        runOutDate: runOut ? toDateKeyUtc(runOut) : null,
        excessQty: hits.length ? excess : null,
        lateDays: hits.length ? late : null,
      };
    }),
  }));
}

type Draft = {
  matchType: MatchType; matchValue: string; sapCode: string | null;
  reason: string | null; replacementSku: string | null; note: string | null;
  effectiveDate: string | null; targetOutDate: string | null; disposition: Disposition;
};

function draftFrom(b: Record<string, unknown>): Draft | string {
  const rawSap = String(b.sapCode ?? '').trim();
  const rawSku = String(b.sku ?? '').trim();
  if (!rawSap && !rawSku) return 'Isi kode SAP atau SKU';

  let matchType: MatchType = 'SAP';
  let matchValue: string;
  if (rawSap) {
    const k = sapKey(rawSap);
    if (!k) return `Kode SAP "${rawSap}" terlalu pendek — minimal ${SAP_KEY_LEN} digit`;
    matchValue = k;
  } else {
    matchType = 'SKU';
    matchValue = rawSku;
  }

  if (b.targetOutDate && !isDate(b.targetOutDate)) return 'Target habis harus format YYYY-MM-DD';
  if (b.effectiveDate && !isDate(b.effectiveDate)) return 'Tanggal efektif harus format YYYY-MM-DD';
  const replacementSku = String(b.replacementSku ?? '').trim() || null;
  if (replacementSku && matchType === 'SKU' && replacementSku === matchValue) return 'SKU pengganti tidak boleh sama dengan SKU-nya sendiri';

  return {
    matchType, matchValue,
    sapCode: rawSap || null,
    reason: String(b.reason ?? '').trim().slice(0, 120) || null,
    replacementSku,
    note: String(b.note ?? '').trim().slice(0, 300) || null,
    effectiveDate: isDate(b.effectiveDate) ? b.effectiveDate : null,
    targetOutDate: isDate(b.targetOutDate) ? b.targetOutDate : null,
    disposition: DISPOSITIONS.includes(b.disposition as Disposition) ? (b.disposition as Disposition) : 'SELL_DOWN',
  };
}

const toData = (d: Draft) => ({
  matchType: d.matchType,
  matchValue: d.matchValue,
  sapCode: d.sapCode,
  reason: d.reason,
  replacementSku: d.replacementSku,
  note: d.note,
  effectiveDate: d.effectiveDate ? keyToUtcDate(d.effectiveDate) : null,
  targetOutDate: d.targetOutDate ? keyToUtcDate(d.targetOutDate) : null,
  disposition: d.disposition,
});

/** Tambah satu baris (JSON), atau unggah banyak baris sekaligus (XLSX). */
export async function POST(req: Request) {
  const type = req.headers.get('content-type') || '';

  // ---- Unggah berkas: kolom Kode SAP (wajib) + Alasan / SKU Pengganti / Catatan
  if (type.includes('multipart/form-data')) {
    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) return fail('Berkas belum dipilih');

    let sheet;
    try { sheet = await readSheet(await file.arrayBuffer()); }
    catch (err) { return fail(`Berkas tidak bisa dibaca: ${err instanceof Error ? err.message : err}`); }

    const problems: string[] = [];
    const drafts = new Map<string, Draft>();
    let skipped = 0;
    sheet.forEach((row, i) => {
      const sap = pickString(row, 'Kode SAP', 'KODE SAP', 'SAP', 'Sap Code', 'sapCode', 'Kode');
      const sku = pickString(row, 'SKU', 'Sku', 'Kode SKU');
      if (!sap && !sku) { skipped++; return; }
      const d = draftFrom({
        sapCode: sap ?? '', sku: sku ?? '',
        reason: pickString(row, 'Alasan', 'Reason') ?? '',
        replacementSku: pickString(row, 'SKU Pengganti', 'Pengganti', 'Replacement') ?? '',
        note: pickString(row, 'Catatan', 'Note', 'Keterangan') ?? '',
      });
      if (typeof d === 'string') {
        skipped++;
        if (problems.length < 5) problems.push(`baris ${i + 2}: ${d}`);
        return;
      }
      // Dua kode SAP untuk barang yang sama menghasilkan kunci identik — cukup satu baris.
      drafts.set(phaseOutKey(d.matchType, d.matchValue), d);
    });

    if (!drafts.size) return fail(`Tidak ada baris yang bisa dipakai.${problems.length ? ' ' + problems.join('; ') : ''}`);

    let upserted = 0;
    for (const [key, d] of drafts) {
      const data = toData(d);
      await prisma.phaseOut.upsert({ where: { key }, update: data, create: { key, ...data } });
      upserted++;
    }
    return json({ ok: true, upserted, skipped, problems, duplicates: Math.max(0, sheet.length - skipped - upserted) });
  }

  // ---- Tambah satu baris
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return fail('Body tidak valid');
  const d = draftFrom(body as Record<string, unknown>);
  if (typeof d === 'string') return fail(d);

  const key = phaseOutKey(d.matchType, d.matchValue);
  if (await prisma.phaseOut.findUnique({ where: { key } })) return fail(`${d.sapCode ?? d.matchValue} sudah ada di daftar phase out`);
  await prisma.phaseOut.create({ data: { key, ...toData(d) } });
  return json({ ok: true, key });
}

/** Ubah satu baris. Hanya field yang dikirim yang diubah. */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return fail('Body tidak valid');
  const b = body as Record<string, unknown>;
  const key = String(b.key ?? '').trim();
  if (!key) return fail('key wajib diisi');
  if (!(await prisma.phaseOut.findUnique({ where: { key } }))) return fail('Baris tidak ditemukan', 404);

  const data: Record<string, unknown> = {};
  if (b.targetOutDate !== undefined) {
    if (!b.targetOutDate) data.targetOutDate = null;
    else if (!isDate(b.targetOutDate)) return fail('Target habis harus format YYYY-MM-DD');
    else data.targetOutDate = keyToUtcDate(b.targetOutDate);
  }
  if (b.effectiveDate !== undefined) {
    if (!b.effectiveDate) data.effectiveDate = null;
    else if (!isDate(b.effectiveDate)) return fail('Tanggal efektif harus format YYYY-MM-DD');
    else data.effectiveDate = keyToUtcDate(b.effectiveDate);
  }
  if (b.reason !== undefined) data.reason = String(b.reason ?? '').trim().slice(0, 120) || null;
  if (b.note !== undefined) data.note = String(b.note ?? '').trim().slice(0, 300) || null;
  if (b.replacementSku !== undefined) data.replacementSku = String(b.replacementSku ?? '').trim() || null;
  if (b.disposition !== undefined) {
    if (!DISPOSITIONS.includes(b.disposition as Disposition)) return fail('Disposisi tidak dikenal');
    data.disposition = b.disposition;
  }

  await prisma.phaseOut.update({ where: { key }, data });
  return json({ ok: true, key });
}

/** Keluarkan dari phase out — dengan `?all=1` seluruh daftar dikosongkan. */
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get('all') === '1') {
    const { count } = await prisma.phaseOut.deleteMany({});
    return json({ ok: true, deleted: count });
  }
  const key = url.searchParams.get('key');
  if (!key) return fail('key wajib diisi');
  await prisma.phaseOut.deleteMany({ where: { key } });
  return json({ ok: true, key });
}
