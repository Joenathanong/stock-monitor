import { prisma } from '@/lib/prisma';
import { getSettings } from '@/lib/compute';
import { buildExclusionMap } from '@/lib/exclusion';
import { addDays, isValidDateKey, keyToUtcDate, toDateKeyUtc, todayKey } from '@/lib/dates';
import { fail, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Daftar tanggal yang dikecualikan (aturan + manual) untuk 120 hari ke belakang & 60 ke depan. */
export async function GET() {
  const s = await getSettings();
  const manual = await prisma.exclusionDate.findMany({ orderBy: { date: 'desc' } });
  const today = todayKey();
  const map = buildExclusionMap(
    addDays(today, -120), addDays(today, 60),
    { paydayDay: s.paydayDay, excludeDoubleDates: s.excludeDoubleDates },
    manual.map((m) => ({ date: toDateKeyUtc(m.date), reason: m.reason })),
  );
  const manualSet = new Set(manual.map((m) => toDateKeyUtc(m.date)));
  return json({
    ok: true,
    today,
    rows: [...map.entries()].map(([date, reason]) => ({ date, reason, manual: manualSet.has(date) })).sort((a, b) => b.date.localeCompare(a.date)),
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { date?: string; reason?: string } | null;
  if (!body?.date || !isValidDateKey(body.date)) return fail('Tanggal harus YYYY-MM-DD');
  const reason = (body.reason || 'Manual').slice(0, 120);
  await prisma.exclusionDate.upsert({ where: { date: keyToUtcDate(body.date) }, create: { date: keyToUtcDate(body.date), reason }, update: { reason } });
  return json({ ok: true });
}

export async function DELETE(req: Request) {
  const date = new URL(req.url).searchParams.get('date');
  if (!date || !isValidDateKey(date)) return fail('Tanggal harus YYYY-MM-DD');
  await prisma.exclusionDate.deleteMany({ where: { date: keyToUtcDate(date) } });
  return json({ ok: true });
}
