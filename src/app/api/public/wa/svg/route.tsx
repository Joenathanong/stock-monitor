import { NextResponse } from 'next/server';
import { Poster } from '@/app/wa/poster';
import type { DataWa } from '@/app/wa/types';
import { tolakAksesPoster } from '@/lib/wa-akses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Poster sebagai berkas SVG — untuk bot yang TIDAK memakai browser.
 *
 *   curl -s "https://…/api/public/wa/svg?k=RAHASIA" -o doi.svg
 *   convert doi.svg doi.jpg     # ImageMagick, atau sharp
 *
 * Komponen posternya sama persis dengan yang dipakai halaman /wa, jadi tidak ada
 * dua versi gambar yang bisa berbeda diam-diam.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const k = url.searchParams.get('k');
  const tolak = await tolakAksesPoster(req);
  if (tolak) {
    const status = tolak.startsWith('WA_PAGE_TOKEN') ? 503 : 401;
    return NextResponse.json({ ok: false, error: tolak }, { status });
  }

  // Ambil datanya lewat endpoint yang sama dengan yang dipakai halaman, supaya
  // bentuk datanya dijamin identik.
  //
  // Izin pemanggil DITERUSKAN apa adanya: `?k=` kalau ia bot, atau cookie
  // sesinya kalau ia orang yang login. Tanpa meneruskan cookie, pengguna yang
  // masuk lewat menu akan lolos di sini lalu ditolak 401 oleh panggilan dalam
  // ini — gagal di tempat yang tidak ada hubungannya dengan sebabnya.
  const dalam = new URL('/api/public/wa', url.origin);
  if (k) dalam.searchParams.set('k', k);
  const cookie = req.headers.get('cookie');
  const res = await fetch(dalam, {
    cache: 'no-store',
    headers: cookie ? { cookie } : undefined,
  });
  if (!res.ok) return NextResponse.json({ ok: false, error: 'Data tidak bisa diambil' }, { status: 502 });
  const data = (await res.json()) as DataWa;

  // Impor DINAMIS: Next menolak `import … from 'react-dom/server'` di app router
  // lewat pemeriksaan webpack ("You're importing a component that imports
  // react-dom/server"). Peringatan itu ditujukan untuk komponen, sedangkan di
  // sini kita memang sengaja merender jadi teks di dalam route handler.
  const { renderToStaticMarkup } = await import('react-dom/server');
  const svg = renderToStaticMarkup(<Poster data={data} />);
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?>\n${svg}`, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Disposition': 'inline; filename="doi-harian.svg"',
    },
  });
}
