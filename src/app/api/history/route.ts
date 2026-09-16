import { skuHistory, summaryHistory } from '@/lib/query';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** `?sku=X` → riwayat satu SKU; tanpa sku → tren DOI total. */
export async function GET(req: Request) {
  const sku = new URL(req.url).searchParams.get('sku');
  if (sku) return json({ ok: true, sku, rows: await skuHistory(sku) });
  return json({ ok: true, rows: await summaryHistory() });
}
