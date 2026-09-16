import { NextResponse } from 'next/server';
import { sessionFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const s = await sessionFromRequest(req);
  if (!s) return NextResponse.json({ ok: false, error: 'Belum login' }, { status: 401 });
  return NextResponse.json({ ok: true, user: { id: s.uid, username: s.u, name: s.n, role: s.r } });
}
