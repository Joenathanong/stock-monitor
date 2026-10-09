import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AMBANG_ATP_BAWAAN, PRIORITAS_BRAND, brandMenang, adalahBundle, skuKotor,
  kelayakan, kunciSebaran, hitungAtp, atpKeseluruhan, persenTeks,
  petaBrand, skuBelumDiset, susunTurunan, bundlingTerblokir, bundlingBertingkat, lingkupBorongan,
  type BarisStokAtp, type Sebaran, type PetaBundle,
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

  // `adalahBundle` TETAP ADA tapi tugasnya berganti: sejak 8 Okt 2026 sore ia
  // dipakai menentukan brand dari kode, bukan membuang barisnya. Bundle kini
  // LAYAK masuk ATP.
  assert.equal(kelayakan(baris({ sku: '- BDL-HANASUI-0000001615', category: 'Sku' })).layak, true);
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

test('tidak aktif dan kategori di luar ATP ditolak dengan sebab masing-masing', () => {
  assert.equal(kelayakan(baris({ isActive: false })).sebab, 'TIDAK_AKTIF');
  // Gimmick dan Bundle DITERIMA sejak 8 Okt 2026 sore — dulu keduanya ditolak.
  assert.equal(kelayakan(baris({ category: 'Gimmick' })).layak, true);
  assert.equal(kelayakan(baris({ category: 'Bundle' })).layak, true);
  // Yang benar-benar di luar daftar tetap ditolak, dengan sebabnya.
  assert.equal(kelayakan(baris({ category: 'Material' })).sebab, 'BUKAN_KATEGORI_SKU');
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
    baris({ sku: 'LAIN', category: 'Material' }),
  ], sebaran([['A', 'Medan', true]]))[0];
  assert.equal(h.dihitung, 1);
  assert.deepEqual(h.ditolak, { TIDAK_AKTIF: 1, BUKAN_KATEGORI_SKU: 1 });
});

test('perincian per kategori selalu berjumlah sama dengan pembaginya', () => {
  // Bundle 73% dari katalog, jadi tanpa perincian ini ATP% lebih banyak
  // bercerita tentang bundle daripada produk satuan tanpa ada yang bisa melihat.
  // Jumlah ketiganya WAJIB sama dengan `dihitung`; kalau tidak, ada baris yang
  // masuk pembagi tapi tidak terhitung di kategori mana pun.
  const h = hitungAtp([
    baris({ sku: 'A', availableQty: 100 }),
    baris({ sku: 'B', availableQty: 1, category: 'Bundle' }),
    baris({ sku: 'C', availableQty: 100, category: 'Bundle' }),
    baris({ sku: 'D', availableQty: 100, category: 'Gimmick' }),
  ], sebaran([['A', 'Medan', true], ['B', 'Medan', true], ['C', 'Medan', true], ['D', 'Medan', true]]))[0];
  assert.equal(h.dihitung, 4);
  assert.equal(h.siap, 3, 'B qty 1 tidak lebih dari ambang 5');
  const jumlah = Object.values(h.perKategori).reduce((t, k) => t + k.dihitung, 0);
  assert.equal(jumlah, h.dihitung);
  assert.deepEqual(h.perKategori.Sku, { dihitung: 1, siap: 1 });
  assert.deepEqual(h.perKategori.Bundle, { dihitung: 2, siap: 1 });
  assert.deepEqual(h.perKategori.Gimmick, { dihitung: 1, siap: 1 });
});

test('tidak layak diperiksa SEBELUM sebaran', () => {
  // Kalau urutannya tertukar, baris di luar kategori ATP akan muncul sebagai
  // "belum diputuskan" dan menenggelamkan peringatan yang sebenarnya.
  const h = hitungAtp([baris({ sku: 'X', category: 'Material' }), baris({ sku: 'Y', category: 'Material' })], new Map())[0];
  assert.equal(h.belumDiputus, 0);
  assert.equal(h.ditolak.BUKAN_KATEGORI_SKU, 2);
});

// --- keseluruhan -----------------------------------------------------------

