import './env';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '../src/lib/prisma';

/**
 * Migrasi ke skema per-area di TiDB.
 *
 * TiDB memakai *clustered index* untuk primary key, dan primary key seperti itu
 * TIDAK BISA di-drop:
 *
 *   Error: Unsupported drop primary key when the table is using clustered index
 *
 * Jadi `prisma db push` gagal total untuk tiga tabel yang kuncinya berubah:
 * `doi_snapshot`, `doi_summary`, `transit_stock`. Satu-satunya jalan adalah
 * membuat tabel baru — tapi kalau tabel lama dihapus begitu saja, RIWAYAT
 * snapshot ikut hilang dan tren DOI di dashboard mulai dari nol lagi.
 *
 * PENTING — pelajaran 29 Sep 2026:
 *
 *   Versi pertama skrip ini hanya mengganti nama tabel jadi `*_lama` dan
 *   mengandalkan tabel itu bertahan selama `prisma db push`. TIDAK BERTAHAN.
 *   Prisma menghapus setiap tabel yang tidak ada di schema.prisma, dan `*_lama`
 *   memang tidak ada di sana, jadi push menawarkan:
 *
 *     • You are about to drop the `doi_snapshot_lama` table, which is not empty
 *     √ Do you want to ignore the warning(s)? ... yes
 *
 *   dan riwayat 4.828 baris hilang. Karena itu sekarang datanya juga DITULIS KE
 *   FILE JSON di `.migrasi-area/` sebelum apa pun disentuh. File itu di luar
 *   jangkauan Prisma, jadi langkah 2 tetap bisa memulihkan walau tabel `*_lama`
 *   sudah dihapus push.
 *
 * Tiga langkah:
 *
 *   1. npm run migrate:area            → data diekspor ke .migrasi-area/*.json,
 *                                        tabel lama diganti nama jadi *_lama
 *   2. npm run db:push                 → Prisma membuat tabel baru yang benar
 *                                        (boleh jawab "yes" pada peringatan
 *                                        drop *_lama — salinannya ada di JSON)
 *   3. npm run migrate:area -- --lanjut → data disalin masuk dari tabel *_lama
 *                                        kalau masih ada, kalau tidak dari JSON
 *
 * Baris lama tidak punya kolom areaId; semuanya diberi 'Pusat', karena memang
 * itulah satu-satunya area yang dihitung sebelum perubahan ini.
 */
const TABEL = ['doi_snapshot', 'doi_summary', 'transit_stock'] as const;
const AREA_LAMA = 'Pusat';
const DIR = '.migrasi-area';
const berkas = (t: string) => join(DIR, `${t}.json`);

async function ada(nama: string): Promise<boolean> {
  const r = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
    nama,
  );
  return Number(r[0]?.n ?? 0) > 0;
}

async function kolom(nama: string): Promise<string[]> {
  const r = await prisma.$queryRawUnsafe<{ c: string }[]>(
    'SELECT column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position',
    nama,
  );
  return r.map((x) => x.c);
}

const hitung = async (t: string) =>
  Number((await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM \`${t}\``))[0].n);

/** JSON tidak kenal BigInt, dan Date harus tetap bisa dibedakan dari teks. */
const rapikan = (v: unknown): unknown =>
  typeof v === 'bigint' ? Number(v)
  : v instanceof Date ? { __tanggal: v.toISOString() }
  : v;
const pulihkan = (v: unknown): unknown =>
  v && typeof v === 'object' && '__tanggal' in (v as Record<string, unknown>)
    ? new Date(String((v as Record<string, unknown>).__tanggal))
    : v;

async function langkah1() {
  console.log('Langkah 1 — mengekspor data lama lalu mengganti nama tabel\n');
  mkdirSync(DIR, { recursive: true });
  let apaPun = false;
  for (const t of TABEL) {
    const lama = `${t}_lama`;
    if (await ada(lama)) { console.log(`  ${lama} sudah ada — dilewati`); continue; }
    if (!(await ada(t))) { console.log(`  ${t} belum ada — dilewati`); continue; }

    // Ekspor DULU. Ini jaring pengaman satu-satunya kalau db:push menghapus *_lama.
    const isi = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM \`${t}\``);
    const bersih = isi.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, rapikan(v)])));
    writeFileSync(berkas(t), JSON.stringify({ tabel: t, kolom: await kolom(t), baris: bersih }, null, 0), 'utf8');

    await prisma.$executeRawUnsafe(`RENAME TABLE \`${t}\` TO \`${lama}\``);
    console.log(`  ${t}: ${isi.length.toLocaleString('id-ID')} baris → ${berkas(t)} + tabel ${lama}`);
    apaPun = true;
  }
  if (!apaPun) { console.log('\nTidak ada yang perlu diganti nama.'); return; }
  console.log('\nSekarang jalankan:\n  npm run db:push');
  console.log('\n  db:push akan memperingatkan bahwa tabel *_lama berisi data dan akan dihapus.');
  console.log(`  Jawab "yes" saja — salinan lengkapnya sudah ada di ${DIR}/, dan langkah`);
  console.log('  berikutnya memulihkannya dari sana.');
  console.log('\nLalu:\n  npm run migrate:area -- --lanjut');
}

