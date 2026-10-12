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
 * Endpoint sendiri, dan SEJAK 12 Okt 2026 tombol Refresh memanggilnya sebagai
 * langkah ketiga. Tetap tidak digabung ke /api/compute: payloadnya 2,5 MB dan
 * /api/compute sudah berlomba dengan batas 60 detik untuk snapshot DOI dan titik
 * tren ATP — pekerjaan yang tidak bisa dibuat ulang besok kalau waktunya habis.
 *
 * Refresh memanggilnya TANPA `force`, jadi jeda `bundle_refresh_hours` menjawab
 * "masih segar" dari satu kueri pada klik-klik berikutnya. `?force=1` (tombol di
 * /atp) mengabaikan jeda itu.
 */
export async function POST(req: Request) {
  const sesi = await sessionFromRequest(req);
  if (!canWrite(sesi?.r)) return fail('Tidak berwenang menarik komposisi bundling', 403);
  const force = new URL(req.url).searchParams.get('force') === '1';
  const s = await getSettings();
  const hasil = await syncBundle(45_000, s.bundleRefreshHours, force);
  return json(hasil, hasil.ok ? 200 : 502);
}
