/**
 * Jaring pengaman SEBELUM `npm run db:push`.
 *
 * `prisma db push` MENGHAPUS tabel yang ada di database tapi tidak ada di
 * schema.prisma, tanpa bertanya. Di proyek ini hal itu sudah pernah terjadi dan
 * memusnahkan 4.828 baris snapshot. Skrip ini membandingkan daftar tabel NYATA
 * di TiDB dengan daftar @@map di schema.prisma, dan menyebutkan isi barisnya,
 * supaya keputusan menjalankan db:push diambil dengan melihat data — bukan
 * dengan berharap.
 *
 * Hanya membaca. Tidak mengubah apa pun.
 */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Ambil nama tabel dari @@map("..."), plus nama model untuk model tanpa @@map. */
function tabelDiSchema(): { map: Set<string>; tanpaMap: string[] } {
  const teks = readFileSync('prisma/schema.prisma', 'utf8');
  const map = new Set<string>();
  const tanpaMap: string[] = [];
  // Pisah per blok model supaya @@map dipasangkan ke model yang benar.
  const blok = teks.split(/\nmodel\s+/).slice(1);
  for (const b of blok) {
    const nama = b.slice(0, b.search(/[\s{]/));
    const m = b.slice(0, b.indexOf('\n}')).match(/@@map\("([^"]+)"\)/);
    if (m) map.add(m[1]); else tanpaMap.push(nama);
  }
  return { map, tanpaMap };
}

const n = (v: unknown) => Number(v ?? 0).toLocaleString('id-ID');

async function main() {
  const { map, tanpaMap } = tabelDiSchema();

  const baris = await prisma.$queryRawUnsafe<{ t: string }[]>(
    'SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = \'BASE TABLE\' ORDER BY TABLE_NAME',
  );
  const diDb = baris.map((r) => r.t);

  console.log(`\nTabel di database : ${diDb.length}`);
  console.log(`@@map di schema   : ${map.size}`);
  if (tanpaMap.length) {
    console.log(`\n! ${tanpaMap.length} model TANPA @@map — Prisma memakai nama modelnya apa adanya:`);
    console.log(`  ${tanpaMap.join(', ')}`);
  }

  // Yang ADA di DB tapi TIDAK di schema -> INI yang akan dihapus db:push.
  const akanDihapus = diDb.filter((t) => !map.has(t) && !tanpaMap.includes(t) && !t.startsWith('_prisma'));

  if (!akanDihapus.length) {
    console.log('\nAMAN: tidak ada tabel di database yang hilang dari schema.');
    console.log('`npm run db:push` tidak akan menghapus tabel mana pun.');
  } else {
    console.log(`\n*** BAHAYA: ${akanDihapus.length} tabel ADA di database tapi TIDAK di schema.prisma.`);
    console.log('*** `npm run db:push` akan MENGHAPUS tabel di bawah ini beserta isinya.');
    console.log('*** JANGAN jalankan db:push sebelum ini diselesaikan.\n');
    for (const t of akanDihapus) {
      let isi = '?';
      try {
        const r = await prisma.$queryRawUnsafe<{ c: bigint }[]>(`SELECT COUNT(*) AS c FROM \`${t}\``);
        isi = n(r[0]?.c);
      } catch (e) { isi = `gagal dihitung (${e instanceof Error ? e.message : String(e)})`; }
      console.log(`    ${t.padEnd(24)} ${isi} baris`);
    }
    console.log('\nPilihan: (a) tambahkan model-nya ke schema.prisma supaya tidak dihapus,');
    console.log('         (b) export dulu ke JSON kalau tabelnya memang sudah tidak dipakai.');
  }

  // Yang di schema tapi belum ada di DB -> ini yang akan DIBUAT (tidak merusak).
  const akanDibuat = [...map, ...tanpaMap].filter((t) => !diDb.includes(t));
  console.log(`\nAkan DIBUAT oleh db:push (tidak merusak): ${akanDibuat.length ? akanDibuat.join(', ') : '(tidak ada)'}`);

  // Isi tabel yang paling mahal kalau hilang — untuk dicatat sebelum push.
  console.log('\nJumlah baris tabel penting sekarang (catat sebelum push):');
  for (const t of ['doi_snapshot', 'sales_daily', 'stock_daily', 'stock_current', 'transit_stock', 'sku_master']) {
    if (!diDb.includes(t)) { console.log(`  ${t.padEnd(16)} (tabel belum ada)`); continue; }
    try {
      const r = await prisma.$queryRawUnsafe<{ c: bigint }[]>(`SELECT COUNT(*) AS c FROM \`${t}\``);
      console.log(`  ${t.padEnd(16)} ${n(r[0]?.c)}`);
    } catch { console.log(`  ${t.padEnd(16)} gagal dihitung`); }
  }
  console.log();
}

main()
  .catch((e) => { console.error('\nGagal:', e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
