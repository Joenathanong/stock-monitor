import './env';
import { prisma } from '../src/lib/prisma';

/**
 * TiDB memakai clustered index untuk primary key, jadi `prisma db push` tidak bisa
 * mengganti PK sebuah tabel di tempat ("Unsupported drop primary key when the table
 * is using clustered index"). Tabel phase_out berpindah kunci dari `sku` ke `key`,
 * jadi tabelnya perlu dibuang dulu lalu dibuat ulang oleh db:push.
 *
 * Isinya memang ikut hilang — daftar phase out tinggal diunggah ulang.
 */
async function main() {
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'phase_out'",
  );
  if (Number(rows[0]?.n ?? 0) === 0) {
    console.log('Tabel phase_out belum ada — tidak ada yang perlu dibuang.');
  } else {
    const isi = await prisma.$queryRawUnsafe<{ n: bigint }[]>('SELECT COUNT(*) AS n FROM phase_out');
    console.log(`Tabel phase_out ditemukan, berisi ${Number(isi[0]?.n ?? 0)} baris — akan dibuang.`);
    await prisma.$executeRawUnsafe('DROP TABLE phase_out');
    console.log('Tabel phase_out dibuang.');
  }
  console.log('\nLangkah berikutnya:\n  npm run db:push\n  lalu buka menu Phase Out dan unggah daftar kode SAP.');
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
