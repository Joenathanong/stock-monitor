import './env';
import { tarikStokEji, whsPemasok } from '../src/lib/eji';
import { prisma } from '../src/lib/prisma';

/**
 * Tarik saldo gudang pemasok EJI ke tabel `supplier_stock`.
 *
 *   npm run sync:supplier
 *
 * Penulisan upsert, lalu baris LAMA untuk gudang yang sama dibuang — tapi HANYA
 * kalau penarikannya tuntas. Kalau cuma sebagian yang terbaca, pembersihan
 * dilewati: menghapus berdasarkan data separuh akan menghilangkan saldo yang
 * sebenarnya masih ada, dan Sugest PO jadi mengira gudangnya kosong.
 */
const BATCH = 500;

tarikStokEji()
  .then(async (r) => {
    const now = new Date();
    for (let i = 0; i < r.rows.length; i += BATCH) {
      const chunk = r.rows.slice(i, i + BATCH);
      const ph = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?)').join(',');
      await prisma.$executeRawUnsafe(
        'INSERT INTO `supplier_stock` (`supplierWhs`,`sapCode`,`name`,`onHand`,`committed`,`sqOpen`,`ordered`,`balNoSq`,`bal`,`perCtn`,`pulledAt`) '
        + `VALUES ${ph} ON DUPLICATE KEY UPDATE `
        + '`name`=VALUES(`name`), `onHand`=VALUES(`onHand`), `committed`=VALUES(`committed`), '
        + '`sqOpen`=VALUES(`sqOpen`), `ordered`=VALUES(`ordered`), `balNoSq`=VALUES(`balNoSq`), '
        + '`bal`=VALUES(`bal`), `perCtn`=VALUES(`perCtn`), `pulledAt`=VALUES(`pulledAt`)',
        ...chunk.flatMap((x) => [
          x.supplierWhs, x.sapCode, x.name, x.onHand, x.committed,
          x.sqOpen, x.ordered, x.balNoSq, x.bal, x.perCtn, now,
        ]),
      );
    }

    let dihapus = 0;
    if (!r.sebagian) {
      for (const w of whsPemasok()) {
        dihapus += await prisma.$executeRawUnsafe(
          'DELETE FROM `supplier_stock` WHERE `supplierWhs` = ? AND `pulledAt` < ?', w, now,
        );
      }
    }

    console.log(
      `\n${r.rows.length.toLocaleString('id-ID')} baris ditulis untuk gudang ${whsPemasok().join(', ')}`
      + `${r.sebagian ? ' (SEBAGIAN — pembersihan dilewati supaya saldo lama tidak hilang)' : ` · ${dihapus} baris lama dihapus`}\n`,
    );
  })
  .catch((e) => { console.error('GAGAL:', e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
