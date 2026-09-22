import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, solveFloor, type SimOptions, type SimRow } from './simulate';

const sku = (over: Partial<SimRow> & { sku: string }): SimRow => ({
  name: null, sapCode: null, abcClass: 'C', status: 'HEALTHY',
  availableQty: 0, transitQty: 0, ads: 0, doi: null, isPhaseOut: false, ...over,
});

function opt(over: Partial<SimOptions> = {}): SimOptions {
  return { targetDoi: 7, classes: ['B', 'C'], floorDays: { A: 7, B: 7, C: 7 }, excludePhaseOut: true, order: 'QTY', ...over };
}

test('DOI total = stok ÷ ADS, dan target stok = target hari × ADS', () => {
  const rows = [
    sku({ sku: 'A1', abcClass: 'A', availableQty: 1000, ads: 100 }),
    sku({ sku: 'B1', abcClass: 'B', availableQty: 1000, ads: 50 }),
  ];
  const r = simulate(rows, opt({ targetDoi: 10 }));
  assert.equal(r.stockBefore, 2000);
  assert.equal(r.adsTotal, 150);
  assert.equal(r.doiBefore, 13.33);
  assert.equal(r.targetStock, 1500);
  assert.equal(r.need, 500);
});

test('yang dipotong hanya kelebihan DI ATAS lantai', () => {
  const rows = [
    sku({ sku: 'GEMUK', abcClass: 'C', availableQty: 1000, ads: 10 }),  // 100 hari
    sku({ sku: 'TIPIS', abcClass: 'C', availableQty: 20, ads: 10 }),    // 2 hari
  ];
  const r = simulate(rows, opt({ targetDoi: 7, floorDays: { A: 7, B: 7, C: 7 } }));
  // lantai 7 hari: GEMUK sisakan 70 -> boleh potong 930; TIPIS sudah di bawah lantai
  assert.equal(r.cuttable, 930);
  assert.equal(r.picks.length, 1);
  assert.equal(r.picks[0].sku, 'GEMUK');
  assert.ok(!r.picks.some((p) => p.sku === 'TIPIS'), 'SKU yang stoknya sudah tipis tidak boleh disentuh');
});

test('kelas yang tidak dicentang tidak disentuh tapi tetap dihitung di DOI total', () => {
  const rows = [
    sku({ sku: 'A1', abcClass: 'A', availableQty: 5000, ads: 100 }),
    sku({ sku: 'C1', abcClass: 'C', availableQty: 1000, ads: 10 }),
  ];
  const r = simulate(rows, opt({ targetDoi: 20, classes: ['C'] }));
  assert.ok(!r.picks.some((p) => p.abcClass === 'A'));
  assert.equal(r.byClass.A.cut, 0);
  assert.equal(r.stockBefore, 6000, 'stok A tetap ikut dihitung');
});

test('target tercapai: DOI sesudah <= target', () => {
  const rows = [
    sku({ sku: 'A1', abcClass: 'A', availableQty: 700, ads: 100 }),
    sku({ sku: 'C1', abcClass: 'C', availableQty: 3000, ads: 20 }),
  ];
  const r = simulate(rows, opt({ targetDoi: 7, floorDays: { A: 7, B: 7, C: 7 } }));
  assert.equal(r.feasible, true);
  assert.ok((r.doiAfter ?? 99) <= 7.01, `doiAfter ${r.doiAfter}`);
  assert.equal(r.shortfall, 0);
});

test('target mustahil dilaporkan apa adanya, bukan dipaksa', () => {
  // A sendirian sudah 50 hari dan tidak boleh dipotong
  const rows = [
    sku({ sku: 'A1', abcClass: 'A', availableQty: 5000, ads: 100 }),
    sku({ sku: 'C1', abcClass: 'C', availableQty: 100, ads: 10 }),
  ];
  const r = simulate(rows, opt({ targetDoi: 7, classes: ['C'] }));
  assert.equal(r.feasible, false);
  assert.ok(r.shortfall > 0);
  assert.ok((r.doiAfter ?? 0) > 7, 'jangan mengaku tercapai');
});

test('sudah di bawah target: tidak ada yang perlu dipotong', () => {
  const rows = [sku({ sku: 'C1', abcClass: 'C', availableQty: 50, ads: 10 })];
  const r = simulate(rows, opt({ targetDoi: 7 }));
  assert.equal(r.need, 0);
  assert.equal(r.cutTotal, 0);
  assert.equal(r.picks.length, 0);
  assert.equal(r.feasible, true);
});

test('urutan QTY memotong habis yang paling gemuk dulu (paling sedikit SKU disentuh)', () => {
  const rows = [
    sku({ sku: 'A1', abcClass: 'A', availableQty: 0, ads: 100 }),
    sku({ sku: 'BESAR', abcClass: 'C', availableQty: 1000, ads: 0 }),
    sku({ sku: 'KECIL', abcClass: 'C', availableQty: 100, ads: 0 }),
  ];
  const r = simulate(rows, opt({ targetDoi: 0, order: 'QTY' }));
  assert.equal(r.picks[0].sku, 'BESAR');
  const total = r.picks.reduce((a, p) => a + p.cut, 0);
  assert.equal(total, r.need);
});

