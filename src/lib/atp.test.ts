import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AMBANG_ATP_BAWAAN, PRIORITAS_BRAND, brandMenang, adalahBundle, skuKotor,
  kelayakan, kunciSebaran, hitungAtp, atpKeseluruhan, persenTeks,
  petaBrand,
  type BarisStokAtp, type Sebaran,
} from './atp';

const baris = (o: Partial<BarisStokAtp> = {}): BarisStokAtp => ({
  sku: 'ACNE-CLEANSER', areaId: 'Medan', availableQty: 100,
  isActive: true, category: 'Sku', sapCode: '1201010101', ...o,
});

const sebaran = (pasangan: [string, string, boolean][]): Sebaran =>
  new Map(pasangan.map(([sku, area, v]) => [kunciSebaran(sku, area), v]));

// --- brand -----------------------------------------------------------------

test('brand bentrok diselesaikan dengan urutan prioritas, bukan urutan data', () => {
  // BBS-CHEERFUL-BLISS nyata: Hanasui DAN NCO di setiap area (8 Okt 2026).
  assert.equal(brandMenang(['NCO', 'Hanasui']), 'Hanasui');
  assert.equal(brandMenang(['Hanasui', 'NCO']), 'Hanasui', 'urutan masukan TIDAK boleh mengubah hasil');
  assert.equal(brandMenang(['EOMMA', 'FYNE']), 'FYNE');
  assert.equal(brandMenang(['EOMMA']), 'EOMMA');
});

test('brand kosong = belum diketahui, BUKAN ditebak', () => {
  // 27 dari 375 SKU aktif tidak punya brand di OCS (hampir semua prefiks CS-).
  assert.equal(brandMenang([]), '');
  assert.equal(brandMenang([null, undefined, '  ']), '');
  // Nama SKU memuat "HANASUI" tapi itu TIDAK boleh jadi brand — user melarang
  // menerka dari nama, dan modul ini tidak pernah melihat namanya.
  assert.equal(brandMenang([]), '', 'CS-HANASUI-POWER-BRIGHT-SERUM tetap kosong');
});

test('besar-kecil huruf tidak membuat dua brand berbeda', () => {
  assert.equal(brandMenang(['hanasui']), 'Hanasui', 'ejaan prioritas yang dikembalikan');
  assert.equal(brandMenang(['nco', 'HANASUI']), 'Hanasui');
});

test('brand di luar daftar prioritas: abjad, supaya tetap sama setiap tarikan', () => {
  assert.equal(brandMenang(['Zeta', 'Alfa']), 'Alfa');
  assert.equal(brandMenang(['Alfa', 'Zeta']), 'Alfa');
  // Yang ada di prioritas tetap menang atas yang tidak.
  assert.equal(brandMenang(['Alfa', 'EOMMA']), 'EOMMA');
});

test('urutan prioritas sesuai keputusan user', () => {
  assert.deepEqual([...PRIORITAS_BRAND], ['Hanasui', 'NCO', 'FYNE', 'EOMMA']);
});

// --- kelayakan -------------------------------------------------------------

test('bundle dikenali dari BDL-, BUKAN dari Category', () => {
  // Baris NYATA 8 Okt 2026: Category "Sku" tapi SKU-nya bundle.
  assert.equal(adalahBundle('- BDL-HANASUI-0000001615'), true);
  assert.equal(adalahBundle('BDL-EOMMA-0000000001'), true);
  assert.equal(adalahBundle('ACNE-CLEANSER'), false);
  // Jangan salah tangkap SKU yang kebetulan memuat huruf itu.
  assert.equal(adalahBundle('ABDL-SOMETHING'), false, 'BDL- di tengah kata bukan bundle');

  const r = kelayakan(baris({ sku: '- BDL-HANASUI-0000001615', category: 'Sku' }));
  assert.equal(r.layak, false);
  assert.equal(r.sebab, 'BUNDLE', 'ditolak karena bundle, bukan karena kategori');
});

