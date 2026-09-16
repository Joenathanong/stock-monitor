import { getSettings, runCompute } from '@/lib/compute';
import { checkCronAuth, fail, json } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Jadwal 07.30 WIB (00:30 UTC): tarik stok → hitung DOI → simpan snapshot hari ini. */
async function run(req: Request) {
  const denied = checkCronAuth(req);
  if (denied) return fail(denied, 401);
  const settings = await getSettings();
  if (!settings.autoCompute) return json({ ok: true, skipped: true, message: 'Perhitungan otomatis dimatikan di Pengaturan' });
  try {
    return json(await runCompute('cron', true));
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Perhitungan gagal', 502);
  }
}

export const GET = run;
export const POST = run;
