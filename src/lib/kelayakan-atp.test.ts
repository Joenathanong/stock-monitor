import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { KATEGORI_ATP, kelayakan, brandDariKode, lengkapiDariKode, petaBrand, lingkupBorongan } from './atp';

/**
 * Penjaga: kode ATP TIDAK boleh menyaring `category = 'Sku'` sendiri.
 *
 * Sejarahnya dua babak, dan keduanya kesalahan yang sama dalam bentuk berbeda.
 *
 * 8 Okt pagi — ATP hanya kategori 'Sku', dan `scripts/sync-brand.ts` menyaring
 * `category = 'Sku'` di query cakupannya tanpa membuang bundle. Akibatnya
 * `- BDL-HANASUI-0000001615` masuk daftar "belum punya brand".
 *
 * 8 Okt sore — user memutuskan ATP mencakup Sku + Bundle + Gimmick. Setiap
 * `category = 'Sku'` yang tertinggal di kode ATP sekarang jadi jauh lebih
 * mahal: ia diam-diam membuang 1.215 bundle dan 68 gimmick, yaitu 73% dari
 * katalognya, dan angkanya tetap terlihat masuk akal.
 *
 * Aturannya sekarang satu kalimat: daftar kategori ATP hanya boleh datang dari
 * `KATEGORI_ATP`. Tes ini membaca sumbernya dan gagal kalau ada berkas ATP yang
 * menuliskan daftarnya sendiri.
 *
 * CAKUPANNYA HANYA BERKAS ATP, yaitu yang mengimpor `atp.ts`. DOI Monitor
 * menyaring `category = 'Sku'` di tujuh tempat dan di sana itu MEMANG benar —
 * user menegaskan DOI tetap SKU saja. Melarangnya di seluruh repo akan memaksa
 * perubahan di DOI yang tidak diminta dan salah.
 */

function berkasTs(dir: string, hasil: string[] = []): string[] {
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) berkasTs(p, hasil);
    else if (/\.(ts|tsx)$/.test(nama) && !/\.test\.tsx?$/.test(nama)) hasil.push(p);
  }
  return hasil;
}

