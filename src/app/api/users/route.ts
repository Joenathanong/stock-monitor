import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { ROLES, sessionFromRequest, type Role } from '@/lib/auth';
import { hashPassword, validatePassword, validateUsername } from '@/lib/password';

export const dynamic = 'force-dynamic';

const json = (d: unknown, status = 200) => NextResponse.json(d as object, { status });
const publicUser = (u: { id: string; username: string; name: string; role: string; isActive: boolean; lastLoginAt: Date | null; createdAt: Date }) => ({
  id: u.id, username: u.username, name: u.name, role: u.role, isActive: u.isActive,
  lastLoginAt: u.lastLoginAt?.toISOString() ?? null, createdAt: u.createdAt.toISOString(),
});

/** Middleware sudah membatasi /api/users ke ADMIN; di sini hanya membaca aktor untuk audit. */
export async function GET() {
  const rows = await prisma.appUser.findMany({ orderBy: [{ role: 'asc' }, { username: 'asc' }] });
  return json({ ok: true, rows: rows.map(publicUser) });
}

export async function POST(req: Request) {
  const s = await sessionFromRequest(req);
  const body = (await req.json().catch(() => ({}))) as { username?: string; password?: string; name?: string; role?: string };
  const username = String(body.username || '').trim().toLowerCase();
  const role = String(body.role || 'USER').toUpperCase() as Role;
  const err = validateUsername(username) || validatePassword(body.password) || (ROLES.includes(role) ? null : 'Role tidak dikenal');
  if (err) return json({ ok: false, error: err }, 400);
  if (await prisma.appUser.findUnique({ where: { username } })) return json({ ok: false, error: 'Username sudah dipakai' }, 409);

  const user = await prisma.appUser.create({
    data: { id: randomUUID(), username, passwordHash: hashPassword(body.password!), name: (body.name || username).slice(0, 120), role },
  });
  await prisma.auditLog.create({ data: { actor: s?.u ?? 'admin', action: 'USER_CREATE', entity: 'app_user', entityId: user.id, detail: `${username} (${role})` } });
  return json({ ok: true, user: publicUser(user) });
}

/** Ubah nama / role / aktif, atau reset password (`password`). */
export async function PATCH(req: Request) {
  const s = await sessionFromRequest(req);
  const body = (await req.json().catch(() => ({}))) as { id?: string; name?: string; role?: string; isActive?: boolean; password?: string };
  if (!body.id) return json({ ok: false, error: 'id wajib diisi' }, 400);
  const target = await prisma.appUser.findUnique({ where: { id: body.id } });
  if (!target) return json({ ok: false, error: 'Pengguna tidak ditemukan' }, 404);

  const data: Record<string, unknown> = {};
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 120);
  if (body.role) {
    const role = body.role.toUpperCase() as Role;
    if (!ROLES.includes(role)) return json({ ok: false, error: 'Role tidak dikenal' }, 400);
    data.role = role;
  }
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive;
  if (body.password !== undefined) {
    const err = validatePassword(body.password);
    if (err) return json({ ok: false, error: err }, 400);
    data.passwordHash = hashPassword(body.password);
  }
  if (!Object.keys(data).length) return json({ ok: false, error: 'Tidak ada perubahan' }, 400);

  // Jangan sampai admin terakhir menonaktifkan / menurunkan dirinya sendiri.
  const losesAdmin = target.role === 'ADMIN' && ((data.role && data.role !== 'ADMIN') || data.isActive === false);
  if (losesAdmin) {
    const admins = await prisma.appUser.count({ where: { role: 'ADMIN', isActive: true } });
    if (admins <= 1) return json({ ok: false, error: 'Tidak bisa — ini admin aktif terakhir' }, 400);
  }

  const user = await prisma.appUser.update({ where: { id: body.id }, data });
  await prisma.auditLog.create({
    data: { actor: s?.u ?? 'admin', action: 'USER_UPDATE', entity: 'app_user', entityId: user.id, detail: JSON.stringify({ ...data, passwordHash: data.passwordHash ? '(reset)' : undefined }) },
  });
  return json({ ok: true, user: publicUser(user) });
}

export async function DELETE(req: Request) {
  const s = await sessionFromRequest(req);
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return json({ ok: false, error: 'id wajib diisi' }, 400);
  if (s?.uid === id) return json({ ok: false, error: 'Tidak bisa menghapus akun sendiri' }, 400);
  const target = await prisma.appUser.findUnique({ where: { id } });
  if (!target) return json({ ok: false, error: 'Pengguna tidak ditemukan' }, 404);
  if (target.role === 'ADMIN') {
    const admins = await prisma.appUser.count({ where: { role: 'ADMIN', isActive: true } });
    if (admins <= 1) return json({ ok: false, error: 'Tidak bisa — ini admin aktif terakhir' }, 400);
  }
  await prisma.appUser.delete({ where: { id } });
  await prisma.auditLog.create({ data: { actor: s?.u ?? 'admin', action: 'USER_DELETE', entity: 'app_user', entityId: id, detail: target.username } });
  return json({ ok: true });
}
