import { muatSugestPo } from '@/lib/sugest-po-store';
import { json, safe } from '@/lib/http';
import { areaDariUrl } from '@/lib/http-area';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Saran open PO per cabang.
 *
 * `no-store` dengan sengaja, bukan `s-maxage`. KEJADIAN 9 Okt 2026: dashboard
 * memakai `s-maxage + stale-while-revalidate` pada route BER-AUTH, dan CDN
 * menyajikan angka basi setelah user menekan Refresh — terukur `x-vercel-cache:
 * STALE, age 407`. Halaman ini lebih berbahaya lagi kalau basi: orang memesan
 * barang berdasarkan saldo gudang yang sudah berubah.
 */
export async function GET(req: Request) {
  const area = areaDariUrl(req);
  const hasil = await muatSugestPo(area);
  const res = json(safe({ ok: true, ...hasil }));
  res.headers.set('Cache-Control', 'no-store, must-revalidate');
  return res;
}
