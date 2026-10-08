import { runCompute } from '@/lib/compute';
import { fail, json } from '@/lib/http';

export const dynamic = 'force-dynamic';
// Vercel Hobby membatasi satu fungsi 60 dtk. Menulis 300 tidak menaikkannya —
// prosesnya tetap dibunuh di detik ke-60, dan kuncinya ikut tertinggal.
export const maxDuration = 60;

/**
 * Tombol Refresh: tarik stok OCS saat ini → hitung ulang → timpa snapshot hari ini.
 * `{ "withStock": false }` menghitung ulang tanpa memanggil OCS (mis. setelah
 * unggah transit atau mengubah pengaturan).
 * `{ "skipTransit": true }` dipakai tombol Refresh, yang sudah memanggil
 * /api/transit/sync lebih dulu supaya SIT ditarik TUNTAS dalam permintaannya
 * sendiri. Tanpa flag ini transit ditarik dua kali dan anggaran 52 dtk-nya
 * dipakai untuk pekerjaan yang sudah selesai.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { withStock?: boolean; skipTransit?: boolean };
  try {
    return json(await runCompute('manual', body.withStock !== false, undefined, body.skipTransit === true));
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Perhitungan gagal', 502);
  }
}
