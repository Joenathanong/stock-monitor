import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE, canWrite } from '@/lib/auth';

/**
 * Tanpa sesi: halaman login, API auth, cron (dilindungi CRON_SECRET), dan
 * dashboard TV publik (/tv), dashboard baca-saja (/dashboard), dan /api/public/*.
 * Pengguna & Pengaturan hanya untuk ADMIN (sesuai keterangan peran di halaman Pengguna:
 * Admin mengelola pengguna & pengaturan, User mengubah data, Lihat saja membaca).
 * Metode tulis ditolak untuk VIEWER di seluruh API.
 */
const PUBLIC_PREFIX = ['/api/cron/', '/api/auth/', '/api/public/'];
const PUBLIC_EXACT = ['/login', '/tv', '/dashboard'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_EXACT.includes(pathname) || PUBLIC_PREFIX.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  const isApi = pathname.startsWith('/api/');
  if (!session) {
    if (isApi) return NextResponse.json({ ok: false, error: 'Belum login' }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  // Halaman/API yang sepenuhnya milik admin.
  const adminPages = pathname === '/users' || pathname === '/settings';
  const adminApis = pathname.startsWith('/api/users');
  // Pengaturan & tanggal pengecualian: dibaca siapa saja, diubah hanya admin.
  const adminWrites = req.method !== 'GET'
    && (pathname.startsWith('/api/settings') || pathname.startsWith('/api/exclusion'));
  if (adminPages || adminApis || adminWrites) {
    if (session.r !== 'ADMIN') {
      if (isApi) return NextResponse.json({ ok: false, error: 'Hanya admin' }, { status: 403 });
      return NextResponse.redirect(new URL('/', req.url));
    }
  }
  if (isApi && req.method !== 'GET' && !canWrite(session.r) && !pathname.startsWith('/api/auth/')) {
    return NextResponse.json({ ok: false, error: 'Akun Anda hanya bisa melihat' }, { status: 403 });
  }
  const res = NextResponse.next();
  res.headers.set('x-user-id', session.uid);
  res.headers.set('x-user-role', session.r);
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
