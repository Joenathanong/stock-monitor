import './env';
import { isiAreaBawaan, muatArea } from '../src/lib/area-store';
import { prisma } from '../src/lib/prisma';

/**
 * Isi tabel `area` dari data yang sudah ada. Aman dijalankan berulang.
 *
 *   npm run db:push        <- tabelnya dibuat dulu
 *   npm run seed:area
 */
isiAreaBawaan()
  .then(async ({ dibuat, sudahAda, perluKode }) => {
    console.log(`\n${sudahAda} baris area sudah ada sebelumnya.`);
    if (dibuat.length) {
      console.log(`${dibuat.length} ditambahkan:`);
      for (const d of dibuat) console.log(`  + ${d}`);
    } else {
      console.log('Tidak ada yang perlu ditambahkan.');
    }
    const semua = await muatArea();
    console.log('\nIsi tabel area sekarang:');
    console.log('kode        area           aktif  urut  DOI min/maks  mulai');
    for (const a of semua) {
      console.log(
        a.code.padEnd(11),
        a.name.padEnd(14),
        (a.isActive ? 'ya' : 'tidak').padEnd(6),
        String(a.sortOrder).padStart(4),
        `${a.doiMin ?? '-'}/${a.doiMax ?? '-'}`.padStart(13),
        a.startDate ?? '-',
      );
    }
    if (perluKode.length) {
      console.log(`\n${perluKode.length} nama area ada di stock_current tapi BELUM terdaftar:`);
      for (const n of perluKode) console.log(`  - ${n}`);
      console.log('Kode gudang OCS-nya tidak bisa diterka, jadi barisnya TIDAK dibuat otomatis.');
      console.log('Tambahkan di Pengaturan → Cabang / Area dengan kode gudang yang benar');
      console.log('(kode itulah yang dipakai mencocokkan SIT dari dokumen receive OCS).');
      console.log('Jalankan "npm run check:receive" untuk melihat kode gudang apa saja yang dipakai OCS.');
    }
    console.log('');
  })
  .catch((e) => { console.error('GAGAL:', e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
