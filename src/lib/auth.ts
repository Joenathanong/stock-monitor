/**
 * Autentikasi multi-user.
 *
 * - Password: scrypt (bawaan Node) → "salt:hash" heksadesimal. Tanpa dependensi.
 * - Sesi: cookie berisi payload base64url + HMAC-SHA256 (Web Crypto), sehingga
 *   middleware (edge runtime) bisa memverifikasi tanpa menyentuh database.
 * - Kunci HMAC: SESSION_SECRET (fallback CRON_SECRET). Mengganti kunci = semua
 *   sesi keluar.
 */
export const SESSION_COOKIE = 'doi_session';
export const SESSION_DAYS = 14;

export type Role = 'ADMIN' | 'USER' | 'VIEWER';
export const ROLES: Role[] = ['ADMIN', 'USER', 'VIEWER'];
export const ROLE_LABEL: Record<Role, string> = { ADMIN: 'Admin', USER: 'User', VIEWER: 'Lihat saja' };

export type SessionPayload = { uid: string; u: string; n: string; r: Role; exp: number };

const secret = () => process.env.SESSION_SECRET || process.env.CRON_SECRET || '';

export function authConfigured(): boolean {
  return secret().length >= 16;
}

// ---------- base64url ----------
const enc = new TextEncoder();
function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s: string): Uint8Array {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmac(message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

// ---------- sesi ----------
export async function signSession(p: Omit<SessionPayload, 'exp'>): Promise<string> {
  const payload: SessionPayload = { ...p, exp: Date.now() + SESSION_DAYS * 86_400_000 };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = b64url(await hmac(body));
  return `${body}.${sig}`;
}

export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token || !authConfigured()) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = b64url(await hmac(body));
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(unb64url(body))) as SessionPayload;
    if (!p.uid || !p.r || typeof p.exp !== 'number' || p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

/** Baca sesi dari Request (API route). */
export async function sessionFromRequest(req: Request): Promise<SessionPayload | null> {
  const cookie = req.headers.get('cookie') || '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return verifySession(m?.[1]);
}

export const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: SESSION_DAYS * 86_400,
});

/** Hak tulis: ADMIN dan USER. VIEWER hanya membaca. */
export const canWrite = (r: Role | undefined) => r === 'ADMIN' || r === 'USER';