test('SKU kotor DITANDAI tapi tetap dihitung', () => {
  // "90 FYNE-BRIGHT-BARRIER-MOIST" kemungkinan produk nyata dengan prefiks
  // salah tulis. Membuangnya berarti kehilangan produk.
  assert.equal(skuKotor('90 FYNE-BRIGHT-BARRIER-MOIST'), true);
  assert.equal(skuKotor('- BDL-X'), true);
  assert.equal(skuKotor(' ACNE-CLEANSER'), true);
  assert.equal(skuKotor('ACNE-CLEANSER'), false);

  const r = kelayakan(baris({ sku: '90 FYNE-BRIGHT-BARRIER-MOIST' }));
  assert.equal(r.layak, true, 'kotor TIDAK membuat ditolak');
  assert.equal(r.kotor, true, 'tapi tetap ditandai');
});

test('tidak aktif dan bukan kategori Sku ditolak dengan sebab masing-masing', () => {
  assert.equal(kelayakan(baris({ isActive: false })).sebab, 'TIDAK_AKTIF');
  assert.equal(kelayakan(baris({ category: 'Gimmick' })).sebab, 'BUKAN_KATEGORI_SKU');
  assert.equal(kelayakan(baris({ category: null })).sebab, 'BUKAN_KATEGORI_SKU');
});

// --- ambang ----------------------------------------------------------------

test('ambang: LEBIH DARI 5, jadi tepat 5 BUKAN available', () => {
  assert.equal(AMBANG_ATP_BAWAAN, 5);
  const s = sebaran([['A', 'Medan', true], ['B', 'Medan', true], ['C', 'Medan', true]]);
  const h = hitungAtp([
    baris({ sku: 'A', availableQty: 5 }),
    baris({ sku: 'B', availableQty: 6 }),
    baris({ sku: 'C', availableQty: 0 }),
  ], s)[0];
  assert.equal(h.dihitung, 3);
  assert.equal(h.siap, 1, 'hanya yang 6; angka 5 tepat di ambang tidak lolos');
});

// --- pembagi: inti perbaikannya --------------------------------------------

test('yang TIDAK disebar keluar dari pembagi — ini kasus EOMMA', () => {
  // Gejala nyata ATP lama: EOMMA 0/29 di cabang, menarik persen turun.
  const rows = [
    baris({ sku: 'HANASUI-1', availableQty: 100 }),
    baris({ sku: 'HANASUI-2', availableQty: 100 }),
    baris({ sku: 'EOMMA-1', availableQty: 0 }),
    baris({ sku: 'EOMMA-2', availableQty: 0 }),
  ];
  const s = sebaran([
    ['HANASUI-1', 'Medan', true], ['HANASUI-2', 'Medan', true],
    ['EOMMA-1', 'Medan', false], ['EOMMA-2', 'Medan', false],
  ]);
  const h = hitungAtp(rows, s)[0];
  assert.equal(h.dihitung, 2, 'EOMMA tidak ikut pembagi');
  assert.equal(h.siap, 2);
  assert.equal(h.persen, 100, 'bukan 50% — cabang tidak dihukum untuk barang yang tidak disebar');
  assert.equal(h.takDisebar, 2, 'dan jumlahnya DILAPORKAN, tidak disembunyikan');
});

test('belum diputuskan juga keluar dari pembagi, tapi dihitung TERPISAH', () => {
  // Harus beda dari "tidak disebar": yang satu keputusan, yang satu pekerjaan.
  const h = hitungAtp([
    baris({ sku: 'A', availableQty: 100 }),
    baris({ sku: 'BARU-1' }), baris({ sku: 'BARU-2' }),
  ], sebaran([['A', 'Medan', true]]))[0];
  assert.equal(h.dihitung, 1);
  assert.equal(h.belumDiputus, 2);
  assert.equal(h.takDisebar, 0, 'belum diputuskan BUKAN sama dengan tidak disebar');
});

test('cabang baru: pembagi 0 -> persen null, BUKAN 0%', () => {
  // Keputusan user: cabang baru tidak ada yang tercentang. Menampilkan "0%"
  // akan terbaca seperti bencana stok, padahal artinya belum diisi.
  const h = hitungAtp([baris({ areaId: 'Bali' }), baris({ sku: 'B', areaId: 'Bali' })], new Map())[0];
  assert.equal(h.dihitung, 0);
  assert.equal(h.persen, null);
  assert.equal(h.belumDiputus, 2);
  assert.equal(persenTeks(h.persen), '—');
});

