import { dashboardView } from '@/lib/query';
import { json } from '@/lib/http';
import { areaDariUrl } from '@/lib/http-area';

/**
 * Data dashboard: ringkasan + empat daftar pendek.
 *
 * TIDAK BOLEH DI-CACHE DI EDGE. Dulu `s-maxage=300, stale-while-revalidate=1800`
 * dengan alasan "snapshot cuma berubah dua kali sehari (cron 01.00 & 07.30)".
 * Alasan itu salah: ada tombol **Refresh** di halaman ini, dan Refresh menulis
 * snapshot baru kapan saja.
 *
 * Akibatnya dilaporkan user 9 Okt 2026 dan terukur langsung:
 *
 *   /api/dashboard   x-vercel-cache: STALE   age 407   computedAt 08.17 (cron)
 *   /api/monitoring  x-vercel-cache: MISS    age   0   computedAt 12.57 (manual)
 *
 * Satu database, satu snapshotDate — yang beda cuma HTTP cache-nya. Jadi
 * dashboard bisa memperlihatkan angka setengah jam lalu (s-maxage 5 menit +
 * stale-while-revalidate 30 menit) sesudah orang menekan Refresh dan melihat
 * tabel DOI sudah berubah. Tidak ada apa pun di layar yang menjelaskannya, dan
 * yang dicurigai orang adalah perhitungannya.
 *
 * `no-store`, bukan s-maxage kecil: nilai berapa pun di atas 0 tetap berarti
 * "boleh menampilkan angka lama sesudah Refresh". Biayanya satu bacaan DB
 * ±270 ms — murah dibanding angka yang tidak bisa dipercaya.
 *
 * Halaman publik (/api/public/dashboard, /tv) lain urusan: tanpa login, tanpa
 * tombol Refresh, dan memang layar tempel — di sana cache masih masuk akal.
 */
export const revalidate = 0;

export async function GET(req: Request) {
  const view = await dashboardView(areaDariUrl(req));
  const res = json({ ok: true, ...view });
  res.headers.set('Cache-Control', 'no-store, must-revalidate');
  return res;
}
