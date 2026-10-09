import { prisma } from '@/lib/prisma';
import { fail, json } from '@/lib/http';
import { sessionFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Preferensi tampilan milik PENGGUNA YANG SEDANG LOGIN.
 *
 * Dipakai DataGrid menyimpan tata letak tabel (urutan & lebar kolom, kolom yang
 * disembunyikan, urutan sort) supaya tetap sama di login berikutnya — termasuk
 * dari komputer atau PDT yang lain, yang tidak bisa dijawab localStorage.
 *
 * TIDAK butuh `canWrite`: ini tata letak milik si pemakai sendiri, bukan data
 * perusahaan. Peran "Lihat saja" pun berhak merapikan tabelnya.
 *
 * Dua pembatasan yang disengaja, supaya endpoint ini tidak jadi tempat
 * penyimpanan bebas untuk apa pun yang dikirim klien:
 *   - `key` harus cocok `grid:<id>`;
 *   - `value` maksimal 8 KB dan harus JSON yang sah.
 */
const POLA_KEY = /^grid:[A-Za-z0-9_-]{1,40}$/;
const MAKS_BYTE = 8 * 1024;

/** Tabel belum ada (db:push belum jalan) tidak boleh merusak halaman. */
function belumAda(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /user_pref/i.test(m) && /doesn't exist|does not exist|Unknown table|no such table|P2021/i.test(m);
}

export async function GET(req: Request) {
  const sesi = await sessionFromRequest(req);
  if (!sesi) return fail('Belum login', 401);
  const key = String(new URL(req.url).searchParams.get('key') ?? '');
  if (!POLA_KEY.test(key)) return fail('key tidak sah', 400);
  try {
    const row = await prisma.userPref.findUnique({ where: { userId_prefKey: { userId: sesi.uid, prefKey: key } } });
    return json({ ok: true, value: row?.value ?? null, updatedAt: row?.updatedAt ?? null });
  } catch (e) {
    // Belum di-push: jawab "tidak ada", bukan galat. Tabelnya tetap jalan
    // dengan localStorage, dan halamannya tidak perlu tahu.
    if (belumAda(e)) return json({ ok: true, value: null, siap: false });
    throw e;
  }
}

export async function PUT(req: Request) {
  const sesi = await sessionFromRequest(req);
  if (!sesi) return fail('Belum login', 401);
  const b = (await req.json().catch(() => null)) as { key?: string; value?: string } | null;
  const key = String(b?.key ?? '');
  const value = String(b?.value ?? '');
  if (!POLA_KEY.test(key)) return fail('key tidak sah', 400);
  if (!value) return fail('value kosong');
  if (Buffer.byteLength(value, 'utf8') > MAKS_BYTE) return fail(`value lebih dari ${MAKS_BYTE} byte`);
  try { JSON.parse(value); } catch { return fail('value harus JSON yang sah'); }
  try {
    await prisma.userPref.upsert({
      where: { userId_prefKey: { userId: sesi.uid, prefKey: key } },
      create: { userId: sesi.uid, prefKey: key, value },
      update: { value },
    });
    return json({ ok: true });
  } catch (e) {
    if (belumAda(e)) return fail('Tabel user_pref belum ada — jalankan `npm run db:push`', 503);
    throw e;
  }
}

export async function DELETE(req: Request) {
  const sesi = await sessionFromRequest(req);
  if (!sesi) return fail('Belum login', 401);
  const key = String(new URL(req.url).searchParams.get('key') ?? '');
  if (!POLA_KEY.test(key)) return fail('key tidak sah', 400);
  try {
    await prisma.userPref.deleteMany({ where: { userId: sesi.uid, prefKey: key } });
    return json({ ok: true });
  } catch (e) {
    if (belumAda(e)) return json({ ok: true, siap: false });
    throw e;
  }
}
