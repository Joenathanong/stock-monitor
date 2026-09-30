import { skuHistory, summaryHistory } from '@/lib/query';
import { json } from '@/lib/http';
import { areaDariUrl } from '@/lib/http-area';

export const dynamic = 'force-dynamic';

/** `?sku=X` → riwayat satu SKU; tanpa sku → tren DOI total. */
export async function GET(req: Request) {
  const sku = new URL(req.url).searchParams.get('sku');
  const area = areaDariUrl(req);
  if (sku) return json({ ok: true, sku, rows: await skuHistory(sku, 60, area) });
  return json({ ok: true, rows: await summaryHistory(90, area) });
}