test('ATP keseluruhan dijumlahkan, BUKAN dirata-rata dari persen per area', () => {
  // Cabang besar 300 SKU 90%, cabang kecil 2 SKU 0%.
  // Rata-rata persen = 45% (menyesatkan). Jumlah = 270/302 = 89,4%.
  const hasil = [
    { areaId: 'Besar', dihitung: 300, siap: 270, persen: 90, takDisebar: 0, takDisebarTurunan: 0, belumDiputus: 0,
      ditolak: { TIDAK_AKTIF: 0, BUKAN_KATEGORI_SKU: 0 }, perKategori: {}, kotor: 0 },
    { areaId: 'Kecil', dihitung: 2, siap: 0, persen: 0, takDisebar: 0, takDisebarTurunan: 0, belumDiputus: 0,
      ditolak: { TIDAK_AKTIF: 0, BUKAN_KATEGORI_SKU: 0 }, perKategori: {}, kotor: 0 },
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
  const kosong = { areaId: 'Bali', dihitung: 0, siap: 0, persen: null, takDisebar: 0, takDisebarTurunan: 0,
    belumDiputus: 10, ditolak: { TIDAK_AKTIF: 0, BUKAN_KATEGORI_SKU: 0 }, perKategori: {}, kotor: 0 };
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
    // false = diputus urutan prioritas. "BBS" bukan brand, jadi kodenya tidak
    // punya suara di sini — beda dengan NCO-EDP-* yang kodenya menyebut NCO.
    dariKode: false,
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

// --------------------------------------------------------------------------
// skuBelumDiset — pengingat "produk baru belum diset di list ATP" (8 Okt 2026)
// --------------------------------------------------------------------------

const brs = (sku: string, areaId: string, o: Partial<BarisStokAtp> = {}): BarisStokAtp =>
  baris({ sku, areaId, category: 'Sku', isActive: true, availableQty: 10, ...o });

test('skuBelumDiset: SKU tanpa keputusan di semua area terlapor', () => {
  const rows = [brs('A', 'Pusat'), brs('A', 'Medan'), brs('B', 'Pusat')];
  const sebaran: Sebaran = new Map([[kunciSebaran('B', 'Pusat'), false]]);
  const h = skuBelumDiset(rows, sebaran);
  assert.deepEqual(h.map((x) => x.sku), ['A']);
  assert.deepEqual(h[0].areas, ['Medan', 'Pusat'], 'area dirapikan & diurutkan');
});

test('skuBelumDiset: SATU keputusan saja sudah membuat SKU-nya hilang dari daftar', () => {
  // "Tidak" pun keputusan. Daftar ini harus bisa mengosongkan dirinya sendiri,
  // kalau tidak ia jadi peringatan yang selalu menyala lalu diabaikan.
  const rows = [brs('A', 'Pusat'), brs('A', 'Medan')];
  for (const nilai of [true, false]) {
    const sebaran: Sebaran = new Map([[kunciSebaran('A', 'Medan'), nilai]]);
    assert.deepEqual(skuBelumDiset(rows, sebaran), [], `putusan ${nilai} di satu area`);
  }
});

test('skuBelumDiset: yang nonaktif atau di luar kategori TIDAK diminta diputuskan', () => {
  const rows = [
    brs('A', 'Pusat', { isActive: false }),
    brs('B', 'Pusat', { category: 'Lain' }),
    brs('C', 'Pusat'),
  ];
  assert.deepEqual(skuBelumDiset(rows, new Map()).map((x) => x.sku), ['C']);
});

test('skuBelumDiset: terbaru di atas, yang tanpa tanggal paling bawah', () => {
  const rows = [
    brs('LAMA', 'Pusat', { firstSeenAt: '2026-01-01T00:00:00.000Z' }),
    brs('BARU', 'Pusat', { firstSeenAt: '2026-10-07T00:00:00.000Z' }),
    brs('KOSONG', 'Pusat'),
  ];
  assert.deepEqual(skuBelumDiset(rows, new Map()).map((x) => x.sku), ['BARU', 'LAMA', 'KOSONG']);
});

test('skuBelumDiset: firstSeenAt yang dipakai PALING AWAL dari barisnya', () => {
  // Satu SKU bisa muncul di Pusat bulan lalu dan di Medan kemarin. "Terlihat
  // sejak" harus menjawab kapan ia mulai ada, bukan kapan cabang terakhir ikut.
  const rows = [
    brs('A', 'Medan', { firstSeenAt: '2026-10-07T00:00:00.000Z' }),
    brs('A', 'Pusat', { firstSeenAt: '2026-09-01T00:00:00.000Z' }),
  ];
  assert.equal(skuBelumDiset(rows, new Map())[0].firstSeenAt, '2026-09-01T00:00:00.000Z');
});

test('skuBelumDiset: daftarnya tidak terpengaruh ambang maupun jumlah stok', () => {
  // Stok 0 tetap perlu diputuskan — justru itu yang paling perlu, karena
  // "disebar tapi kosong" adalah angka yang menurunkan ATP.
  const rows = [brs('A', 'Pusat', { availableQty: 0 })];
  assert.deepEqual(skuBelumDiset(rows, new Map()).map((x) => x.sku), ['A']);
});

// --------------------------------------------------------------------------
// susunTurunan — turunan bundling, TAMPILAN saja (9 Okt 2026)
// --------------------------------------------------------------------------

const AREAS = ['Makassar', 'Medan'];

/** stokPerSku: sku -> area -> { availableQty, isActive, name } */
const stok = (
  isi: [string, string, number, boolean?][],
): Map<string, Map<string, { availableQty: number; isActive: boolean; name: string }>> => {
  const m = new Map<string, Map<string, { availableQty: number; isActive: boolean; name: string }>>();
  for (const [sku, area, qty, aktif] of isi) {
    let per = m.get(sku);
    if (!per) { per = new Map(); m.set(sku, per); }
    per.set(area, { availableQty: qty, isActive: aktif ?? true, name: `Nama ${sku}` });
  }
  return m;
};

const peta = (isi: [string, string, number][]): PetaBundle => {
  const m: PetaBundle = new Map();
  for (const [b, i, q] of isi) {
    const l = m.get(b) ?? [];
    l.push({ itemSku: i, qty: q });
    m.set(b, l);
  }
  return m;
};

test('bukan bundle / komposisi belum ada → n 0, bukan melempar', () => {
  const h = susunTurunan('SKU-BIASA', new Map(), stok([['SKU-BIASA', 'Medan', 10]]), AREAS);
  assert.equal(h.n, 0);
  assert.deepEqual(h.turunan, []);
  assert.equal(h.adaNonaktif, false);
});

test('qty per bundle ikut menentukan berapa yang bisa dibentuk', () => {
  // 100 pcs komponen dengan qty 2 per bundle = 50 bundle, bukan 100.
  const h = susunTurunan(
    'BDL-X', peta([['BDL-X', 'KOMP-A', 2]]),
    stok([['KOMP-A', 'Makassar', 100], ['KOMP-A', 'Medan', 7]]), AREAS,
  );
  assert.equal(h.n, 1);
  assert.equal(h.turunan[0].area.Makassar.muat, 50);
  assert.equal(h.turunan[0].area.Medan.muat, 3, 'floor(7/2) = 3, dibulatkan TURUN');
  assert.equal(h.muat.Makassar, 50);
});

test('pembatas = komponen dengan muat TERKECIL, per cabang masing-masing', () => {
  const h = susunTurunan(
    'BDL-X', peta([['BDL-X', 'BANYAK', 1], ['BDL-X', 'TIPIS', 1]]),
    stok([
      ['BANYAK', 'Makassar', 500], ['BANYAK', 'Medan', 2],
      ['TIPIS', 'Makassar', 3], ['TIPIS', 'Medan', 400],
    ]),
    AREAS,
  );
  assert.equal(h.muat.Makassar, 3);
  assert.equal(h.pembatas.Makassar, 'TIPIS');
  assert.equal(h.muat.Medan, 2);
  assert.equal(h.pembatas.Medan, 'BANYAK', 'pembatasnya bisa beda per cabang');
});

test('satu komponen habis membuat SELURUH bundle tidak bisa dibentuk', () => {
  // Inilah yang dijelaskan baris rincian: komponen lain penuh pun tidak menolong.
  const h = susunTurunan(
    'BDL-X', peta([['BDL-X', 'ADA', 1], ['BDL-X', 'HABIS', 1]]),
    stok([['ADA', 'Medan', 9999], ['HABIS', 'Medan', 0]]), ['Medan'],
  );
  assert.equal(h.muat.Medan, 0);
  assert.equal(h.pembatas.Medan, 'HABIS');
});

test('komponen yang TIDAK terdaftar di cabang → null, dan hitungannya jadi null', () => {
  // Bukan dilewati. Melewatinya memberi angka terlalu optimistis dari komponen
  // yang tersisa, dan itu angka yang tidak bisa dipercaya tanpa ada tandanya.
  const h = susunTurunan(
    'BDL-X', peta([['BDL-X', 'ADA', 1], ['BDL-X', 'ASING', 1]]),
    stok([['ADA', 'Medan', 50]]), ['Medan'],
  );
  assert.equal(h.turunan[1].area.Medan.stok, null);
  assert.equal(h.turunan[1].area.Medan.aktif, null);
  assert.equal(h.muat.Medan, null, 'satu komponen tidak diketahui → jawabannya tidak diketahui');
});

test('komponen nonaktif tetap DITAMPILKAN dan ditandai', () => {
  const h = susunTurunan(
    'BDL-X', peta([['BDL-X', 'KOMP', 1]]),
    stok([['KOMP', 'Makassar', 10, true], ['KOMP', 'Medan', 10, false]]), AREAS,
  );
  assert.equal(h.adaNonaktif, true);
  assert.equal(h.turunan[0].nAktif, 1);
  assert.equal(h.turunan[0].nNonaktif, 1);
  assert.equal(h.turunan[0].area.Medan.aktif, false);
  assert.equal(h.turunan[0].area.Medan.stok, 10, 'nonaktif bukan berarti stoknya disembunyikan');
});

test('nama komponen diambil dari baris stok mana pun yang punya isinya', () => {
  const h = susunTurunan('BDL-X', peta([['BDL-X', 'KOMP', 1]]), stok([['KOMP', 'Medan', 1]]), AREAS);
  assert.equal(h.turunan[0].name, 'Nama KOMP');
});

test('qty 0 tidak membuat pembagian nol', () => {
  // mapBundleItems memaksa qty minimal 1, tapi modul ini tidak boleh ikut
  // percaya begitu saja — data lama di tabel bisa saja memuat 0.
  const h = susunTurunan('BDL-X', peta([['BDL-X', 'KOMP', 0]]), stok([['KOMP', 'Medan', 10]]), ['Medan']);
  assert.equal(h.turunan[0].area.Medan.muat, 10, 'qty <= 0 diperlakukan sebagai 1');
});

// --------------------------------------------------------------------------
// Aturan turunan: komponen tidak disebar -> bundling keluar dari pembagi
// (keputusan user 9 Okt 2026, opsi A)
// --------------------------------------------------------------------------

const petaB = (isi: [string, string, number][]): PetaBundle => {
  const m: PetaBundle = new Map();
  for (const [b, i, q] of isi) { const l = m.get(b) ?? []; l.push({ itemSku: i, qty: q }); m.set(b, l); }
  return m;
};

test('komponen "Tidak" di sebuah cabang memblokir bundling DI CABANG ITU SAJA', () => {
  const b = bundlingTerblokir(
    petaB([['BDL-X', 'KOMP-A', 1]]),
    sebaran([['KOMP-A', 'Makassar', false]]),
    ['Makassar', 'Medan'],
  );
  assert.deepEqual(b.get(kunciSebaran('BDL-X', 'Makassar')), ['KOMP-A']);
  assert.equal(b.has(kunciSebaran('BDL-X', 'Medan')), false, 'Medan tidak ikut terblokir');
});

test('"Belum diputuskan" TIDAK merambat — hanya "Tidak" yang tegas', () => {
  // Kalau "Belum" ikut, 4 cabang yang checklist-nya masih kosong akan
  // mematikan SELURUH bundling sekaligus. Itu kecelakaan, bukan keputusan.
  const b = bundlingTerblokir(petaB([['BDL-X', 'KOMP-A', 1]]), new Map(), ['Makassar']);
  assert.equal(b.size, 0);
});

test('komponen "Ya" tidak memblokir apa pun', () => {
  const b = bundlingTerblokir(
    petaB([['BDL-X', 'KOMP-A', 1]]),
    sebaran([['KOMP-A', 'Makassar', true]]),
    ['Makassar'],
  );
  assert.equal(b.size, 0);
});

test('SEMUA komponen yang memblokir disebut, bukan yang pertama saja', () => {
  // Selnya harus bisa menjawab "komponen mana" — kalau cuma satu yang dicatat,
  // user menyebar ulang satu komponen lalu heran bundling-nya masih mati.
  const b = bundlingTerblokir(
    petaB([['BDL-X', 'A', 1], ['BDL-X', 'B', 1], ['BDL-X', 'C', 1]]),
    sebaran([['A', 'Pusat', false], ['C', 'Pusat', false], ['B', 'Pusat', true]]),
    ['Pusat'],
  );
  assert.deepEqual(b.get(kunciSebaran('BDL-X', 'Pusat')), ['A', 'C']);
});

test('hitungAtp: bundling terblokir KELUAR dari pembagi, dan dihitung terpisah', () => {
  const rows = [
    baris({ sku: 'BDL-X', areaId: 'Pusat', availableQty: 100 }),
    baris({ sku: 'KOMP-A', areaId: 'Pusat', availableQty: 100 }),
    baris({ sku: 'BIASA', areaId: 'Pusat', availableQty: 100 }),
  ];
  const sb = sebaran([['BDL-X', 'Pusat', true], ['KOMP-A', 'Pusat', false], ['BIASA', 'Pusat', true]]);
  const blokir = bundlingTerblokir(petaB([['BDL-X', 'KOMP-A', 1]]), sb, ['Pusat']);

  const tanpa = hitungAtp(rows, sb, 5, 'AKTIF')[0];
  assert.equal(tanpa.dihitung, 2, 'tanpa aturan: BDL-X ikut pembagi');
  assert.equal(tanpa.takDisebarTurunan, 0);

  const dengan = hitungAtp(rows, sb, 5, 'AKTIF', blokir)[0];
  assert.equal(dengan.dihitung, 1, 'BDL-X keluar dari pembagi');
  assert.equal(dengan.siap, 1, 'yang tersisa cuma BIASA');
  assert.equal(dengan.takDisebar, 2, 'KOMP-A (dicentang) + BDL-X (turunan)');
  assert.equal(dengan.takDisebarTurunan, 1, 'yang karena turunan dipisah, supaya 1 tidak terbaca 2');
  assert.equal(dengan.persen, 100);
});

test('bundling "Belum" TIDAK dipindah ke takDisebar oleh aturan turunan', () => {
  // Kalau dipindah, ia hilang dari pengingat "belum diatur" tanpa ada orang
  // yang pernah memutuskannya.
  const rows = [baris({ sku: 'BDL-X', areaId: 'Pusat', availableQty: 100 })];
  const sb = sebaran([['KOMP-A', 'Pusat', false]]);
  const blokir = bundlingTerblokir(petaB([['BDL-X', 'KOMP-A', 1]]), sb, ['Pusat']);
  const h = hitungAtp(rows, sb, 5, 'AKTIF', blokir)[0];
  assert.equal(h.belumDiputus, 1);
  assert.equal(h.takDisebar, 0);
  assert.equal(h.takDisebarTurunan, 0);
});

test('bundling yang sudah dicentang "Tidak" tidak dihitung dua kali', () => {
  const rows = [baris({ sku: 'BDL-X', areaId: 'Pusat', availableQty: 100 })];
  const sb = sebaran([['BDL-X', 'Pusat', false], ['KOMP-A', 'Pusat', false]]);
  const blokir = bundlingTerblokir(petaB([['BDL-X', 'KOMP-A', 1]]), sb, ['Pusat']);
  const h = hitungAtp(rows, sb, 5, 'AKTIF', blokir)[0];
  assert.equal(h.takDisebar, 1);
  assert.equal(h.takDisebarTurunan, 0, 'keluar karena dicentang, bukan karena turunan');
});

test('aturan turunan TIDAK menulis apa pun ke peta sebaran', () => {
  // Inti opsi A: diturunkan saat hitung, tidak pernah mengubah keputusan orang.
  const sb = sebaran([['KOMP-A', 'Pusat', false], ['BDL-X', 'Pusat', true]]);
  const sebelum = JSON.stringify([...sb.entries()].sort());
  bundlingTerblokir(petaB([['BDL-X', 'KOMP-A', 1]]), sb, ['Pusat']);
  assert.equal(JSON.stringify([...sb.entries()].sort()), sebelum);
  assert.equal(sb.get(kunciSebaran('BDL-X', 'Pusat')), true, 'centang bundling tetap Ya');
});

test('penjaga: belum ada bundling bertingkat (terukur 0 dari 2.028 pada 9 Okt 2026)', () => {
  // Aturan ini satu lapis. Kalau suatu hari komponen ternyata bundling juga,
  // rantainya akan terlewat DIAM-DIAM — jadi keadaannya dibuat terlihat.
  assert.deepEqual(bundlingBertingkat(petaB([['BDL-X', 'KOMP-A', 1], ['BDL-Y', 'KOMP-B', 1]])), []);
  assert.deepEqual(
    bundlingBertingkat(petaB([['BDL-LUAR', 'BDL-DALAM', 1], ['BDL-DALAM', 'KOMP', 1]])),
    ['BDL-LUAR → BDL-DALAM'],
    'kalau muncul, harus terdeteksi — bukan diabaikan',
  );
});

test('lingkupBorongan: hanya baris yang DIBERIKAN yang kena — tidak pernah melebar', () => {
  // Penjaga lingkup tombol borongan (/atp). Sejak 9 Okt 2026 daftar yang
  // dikirim ke sini adalah hasil saringan TABEL (termasuk filter per kolom),
  // bukan lagi hanya filter halaman. Fungsi ini tidak boleh menambah baris
  // dari mana pun — kalau melebar, user menyaring 10 baris lalu 1.600 berubah.
  const r = (sku: string, areas: string[]) =>
    ({ sku, area: Object.fromEntries(areas.map((a) => [a, {}])) });
  const { target, nKeputusan } = lingkupBorongan(
    [r('A', ['Pusat', 'Medan']), r('B', ['Pusat'])],
    ['Pusat'],
  );
  assert.deepEqual(target.map((x) => x.sku), ['A', 'B']);
  assert.equal(nKeputusan, 2, 'satu keputusan per (SKU, cabang) yang barisnya ADA');
});

test('lingkupBorongan: SKU yang tidak punya baris di cabang itu dilewati', () => {
  const r = (sku: string, areas: string[]) =>
    ({ sku, area: Object.fromEntries(areas.map((a) => [a, {}])) });
  const { target, nKeputusan } = lingkupBorongan([r('A', ['Medan'])], ['Pusat']);
  assert.deepEqual(target, [], 'tidak ada barisnya di Pusat → bukan target');
  assert.equal(nKeputusan, 0);
});

test('lingkupBorongan: daftar kosong menghasilkan nol, bukan semuanya', () => {
  // Kalau filter tabel tidak menyisakan apa pun, tombol borongan harus
  // mengenai NOL — bukan diam-diam jatuh ke seluruh data.
  const { target, nKeputusan } = lingkupBorongan([], ['Pusat', 'Medan']);
  assert.deepEqual(target, []);
  assert.equal(nKeputusan, 0);
});
