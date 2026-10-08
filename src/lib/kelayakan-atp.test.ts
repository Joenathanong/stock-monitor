import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { adalahBundle, kelayakan } from './atp';

/**
 * Penjaga: SIAPA PUN yang menyaring "SKU layak ATP" lewat SQL wajib juga
 * membuang bundle di JS.
 *
 * Kena 8 Okt 2026 di `scripts/sync-brand.ts`. Query cakupannya:
 *
 *   SELECT DISTINCT sku FROM stock_current WHERE isActive = 1 AND category = 'Sku'
 *
 * Hasilnya memasukkan `- BDL-HANASUI-0000001615` ke daftar "27 SKU belum punya
 * brand", padahal itu bundle dan tidak pernah masuk hitungan ATP. Angka
 * cakupannya salah (348/375, seharusnya 348/374) dan user disuruh mengisi
 * brand untuk baris yang tidak dipakai.
 *
 * Akarnya: `category` TIDAK bisa memisahkan bundle — OCS menandai bundle
 * dengan `category = 'Sku'`. Jadi SQL saja selalu kurang satu syarat, dan
 * syarat itu hanya ada di `adalahBundle()`.
 *
 * Tes ini membaca sumbernya. Kalau ada berkas ATP yang menyaring
 * `category = 'Sku'` tapi tidak menyebut `adalahBundle`, ia gagal — supaya
 * ketahuan di `npm test`, bukan dari daftar yang user curigai.
 *
 * CAKUPANNYA SENGAJA HANYA BERKAS ATP, yaitu yang mengimpor `atp.ts`.
 * DOI Monitor juga menyaring `category = 'Sku'` di tujuh tempat (compute.ts,
 * sync.ts, query.ts, api/sku-master, api/transit, …) dan di sana bundle MEMANG
 * ikut dihitung — itu program terpisah dengan aturan sendiri. Melarangnya di
 * seluruh repo akan memaksa perubahan di DOI Monitor yang tidak diminta dan
 * salah. Jadi penjaga ini mengikat ATP saja.
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

/**
 * Berkas ATP = yang mengimpor atp.ts. Itu batas yang dipakai penjaga ini.
 *
 * Ekstensinya ikut diterima (`./atp`, `./atp.ts`, `./atp.js`): repo ini menulis
 * impor tanpa ekstensi, tapi pola yang hanya cocok tanpa ekstensi membuat satu
 * berkas ber-ekstensi lolos tanpa suara — ketahuan saat menguji penjaga ini
 * sendiri dengan berkas pelanggar buatan.
 */
const IMPOR_ATP = /from\s+['"][^'"]*\/atp(?:\.[jt]s)?['"]/;

test('penyaring SQL category=Sku di berkas ATP juga membuang bundle', () => {
  const berkas = [...berkasTs('src'), ...berkasTs('scripts')]
    .filter((f) => !/[\\/]atp\.ts$/.test(f));
  const atp = berkas.filter((f) => IMPOR_ATP.test(readFileSync(f, 'utf8')));

  // Kalau nol, penjaganya tidak menjaga apa pun — berarti polanya berubah.
  assert.ok(atp.length > 0, 'tidak ada berkas yang mengimpor atp.ts — penjaga ini jadi kosong');

  const pelanggar: string[] = [];
  for (const f of atp) {
    const kode = readFileSync(f, 'utf8');
    if (!SARING_SQL.test(kode)) continue;
    // `kelayakan()` sudah menolak bundle di dalam dirinya, jadi memakainya cukup.
    if (/adalahBundle|kelayakan\s*\(/.test(kode)) continue;
    pelanggar.push(f);
  }
  assert.deepEqual(
    pelanggar,
    [],
    `Berkas ATP ini menyaring category='Sku' lewat SQL tanpa membuang bundle:\n  ${pelanggar.join('\n  ')}\n`
      + "OCS menandai bundle dengan category='Sku', jadi hasilnya ikut terbawa.\n"
      + 'Tambahkan `.filter((r) => !adalahBundle(r.sku))` — fungsi yang sama yang dipakai kelayakan().',
  );
});

test('sync-brand memakai adalahBundle, bukan salinan aturannya', () => {
  const kode = readFileSync('scripts/sync-brand.ts', 'utf8');
  assert.match(kode, /adalahBundle/, 'sync-brand.ts harus memakai adalahBundle dari src/lib/atp');
  // Ekstensi ikut diterima, alasan sama dengan IMPOR_ATP di atas.
  assert.match(
    kode,
    /from '\.\.\/src\/lib\/atp(?:\.[jt]s)?'/,
    'adalahBundle harus diimpor dari atp.ts — bukan ditulis ulang di skrip',
  );
  assert.doesNotMatch(
    kode,
    /BDL-\s*\)?\s*\.test|startsWith\(\s*['"]BDL/,
    'jangan salin aturan bundle ke skrip; aturannya hanya boleh satu tempat',
  );
});

test('kelayakan menolak bundle yang OCS tandai category=Sku', () => {
  // Baris nyata dari OCS, 8 Okt 2026.
  const r = { sku: '- BDL-HANASUI-0000001615', isActive: true, category: 'Sku', sapCode: '' };
  assert.equal(adalahBundle(r.sku), true);
  assert.deepEqual(kelayakan(r), { layak: false, sebab: 'BUNDLE', kotor: true });
});
