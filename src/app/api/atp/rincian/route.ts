import { fail, json, safe } from '@/lib/http';
import { sessionFromRequest } from '@/lib/auth';
import { rincianAtpArea } from '@/lib/atp-store';
import { AMBANG_ATP_BAWAAN } from '@/lib/atp';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Rincian ATP satu cabang: siapa yang ikut pembagi, siapa yang tidak, dan kenapa.
 *
 * WAJIB LOGIN, dan itu keputusan yang disengaja. Halaman /wa bisa dibuka tanpa
 * login dengan `?k=<WA_PAGE_TOKEN>` supaya bot WhatsApp bisa memotretnya —
 * token itu dimaksudkan untuk SATU gambar ringkasan. Endpoint ini mengembalikan
 * daftar SKU beserta stok per cabang, jadi menerima token poster di sini berarti
 * memperluas apa yang bisa diambil siapa pun yang memegangnya. Orang yang
 * membuka /wa lewat tautan token akan melihat pesan "perlu login" di panelnya,
 * bukan datanya.
 */
export async function GET(req: Request) {
  const sesi = await sessionFromRequest(req);
  if (!sesi) return fail('Perlu login untuk melihat rincian ATP', 401);

  const u = new URL(req.url);
  const area = String(u.searchParams.get('area') ?? '').trim();
  if (!area) return fail('Parameter `area` wajib diisi');

  const n = Number(u.searchParams.get('ambang'));
  const ambang = Number.isFinite(n) ? Math.min(10_000, Math.max(0, Math.trunc(n))) : AMBANG_ATP_BAWAAN;
  const b = Number(u.searchParams.get('batas'));
  const batas = Number.isFinite(b) ? Math.min(2_000, Math.max(10, Math.trunc(b))) : 300;

  try {
    const hasil = await rincianAtpArea(area, ambang, batas);
    if (!hasil.siapTabel) return fail('Tabel atp_share belum ada — jalankan `npm run db:push`', 503);
    return json(safe({ ok: true, ...hasil }));
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Rincian ATP gagal', 502);
  }
}
