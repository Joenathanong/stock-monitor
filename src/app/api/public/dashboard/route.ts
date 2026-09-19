import { NextResponse } from 'next/server';
import { dashboardView } from '@/lib/query';

export const dynamic = 'force-dynamic';

/**
 * Data dashboard TANPA login. Bila PUBLIC_TV_TOKEN diset di environment,
 * halaman harus dibuka dengan ?key=<token> — sama seperti dashboard TV.
 * Isinya hanya ringkasan + daftar pendek; tidak ada data tulis di sini.
 */
export async function GET(req: Request) {
  const token = process.env.PUBLIC_TV_TOKEN;
  if (token && new URL(req.url).searchParams.get('key') !== token) {
    return NextResponse.json({ ok: false, error: 'Kunci dashboard salah' }, { status: 401 });
  }
  const view = await dashboardView();
  const res = NextResponse.json({ ok: true, ...view });
  res.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=1800');
  return res;
}
