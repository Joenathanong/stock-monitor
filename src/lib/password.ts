/** Hash password dengan scrypt bawaan Node — hanya dipakai di API route (bukan middleware). */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = scryptSync(password, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function validatePassword(pw: unknown): string | null {
  if (typeof pw !== 'string' || pw.length < 6) return 'Password minimal 6 karakter';
  if (pw.length > 100) return 'Password terlalu panjang';
  return null;
}

export function validateUsername(u: unknown): string | null {
  if (typeof u !== 'string' || !/^[a-zA-Z0-9._-]{3,40}$/.test(u)) return 'Username 3–40 karakter: huruf, angka, titik, garis';
  return null;
}
