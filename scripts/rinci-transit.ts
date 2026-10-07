import './env';
import { prisma } from '../src/lib/prisma';

/**
 * Rincikan SIT satu area sampai ke DO dan itemnya.
 *
 *   npm run rinci:transit                 -> semua area
 *   npm run rinci:transit -- Pusat        -> satu area
 *
 * Kenapa skrip ini ada: angka SIT di layar adalah hasil penjumlahan dua tahap
 * (baris DO -> per SKU per area), jadi "171 pcs" tidak bisa dilacak balik hanya
 * dengan melihat layar. Yang paling sering ditanyakan justru "dari DO mana" —
 * dan tanpa jawaban itu angkanya tidak bisa dipercaya maupun dibantah.
 *
 * SUMBERNYA DUA, dan keduanya ditampilkan supaya bisa dibandingkan:
 *   transit_stock -> yang DIPAKAI DOI (hasil akhir)
 *   receive_doc   -> cache baris DO mentah dari OCS (bahan bakunya)
 *
 * PENTING soal dua kolom qty di OCS:
 *   DoQty          = yang dikirim di DO itu  -> INI yang dipakai SIT
 *   BatchQuantity  = isi batch asalnya       -> ini yang muncul sebagai
 *                    "TotalQty" di daftar receive-stock OCS
 * Keduanya hampir selalu BERBEDA, dan itu bukan selisih yang hilang: batch bisa
 * dipecah ke beberapa DO. Memakai BatchQuantity sebagai SIT akan melebih-lebihkan
 * barang dalam perjalanan.
 */
type BarisDo = {
  DoDocNum?: number; DoLineNum?: number; ItemCode?: string; ItemName?: string;
  DoQty?: number; BatchQuantity?: number; BatchNum?: string; AddressCode?: string;
  DoDocDate?: string; PerCtnQty?: number;
};

const n = (v: unknown) => Number(v ?? 0).toLocaleString('id-ID');
const pilihArea = process.argv.slice(2).filter((a) => !a.startsWith('--'));

