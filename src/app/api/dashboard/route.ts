import { dashboardView } from '@/lib/query';
import { json } from '@/lib/http';

/**
 * Data dashboard: ringkasan + empat daftar pendek. Snapshot hanya berubah dua kali
 * sehari (cron 01.00 & 07.30), jadi aman di-cache sebentar di edge — ini yang
 * menghilangkan tunggu beberapa detik tiap kali dashboard dibuka.
 */
export const revalidate = 0;

export async function GET() {
  const view = await dashboardView();
  const res = json({ ok: true, ...view });
  res.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=1800');
  return res;
}
