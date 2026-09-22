import { syncSales } from '@/lib/sync';
import { getSettings } from '@/lib/compute';
import { diffDays, isValidDateKey } from '@/lib/dates';
import { fail, json } from '@/lib/http';

export const dynamic = 'force-dynamic';
// Vercel Hobby membatasi satu fungsi 60 dtk. Menulis 300 tidak menaikkannya —
// prosesnya tetap dibunuh di detik ke-60, dan kuncinya ikut tertinggal.
export const maxDuration = 60;

/**
 * Tarik penjualan manual dari UI. Bisa `days` (N hari terakhir) atau rentang
 * `from`..`to`. Rentang dibatasi 31 hari per permintaan supaya muat di batas
 * waktu fungsi Vercel (±2 detik per hari untuk satu area).
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { days?: number; from?: string; to?: string };
  const settings = await getSettings();
  try {
    if (body.from && body.to) {
      if (!isValidDateKey(body.from) || !isValidDateKey(body.to)) return fail('Tanggal harus YYYY-MM-DD');
      const span = diffDays(body.from, body.to) + 1;
      if (span < 1) return fail('Rentang terbalik');
      if (span > 31) return fail('Maksimal 31 hari per penarikan — ulangi untuk bulan berikutnya');
      return json(await syncSales(settings, { trigger: 'manual', from: body.from, to: body.to }));
    }
    const days = Math.min(31, Math.max(1, Number(body.days) || settings.salesSyncLookbackDays));
    return json(await syncSales(settings, { trigger: 'manual', days }));
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Sinkronisasi gagal', 502);
  }
}