test('urutan PROPORSIONAL membagi beban ke semua SKU', () => {
  const rows = [
    sku({ sku: 'A1', abcClass: 'A', availableQty: 700, ads: 100 }),
    sku({ sku: 'C1', abcClass: 'C', availableQty: 1000, ads: 0 }),
    sku({ sku: 'C2', abcClass: 'C', availableQty: 1000, ads: 0 }),
  ];
  const r = simulate(rows, opt({ targetDoi: 7, order: 'PROPORSIONAL' }));
  assert.equal(r.picks.length, 2, 'keduanya kena');
  assert.equal(r.picks[0].cut, r.picks[1].cut);
  assert.equal(r.cutTotal, r.need);
});

test('pembulatan proporsional tidak membuat total meleset', () => {
  const rows = [
    sku({ sku: 'A1', abcClass: 'A', availableQty: 0, ads: 100 }),
    ...[333, 333, 334, 101, 7].map((q, i) => sku({ sku: `C${i}`, abcClass: 'C', availableQty: q, ads: 0 })),
  ];
  const r = simulate(rows, opt({ targetDoi: 3, order: 'PROPORSIONAL' }));
  assert.equal(r.cutTotal, r.need);
});

test('phase out: dikeluarkan = stok dan ADS-nya sama-sama hilang', () => {
  const rows = [
    sku({ sku: 'A1', abcClass: 'A', availableQty: 700, ads: 100 }),
    sku({ sku: 'PO1', abcClass: 'C', availableQty: 900, ads: 30, status: 'PHASE_OUT', isPhaseOut: true }),
  ];
  const ikut = simulate(rows, opt({ excludePhaseOut: false }));
  const keluar = simulate(rows, opt({ excludePhaseOut: true }));
  assert.equal(ikut.stockBefore, 1600);
  assert.equal(ikut.adsTotal, 130);
  assert.equal(keluar.stockBefore, 700);
  assert.equal(keluar.adsTotal, 100);
  assert.equal(keluar.phaseOut.stock, 900, 'tetap dilaporkan walau tidak dihitung');
});

test('SKU dikecualikan tidak pernah ikut', () => {
  const rows = [
    sku({ sku: 'A1', abcClass: 'A', availableQty: 700, ads: 100 }),
    sku({ sku: 'X1', abcClass: 'C', availableQty: 9999, ads: 5, status: 'EXCLUDED' }),
  ];
  const r = simulate(rows, opt());
  assert.equal(r.stockBefore, 700);
  assert.equal(r.skuCount, 1);
});

test('solveFloor mencari lantai TERTINGGI yang masih memenuhi target', () => {
  const rows = [
    sku({ sku: 'A1', abcClass: 'A', availableQty: 700, ads: 100 }),
    sku({ sku: 'C1', abcClass: 'C', availableQty: 3000, ads: 20 }),
  ];
  const f = solveFloor(rows, { targetDoi: 7, classes: ['C'], excludePhaseOut: true });
  assert.ok(f !== null);
  const pas = simulate(rows, opt({ targetDoi: 7, classes: ['C'], floorDays: { A: f!, B: f!, C: f! } }));
  assert.ok((pas.doiAfter ?? 99) <= 7.01, `lantai ${f} -> ${pas.doiAfter}`);
  const kelewat = simulate(rows, opt({ targetDoi: 7, classes: ['C'], floorDays: { A: f! + 1, B: f! + 1, C: f! + 1 } }));
  assert.ok((kelewat.doiAfter ?? 0) > 7, 'lantai lebih tinggi seharusnya sudah meleset');
});

test('solveFloor mengembalikan null bila target mustahil', () => {
  const rows = [sku({ sku: 'A1', abcClass: 'A', availableQty: 5000, ads: 100 })];
  assert.equal(solveFloor(rows, { targetDoi: 7, classes: ['C'], excludePhaseOut: true }), null);
});

test('angka nyata 22 Sep 2026: 12,26 hari dengan phase out, 11,51 tanpa', () => {
  // Satu SKU wakil per kelas, memakai agregat dari snapshot produksi.
  const rows = [
    sku({ sku: 'A', abcClass: 'A', availableQty: 157264, ads: 22852.85 }),
    sku({ sku: 'B', abcClass: 'B', availableQty: 105202, ads: 6301.64 }),
    sku({ sku: 'C', abcClass: 'C', availableQty: 109647, ads: 3179.58 }),
    sku({ sku: 'PO', abcClass: 'C', availableQty: 34972, ads: 860.51, status: 'PHASE_OUT', isPhaseOut: true }),
  ];
  assert.equal(simulate(rows, opt({ excludePhaseOut: false })).doiBefore, 12.26);
  const r = simulate(rows, opt({ targetDoi: 7, excludePhaseOut: true }));
  assert.equal(r.doiBefore, 11.51);
  assert.equal(r.need, 145775);
  assert.equal(r.byClass.A.doi, 6.88);
  assert.equal(r.byClass.B.doi, 16.69);
  assert.equal(r.byClass.C.doi, 34.48);
});
