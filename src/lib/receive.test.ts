import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapReceive, isiBoxDariNama, formatCtnPcs, type OcsReceiveLine } from './receive';
import { KODE_AREA_BAWAAN, TANPA_KODE } from './area-master';

/** Peta kode gudang → area, seperti yang dibangun dari tabel `area`. */
const peta = new Map(Object.entries(KODE_AREA_BAWAAN));

/** Indeks 6-digit-terakhir → SKU, seperti yang dibangun dari stock_current. */
const idx = new Map([
  ['040210', { sku: 'LIPSTICK-CINNAMON-10', name: 'Lipstick Cinnamon' }],
  ['010110', { sku: 'SERUM-GOLD', name: 'Serum Gold' }],
  ['050302', { sku: 'NCO-EDP-SUN-KISSSED', name: 'N.Co EDP Sun Kissed' }],
]);

const baris = (o: Partial<OcsReceiveLine>): OcsReceiveLine => ({
  DoDocNum: 1202603659, DoLineNum: 0, DoDocDate: '2026-06-19T00:00:00',
  ItemCode: '1201040210', ItemName: 'Hanasui Mattedorable Lipstick Cinnamon #110 2gr x 72',
  PerCtnQty: 72, BatchNum: 'E26490', DoQty: 2840, BatchQuantity: 2880, AddressCode: 'GJSB', ...o,
});

test('DoQty dipakai apa adanya — TIDAK dikalikan isi karton', () => {
  // Baris nyata OCS 25 Sep 2026: PerCtnQty 72, DoQty 2840, tampil "39 ctn 32 pcs".
  // 72 × 39 + 32 = 2840 — jadi DoQty memang sudah total pcs.
  const r = mapReceive([baris({})], idx, peta);
  assert.equal(r.transit.length, 1);
  assert.equal(r.transit[0].qty, 2840, 'qty harus persis DoQty');
  assert.equal(r.transit[0].qtyBatch, 2880, 'BatchQuantity disimpan terpisah');
  assert.equal(formatCtnPcs(2840, 72), '39 ctn 32 pcs');
  assert.equal(72 * 39 + 32, 2840);
});

test('kode SAP dicocokkan lewat 6 digit terakhir, prefiks boleh beda', () => {
  // Baris receive memakai 1201/1208, stok memakai 1222/1228.
  const r = mapReceive([
    baris({ ItemCode: '1201010110', ItemName: 'Hanasui Whitening Gold Serum Renew 20ml x 100', PerCtnQty: 0, DoQty: 3200, BatchQuantity: 3200, AddressCode: 'GJYG' }),
    baris({ ItemCode: '1208050302', ItemName: 'N.Co EDP Sun Kissed 100ml x 36', PerCtnQty: 36, DoQty: 36, BatchQuantity: 324, AddressCode: 'GJMK' }),
  ], idx, peta);
  assert.deepEqual(r.transit.map((t) => [t.sku, t.areaId, t.qty]).sort(), [
    ['NCO-EDP-SUN-KISSSED', 'Makassar', 36],
    ['SERUM-GOLD', 'Yogyakarta', 3200],
  ].sort());
  assert.equal(r.takCocok.length, 0);
});

test('SKU sama di dua gudang tidak saling menimpa', () => {
  const r = mapReceive([
    baris({ AddressCode: 'GJSB', DoQty: 2840 }),
    baris({ AddressCode: 'GJMK', DoQty: 1080, DoDocNum: 1202603239 }),
  ], idx, peta);
  assert.equal(r.transit.length, 2);
  assert.deepEqual(
    r.transit.map((t) => [t.areaId, t.qty]).sort(),
    [['Makassar', 1080], ['Surabaya', 2840]],
  );
});

test('beberapa batch untuk SKU+gudang yang sama dijumlahkan', () => {
  const r = mapReceive([
    baris({ BatchNum: 'A', DoQty: 1000, BatchQuantity: 1000, DoDocDate: '2026-06-20T00:00:00' }),
    baris({ BatchNum: 'B', DoQty: 840, BatchQuantity: 840, DoDocDate: '2026-06-18T00:00:00', DoDocNum: 1202603720 }),
  ], idx, peta);
  assert.equal(r.transit.length, 1);
  assert.equal(r.transit[0].qty, 1840);
  assert.equal(r.transit[0].eta, '2026-06-18', 'ETA paling awal yang dipakai');
  assert.equal(r.transit[0].docNums, '1202603659, 1202603720');
});

test('ItemCode tanpa pasangan SKU dilaporkan, bukan dibuang', () => {
  const r = mapReceive([baris({ ItemCode: '9999999999', DoQty: 500 })], idx, peta);
  assert.equal(r.transit.length, 0);
  assert.deepEqual(r.takCocok, [{ sapCode: '9999999999', name: baris({}).ItemName, areaId: 'Surabaya', qty: 500 }]);
  assert.equal(r.totalDoQty, 500, 'tetap ikut total supaya selisihnya kelihatan');
});

test('isi karton: PerCtnQty menang, nama produk jadi cadangan', () => {
  const r = mapReceive([
    baris({ PerCtnQty: 0, ItemName: 'Hanasui Mattedorable Lipstick Cinnamon #110 2gr x 72' }),
  ], idx, peta);
  const b = r.box[0];
  assert.deepEqual([b.fromOcs, b.fromName, b.perCtn, b.mismatch], [0, 72, 72, false]);
});

