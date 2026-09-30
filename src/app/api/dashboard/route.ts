import { dashboardView } from '@/lib/query';
import { json } from '@/lib/http';
import { areaDariUrl } from '@/lib/http-area';

/**
 * Data dashboard: ringkasan + empat daftar pendek. Snapshot hanya berubah dua kali
 * sehari (cron 01.00 & 07.30), jadi aman di-cache sebentar di edge — ini yang
 * menghilangkan tunggu beberapa detik tiap kali dashboard dibuka.
 */
export const revalidate = 0;

export async function GET(req: Request) {
  const view = await dashboardView(areaDariUrl(req));
  const res = json({ ok: true, ...view });
  // Cache dibedakan per area — tanpa Vary, Surabaya bisa menerima cache Pusat.
  res.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=1800');
  return res;
}