async function dariTabel(t: string, lama: string): Promise<number | null> {
  if (!(await ada(lama))) return null;
  const baru = await kolom(t);
  const asal = new Set(await kolom(lama));
  const sama = baru.filter((c) => asal.has(c) && c !== 'areaId');
  const punyaArea = baru.includes('areaId');
  const target = punyaArea ? ['areaId', ...sama] : sama;
  const sumber = punyaArea ? [`'${AREA_LAMA}'`, ...sama.map((c) => `\`${c}\``)] : sama.map((c) => `\`${c}\``);
  const n = await hitung(lama);
  if (n) {
    await prisma.$executeRawUnsafe(
      `INSERT IGNORE INTO \`${t}\` (${target.map((c) => `\`${c}\``).join(',')})
       SELECT ${sumber.join(',')} FROM \`${lama}\``,
    );
  }
  await prisma.$executeRawUnsafe(`DROP TABLE \`${lama}\``);
  return n;
}

async function dariJson(t: string): Promise<number | null> {
  if (!existsSync(berkas(t))) return null;
  const { baris } = JSON.parse(readFileSync(berkas(t), 'utf8')) as { baris: Record<string, unknown>[] };
  if (!baris.length) return 0;
  const baru = new Set(await kolom(t));
  const punyaArea = baru.has('areaId');
  // Hanya kolom yang masih ada di tabel baru; kolom baru dibiarkan pakai bawaannya.
  const kol = Object.keys(baris[0]).filter((c) => baru.has(c) && c !== 'areaId');
  const target = punyaArea ? ['areaId', ...kol] : kol;
  const petak = `(${target.map(() => '?').join(',')})`;
  // Dipotong per 200 baris supaya satu pernyataan tidak kebesaran untuk TiDB.
  for (let i = 0; i < baris.length; i += 200) {
    const potong = baris.slice(i, i + 200);
    const nilai: unknown[] = [];
    for (const r of potong) {
      if (punyaArea) nilai.push(AREA_LAMA);
      for (const c of kol) nilai.push(pulihkan(r[c]) ?? null);
    }
    await prisma.$executeRawUnsafe(
      `INSERT IGNORE INTO \`${t}\` (${target.map((c) => `\`${c}\``).join(',')}) VALUES ${potong.map(() => petak).join(',')}`,
      ...nilai,
    );
  }
  return baris.length;
}

async function langkah2() {
  console.log('Langkah 2 — memulihkan data lama ke tabel baru\n');
  for (const t of TABEL) {
    const lama = `${t}_lama`;
    if (!(await ada(t))) {
      console.log(`  ${t} BELUM DIBUAT — jalankan "npm run db:push" dulu, lalu ulangi perintah ini.`);
      process.exitCode = 1; return;
    }
    let n = await dariTabel(t, lama);
    let asal = `tabel ${lama}`;
    if (n === null) { n = await dariJson(t); asal = berkas(t); }
    if (n === null) { console.log(`  ${t}: tidak ada salinan lama — dilewati`); continue; }
    const isi = await hitung(t);
    console.log(`  ${t}: ${n.toLocaleString('id-ID')} baris dipulihkan dari ${asal}` +
      ` (areaId = '${AREA_LAMA}') · isi sekarang ${isi.toLocaleString('id-ID')}`);
  }
  console.log(`\nSelesai. Folder ${DIR}/ boleh dihapus setelah dashboard terlihat benar.`);
  console.log('Lanjut:\n  npm run sync:transit -- --force\n  npm run compute');
}

const lanjut = process.argv.includes('--lanjut');
(lanjut ? langkah2() : langkah1())
  .catch((e) => { console.error('GAGAL:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
