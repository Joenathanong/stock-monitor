import { latestSnapshot } from '@/lib/query';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Seluruh baris snapshot terakhir. Penyaringan & pengurutan dilakukan di
 * browser — ±2.500 baris ringan, dan menghindari bolak-balik ke server tiap klik.
 */
export async function GET() {
  const snap = await latestSnapshot();
  return json({ ok: true, ...snap });
}
