import './env';
import { prisma } from '../src/lib/prisma';
import { fetchBrandLookup } from '../src/lib/ocs';
import { petaBrand, PRIORITAS_BRAND, lengkapiDariKode, KATEGORI_ATP } from '../src/lib/atp';

/**
 * Tarik brand (= toko) per SKU dari OCS ke tabel `sku_brand`.
 *
 *   npm run sync:brand
 *   npm run sync:brand -- --timpa-manual
 *
 * Sumbernya `DTO_LookupStockDetailedData` — satu-satunya tempat brand ada di
 * OCS. Tidak ada medan bernama "Brand"; yang dipakai `ShopCode`/`ShopName`.
 *
 * ISI MANUAL TIDAK DITIMPA. Diukur 8 Okt 2026: 27 dari 375 SKU aktif tidak
 * punya brand di OCS (hampir semua prefiks `CS-`), dan user memutuskan itu
 * diisi manual, bukan diterka dari nama. Kalau sinkronisasi menimpanya, isian
 * manual hilang tiap kali skrip ini jalan — dan tidak ada yang akan sadar
 * sampai filter brand mulai salah. `--timpa-manual` ada untuk kasus sengaja.
 */
const timpaManual = process.argv.includes('--timpa-manual');
const n = (v: number) => v.toLocaleString('id-ID');