test('sebaran dipisahkan per area — satu SKU di dua cabang adalah DUA keputusan', () => {
  const rows = [
    baris({ sku: 'X', areaId: 'Medan', availableQty: 100 }),
    baris({ sku: 'X', areaId: 'Makassar', availableQty: 100 }),
  ];
  const s = sebaran([['X', 'Medan', true], ['X', 'Makassar', false]]);
  const h = hitungAtp(rows, s);
  const medan = h.find((x) => x.areaId === 'Medan')!;
  const makassar = h.find((x) => x.areaId === 'Makassar')!;
  assert.equal(medan.dihitung, 1);
  assert.equal(makassar.dihitung, 0);
  assert.equal(makassar.takDisebar, 1);
});

test('yang tidak layak dirinci sebabnya, tidak dilebur jadi satu angka', () => {
  const h = hitungAtp([
    baris({ sku: 'A', availableQty: 100 }),
    baris({ sku: 'MATI', isActive: false }),
    baris({ sku: 'BDL-X' }),
    baris({ sku: 'G', category: 'Gimmick' }),
  ], sebaran([['A', 'Medan', true]]))[0];
  assert.equal(h.dihitung, 1);
  assert.deepEqual(h.ditolak, { TIDAK_AKTIF: 1, BUKAN_KATEGORI_SKU: 1, BUNDLE: 1 });
});

test('tidak layak diperiksa SEBELUM sebaran — bundle tidak jadi "belum diputuskan"', () => {
  // Kalau urutannya tertukar, 10.055 baris Bundle akan muncul sebagai
  // "belum diputuskan" dan menenggelamkan peringatan yang sebenarnya.
  const h = hitungAtp([baris({ sku: 'BDL-X' }), baris({ sku: 'BDL-Y' })], new Map())[0];
  assert.equal(h.belumDiputus, 0);
  assert.equal(h.ditolak.BUNDLE, 2);
});

// --- keseluruhan -----------------------------------------------------------

test('ATP keseluruhan dijumlahkan, BUKAN dirata-rata dari persen per area', () => {
  // Cabang besar 300 SKU 90%, cabang kecil 2 SKU 0%.
  // Rata-rata persen = 45% (menyesatkan). Jumlah = 270/302 = 89,4%.
  const hasil = [
    { areaId: 'Besar', dihitung: 300, siap: 270, persen: 90, takDisebar: 0, belumDiputus: 0,
      ditolak: { TIDAK_AKTIF: 0, BUKAN_KATEGORI_SKU: 0, BUNDLE: 0 }, kotor: 0 },
    { areaId: 'Kecil', dihitung: 2, siap: 0, persen: 0, takDisebar: 0, belumDiputus: 0,
      ditolak: { TIDAK_AKTIF: 0, BUKAN_KATEGORI_SKU: 0, BUNDLE: 0 }, kotor: 0 },
  ];
  const t = atpKeseluruhan(hasil);
  assert.equal(t.dihitung, 302);
  assert.equal(t.siap, 270);
  assert.ok(Math.abs(t.persen! - 89.4) < 0.1, `${t.persen}`);
  assert.equal(t.terlemah?.areaId, 'Kecil');
});

test('cabang berpembagi 0 tidak bisa jadi "terlemah"', () => {
  // Kalau ikut, cabang baru yang belum diisi akan selalu jadi "cabang terlemah"
  // dan menutupi cabang yang benar-benar bermasalah.
  const kosong = { areaId: 'Bali', dihitung: 0, siap: 0, persen: null, takDisebar: 0,
    belumDiputus: 10, ditolak: { TIDAK_AKTIF: 0, BUKAN_KATEGORI_SKU: 0, BUNDLE: 0 }, kotor: 0 };
  const isi = { ...kosong, areaId: 'Medan', dihitung: 10, siap: 7, persen: 70, belumDiputus: 0 };
  assert.equal(atpKeseluruhan([kosong, isi]).terlemah?.areaId, 'Medan');
  assert.equal(atpKeseluruhan([kosong]).terlemah, null);
});

