import './env';
import { prisma } from '../src/lib/prisma';

/** Uji koneksi TiDB: tulis, baca, hapus. Menjawab "apakah DATABASE_URL benar?". */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL belum diisi di .env');
  console.log('Host  :', new URL(url.replace('mysql://', 'http://')).host);

  const t0 = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  console.log('Koneksi OK dalam', Date.now() - t0, 'ms');

  await prisma.appSetting.upsert({
    where: { key: '__check__' },
    create: { key: '__check__', value: new Date().toISOString() },
    update: { value: new Date().toISOString() },
  });
  const row = await prisma.appSetting.findUnique({ where: { key: '__check__' } });
  console.log('Tulis & baca OK  :', row?.value);
  await prisma.appSetting.delete({ where: { key: '__check__' } });
  console.log('Hapus OK');

  const counts = {
    stock: await prisma.stockCurrent.count(),
    sales: await prisma.salesDaily.count(),
    transit: await prisma.transitStock.count(),
    skuMaster: await prisma.skuMaster.count(),
    snapshot: await prisma.doiSnapshot.count(),
  };
  console.log('Isi tabel        :', counts);
}

main().catch((e) => { console.error('GAGAL:', e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