/** `category = 'Sku'` di dalam SQL mentah, apa pun spasi dan kutipnya. */
const SARING_SQL = /category\s*=\s*['"]Sku['"]/i;
/** Berkas ATP = yang mengimpor atp.ts (ekstensi ikut diterima). */
const IMPOR_ATP = /from\s+['"][^'"]*\/atp(?:\.[jt]s)?['"]/;

test('berkas ATP tidak menyaring category=Sku sendiri', () => {
  const berkas = [...berkasTs('src'), ...berkasTs('scripts')]
    .filter((f) => !/[\\/]atp\.ts$/.test(f));
  const atp = berkas.filter((f) => IMPOR_ATP.test(readFileSync(f, 'utf8')));
  assert.ok(atp.length > 0, 'tidak ada berkas yang mengimpor atp.ts — penjaga ini jadi kosong');

  const pelanggar: string[] = [];
  for (const f of atp) {
    const kode = readFileSync(f, 'utf8')
      // Komentar dibuang: berkas-berkas ini MENJELASKAN sejarah aturannya, dan
      // penjelasan itu menyebut `category = 'Sku'` berkali-kali.
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    if (SARING_SQL.test(kode)) pelanggar.push(f);
  }
  assert.deepEqual(
    pelanggar,
    [],
    `Berkas ATP ini menuliskan sendiri daftar kategorinya:\n  ${pelanggar.join('\n  ')}\n`
      + `ATP mencakup ${KATEGORI_ATP.join(', ')} — menyaring 'Sku' saja membuang 73% katalog diam-diam.\n`
      + 'Pakai KATEGORI_ATP dari src/lib/atp.ts.',
  );
});

test('kelayakan menerima ketiga kategori, menolak selainnya', () => {
  const b = (o: Record<string, unknown>) =>
    ({ sku: 'X', areaId: 'Medan', availableQty: 10, isActive: true, category: 'Sku', ...o }) as never;
  for (const kat of KATEGORI_ATP) assert.equal(kelayakan(b({ category: kat })).layak, true, kat);
  assert.equal(kelayakan(b({ category: 'Material' })).sebab, 'BUKAN_KATEGORI_SKU');
  assert.equal(kelayakan(b({ category: null })).sebab, 'BUKAN_KATEGORI_SKU');

  // Bundle TIDAK lagi ditolak — ini pembalikan aturan 8 Okt sore.
  assert.equal(kelayakan(b({ sku: '- BDL-HANASUI-0000001615', category: 'Sku' })).layak, true);
  assert.equal(kelayakan(b({ sku: 'BDL-EOMMA-0000000001', category: 'Bundle' })).layak, true);
});

test('saringan aktif: AKTIF / NONAKTIF / SEMUA', () => {
  const b = (isActive: boolean) =>
    ({ sku: 'X', areaId: 'Medan', availableQty: 10, isActive, category: 'Sku' }) as never;
  assert.equal(kelayakan(b(true), 'AKTIF').layak, true);
  assert.equal(kelayakan(b(false), 'AKTIF').sebab, 'TIDAK_AKTIF');
  assert.equal(kelayakan(b(false), 'NONAKTIF').layak, true);
  assert.equal(kelayakan(b(true), 'NONAKTIF').sebab, 'TIDAK_AKTIF');
  assert.equal(kelayakan(b(true), 'SEMUA').layak, true);
  assert.equal(kelayakan(b(false), 'SEMUA').layak, true);
});

test('brand bundle dibaca dari kode, dengan ejaan daftar prioritas', () => {
  // Pola nyata OCS 8 Okt 2026 — 1.215 dari 1.215 cocok, 0 gagal.
  assert.equal(brandDariKode('BDL-HANASUI-0000001615'), 'Hanasui');
  assert.equal(brandDariKode('- BDL-HANASUI-0000001615'), 'Hanasui');
  assert.equal(brandDariKode('BDL-EOMMA-0000000001'), 'EOMMA');
  assert.equal(brandDariKode('BDL-NCO-0000000123'), 'NCO');
  assert.equal(brandDariKode('BDL-FYNE-0000000123'), 'FYNE');
  // Bukan bundle, atau brand di luar daftar → kosong, BUKAN terkaan.
  assert.equal(brandDariKode('ACNE-DAY-CREAM'), '');
  assert.equal(brandDariKode('BDL-MERKASING-0001'), '');
  // Gimmick sengaja tidak ikut pola ini: "GIMMICK-TUMBLER-..." bukan brand.
  assert.equal(brandDariKode('GIMMICK-TUMBLER-NCO'), '');
});

test('lookup OCS selalu menang atas kode', () => {
  const peta = petaBrand([{ SellerSku: 'BDL-HANASUI-0000000001', ShopCode: 'NCO' }]);
  const { brand, asal, diisi } = lengkapiDariKode(peta, [
    'BDL-HANASUI-0000000001',   // sudah ada dari lookup → tidak boleh ditimpa
    'BDL-HANASUI-0000000002',   // belum ada → diisi dari kode
  ]);
  assert.equal(brand.get('BDL-HANASUI-0000000001'), 'NCO', 'pernyataan eksplisit OCS harus menang');
  assert.equal(brand.get('BDL-HANASUI-0000000002'), 'Hanasui');
  assert.equal(diisi, 1);
  // Asalnya ditandai supaya hasil terkaan bisa ditinjau ulang nanti.
  assert.equal(asal.get('BDL-HANASUI-0000000002'), 'kode BDL-');
  assert.equal(asal.get('BDL-HANASUI-0000000001'), 'NCO');
});

// ---------------------------------------------------------------------------
// Pola kode diperluas + kode menang atas prioritas (keputusan user 8 Okt 2026).
// ---------------------------------------------------------------------------

test('brand dibaca dari kode untuk SEMUA awalan, bukan hanya BDL-', () => {
  // SKU nyata dari daftar 46 yang belum punya brand.
  assert.equal(brandDariKode('CS-HANASUI-POWER-BRIGHT-SERUM'), 'Hanasui');
  assert.equal(brandDariKode('GIMMICK-NCO-GIFT-TUMBLR-CORKCICLE'), 'NCO');
  assert.equal(brandDariKode('GIMMICK-FYNE-POWERBANK'), 'FYNE');
  assert.equal(brandDariKode('GIMMICK-EOMMA-BUKU'), 'EOMMA');
  assert.equal(brandDariKode('BDL-HANASUI-0000001615'), 'Hanasui');
  // Bentuk KOTOR yang nyata ada di OCS — dua jenis, dua pembersihan berbeda.
  assert.equal(brandDariKode('- BDL-HANASUI-0000001615'), 'Hanasui', 'awalan "- "');
  assert.equal(brandDariKode('90 FYNE-BRIGHT-BARRIER-MOIST'), 'FYNE', 'awalan "90 "');
  // Brand di segmen PERTAMA (parfum NCO) maupun KEDUA sama-sama terbaca.
  assert.equal(brandDariKode('NCO-EDP-AMETHYST'), 'NCO');
});

test('segmen yang BUKAN brand tetap kosong — ini yang membuatnya bukan terkaan', () => {
  // Enam belas SKU nyata yang memang harus tetap manual. Kalau salah satu dari
  // ini mengembalikan brand, aturannya sudah berubah jadi menebak.
  for (const s of [
    'CS-MUD-MASK-JAPANESE', 'CS-ACNE-TREATMENT-ESSENCE', 'CS-ADVANCE-EXFOLIATING-SERUM',
    'CS-ANTI-AGING-PEEL-OFF-MASK', 'CS-SUNSCREEN-SPF30-RENEW-HANGTAG',
    'GIMMICK-TAS-PUFFY-PINK', 'GIMMICK-TUMBLER-OAWALA', 'GIMMICK-CATOKAN-NVMEE',
    'GIMMICK-MATTEDORABLE-EYE-CURLER', 'GIMMICK-AERIS-BRUSH-COMPLETE-SET',
  ]) {
    assert.equal(brandDariKode(s), '', `"${s}" seharusnya kosong, bukan terkaan`);
  }
  // EOMMA ada di SKU ini tapi di SEGMEN TERAKHIR, bukan kedua — tidak diterima.
  assert.equal(brandDariKode('GIMMICK-VOUCHER-KLIKNCLEAN-EOMMA'), '');
});

test('bentrokan dua brand: kode SKU menang atas urutan prioritas', () => {
  // Kasus nyata: 11 parfum NCO-EDP-* terdaftar di toko Hanasui DAN NCO.
  // Urutan prioritas melabelinya Hanasui; kodenya sendiri menyebut NCO.
  const peta = petaBrand([
    { SellerSku: 'NCO-EDP-AMETHYST', ShopCode: 'Hanasui' },
    { SellerSku: 'NCO-EDP-AMETHYST', ShopCode: 'NCO' },
  ]);
  assert.equal(peta.brand.get('NCO-EDP-AMETHYST'), 'NCO');
  assert.equal(peta.bentrok[0].dariKode, true);
  // Asalnya tetap merekam KEDUANYA supaya bisa ditinjau.
  assert.equal(peta.asal.get('NCO-EDP-AMETHYST'), 'Hanasui, NCO');
});

test('bentrokan yang kodenya tidak menyebut brand tetap pakai urutan prioritas', () => {
  // Lima sisanya dari 16 bentrokan: BBS-* dan BALMTINT-* tidak menyebut brand.
  const peta = petaBrand([
    { SellerSku: 'BBS-CHEERFUL-BLISS', ShopCode: 'Hanasui' },
    { SellerSku: 'BBS-CHEERFUL-BLISS', ShopCode: 'NCO' },
  ]);
  assert.equal(peta.brand.get('BBS-CHEERFUL-BLISS'), 'Hanasui', 'prioritas yang memutus');
  assert.equal(peta.bentrok[0].dariKode, false);
});

test('kode TIDAK menang kalau brandnya bukan kandidat bentrokan', () => {
  // Kalau kode menyebut brand yang OCS tidak daftarkan untuk SKU itu, yang
  // meragukan adalah kodenya — bukan datanya. Prioritas yang dipakai.
  const peta = petaBrand([
    { SellerSku: 'BDL-EOMMA-0000000001', ShopCode: 'Hanasui' },
    { SellerSku: 'BDL-EOMMA-0000000001', ShopCode: 'FYNE' },
  ]);
  assert.equal(peta.brand.get('BDL-EOMMA-0000000001'), 'Hanasui');
  assert.equal(peta.bentrok[0].dariKode, false);
});

// ---------------------------------------------------------------------------
// Lingkup isi borongan — bagian yang bisa merusak paling banyak.
// ---------------------------------------------------------------------------

const brs = (sku: string, ...areas: string[]) =>
  ({ sku, area: Object.fromEntries(areas.map((a) => [a, {}])) });

test('tanpa centang: lingkupnya seluruh baris yang lolos filter', () => {
  const baris = [brs('A', 'Medan', 'Pusat'), brs('B', 'Medan')];
  const r = lingkupBorongan(baris, new Set(), ['Medan', 'Pusat']);
  assert.equal(r.pakaiPilihan, false);
  assert.equal(r.target.length, 2);
  assert.equal(r.nKeputusan, 3, 'A punya 2 area, B punya 1');
});

test('PILIHAN DIPOTONG DENGAN FILTER — tidak pernah mengubah baris di luar layar', () => {
  // Inti keamanannya: user mencentang A dan Z, lalu memfilter sehingga Z hilang
  // dari daftar. Z TIDAK boleh ikut berubah.
  const baris = [brs('A', 'Medan'), brs('B', 'Medan')];
  const r = lingkupBorongan(baris, new Set(['A', 'Z']), ['Medan']);
  assert.deepEqual(r.target.map((x) => x.sku), ['A']);
  assert.equal(r.nKeputusan, 1);
});

test('baris yang tidak punya area yang dituju tidak ikut dihitung', () => {
  // Kalau ikut, jumlah di layar lebih besar dari yang benar-benar berubah —
  // dan user menyetujui angka yang salah.
  const baris = [brs('A', 'Medan'), brs('B', 'Pusat')];
  const r = lingkupBorongan(baris, new Set(), ['Medan']);
  assert.deepEqual(r.target.map((x) => x.sku), ['A']);
  assert.equal(r.nKeputusan, 1);
});

test('semua cabang: jumlah keputusan jauh lebih besar dari jumlah SKU', () => {
  // 20 SKU x 5 cabang = 100 keputusan. Angka inilah yang harus disebut sebelum
  // user menekan OK, bukan "20".
  const areas = ['Makassar', 'Medan', 'Pusat', 'Surabaya', 'Yogyakarta'];
  const baris = Array.from({ length: 20 }, (_, i) => brs(`S${i}`, ...areas));
  const r = lingkupBorongan(baris, new Set(), areas);
  assert.equal(r.target.length, 20);
  assert.equal(r.nKeputusan, 100);
});
