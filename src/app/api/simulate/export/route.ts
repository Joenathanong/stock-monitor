import { runSimulation } from '@/lib/simulate-server';
import { writeSheet } from '@/lib/xlsx';
import { STATUS_LABEL } from '@/lib/doi';
import { fail } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Hasil simulasi sebagai XLSX — kolomnya sama persis dengan yang di layar. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const { snap, params, hasil } = await runSimulation(url);
  if (!hasil || !params) return fail('Belum ada snapshot DOI — jalankan Refresh dulu', 409);

  const buffer = await writeSheet(
    'Simulasi DOI',
    [
      { header: 'SKU', key: 'sku', width: 34 },
      { header: 'Nama', key: 'name', width: 46 },
      { header: 'SAP Code', key: 'sapCode', width: 14 },
      { header: 'ABC', key: 'abc', width: 6 },
      { header: 'Status', key: 'status', width: 16 },
      { header: 'Stok Sekarang', key: 'stock', width: 15 },
      { header: `ADS Opsi ${params.opsi}`, key: 'ads', width: 14 },
      { header: 'DOI Sekarang', key: 'doi', width: 14 },
      { header: 'Sisakan (hari)', key: 'floorDays', width: 15 },
      { header: 'Sisakan (pcs)', key: 'keep', width: 15 },
      { header: 'POTONG (pcs)', key: 'cut', width: 15 },
      { header: 'Harga Satuan (Rp)', key: 'unitPrice', width: 18 },
      { header: 'Nilai Dipotong (Rp)', key: 'cutValue', width: 20 },
      { header: 'Stok Sesudah', key: 'stockAfter', width: 15 },
      { header: 'DOI Sesudah', key: 'doiAfter', width: 14 },
    ],
    hasil.picks.map((p) => ({
      sku: p.sku, name: p.name ?? '', sapCode: p.sapCode ?? '', abc: p.abcClass,
      status: STATUS_LABEL[p.status as keyof typeof STATUS_LABEL] ?? p.status,
      stock: p.stock, ads: p.ads, doi: p.doi ?? '',
      floorDays: p.floorDays, keep: p.keep, cut: p.cut,
      unitPrice: p.unitPrice || '', cutValue: p.cutValue || '',
      stockAfter: p.stockAfter, doiAfter: p.doiAfter ?? '',
    })),
  );

  const nama = `simulasi-doi-${params.targetDoi}hari-${snap.snapshotDate ?? 'kosong'}.xlsx`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${nama}"`,
    },
  });
}
