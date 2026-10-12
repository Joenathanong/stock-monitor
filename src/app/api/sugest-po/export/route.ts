import { muatSugestPo } from '@/lib/sugest-po-store';
import { writeWorkbook } from '@/lib/xlsx';
import { areaDariUrl } from '@/lib/http-area';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Ekspor saran PO ke Excel.
 *
 * SATU BARIS PER (SKU x KODE SUMBER), bukan satu baris per SKU. Baris PO yang
 * ditulis "ambil 96 pcs" tanpa menyebut dari gudang dan kode mana tidak bisa
 * dieksekusi orang gudang — dan justru pemecahan ke beberapa kode itulah inti
 * Sugest PO. SKU yang tidak kebagian barang tetap ditulis satu baris dengan
 * qty 0 dan keterangannya, supaya "tidak ada stok" terbedakan dari "tidak ada
 * di daftar".
 */
export async function GET(req: Request) {
  const area = areaDariUrl(req);
  const h = await muatSugestPo(area);

  const baris = h.baris.flatMap((b) => (b.ambil.length
    ? b.ambil.map((a) => ({
        areaId: b.areaId, sku: b.sku, name: b.name, abc: b.abc ?? '', status: b.status,
        doi: b.doi, doiSesudah: b.doiSesudah, need: b.need,
        whs: a.supplierWhs ?? '', sapCode: a.sapCode, perCtn: a.perCtn, ctn: a.ctn, qty: a.qty,
        kurang: b.kurang, alasan: b.alasan, keterangan: b.keterangan,
      }))
    : [{
        areaId: b.areaId, sku: b.sku, name: b.name, abc: b.abc ?? '', status: b.status,
        doi: b.doi, doiSesudah: b.doiSesudah, need: b.need,
        whs: '', sapCode: '', perCtn: 0, ctn: 0, qty: 0,
        kurang: b.kurang, alasan: b.alasan, keterangan: b.keterangan,
      }]));

  const buffer = await writeWorkbook([{
    nama: 'Sugest PO',
    catatan: [
      `Snapshot ${h.snapshotDate ?? '—'} · cabang ${area ?? 'semua'} · DOI Opsi ${h.opsi}`,
      'Satu baris per SKU x kode sumber. SKU tanpa kode SAP tetap ada dengan kebutuhannya; kolom gudang & kode kosong.',
    ],
    columns: [
      { header: 'Area', key: 'areaId', width: 14 },
      { header: 'SKU', key: 'sku', width: 34 },
      { header: 'Nama', key: 'name', width: 46 },
      { header: 'ABC', key: 'abc', width: 6 },
      { header: 'Status', key: 'status', width: 12 },
      // HANYA opsi yang dipilih — nomornya ditulis di judul supaya kolomnya
      // tidak bisa disalahbaca sebagai opsi yang lain.
      { header: `DOI Opsi ${h.opsi}`, key: 'doi', width: 12 },
      { header: `DOI setelah PO (Opsi ${h.opsi})`, key: 'doiSesudah', width: 24 },
      { header: 'Kebutuhan (pcs)', key: 'need', width: 16 },
      { header: 'Gudang', key: 'whs', width: 10 },
      { header: 'Kode SAP', key: 'sapCode', width: 18 },
      { header: 'Isi/karton', key: 'perCtn', width: 12 },
      { header: 'Karton', key: 'ctn', width: 10 },
      { header: 'Qty (pcs)', key: 'qty', width: 12 },
      { header: 'Kurang (pcs)', key: 'kurang', width: 14 },
      { header: 'Alasan', key: 'alasan', width: 22 },
      { header: 'Keterangan', key: 'keterangan', width: 44 },
    ],
    rows: baris,
  }, {
    // Lembar kedua: satu baris per CABANG, bukan per SKU. Dicampur ke lembar
    // pertama, angkanya akan ikut terjumlah saat orang membuat pivot.
    nama: 'DOI per cabang',
    columns: [
      { header: 'Cabang', key: 'areaId', width: 16 },
      { header: 'Baris PO', key: 'baris', width: 10 },
      { header: 'Qty PO (pcs)', key: 'qtyPo', width: 14 },
      { header: 'Stok (pcs)', key: 'stok', width: 14 },
      { header: 'SIT (pcs)', key: 'transit', width: 14 },
      { header: `ADS Opsi ${h.opsi}`, key: 'ads', width: 14 },
      { header: `DOI sekarang (Opsi ${h.opsi})`, key: 'doiSekarang', width: 22 },
      { header: `DOI setelah PO (Opsi ${h.opsi})`, key: 'doiSesudah', width: 24 },
      { header: 'Target (hari)', key: 'target', width: 14 },
    ],
    rows: h.perArea,
  }]);

  const nama = `sugest-po-${area ?? 'semua'}-${h.snapshotDate ?? 'kosong'}.xlsx`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${nama}"`,
      'Cache-Control': 'no-store, must-revalidate',
    },
  });
}