async function main() {
  console.log(`\nMenarik brand dari OCS${timpaManual ? ' (--timpa-manual: isian manual DITIMPA)' : ''}…`);

  const rows = await fetchBrandLookup(45_000);
  console.log(`  ${n(rows.length)} baris dari DTO_LookupStockDetailedData`);

  const peta = petaBrand(rows);
  console.log(`  ${n(peta.brand.size)} SKU unik punya brand dari lookup OCS`);

  // Lookup OCS memuat NOL bundle (diukur 8 Okt 2026: cakupan 0,0% dari 1.215
  // bundle aktif). Tanpa langkah ini 73% baris checklist tidak punya brand, dan
  // filter brand — satu-satunya cara isi borongan — jadi tidak berguna.
  // Brand-nya dibaca dari KODE SKU (`BDL-<BRAND>-`), bukan dari nama produk.
  const semuaSku = (await prisma.$queryRawUnsafe<{ sku: string }[]>(
    `SELECT DISTINCT sku FROM stock_current WHERE category IN (${KATEGORI_ATP.map(() => '?').join(',')})`,
    ...KATEGORI_ATP,
  )).map((r) => r.sku);
  const { diisi, brand, asal } = lengkapiDariKode(peta, semuaSku);
  const bentrok = peta.bentrok;
  if (diisi) console.log(`  ${n(diisi)} SKU tambahan dapat brand dari kode BDL- (lookup OCS tidak memuatnya)`);

  // Baris yang sudah diisi manual — dilindungi.
  const manual = new Set(
    (await prisma.skuBrand.findMany({ where: { manual: true }, select: { sku: true } })).map((r) => r.sku),
  );
  if (manual.size) console.log(`  ${n(manual.size)} SKU diisi manual${timpaManual ? ' — akan DITIMPA' : ' — dilindungi'}`);

  // --- penulisan BERKELOMPOK, bukan satu per satu ---
  //
  // Dulu `prisma.skuBrand.upsert()` di dalam loop: satu bolak-balik jaringan ke
  // TiDB per SKU. Dengan 586 SKU itu sudah lambat tapi masih tertahankan;
  // begitu bundle ikut (8 Okt 2026) jumlahnya jadi 2.607 dan skripnya duduk
  // 4–13 menit TANPA satu baris keluaran pun — user wajar mengira ia macet.
  //
  // Satu INSERT ... ON DUPLICATE KEY UPDATE per 400 baris memangkasnya jadi 7
  // bolak-balik. Pola dan ukuran kelompoknya sama dengan `BATCH` di sync.ts.
  //
  // `manual` SENGAJA tidak ikut di-UPDATE kecuali --timpa-manual: baris manual
  // sudah disaring keluar di bawah, jadi menuliskannya hanya membuka peluang
  // menghapus penandanya kalau penyaringnya suatu saat bocor.
  const KELOMPOK = 400;
  const akanDitulis = [...brand.entries()].filter(([sku]) => timpaManual || !manual.has(sku));
  const dilewati = brand.size - akanDitulis.length;
  const now = new Date();
  let ditulis = 0;

  if (akanDitulis.length) {
    process.stdout.write(`\nMenulis ${n(akanDitulis.length)} baris ke sku_brand`
      + ` (${Math.ceil(akanDitulis.length / KELOMPOK)} kelompok)…\n`);
  }
  // Potongan `manual` disusun DI LUAR panggilan Prisma. Ternary sebagai bagian
  // argumen melanggar aturan yang dijaga prisma-args.test.ts — dan lebih dari
  // itu, SQL yang dirakit di dalam daftar argumen susah dibaca saat salah.
  const setManual = timpaManual ? ', `manual`=VALUES(`manual`)' : '';

  for (let i = 0; i < akanDitulis.length; i += KELOMPOK) {
    const chunk = akanDitulis.slice(i, i + KELOMPOK);
    const ph = chunk.map(() => '(?,?,?,?,?)').join(',');
    const sql =
      `INSERT INTO sku_brand (\`sku\`, \`brand\`, \`brandAsal\`, \`manual\`, \`updatedAt\`) VALUES ${ph}
       ON DUPLICATE KEY UPDATE
         \`brand\`=VALUES(\`brand\`), \`brandAsal\`=VALUES(\`brandAsal\`), \`updatedAt\`=VALUES(\`updatedAt\`)${setManual}`;
    await prisma.$executeRawUnsafe(
      sql,
      ...chunk.flatMap(([sku, b]) => [
        sku.slice(0, 120), b.slice(0, 40), (asal.get(sku) ?? b).slice(0, 200), 0, now,
      ]),
    );
    ditulis += chunk.length;
    // Kemajuan ditulis per kelompok. Tanpa ini tidak ada cara membedakan
    // "sedang bekerja" dari "menggantung" — dan itu persis yang terjadi.
    const persen = ((ditulis / akanDitulis.length) * 100).toFixed(0);
    process.stdout.write(`  ${String(persen).padStart(3)}%  ${n(ditulis)} / ${n(akanDitulis.length)}\n`);
  }
  console.log(`\n${n(ditulis)} baris ditulis, ${n(dilewati)} dilewati (manual).`);

  if (bentrok.length) {
    console.log(`\n${bentrok.length} SKU punya LEBIH DARI SATU brand di OCS.`);
    console.log(`Diselesaikan dengan urutan prioritas: ${PRIORITAS_BRAND.join(' > ')}`);
    console.log('Asalnya tetap direkam di kolom brandAsal supaya bisa ditinjau.\n');
    for (const b of bentrok.slice(0, 20)) {
      // Ditandai jelas mana yang diputus oleh KODE SKU, bukan oleh urutan
      // prioritas — itu dua aturan berbeda dan user berhak tahu yang mana.
      const dari = b.dariKode ? ' (dari kode SKU)' : '';
      console.log(`  ${b.sku.padEnd(34)} ${b.brand.join(' / ').padEnd(22)} -> ${b.menang}${dari}`);
    }
    const olehKode = bentrok.filter((b) => b.dariKode).length;
    if (olehKode) {
      console.log(`\n  ${olehKode} di antaranya diputus oleh kode SKU-nya sendiri, bukan urutan prioritas.`);
    }
    if (bentrok.length > 20) console.log(`  …dan ${bentrok.length - 20} lagi.`);
  }

  // Cakupan terhadap SKU yang BENAR-BENAR dipakai ATP.
  //
  // Daftar kategorinya diambil dari `KATEGORI_ATP`, konstanta yang sama yang
  // dipakai `kelayakan()` — bukan ditulis ulang di sini. Sampai 8 Okt 2026
  // query ini menulis `category = 'Sku'` sendiri, dan begitu ATP diperluas ke
  // tiga kategori angka cakupannya akan diam-diam menghitung sepertiga dari
  // yang sebenarnya.
  const aktif = await prisma.$queryRawUnsafe<{ sku: string }[]>(
    `SELECT DISTINCT sku FROM stock_current WHERE isActive = 1 AND category IN (${KATEGORI_ATP.map(() => '?').join(',')})`,
    ...KATEGORI_ATP,
  );
  const punya = await prisma.skuBrand.findMany({
    where: { sku: { in: aktif.map((r) => r.sku) }, NOT: { brand: '' } },
    select: { sku: true },
  });
  const adaBrand = new Set(punya.map((p) => p.sku));
  const belum = aktif.filter((r) => !adaBrand.has(r.sku)).map((r) => r.sku);

  console.log(`\nCakupan terhadap SKU yang layak ATP (aktif; ${KATEGORI_ATP.join(', ')}):`);
  console.log(`  ${n(punya.length)} dari ${n(aktif.length)} punya brand `
    + `(${aktif.length ? ((punya.length / aktif.length) * 100).toFixed(1) : '0'}%)`);
  if (belum.length) {
    console.log(`\n  ${n(belum.length)} SKU BELUM punya brand — isi manual di halaman ATP.`);
    console.log('  Tidak diterka dari namanya (keputusan user): menerka akan salah');
    console.log('  mengelompokkan tanpa ada yang tahu.\n');
    for (const s of belum.slice(0, 30)) console.log(`    ${s}`);
    if (belum.length > 30) console.log(`    …dan ${belum.length - 30} lagi.`);
  }
  console.log('');
}

main()
  .catch((e) => { console.error('\nGAGAL:', e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
