import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hitungBaris, hitungSemua, urutKemendesakan, type BarisOpenPo } from './openpo';

const b = (o: Partial<BarisOpenPo> = {}): BarisOpenPo => ({
  sku: 'LIPSTICK-CINNAMON-10', name: 'Lipstick Cinnamon 2gr x 72', areaId: 'Pusat',
  need: 500, status: 'HEALTHY', doi: 12, perCtn122: 72, perCtn120: 72, saldo122: 5000, saldo120: 5000, ...o,
});

test('kebutuhan dibulatkan NAIK ke karton, diambil dari 122 dulu', () => {
  // butuh 500 pcs → ceil(500/72) = 7 ctn = 504 pcs, semuanya dari 122.
  const h = hitungBaris(b());
  assert.deepEqual([h.qty122, h.qty120, h.qtyTotal, h.ctnTotal], [504, 0, 504, 7]);
  assert.equal(h.alasan, 'OK');
  assert.equal(h.kurang, 0);
});

test('122 tidak cukup → karton utuh dari 122, sisanya dari 120', () => {
  // butuh 7 ctn; 122 hanya punya 3 ctn utuh (216 pcs dari 250), sisanya 4 ctn dari 120.
  const h = hitungBaris(b({ saldo122: 250, saldo120: 5000 }));
  assert.deepEqual([h.qty122 / 72, h.qty120 / 72], [3, 4], 'pembagian karton 122 lalu 120');
  assert.equal(h.qtyTotal, 504);
  assert.equal(h.alasan, 'OK');
});

test('122 kosong → seluruhnya dari 120', () => {
  const h = hitungBaris(b({ saldo122: 0, saldo120: 5000 }));
  assert.deepEqual([h.qty122, h.qty120, h.ctnTotal], [0, 504, 7]);
  assert.equal(h.alasan, 'OK');
});

test('dua-duanya kurang → round down ke karton utuh yang ada, sisa dilaporkan', () => {
  // butuh 7 ctn, yang ada 2 ctn (122) + 1 ctn (120) = 3 ctn.
  const h = hitungBaris(b({ saldo122: 200, saldo120: 100 }));
  assert.equal(h.ctnTotal, 3);
  assert.equal(h.qtyTotal, 216);
  assert.equal(h.alasan, 'KURANG');
  assert.equal(h.kurang, 500 - 216, 'sisa kebutuhan dihitung dari need, bukan dari karton');
  assert.match(h.keterangan, /kurang 284 pcs/);
});

test('saldo GBJD nol → tanpa angka, keterangan "Stock GBJD Kosong"', () => {
  const h = hitungBaris(b({ saldo122: 0, saldo120: 0 }));
  assert.equal(h.qtyTotal, 0);
  assert.equal(h.alasan, 'KOSONG');
  assert.equal(h.keterangan, 'Stock GBJD Kosong');
  assert.equal(h.kurang, 500);
});

test('saldo negatif diperlakukan sama dengan kosong', () => {
  const h = hitungBaris(b({ saldo122: -40, saldo120: -5 }));
  assert.equal(h.alasan, 'KOSONG');
  assert.equal(h.keterangan, 'Stock GBJD Kosong');
});

test('kurang dari 1 karton + DOI tipis → tetap diproses', () => {
  for (const status of ['CRITICAL', 'LOW']) {
    const h = hitungBaris(b({ status, saldo122: 40, saldo120: 20, need: 500 }));
    assert.equal(h.alasan, 'PECAHAN_TIPIS', status);
    assert.deepEqual([h.qty122, h.qty120, h.qtyTotal], [40, 20, 60]);
    assert.equal(h.ctnTotal, 0, 'pecahan tidak dihitung sebagai karton');
    assert.equal(h.kurang, 440);
  }
});

test('kurang dari 1 karton tapi DOI BELUM tipis → tidak diproses', () => {
  const h = hitungBaris(b({ status: 'HEALTHY', saldo122: 40, saldo120: 20 }));
  assert.equal(h.qtyTotal, 0);
  assert.equal(h.alasan, 'KURANG');
  assert.match(h.keterangan, /belum tipis/);
});

test('pecahan tipis tidak melebihi kebutuhan', () => {
  const h = hitungBaris(b({ status: 'CRITICAL', need: 30, saldo122: 40, saldo120: 20, perCtn122: 72, perCtn120: 72 }));
  assert.equal(h.qtyTotal, 30, 'berhenti di kebutuhan, bukan menghabiskan saldo');
  assert.equal(h.kurang, 0);
});

test('kebutuhan nol atau negatif → tidak ada saran', () => {
  for (const need of [0, -100]) {
    const h = hitungBaris(b({ need }));
    assert.equal(h.alasan, 'TIDAK_PERLU');
    assert.equal(h.qtyTotal, 0);
    assert.equal(h.keterangan, '');
  }
});

test('isi karton tidak diketahui → pcs apa adanya, ditandai', () => {
  const h = hitungBaris(b({ perCtn122: 0, perCtn120: 0, need: 500, saldo122: 300, saldo120: 300 }));
  assert.deepEqual([h.qty122, h.qty120, h.qtyTotal], [300, 200, 500]);
  assert.equal(h.alasan, 'TANPA_ISI_KARTON');
  assert.equal(h.ctnTotal, 0);
});

test('kebutuhan pas sekarton tidak dibulatkan naik jadi dua', () => {
  const h = hitungBaris(b({ need: 144, perCtn122: 72, perCtn120: 72 }));
  assert.equal(h.ctnTotal, 2);
  assert.equal(h.qtyTotal, 144);
});

