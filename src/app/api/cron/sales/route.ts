import { syncSales } from '@/lib/sync';
import { getSettings } from '@/lib/compute';
import { checkCronAuth, fail, json } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Jadwal 01.00 WIB (18:00 UTC): tarik ulang 7 hari terakhir dari OCS. */
async function run(req: Request) {
  const denied = checkCronAuth(req);
  if (denied) return fail(denied, 401);
  const settings = await getSettings();
  if (!settings.autoSyncSales) return json({ ok: true, skipped: true, message: 'Sinkronisasi penjualan dimatikan di Pengaturan' });
  const url = new URL(req.url);
  const days = Number(url.searchParams.get('days') || settings.salesSyncLookbackDays);
  try {
    return json(await syncSales(settings, { trigger: 'cron', days }));
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Sinkronisasi penjualan gagal', 502);
  }
}

export const GET = run;
export const POST = run;