test('persenTeks: satu desimal, koma', () => {
  assert.equal(persenTeks(71.04), '71,0%');
  assert.equal(persenTeks(100), '100,0%');
  assert.equal(persenTeks(null), '—');
});

test('hasil berurut per nama area, supaya kolomnya tidak berpindah', () => {
  const h = hitungAtp([
    baris({ areaId: 'Yogyakarta' }), baris({ areaId: 'Makassar' }), baris({ areaId: 'Medan' }),
  ], new Map());
  assert.deepEqual(h.map((x) => x.areaId), ['Makassar', 'Medan', 'Yogyakarta']);
});

// --- peta brand dari baris mentah OCS --------------------------------------

test('petaBrand: ShopCode dipakai, ShopName hanya cadangan', () => {
  const h = petaBrand([
    { SellerSku: 'A', ShopCode: 'Hanasui', ShopName: 'Hanasui' },
    { SellerSku: 'B', ShopCode: '', ShopName: 'FYNE' },
    { SellerSku: 'C', ShopCode: '  ', ShopName: '  ' },
  ]);
  assert.equal(h.brand.get('A'), 'Hanasui');
  assert.equal(h.brand.get('B'), 'FYNE', 'jatuh ke ShopName');
  assert.equal(h.brand.has('C'), false, 'dua-duanya kosong -> tidak dipetakan');
});

test('petaBrand: bentrokan DIKEMBALIKAN, bukan diselesaikan diam-diam', () => {
  // BBS-CHEERFUL-BLISS nyata: Hanasui dan NCO di setiap area (16 SKU serupa).
  const h = petaBrand([
    { SellerSku: 'BBS-CHEERFUL-BLISS', ShopCode: 'NCO' },
    { SellerSku: 'BBS-CHEERFUL-BLISS', ShopCode: 'Hanasui' },
    { SellerSku: 'ACNE-CLEANSER', ShopCode: 'Hanasui' },
  ]);
  assert.equal(h.brand.get('BBS-CHEERFUL-BLISS'), 'Hanasui', 'prioritas menang');
  assert.equal(h.asal.get('BBS-CHEERFUL-BLISS'), 'Hanasui, NCO', 'asalnya tetap terekam');
  assert.equal(h.bentrok.length, 1);
  assert.deepEqual(h.bentrok[0], {
    sku: 'BBS-CHEERFUL-BLISS', brand: ['Hanasui', 'NCO'], menang: 'Hanasui',
  });
});

test('petaBrand: urutan baris OCS TIDAK mengubah hasil', () => {
  const a = petaBrand([{ SellerSku: 'X', ShopCode: 'NCO' }, { SellerSku: 'X', ShopCode: 'Hanasui' }]);
  const b = petaBrand([{ SellerSku: 'X', ShopCode: 'Hanasui' }, { SellerSku: 'X', ShopCode: 'NCO' }]);
  assert.equal(a.brand.get('X'), b.brand.get('X'));
  assert.equal(a.asal.get('X'), b.asal.get('X'), 'asal juga harus stabil, karena itu diurut');
});

test('petaBrand: SKU tanpa nama dilewati, spasi dirapikan', () => {
  const h = petaBrand([
    { SellerSku: '  ', ShopCode: 'Hanasui' },
    { SellerSku: undefined, ShopCode: 'NCO' },
    { SellerSku: '  SPASI-KIRI  ', ShopCode: 'FYNE' },
  ]);
  assert.equal(h.brand.size, 1);
  assert.equal(h.brand.get('SPASI-KIRI'), 'FYNE');
});

test('petaBrand: prioritas bisa diganti tanpa mengubah kode', () => {
  // Prioritasnya ditaruh di Pengaturan, jadi harus bisa dilewatkan.
  const h = petaBrand(
    [{ SellerSku: 'X', ShopCode: 'Hanasui' }, { SellerSku: 'X', ShopCode: 'NCO' }],
    ['NCO', 'Hanasui'],
  );
  assert.equal(h.brand.get('X'), 'NCO');
});
