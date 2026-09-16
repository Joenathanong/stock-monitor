import { NextResponse } from 'next/server';

export const json = (data: unknown, status = 200) => NextResponse.json(data as object, { status });

export const fail = (message: string, status = 400) => NextResponse.json({ ok: false, error: message }, { status });

/**
 * Endpoint /api/cron/* hanya boleh dipicu penjadwal. Vercel Cron mengirim
 * `Authorization: Bearer <CRON_SECRET>`; tombol manual di UI memakai secret yang sama.
 */
export function checkCronAuth(req: Request): string | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return 'CRON_SECRET belum diset di environment variables';
  const header = req.headers.get('authorization') || '';
  const url = new URL(req.url);
  const provided = header.startsWith('Bearer ') ? header.slice(7) : url.searchParams.get('key');
  return provided === secret ? null : 'Tidak berwenang';
}

/** Serialisasi aman untuk BigInt yang dikembalikan Prisma. */
export function safe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));
}
