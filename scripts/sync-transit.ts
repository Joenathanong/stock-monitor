import './env';
import { syncTransit } from '../src/lib/sync';
import { prisma } from '../src/lib/prisma';

/**
 * Tarik barang dalam perjalanan dari OCS. `--force` mengabaikan jendela kesegaran.
 *   npm run sync:transit
 *   npm run sync:transit -- --force
 */
const force = process.argv.includes('--force');

syncTransit(15 * 60_000, 3, force)
  .then(async (r) => {
    console.log(r.skipped ? r.message
      : `${r.rows} baris dari ${r.docs} dokumen`
        + `${r.docsCache ? ` — ${r.docsCache} dari cache, ${r.docsBaru} ditarik` : ''}`
        + ` (${Math.round((r.durationMs ?? 0) / 1000)} dtk)`
        + `${r.partial ? `\n  SEBAGIAN: ${r.docsKurang} dokumen belum terbaca` : ''}`);
    if (r.areas) {
      console.log('\nPer gudang (qty = DoQty, yang dipakai DOI):');
      console.table(Object.entries(r.areas).map(([area, qty]) => ({ area, qty })));
      console.log(`  total DoQty ${r.totalDoQty?.toLocaleString('id-ID')} · BatchQuantity ${r.totalBatchQty?.toLocaleString('id-ID')}`);
    }
    if (r.takCocok) {
      const rows = await prisma.$queryRawUnsafe<{ sku: string; areaId: string; qty: number }[]>(
        "SELECT sku, areaId, qty FROM transit_stock WHERE source = 'ocs' ORDER BY qty DESC LIMIT 5",
      );
      console.log(`\n  ${r.takCocok} kode SAP tidak ketemu SKU-nya — cek di halaman Stok Dalam Perjalanan.`);
      console.log('  Contoh baris yang BERHASIL dicocokkan:', rows.map((x) => `${x.sku}/${x.areaId}`).join(', '));
    }
    if (r.message && !r.skipped) console.log(`\n  ${r.message}`);
  })
  .catch((e) => { console.error('GAGAL:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