test('isi karton besar (3 digit) tetap terbaca', () => {
  const h = hitungBaris(b({ perCtn122: 100, perCtn120: 100, need: 3200, saldo122: 10_000, saldo120: 0 }));
  assert.equal(h.ctnTotal, 32);
  assert.equal(h.qtyTotal, 3200);
});

// ---------------------------------------------------------------- antar kota

test('stok GBJD dipakai bersama — satu karton tidak dijanjikan ke dua kota', () => {
  // Satu SKU, saldo 122 hanya 3 karton, dua kota sama-sama butuh 3 karton.
  const rows = [
    b({ areaId: 'Surabaya', status: 'HEALTHY', doi: 20, need: 216, saldo122: 216, saldo120: 0 }),
    b({ areaId: 'Pusat', status: 'CRITICAL', doi: 2, need: 216, saldo122: 216, saldo120: 0 }),
  ];
  const { hasil, ringkas } = hitungSemua(rows);
  // Total yang dijanjikan tidak boleh melebihi saldo yang ada.
  assert.equal(ringkas.qtyTotal, 216, 'tidak menjanjikan lebih dari yang ada di gudang');
  const pusat = hasil.find((h) => h.areaId === 'Pusat')!;
  const sby = hasil.find((h) => h.areaId === 'Surabaya')!;
  assert.equal(pusat.qtyTotal, 216, 'yang CRITICAL dilayani duluan');
  assert.equal(sby.qtyTotal, 0);
  assert.equal(sby.alasan, 'KOSONG', 'saldo sudah habis dipakai kota sebelumnya');
});

test('urutan kemendesakan: CRITICAL, lalu LOW, lalu DOI terkecil', () => {
  const urut = [
    b({ areaId: 'A', status: 'HEALTHY', doi: 3 }),
    b({ areaId: 'B', status: 'LOW', doi: 9 }),
    b({ areaId: 'C', status: 'CRITICAL', doi: 8 }),
    b({ areaId: 'D', status: 'HEALTHY', doi: 1 }),
  ].sort(urutKemendesakan).map((r) => r.areaId);
  assert.deepEqual(urut, ['C', 'B', 'D', 'A']);
});

test('SKU berbeda punya saldo sendiri-sendiri', () => {
  const { ringkas } = hitungSemua([
    b({ sku: 'A', areaId: 'Pusat', need: 144, saldo122: 144, saldo120: 0 }),
    b({ sku: 'B', areaId: 'Pusat', need: 144, saldo122: 144, saldo120: 0 }),
  ]);
  assert.equal(ringkas.qtyTotal, 288, 'saldo SKU A tidak ikut terpakai oleh SKU B');
});

test('ringkasan menjumlahkan per kode SAP', () => {
  const { ringkas } = hitungSemua([
    b({ sku: 'A', need: 504, saldo122: 216, saldo120: 5000 }),
  ]);
  assert.equal(ringkas.qty122, 216);
  assert.equal(ringkas.qty120, 288);
  assert.equal(ringkas.qtyTotal, 504);
  assert.equal(ringkas.ctnTotal, 7);
});

// ------------------------------------------- isi karton berbeda antar kode

test('isi karton 122 dan 120 BERBEDA — masing-masing pakai angkanya sendiri', () => {
  // Kasus nyata GBJD 28 Sep 2026: "Power Bright Expert Serum 20ml x 64 - IEG"
  // (kode 122, isi 64) vs "… 20ml x 48" (kode 120, isi 48). 35 dari 51
  // pasangan kode berperilaku begini.
  const h = hitungBaris(b({ need: 500, perCtn122: 64, perCtn120: 48, saldo122: 128, saldo120: 10_000 }));
  // 122 punya 2 karton utuh (128/64) = 128 pcs; sisa 372 pcs dari 120 →
  // ceil(372/48) = 8 karton = 384 pcs.
  assert.deepEqual([h.ctn122, h.qty122], [2, 128]);
  assert.deepEqual([h.ctn120, h.qty120], [8, 384]);
  assert.equal(h.qtyTotal, 512);
  assert.equal(h.alasan, 'OK');
  assert.match(h.keterangan, /122: 2 ctn×64, 120: 8 ctn×48/);
});

test('hanya 120 yang punya isi karton → 122 dilewati', () => {
  const h = hitungBaris(b({ need: 100, perCtn122: 0, perCtn120: 48, saldo122: 5000, saldo120: 5000 }));
  assert.equal(h.qty122, 0, 'tanpa isi karton, 122 tidak bisa dibulatkan');
  assert.deepEqual([h.ctn120, h.qty120], [3, 144]);
});

test('122 cukup sendirian → 120 tidak disentuh walau isinya beda', () => {
  const h = hitungBaris(b({ need: 500, perCtn122: 64, perCtn120: 48, saldo122: 10_000, saldo120: 10_000 }));
  assert.equal(h.ctn120, 0);
  assert.equal(h.ctn122, 8, 'ceil(500/64) = 8 karton');
  assert.equal(h.qtyTotal, 512);
});

test('ringkasan memisahkan karton 122 dan 120', () => {
  const { ringkas } = hitungSemua([
    b({ sku: 'A', need: 500, perCtn122: 64, perCtn120: 48, saldo122: 128, saldo120: 10_000 }),
  ]);
  assert.deepEqual([ringkas.ctn122, ringkas.ctn120, ringkas.ctnTotal], [2, 8, 10]);
  assert.deepEqual([ringkas.qty122, ringkas.qty120], [128, 384]);
});
