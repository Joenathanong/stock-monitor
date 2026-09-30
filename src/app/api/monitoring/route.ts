import { latestSnapshot } from '@/lib/query';
import { json } from '@/lib/http';
import { areaDariUrl } from '@/lib/http-area';

export const dynamic = 'force-dynamic';

/**
 * Seluruh baris snapshot terakhir. Penyaringan & pengurutan dilakukan di
 * browser — ±2.500 baris ringan, dan menghindari bolak-balik ke server tiap klik.
 */
export async function GET(req: Request) {
  const snap = await latestSnapshot(areaDariUrl(req));
  return json({ ok: true, ...snap });
}
