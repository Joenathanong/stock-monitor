import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { authConfigured, cookieOptions, signSession, SESSION_COOKIE } from '@/lib/auth';
import { hashPassword, validatePassword, validateUsername } from '@/lib/password';

export const dynamic = 'force-dynamic';

/** Apakah aplikasi masih kosong (belum ada pengguna)? Dipakai halaman login. */
export async function GET() {
  const count = await prisma.appUser.count();
  return NextResponse.json({ ok: true, needsSetup: count === 0, authConfigured: authConfigured() });
}

/** Buat admin pertama — hanya bisa dipanggil selama tabel pengguna kosong. */
export async function POST(req: Request) {
  if (!authConfigured()) return NextResponse.json({ ok: false, error: 'SESSION_SECRET belum diset di environment' }, { status: 500 });
  const count = await prisma.appUser.count();
  if (count > 0) return NextResponse.json({ ok: false, error: 'Pengguna sudah ada — login sebagai admin untuk menambah pengguna' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { username?: string; password?: string; name?: string };
  const username = String(body.username || '').trim().toLowerCase();
  const err = validateUsername(username) || validatePassword(body.password);
  if (err) return NextResponse.json({ ok: false, error: err }, { status: 400 });

  const user = await prisma.appUser.create({
    data: { id: randomUUID(), username, passwordHash: hashPassword(body.password!), name: (body.name || username).slice(0, 120), role: 'ADMIN' },
  });
  await prisma.auditLog.create({ data: { actor: username, action: 'USER_SETUP', entity: 'app_user', entityId: user.id } });
  const token = await signSession({ uid: user.id, u: user.username, n: user.name, r: 'ADMIN' });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, cookieOptions());
  return res;
}