test('PerCtnQty dan nama produk berbeda → ditandai', () => {
  const r = mapReceive([baris({ PerCtnQty: 48 })], idx, peta); // nama menyebut 72
  assert.equal(r.box[0].mismatch, true);
  assert.equal(r.box[0].perCtn, 48, 'OCS tetap menang; tandanya untuk dibetulkan orang');
});

test('parse isi karton dari nama', () => {
  assert.equal(isiBoxDariNama('Hanasui Whitening Gold Serum Renew 20ml x 100'), 100);
  assert.equal(isiBoxDariNama('N.Co Extrait de Parfum Charme 40ml x 24'), 24);
  assert.equal(isiBoxDariNama('Hanasui Next Level Butter Balm Tint Sassy #03 3.5g'), null, 'tanpa " x N" → null');
  // Master SAP memakai akhiran di belakang angka; ini yang dulu gagal terbaca.
  assert.equal(isiBoxDariNama('Hanasui Acne Expert Day Cream 15gr x 48 MP'), 48);
  assert.equal(isiBoxDariNama('Hanasui Vitamin C+Collagen Serum Renew 20ml x 100 - IEG'), 100);
  assert.equal(isiBoxDariNama('Hanasui Naturgo Peel Off Mask 10gr x 1000'), 1000, 'isi karton 4 digit');
  assert.equal(isiBoxDariNama('Sesuatu 20ml X 48'), 48, 'huruf X besar');
  assert.equal(isiBoxDariNama('Hanasui Browmatic Tester0.06grx864'), null, 'tanpa spasi bukan pemisah yang sah');
  assert.equal(isiBoxDariNama('Produk x 0'), null, 'nol bukan isi karton yang sah');
  assert.equal(isiBoxDariNama(''), null);
  assert.equal(isiBoxDariNama('Sesuatu 10ml x 12 x 6'), 6, 'yang dipakai " x " TERAKHIR');
});

test('format ctn/pcs', () => {
  assert.equal(formatCtnPcs(2840, 72), '39 ctn 32 pcs');
  assert.equal(formatCtnPcs(2880, 72), '40 ctn', 'karton utuh tidak menulis "0 pcs"');
  assert.equal(formatCtnPcs(50, 72), '50 pcs', 'kurang dari sekarton');
  assert.equal(formatCtnPcs(3200, 0), '3.200 pcs', 'tanpa isi karton → pcs saja');
});

test('kode gudang asing DILAPORKAN, tidak diam-diam jadi Pusat', () => {
  // Perilaku lama: kode tak dikenal dan kode kosong dihitung sebagai "Pusat".
  // Cabang baru yang belum didaftarkan jadi menambah SIT Pusat tanpa ada yang
  // tahu. Sekarang keduanya masuk `kodeAsing` supaya bisa diperingatkan.
  const r = mapReceive([
    baris({ AddressCode: 'GJSB', DoQty: 100 }),
    baris({ AddressCode: 'GXXX', DoQty: 70, DoDocNum: 2 }),
    baris({ AddressCode: '', DoQty: 30, DoDocNum: 3 }),
  ], idx, peta);
  assert.deepEqual(r.kodeAsing.map((k) => [k.kode, k.qty]), [['GXXX', 70], [TANPA_KODE, 30]]);
  const pusat = r.transit.filter((t) => t.areaId === 'Pusat');
  assert.deepEqual(pusat, [], 'tidak ada satu pun qty yang menyelinap jadi Pusat');
});

test('kode gudang baru cukup ditambahkan di tabel area, tanpa ubah kode', () => {
  const petaBaru = new Map([...peta, ['GJBL', 'Bali']]);
  const r = mapReceive([baris({ AddressCode: 'GJBL', DoQty: 480 })], idx, petaBaru);
  assert.equal(r.transit[0].areaId, 'Bali');
  assert.deepEqual(r.kodeAsing, [], 'sudah terdaftar → bukan kode asing');
});

test('qty nol atau negatif dilewati', () => {
  const r = mapReceive([baris({ DoQty: 0 }), baris({ DoQty: -5 })], idx, peta);
  assert.equal(r.transit.length, 0);
  assert.equal(r.totalDoQty, 0);
});

test('angka nyata OCS 25 Sep 2026 — total per gudang', () => {
  // Dari 22 dokumen / 727 baris: Σ DoQty 236.647 vs Σ BatchQuantity 255.459.
  // Diringkas jadi satu baris per gudang untuk menjaga uji tetap ringkas.
  const nyata: [string, number, number][] = [
    ['GJSB', 62735, 78787], ['GJMK', 84220, 84508], ['GJYG', 67672, 67672], ['GJMD', 22020, 24492],
  ];
  const r = mapReceive(nyata.map(([kode, doq, bq]) => baris({ AddressCode: kode, DoQty: doq, BatchQuantity: bq })), idx, peta);
  assert.equal(r.totalDoQty, 236647);
  assert.equal(r.totalBatchQty, 255459);
  assert.equal(r.transit.length, 4, 'empat gudang terpisah, Pusat memang nol');
});
