/**
 * Diagnosa: kenapa transit (SIT) sebuah area tidak ikut terhitung di DOI.
 *
 * HANYA MEMBACA. Tidak menulis, tidak memanggil OCS.
 *
 * Transit baru ikut dihitung kalau SKU-nya ada di `stock_current` untuk area
 * yang sama (compute.ts: `stock.map(...)` lalu `transit.get(st.sku)`), DAN
 * barisnya lolos saringan yang sama dengan stok: category='Sku',
 * isActive=1 (kecuali include_inactive), dan bukan CS-* (kecuali
 * include_clearance). Baris transit untuk SKU yang tidak lolos saringan itu
 * hilang tanpa jejak di DOI - itulah yang dilaporkan di sini.
 *
 *   npx tsx scripts/check-transit-area.ts            # semua area
 *   npx tsx scripts/check-transit-area.ts Pusat      # satu area
 */
import { prisma } from '../src/lib/prisma';

const areaArg = process.argv[2] || null;
const n = (x: unknown) => Number(x ?? 0).toLocaleString('id-ID');
const iso = (d: unknown) => (d instanceof Date ? `${d.toISOString().replace('T', ' ').slice(0, 19)} UTC` : String(d ?? '-'));

async function main() {
  const where = areaArg ? 'WHERE t.areaId = ?' : '';
  const p: unknown[] = areaArg ? [areaArg] : [];

  const ringkas = await prisma.$queryRawUnsafe<{
    areaId: string; baris: number; qty: number;
    adaStok: number; qtyAdaStok: number;
    nonaktif: number; qtyNonaktif: number;
    bukanSku: number; qtyBukanSku: number;
    clearance: number; qtyClearance: number;
    tanpaStok: number; qtyTanpaStok: number;
  }[]>(
    `SELECT t.areaId,
            COUNT(*) AS baris, SUM(t.qty) AS qty,
            SUM(s.sku IS NOT NULL AND s.category = 'Sku' AND s.isActive = 1 AND s.sku NOT LIKE 'CS-%') AS adaStok,
            SUM(IF(s.sku IS NOT NULL AND s.category = 'Sku' AND s.isActive = 1 AND s.sku NOT LIKE 'CS-%', t.qty, 0)) AS qtyAdaStok,
            SUM(s.sku IS NOT NULL AND s.isActive = 0) AS nonaktif,
            SUM(IF(s.sku IS NOT NULL AND s.isActive = 0, t.qty, 0)) AS qtyNonaktif,
            SUM(s.sku IS NOT NULL AND s.category <> 'Sku') AS bukanSku,
            SUM(IF(s.sku IS NOT NULL AND s.category <> 'Sku', t.qty, 0)) AS qtyBukanSku,
            SUM(s.sku IS NOT NULL AND s.sku LIKE 'CS-%') AS clearance,
            SUM(IF(s.sku IS NOT NULL AND s.sku LIKE 'CS-%', t.qty, 0)) AS qtyClearance,
            SUM(s.sku IS NULL) AS tanpaStok,
            SUM(IF(s.sku IS NULL, t.qty, 0)) AS qtyTanpaStok
       FROM transit_stock t
       LEFT JOIN stock_current s ON s.sku = t.sku AND s.areaId = t.areaId
       ${where}
      GROUP BY t.areaId ORDER BY t.areaId`,
    ...p,
  );

  const totalBaris = await prisma.$queryRawUnsafe<{ n: number }[]>('SELECT COUNT(*) AS n FROM transit_stock');
  console.log('\n=== TRANSIT per area: berapa yang benar-benar ikut dihitung ===\n');
  if (!ringkas.length) {
    // Tabel kosong BUKAN "semuanya sehat" - itu dua hal yang sangat berbeda.
    console.log(areaArg
      ? `  TIDAK ADA satu pun baris transit untuk area "${areaArg}".`
        + `\n  (transit_stock berisi ${n(totalBaris[0]?.n)} baris untuk area lain.)`
        + '\n  Jadi masalahnya BUKAN penyaringan stok - datanya memang belum pernah ditulis.'
        + '\n  Jalankan tanpa nama area untuk melihat area mana yang terisi,'
        + '\n  lalu "npm run sync:transit" untuk melihat pembagian per area + takCocok dari OCS.'
      : `  transit_stock KOSONG (${n(totalBaris[0]?.n)} baris).`);
  } else {
    console.log('area        baris   qty        IKUT       tanpa stok   nonaktif   bukan Sku   CS-*');
    for (const r of ringkas) {
      console.log(
        r.areaId.padEnd(11),
        String(r.baris).padStart(5),
        n(r.qty).padStart(10),
        `${n(r.qtyAdaStok)} (${r.adaStok})`.padStart(14),
        `${n(r.qtyTanpaStok)} (${r.tanpaStok})`.padStart(12),
        `${n(r.qtyNonaktif)} (${r.nonaktif})`.padStart(10),
        `${n(r.qtyBukanSku)} (${r.bukanSku})`.padStart(11),
        `${n(r.qtyClearance)} (${r.clearance})`.padStart(8),
      );
    }
  }

  // Area mana saja yang PUNYA baris transit - selalu ditampilkan, supaya saat
  // satu area kosong langsung kelihatan bandingannya.
  const perArea = await prisma.$queryRawUnsafe<{ areaId: string; baris: number; qty: number; src: string }[]>(
    `SELECT areaId, COUNT(*) AS baris, SUM(qty) AS qty, GROUP_CONCAT(DISTINCT source) AS src
       FROM transit_stock GROUP BY areaId ORDER BY areaId`,
  );
  console.log('\n=== isi transit_stock, SELURUH area ===');
  if (!perArea.length) console.log('  (kosong)');
  for (const a of perArea) console.log(`  ${a.areaId.padEnd(12)} ${String(a.baris).padStart(5)} baris  ${n(a.qty).padStart(10)} pcs  source: ${a.src}`);

  // Apakah areanya punya stok sama sekali? Tanpa baris stok, SELURUH transit
  // area itu hilang - dan itu sebab yang berbeda dari SKU per SKU.
  const stok = await prisma.$queryRawUnsafe<{ areaId: string; sku: number; aktif: number }[]>(
    `SELECT areaId, COUNT(*) AS sku, SUM(isActive = 1 AND category = 'Sku') AS aktif
       FROM stock_current GROUP BY areaId ORDER BY areaId`,
  );
  console.log('\n=== stock_current per area (transit butuh SKU-nya ada di sini) ===');
  for (const s of stok) console.log(`  ${s.areaId.padEnd(12)} ${n(s.sku).padStart(6)} baris, ${n(s.aktif)} aktif & category Sku`);

  // Baris yang hilang, biar kelihatan contohnya.
  const hilang = await prisma.$queryRawUnsafe<{ areaId: string; sku: string; qty: number; sebab: string; note: string }[]>(
    `SELECT t.areaId, t.sku, t.qty, t.note,
            CASE WHEN s.sku IS NULL THEN 'SKU+area tidak ada di stock_current'
                 WHEN s.category <> 'Sku' THEN CONCAT('category = ', s.category)
                 WHEN s.isActive = 0 THEN 'isActive = 0'
                 WHEN s.sku LIKE 'CS-%' THEN 'SKU clearance CS-*'
                 ELSE '?' END AS sebab
       FROM transit_stock t
       LEFT JOIN stock_current s ON s.sku = t.sku AND s.areaId = t.areaId
      WHERE (s.sku IS NULL OR s.category <> 'Sku' OR s.isActive = 0 OR s.sku LIKE 'CS-%')
        ${areaArg ? 'AND t.areaId = ?' : ''}
      ORDER BY t.qty DESC LIMIT 25`,
    ...p,
  );
  if (hilang.length) {
    console.log('\n=== 25 baris transit terbesar yang TIDAK ikut dihitung ===');
    for (const h of hilang) {
      console.log(`  ${h.areaId.padEnd(11)} ${h.sku.padEnd(22)} ${n(h.qty).padStart(9)} pcs  ${h.sebab}  [${h.note ?? ''}]`);
    }
  } else if (ringkas.length) {
    console.log('\nSemua baris transit punya pasangan stok yang lolos saringan.');
  }

  // Terakhir dihitung kapan - transit yang baru masuk belum tampil sampai compute jalan.
  const sum = await prisma.$queryRawUnsafe<{ areaId: string; snapshotDate: Date; computedAt: Date }[]>(
    'SELECT areaId, MAX(snapshotDate) AS snapshotDate, MAX(computedAt) AS computedAt FROM doi_summary GROUP BY areaId ORDER BY areaId',
  );
  console.log('\n=== perhitungan terakhir (transit baru tidak tampil sebelum ini diperbarui) ===');
  for (const s of sum) {
    console.log(`  ${s.areaId.padEnd(12)} snapshot ${iso(s.snapshotDate).slice(0, 10)}  dihitung ${iso(s.computedAt)}`);
  }

  const tr = await prisma.$queryRawUnsafe<{ t: Date }[]>('SELECT MAX(updatedAt) AS t FROM transit_stock');
  console.log(`\ntransit_stock terakhir diperbarui: ${iso(tr[0]?.t)}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
