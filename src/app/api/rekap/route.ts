import { prisma } from '@/lib/prisma';
import { json, safe } from '@/lib/http';
import { isValidDateKey, keyToUtcDate, todayKey, toDateKeyUtc, type DateKey } from '@/lib/dates';
import {
  susunRekap, rekapPerArea, rekapTotal, terjualTanpaStok,
  type BarisStokHarian, type BarisJualHarian,
} from '@/lib/rekap';

export const dynamic = 'force-dynamic';
// Vercel Hobby membunuh satu fungsi di detik ke-60. Menulis angka lebih besar
// TIDAK menaikkannya.
export const maxDuration = 60;

/**
 * Rekap stok & penjualan SATU HARI, bisa back date.
 *
 * Sumbernya `stock_daily` dan `sales_daily` — dua tabel yang kuncinya memuat
 * tanggal, jadi hari kemarin tidak berubah karena Refresh hari ini. Lihat
 * `src/lib/rekap.ts` untuk alasan lengkapnya dan satu batasnya (stock_daily
 * hanya merekam kategori 'Sku').
 *
 * Tanggal yang TIDAK ADA datanya dijawab dengan ringkasan kosong + rentang
 * tanggal yang tersedia — bukan dengan galat. Orang yang salah pilih tanggal
 * butuh tahu tanggal mana yang bisa dipilih, bukan tahu bahwa ia salah.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const minta = String(u.searchParams.get('tanggal') ?? '').trim();
  const tanggal: DateKey = isValidDateKey(minta) ? minta : todayKey();
  const d = keyToUtcDate(tanggal);

  // Rentang yang benar-benar tersimpan — dipakai mengisi batas date picker dan
  // menjelaskan tanggal yang kosong.
  const [rentangStok, rentangJual] = await Promise.all([
    prisma.$queryRawUnsafe<{ awal: Date | null; akhir: Date | null; hari: bigint | number }[]>(
      'SELECT MIN(snapshotDate) AS awal, MAX(snapshotDate) AS akhir, COUNT(DISTINCT snapshotDate) AS hari FROM stock_daily',
    ),
    prisma.$queryRawUnsafe<{ awal: Date | null; akhir: Date | null; hari: bigint | number }[]>(
      'SELECT MIN(salesDate) AS awal, MAX(salesDate) AS akhir, COUNT(DISTINCT salesDate) AS hari FROM sales_daily',
    ),
  ]);

  const [stok, jual, namaRows] = await Promise.all([
    prisma.$queryRawUnsafe<BarisStokHarian[]>(
      'SELECT sku, areaId, availableQty, qtyOnHand, qtyOnOrder FROM stock_daily WHERE snapshotDate = ?',
      d,
    ),
    prisma.$queryRawUnsafe<BarisJualHarian[]>(
      'SELECT sku, areaId, qty, qtyCancel, qtyShopee, qtyTiktok, qtyTokped, qtyLazada, qtyOther '
      + 'FROM sales_daily WHERE salesDate = ?',
      d,
    ),
    // Nama dari stock_current: satu-satunya tempat nama produk disimpan. Nama
    // bisa berubah sejak tanggal yang dilihat — itu diterima dengan sadar,
    // karena menyimpan nama di tiap baris harian akan menggandakan tabelnya
    // demi informasi yang tidak dipakai menghitung apa pun.
    prisma.$queryRawUnsafe<{ sku: string; name: string }[]>(
      'SELECT sku, MAX(name) AS name FROM stock_current GROUP BY sku',
    ),
  ]);

  const nama = new Map(namaRows.map((r) => [r.sku, String(r.name ?? '')]));
  const baris = susunRekap(stok, jual, nama);
  const perArea = rekapPerArea(baris);
  const total = rekapTotal(baris);
  const tanpaStok = terjualTanpaStok(baris);

  const rentang = (r: { awal: Date | null; akhir: Date | null; hari: bigint | number }[]) => {
    const x = r[0];
    return {
      awal: x?.awal ? toDateKeyUtc(new Date(x.awal)) : null,
      akhir: x?.akhir ? toDateKeyUtc(new Date(x.akhir)) : null,
      hari: Number(x?.hari ?? 0),
    };
  };

  const adaStok = stok.length > 0;
  const adaJual = jual.length > 0;

  return json(safe({
    ok: true,
    tanggal,
    hariIni: todayKey(),
    rentang: { stok: rentangStok ? rentang(rentangStok) : null, jual: rentangJual ? rentang(rentangJual) : null },
    perArea,
    total,
    baris,
    terjualTanpaStok: tanpaStok.slice(0, 200),
    terjualTanpaStokTotal: tanpaStok.length,
    pesan: [
      !adaStok && !adaJual
        ? `Tidak ada data stok maupun penjualan untuk ${tanggal}.`
        : !adaStok
          ? `Tidak ada potret stok untuk ${tanggal} — angka stok di bawah kosong, penjualannya tetap ada.`
          : !adaJual
            ? `Tidak ada data penjualan untuk ${tanggal} — bisa berarti memang nol, atau hari itu belum tertarik.`
            : '',
    ].filter(Boolean).join(' '),
  }));
}
