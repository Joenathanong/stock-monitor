import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authConfigured, cookieOptions, signSession, SESSION_COOKIE, type Role } from '@/lib/auth';
import { verifyPassword } from '@/lib/password';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!authConfigured()) {
    return NextResponse.json({ ok: false, error: 'SESSION_SECRET belum diset (minimal 16 karakter) di environment' }, { status: 500 });
  }
  const { username, password } = (await req.json().catch(() => ({}))) as { username?: string; password?: string };
  if (!username || !password) return NextResponse.json({ ok: false, error: 'Username dan password wajib diisi' }, { status: 400 });

  const user = await prisma.appUser.findUnique({ where: { username: username.trim().toLowerCase() } });
  if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ ok: false, error: 'Username atau password salah' }, { status: 401 });
  }
  await prisma.appUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const token = await signSession({ uid: user.id, u: user.username, n: user.name, r: user.role as Role });
  const res = NextResponse.json({ ok: true, user: { username: user.username, name: user.name, role: user.role } });
  res.cookies.set(SESSION_COOKIE, token, cookieOptions());
  return res;
}
