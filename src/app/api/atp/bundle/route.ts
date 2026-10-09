import { fail, json } from '@/lib/http';
import { sessionFromRequest, canWrite } from '@/lib/auth';
import { syncBundle } from '@/lib/sync';
import { getSettings } from '@/lib/compute';

export const dynamic = 'force-dynamic';
// Vercel Hobby membunuh satu fungsi di detik ke-60. Payload GetBundleStock 2,5 MB
// dan ±2,4 dtk saat diukur 9 Okt 2026, jadi anggarannya longgar — tapi angka di
// bawah ini tetap di bawah 60, bukan angka khayalan.
export const maxDuration = 60;

/**
 * Tarik komposisi bundling dari OCS.
 *
 * SENGAJA endpoint sendiri, tidak ikut /api/compute (tombol Refresh): komposisi
 * bundling itu master data yang jarang berubah, dan Refresh sudah punya
 * pekerjaan yang harus selesai dalam 60 detik. `?force=1` mengabaikan jeda
 * `bundle_refresh_hours`.
 */
export async function POST(req: Request) {
  const sesi = await sessionFromRequest(req);
  if (!canWrite(sesi?.r)) return fail('Tidak berwenang menarik komposisi bundling', 403);
  const force = new URL(req.url).searchParams.get('force') === '1';
  const s = await getSettings();
  const hasil = await syncBundle(45_000, s.bundleRefreshHours, force);
  return json(hasil, hasil.ok ? 200 : 502);
}
