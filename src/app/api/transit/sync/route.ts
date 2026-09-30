import { syncTransit } from '@/lib/sync';
import { getSettings } from '@/lib/compute';
import { fail, json } from '@/lib/http';

export const dynamic = 'force-dynamic';
// Vercel Hobby membatasi satu fungsi 60 dtk. 22 dokumen × 1 panggilan berurutan
// bisa lewat dari itu, jadi syncTransit beranggaran dan melapor kalau belum tuntas.
export const maxDuration = 60;

/** Tarik barang dalam perjalanan dari OCS sekarang juga. */
export async function POST(req: Request) {
  const force = new URL(req.url).searchParams.get('force') === '1';
  const s = await getSettings();
  if (!s.transitEnabled) return json({ ok: true, skipped: true, message: 'Penarikan transit dimatikan di Pengaturan' });
  try {
    return json(await syncTransit(50_000, s.transitRefreshHours, force));
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Penarikan transit gagal', 502);
  }
}
