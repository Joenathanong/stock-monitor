import { latestSnapshot } from '@/lib/query';
import { writeSheet } from '@/lib/xlsx';
import { STATUS_LABEL } from '@/lib/doi';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get('status') || 'ALL';
  const abc = url.searchParams.get('abc') || 'ALL';
  const snap = await latestSnapshot();
  let rows = snap.rows;
  if (status !== 'ALL') rows = rows.filter((r) => r.status === status);
  if (abc !== 'ALL') rows = rows.filter((r) => r.abcClass === abc);

  const buffer = await writeSheet(
    'DOI',
    [
      { header: 'SKU', key: 'sku', width: 34 },
      { header: 'Nama', key: 'name', width: 46 },
      { header: 'SAP Code', key: 'sapCode', width: 14 },
      { header: 'ABC', key: 'abc', width: 6 },
      { header: 'Stok (Available)', key: 'stock', width: 14 },
      { header: 'On Hand', key: 'onHand', width: 10 },
      { header: 'On Order', key: 'onOrder', width: 10 },
      { header: 'Dalam Perjalanan', key: 'transit', width: 16 },
      { header: 'Lead Time (hari)', key: 'leadTime', width: 15 },
      { header: 'Tgl Jual Pertama', key: 'first', width: 16 },
      { header: 'Umur Jual (hari)', key: 'age', width: 15 },
      { header: 'Keterangan NPL', key: 'npl', width: 30 },
      { header: 'Penjualan 3 Bln', key: 'sales90', width: 15 },
      { header: 'Penjualan 3 Bln (ex campaign)', key: 'salesEx', width: 26 },
      { header: 'Hari Dihitung (Opsi 1)', key: 'daysEx', width: 20 },
      { header: 'ADS Opsi 1', key: 'ads1', width: 11 },
      { header: 'ADS 8 Mg', key: 'ads8w', width: 10 },
      { header: 'ADS 4 Mg', key: 'ads4w', width: 10 },
      { header: 'ADS 2 Mg', key: 'ads2w', width: 10 },
      { header: 'ADS Opsi 2', key: 'ads2', width: 11 },
      { header: 'Sumber Opsi 2', key: 'ads2Source', width: 13 },
      { header: 'DOI Opsi 1', key: 'doi1', width: 11 },
      { header: 'DOI Opsi 2', key: 'doi2', width: 11 },
      { header: 'DOI Opsi 1 + Transit', key: 'doi1T', width: 19 },
      { header: 'DOI Opsi 2 + Transit', key: 'doi2T', width: 19 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Saran Tindakan', key: 'action', width: 44 },
      { header: 'Saran Qty PO (Opsi 1)', key: 'sug1', width: 20 },
      { header: 'Saran Qty PO (Opsi 2)', key: 'sug2', width: 20 },
      { header: 'Perkiraan Habis', key: 'runOut', width: 16 },
      { header: 'Pangsa Penjualan %', key: 'share', width: 18 },
      { header: 'Kumulatif %', key: 'cum', width: 12 },
    ],
    rows.map((r) => ({
      sku: r.sku, name: r.name, sapCode: r.sapCode, abc: r.abcClass,
      stock: r.availableQty, onHand: r.qtyOnHand, onOrder: r.qtyOnOrder, transit: r.transitQty, leadTime: r.leadTimeDays,
      first: r.firstSalesDate, age: r.ageDays, npl: r.nplNote ?? '',
      sales90: r.sales90, salesEx: r.salesEx, daysEx: r.daysEx,
      ads1: r.ads1, ads8w: r.ads8w, ads4w: r.ads4w, ads2w: r.ads2w, ads2: r.ads2, ads2Source: r.ads2Source,
      doi1: r.doi1, doi2: r.doi2, doi1T: r.doi1Transit, doi2T: r.doi2Transit,
      status: STATUS_LABEL[r.status] ?? r.status, action: r.action, sug1: r.suggested1, sug2: r.suggested2,
      runOut: r.runOutDate, share: r.abcShare, cum: r.abcCumShare,
    })),
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="doi-${snap.snapshotDate ?? 'kosong'}.xlsx"`,
    },
  });
}
