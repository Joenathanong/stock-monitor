import './env';
import { prisma } from '../src/lib/prisma';
import { fetchBrandLookup } from '../src/lib/ocs';
import { petaBrand, PRIORITAS_BRAND, adalahBundle } from '../src/lib/atp';

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

  const { brand, asal, bentrok } = petaBrand(rows);
  console.log(`  ${n(brand.size)} SKU unik punya brand`);

  // Baris yang sudah diisi manual — dilindungi.
  const manual = new Set(
    (await prisma.skuBrand.findMany({ where: { manual: true }, select: { sku: true } })).map((r) => r.sku),
  );
  if (manual.size) console.log(`  ${n(manual.size)} SKU diisi manual${timpaManual ? ' — akan DITIMPA' : ' — dilindungi'}`);

  let ditulis = 0; let dilewati = 0;
  for (const [sku, b] of brand) {
    if (manual.has(sku) && !timpaManual) { dilewati++; continue; }
    await prisma.skuBrand.upsert({
      where: { sku },
      create: { sku, brand: b, brandAsal: asal.get(sku) ?? b, manual: false },
      update: { brand: b, brandAsal: asal.get(sku) ?? b, manual: timpaManual ? false : undefined },
    });
    ditulis++;
  }
  console.log(`\n${n(ditulis)} baris ditulis, ${n(dilewati)} dilewati (manual).`);

  if (bentrok.length) {
    console.log(`\n${bentrok.length} SKU punya LEBIH DARI SATU brand di OCS.`);
    console.log(`Diselesaikan dengan urutan prioritas: ${PRIORITAS_BRAND.join(' > ')}`);
    console.log('Asalnya tetap direkam di kolom brandAsal supaya bisa ditinjau.\n');
    for (const b of bentrok.slice(0, 20)) {
      console.log(`  ${b.sku.padEnd(34)} ${b.brand.join(' / ').padEnd(22)} -> ${b.menang}`);
    }
    if (bentrok.length > 20) console.log(`  …dan ${bentrok.length - 20} lagi.`);
  }

  // Cakupan terhadap SKU yang BENAR-BENAR dipakai ATP.
  //
  // Penyaringnya HARUS sama dengan `kelayakan()` di src/lib/atp.ts, kalau tidak
  // angka cakupan di sini bohong. SQL hanya bisa menyaring dua dari tiga
  // syaratnya; syarat ketiga — bundle — tidak bisa dilihat dari `category`:
  // 8 Okt 2026 terbukti ada baris `category = 'Sku'` dengan SKU
  // `"- BDL-HANASUI-0000001615"`. Jadi bundle dibuang di JS pakai
  // `adalahBundle()`, fungsi yang sama yang dipakai `kelayakan()` — bukan
  // disalin ulang, supaya tidak bisa berbeda nanti.
  const semuaAktif = await prisma.$queryRawUnsafe<{ sku: string }[]>(
    "SELECT DISTINCT sku FROM stock_current WHERE isActive = 1 AND category = 'Sku'",
  );
  const aktif = semuaAktif.filter((r) => !adalahBundle(r.sku));
  const bundle = semuaAktif.length - aktif.length;
  if (bundle) {
    console.log(`\n  ${n(bundle)} SKU dibuang: bundle (BDL-) walau OCS menandainya category='Sku'.`);
    console.log('  Bundle tidak masuk hitungan ATP, jadi tidak perlu brand.');
  }
  const punya = await prisma.skuBrand.findMany({
    where: { sku: { in: aktif.map((r) => r.sku) }, NOT: { brand: '' } },
    select: { sku: true },
  });
  const adaBrand = new Set(punya.map((p) => p.sku));
  const belum = aktif.filter((r) => !adaBrand.has(r.sku)).map((r) => r.sku);

  console.log(`\nCakupan terhadap SKU yang layak ATP (aktif, kategori Sku, bukan bundle):`);
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
