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
  const area = new URL(req.url).searchParams.get('area')?.trim() || null;
  const view = await dashboardView(area);
  const res = NextResponse.json({ ok: true, ...view });
  // Layar tempel tanpa login dan tanpa tombol Refresh, jadi cache edge masih
  // masuk akal di sini — tapi jendelanya dipersempit 9 Okt 2026. Yang lama
  // (5 menit + 30 menit stale) berarti layar gudang bisa menampilkan angka
  // setengah jam lalu sesudah seseorang menekan Refresh di aplikasi, dan di
  // layar itu TIDAK ADA cara mengetahuinya. Satu menit cukup untuk menahan
  // beban, dan tidak cukup lama untuk membuat orang salah membaca.
  res.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  return res;
}
