import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sessionFromRequest } from '@/lib/auth';
import { hashPassword, validatePassword, verifyPassword } from '@/lib/password';

export const dynamic = 'force-dynamic';

/** Ganti password sendiri. */
export async function POST(req: Request) {
  const s = await sessionFromRequest(req);
  if (!s) return NextResponse.json({ ok: false, error: 'Belum login' }, { status: 401 });
  const { current, next } = (await req.json().catch(() => ({}))) as { current?: string; next?: string };
  const err = validatePassword(next);
  if (err) return NextResponse.json({ ok: false, error: err }, { status: 400 });
  const user = await prisma.appUser.findUnique({ where: { id: s.uid } });
  if (!user || !user.isActive) return NextResponse.json({ ok: false, error: 'Akun tidak aktif' }, { status: 403 });
  if (!current || !verifyPassword(current, user.passwordHash)) return NextResponse.json({ ok: false, error: 'Password saat ini salah' }, { status: 400 });
  await prisma.appUser.update({ where: { id: user.id }, data: { passwordHash: hashPassword(next!) } });
  await prisma.auditLog.create({ data: { actor: user.username, action: 'PASSWORD_CHANGE', entity: 'app_user', entityId: user.id } });
  return NextResponse.json({ ok: true });
}
