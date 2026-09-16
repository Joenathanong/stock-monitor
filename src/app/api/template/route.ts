import { writeSheet } from '@/lib/xlsx';
import { addDays, todayKey } from '@/lib/dates';
import { fail } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Berkas contoh untuk tiap jenis unggahan, supaya kolomnya tidak perlu ditebak. */
export async function GET(req: Request) {
  const kind = (new URL(req.url).searchParams.get('kind') || '').toLowerCase();
  const today = todayKey();

  const specs: Record<string, { sheet: string; columns: { header: string; key: string; width?: number }[]; rows: Record<string, unknown>[] }> = {
    transit: {
      sheet: 'Stok Dalam Perjalanan',
      columns: [
        { header: 'SKU', key: 'sku', width: 34 },
        { header: 'Qty', key: 'qty', width: 10 },
        { header: 'ETA', key: 'eta', width: 14 },
        { header: 'Catatan', key: 'note', width: 28 },
      ],
      rows: [
        { sku: 'CONTOH-SKU-A', qty: 500, eta: addDays(today, 5), note: 'PO-2026-001' },
        { sku: 'CONTOH-SKU-B', qty: 1200, eta: '', note: '' },
      ],
    },
    leadtime: {
      sheet: 'Lead Time',
      columns: [
        { header: 'SKU', key: 'sku', width: 34 },
        { header: 'Lead Time (Hari)', key: 'days', width: 18 },
        { header: 'Exclude', key: 'exclude', width: 10 },
        { header: 'Catatan', key: 'note', width: 24 },
      ],
      rows: [
        { sku: 'CONTOH-SKU-A', days: 7, exclude: 0, note: 'Supplier A' },
        { sku: 'CONTOH-SKU-B', days: 14, exclude: 0, note: '' },
        { sku: 'CONTOH-SKU-DISCONTINUED', days: '', exclude: 1, note: 'tidak diproduksi lagi' },
      ],
    },
    sales: {
      sheet: 'Histori Penjualan',
      columns: [
        { header: 'Date', key: 'date', width: 14 },
        { header: 'SKU', key: 'sku', width: 34 },
        { header: 'Area', key: 'area', width: 14 },
        { header: 'Qty', key: 'qty', width: 10 },
      ],
      rows: [
        { date: addDays(today, -1), sku: 'CONTOH-SKU-A', area: 'Pusat', qty: 120 },
        { date: addDays(today, -2), sku: 'CONTOH-SKU-A', area: 'Pusat', qty: 98 },
      ],
    },
  };

  const spec = specs[kind];
  if (!spec) return fail('kind harus salah satu dari: transit, leadtime, sales');

  const buffer = await writeSheet(spec.sheet, spec.columns, spec.rows);
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="template-${kind}.xlsx"`,
    },
  });
}