async function main() {
  const area = await prisma.$queryRawUnsafe<{ code: string; name: string }[]>(
    'SELECT code, name FROM area',
  );
  const kodePerNama = new Map<string, string[]>();
  for (const a of area) {
    const arr = kodePerNama.get(a.name) ?? [];
    arr.push(a.code); kodePerNama.set(a.name, arr);
  }

  const transit = await prisma.$queryRawUnsafe<{
    sku: string; areaId: string; qty: number; qtyBatch: number;
    eta: Date | null; note: string | null; docNums: string | null;
  }[]>(
    "SELECT sku, areaId, qty, qtyBatch, eta, note, docNums FROM transit_stock WHERE source = 'ocs' ORDER BY areaId, qty DESC",
  );

  // Baris DO mentah dari cache, dipetakan per nomor DO.
  const cache = await prisma.$queryRawUnsafe<{ docNum: number; lines: string }[]>(
    'SELECT docNum, `lines` FROM receive_doc',
  );
  const barisPerDo = new Map<number, BarisDo[]>();
  for (const c of cache) {
    try { const j = JSON.parse(c.lines); if (Array.isArray(j)) barisPerDo.set(c.docNum, j); } catch { /* cache rusak dilewati */ }
  }

  const areas = [...new Set(transit.map((t) => t.areaId))]
    .filter((a) => !pilihArea.length || pilihArea.some((p) => p.toLowerCase() === a.toLowerCase()))
    .sort();

  if (!areas.length) {
    console.log(`\nTidak ada baris transit untuk ${pilihArea.join(', ') || '(semua area)'}.`);
    console.log(`Area yang PUNYA transit: ${[...new Set(transit.map((t) => t.areaId))].join(', ') || '(tidak ada)'}`);
    return;
  }

  for (const a of areas) {
    const rows = transit.filter((t) => t.areaId === a);
    const total = rows.reduce((s, r) => s + Number(r.qty), 0);
    const kode = kodePerNama.get(a) ?? [];
    console.log(`\n${'='.repeat(78)}`);
    console.log(`${a}  —  ${n(total)} pcs dalam perjalanan   (kode gudang: ${kode.join(', ') || 'TIDAK TERDAFTAR'})`);
    console.log('='.repeat(78));

    // --- 1. per SKU, seperti yang dipakai DOI ---
    console.log('\nPer SKU (inilah yang dipakai DOI):');
    console.log(`  ${'SKU'.padEnd(34)} ${'qty'.padStart(8)} ${'ETA'.padEnd(11)} kode SAP · DO`);
    for (const r of rows) {
      const sap = (r.note ?? '').replace(/^OCS · /, '');
      const eta = r.eta ? new Date(r.eta).toISOString().slice(0, 10) : '-';
      console.log(`  ${r.sku.slice(0, 34).padEnd(34)} ${n(r.qty).padStart(8)} ${eta.padEnd(11)} ${sap} · ${r.docNums ?? '-'}`);
    }

    // --- 2. per DO, dari baris mentah: inilah jawaban "dari DO mana" ---
    const nomor = [...new Set(rows.flatMap((r) => (r.docNums ?? '').split(', ').map((x) => Number(x.trim())).filter(Boolean)))];
    console.log(`\nRincian per DO (${nomor.length} dokumen), dari baris mentah OCS:`);
    let jDo = 0; let jBatch = 0;
    for (const num of nomor.sort()) {
      const baris = (barisPerDo.get(num) ?? []).filter((b) => {
        const k = kode.length ? kode : null;
        return !k || k.includes(String(b.AddressCode ?? '').trim().toUpperCase());
      });
      if (!baris.length) {
        console.log(`\n  DO ${num} — baris mentahnya tidak ada di cache receive_doc`);
        console.log('    (cache kedaluwarsa; jalankan "npm run sync:transit -- --force")');
        continue;
      }
      const sDo = baris.reduce((s, b) => s + (Number(b.DoQty) || 0), 0);
      const sBatch = baris.reduce((s, b) => s + (Number(b.BatchQuantity) || 0), 0);
      jDo += sDo; jBatch += sBatch;
      const tgl = typeof baris[0].DoDocDate === 'string' ? baris[0].DoDocDate.slice(0, 10) : '-';
      console.log(`\n  DO ${num}   tanggal ${tgl}   ${baris.length} baris   DoQty ${n(sDo)} · BatchQuantity ${n(sBatch)}`);
      console.log(`    ${'ln'.padStart(3)} ${'ItemCode'.padEnd(12)} ${'DoQty'.padStart(7)} ${'BatchQty'.padStart(9)} ${'batch'.padEnd(10)} nama`);
      for (const b of baris.sort((x, y) => (Number(y.DoQty) || 0) - (Number(x.DoQty) || 0))) {
        console.log(
          `    ${String(b.DoLineNum ?? '-').padStart(3)} ${String(b.ItemCode ?? '-').padEnd(12)}`
          + ` ${n(b.DoQty).padStart(7)} ${n(b.BatchQuantity).padStart(9)} ${String(b.BatchNum ?? '-').padEnd(10)}`
          + ` ${String(b.ItemName ?? '').slice(0, 44)}`,
        );
      }
    }

    console.log(`\n  JUMLAH dari baris DO : DoQty ${n(jDo)} · BatchQuantity ${n(jBatch)}`);
    console.log(`  JUMLAH di transit_stock: ${n(total)}`);
    if (jDo !== total) {
      console.log(`  !! BEDA ${n(Math.abs(jDo - total))} pcs — sebagian baris DO tidak jadi baris transit.`);
      console.log('     Penyebab tersering: ItemCode-nya tidak ketemu SKU di stock_current');
      console.log('     (6 digit terakhir tidak cocok). Jalankan "npm run sync:transit -- --force"');
      console.log('     dan baca bagian "kode SAP TIDAK ketemu SKU-nya".');
    } else {
      console.log('  cocok — setiap baris DO terwakili di transit.');
    }
    console.log('\n  Catatan: DoQty = yang dikirim di DO ini (dipakai SIT).');
    console.log('           BatchQuantity = isi batch asalnya, itulah "TotalQty" di daftar OCS.');
    console.log('           Keduanya memang beda: satu batch bisa dipecah ke beberapa DO.');
  }

  // Baris transit yang tidak ikut dihitung DOI — supaya tidak disangka hilang.
  const buang = await prisma.$queryRawUnsafe<{ areaId: string; sku: string; qty: number; sebab: string }[]>(
    `SELECT t.areaId, t.sku, t.qty,
            CASE WHEN s.sku IS NULL THEN 'SKU tidak ada di stock_current area itu'
                 WHEN s.isActive = 0 THEN 'isActive = 0'
                 WHEN s.category <> 'Sku' THEN CONCAT('category = ', s.category)
                 ELSE '?' END AS sebab
       FROM transit_stock t
       LEFT JOIN stock_current s ON s.sku = t.sku AND s.areaId = t.areaId
      WHERE t.source = 'ocs'
        AND (s.sku IS NULL OR s.isActive = 0 OR s.category <> 'Sku')
      ORDER BY t.qty DESC LIMIT 20`,
  );
  if (buang.length) {
    console.log(`\n${'='.repeat(78)}`);
    console.log('Baris transit yang ADA tapi TIDAK ikut dihitung DOI:');
    for (const b of buang) console.log(`  ${b.areaId.padEnd(12)} ${n(b.qty).padStart(7)} pcs  ${b.sku.slice(0, 32).padEnd(32)} ${b.sebab}`);
    console.log(`  total ${n(buang.reduce((s, b) => s + Number(b.qty), 0))} pcs barang nyata yang tidak terlihat di DOI mana pun.`);
  }
  console.log('');
}

main()
  .catch((e) => { console.error('\nGAGAL:', e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
