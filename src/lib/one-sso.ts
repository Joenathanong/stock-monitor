/**
 * Login lewat One-IEG (OpenID Connect) — pilot.
 *
 * Alur: /api/auth/sso/start → One-IEG /authorize → /api/auth/sso/callback
 * (tukar kode di server memakai client secret, verifikasi id_token lewat JWKS)
 * → akun lokal ditautkan / dibuat → sesi doi_session biasa.
 *
 * Login lama (username + password lokal) TETAP jalan selama masa transisi.
 *
 * Environment:
 *   ONE_IEG_ISSUER         https://one-ieg.vercel.app
 *   ONE_IEG_CLIENT_ID      doi-monitor
 *   ONE_IEG_CLIENT_SECRET  one_...
 *   ONE_IEG_REDIRECT_URI   (opsional) default <origin>/api/auth/sso/callback
 */
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

export const SSO_COOKIE = 'doi_sso';
/** Sesi lokal hasil SSO lebih pendek dari login lama (14 hari) supaya akses yang dicabut di One-IEG cepat berlaku. */
export const SSO_SESSION_DAYS = 0.5;

const issuer = () => (process.env.ONE_IEG_ISSUER || '').replace(/\/+$/, '');
export const ssoConfigured = () => Boolean(issuer() && process.env.ONE_IEG_CLIENT_ID && process.env.ONE_IEG_CLIENT_SECRET);

export function redirectUri(req: Request): string {
  if (process.env.ONE_IEG_REDIRECT_URI) return process.env.ONE_IEG_REDIRECT_URI;
  const proto = req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host;
  return `${proto}://${host}/api/auth/sso/callback`;
}

const b64url = (b: Buffer) => b.toString('base64url');

export type SsoState = { state: string; verifier: string; nonce: string; next: string };

/** Buat state + PKCE + nonce, dan alamat authorize One-IEG. */
export function beginLogin(req: Request, next: string): { url: string; cookie: string } {
  const st: SsoState = {
    state: b64url(randomBytes(16)),
    verifier: b64url(randomBytes(32)),
    nonce: b64url(randomBytes(16)),
    next: next.startsWith('/') && !next.startsWith('//') ? next : '/',
  };
  const u = new URL(`${issuer()}/api/oidc/authorize`);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', process.env.ONE_IEG_CLIENT_ID!);
  u.searchParams.set('redirect_uri', redirectUri(req));
  u.searchParams.set('scope', 'openid profile');
  u.searchParams.set('state', st.state);
  u.searchParams.set('nonce', st.nonce);
  u.searchParams.set('code_challenge', b64url(createHash('sha256').update(st.verifier).digest()));
  u.searchParams.set('code_challenge_method', 'S256');
  return { url: u.toString(), cookie: b64url(Buffer.from(JSON.stringify(st))) };
}

export function readState(raw: string | undefined): SsoState | null {
  if (!raw) return null;
  try { return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as SsoState; } catch { return null; }
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

export type OneClaims = JWTPayload & {
  sub: string; one_id: string; preferred_username: string; name: string; app_role: string; app_role_label?: string; theme?: string | null;
};

/** Tukar kode → id_token, lalu verifikasi tanda tangan, issuer, audience, nonce. */
export async function finishLogin(req: Request, code: string, st: SsoState): Promise<OneClaims> {
  const res = await fetch(`${issuer()}/api/oidc/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${encodeURIComponent(process.env.ONE_IEG_CLIENT_ID!)}:${encodeURIComponent(process.env.ONE_IEG_CLIENT_SECRET!)}`).toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(req), code_verifier: st.verifier }),
    cache: 'no-store',
  });
  const j = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
  if (!res.ok || !j.id_token) throw new Error(j.error_description || j.error || `One-IEG menjawab HTTP ${res.status}`);
  if (!jwks) jwks = createRemoteJWKSet(new URL(`${issuer()}/api/oidc/jwks`));
  const { payload } = await jwtVerify(j.id_token, jwks, { issuer: issuer(), audience: process.env.ONE_IEG_CLIENT_ID! });
  if (payload.nonce !== st.nonce) throw new Error('nonce tidak cocok');
  return payload as OneClaims;
}
