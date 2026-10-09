import './env';
import { syncBundle } from '../src/lib/sync';
import { prisma } from '../src/lib/prisma';

/**
 * Tarik komposisi bundling OCS ke `bundle_item`.
 *
 *   npm run sync:bundle            (hormati jeda bundle_refresh_hours)
 *   npm run sync:bundle -- --force (tarik sekarang, apa pun jedanya)
 */
const force = process.argv.includes('--force');

syncBundle(60_000, force ? 0 : 12, force)
  .then(async (r) => {
    console.log(`\n${r.ok ? 'OK' : 'GAGAL'}${r.skipped ? ' (dilewati)' : ''} — ${r.message ?? ''}`);
    if (r.bundle) {
      const contoh = await prisma.$queryRawUnsafe<{ bundleSku: string; n: bigint }[]>(
        'SELECT bundleSku, COUNT(*) AS n FROM bundle_item GROUP BY bundleSku ORDER BY n DESC LIMIT 5',
      );
      console.log('\nBundle dengan komponen terbanyak:');
      for (const c of contoh) console.log(`  ${String(c.n).padStart(3)} komponen  ${c.bundleSku}`);

      // Yang paling berguna diketahui: komponen yang TIDAK ada di stok OCS.
      // Itu bundle yang tidak akan pernah bisa dijanjikan, dan sebabnya tidak
      // kelihatan di angka mana pun selain di sini.
      const yatim = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        'SELECT COUNT(DISTINCT b.itemSku) AS n FROM bundle_item b '
        + 'LEFT JOIN stock_current s ON s.sku = b.itemSku WHERE s.sku IS NULL',
      );
      console.log(`\n${yatim[0]?.n ?? 0} SKU komponen tidak ada di stock_current (tidak akan punya angka stok).`);
    }
    console.log('');
  })
  .catch((e) => { console.error('GAGAL:', e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
