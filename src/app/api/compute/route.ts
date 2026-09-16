import { runCompute } from '@/lib/compute';
import { fail, json } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Tombol Refresh: tarik stok OCS saat ini → hitung ulang → timpa snapshot hari ini.
 * `{ "withStock": false }` menghitung ulang tanpa memanggil OCS (mis. setelah
 * unggah transit atau mengubah pengaturan).
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { withStock?: boolean };
  try {
    return json(await runCompute('manual', body.withStock !== false));
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Perhitungan gagal', 502);
  }
}
