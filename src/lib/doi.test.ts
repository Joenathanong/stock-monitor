import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignAbc, computeSku, summarize, totalDoi, windowStat, type DoiContext, type SkuInput } from './doi';
import { toDoiSettings } from './settings';
import { addDays, type DateKey } from './dates';
import { buildExclusionMap, ruleReason } from './exclusion';

const TODAY: DateKey = '2026-09-15';
const S = toDoiSettings();

function constantSales(perDay: number, days: number, today = TODAY): Record<DateKey, number> {
  const out: Record<DateKey, number> = {};
  for (let i = 1; i <= days; i++) out[addDays(today, -i)] = perDay;
  return out;
}

function ctx(over: Partial<DoiContext> = {}): DoiContext {
  return { today: TODAY, exclusionDates: new Set(), earliestDataDate: '2026-01-01', ...over };
}

function input(over: Partial<SkuInput> = {}): SkuInput {
  return {
    sku: 'SKU-A', name: 'Produk A', availableQty: 100, transitQty: 0,
    salesByDate: constantSales(10, 120), firstSalesDate: '2026-03-01', ...over,
  };
}

test('jendela berakhir kemarin — hari ini tidak dihitung', () => {
  const sales = constantSales(10, 120);
  sales[TODAY] = 999;
  const w = windowStat({ salesByDate: sales, firstSalesDate: '2026-01-01' }, TODAY, 90);
  assert.equal(w.days, 90);
  assert.equal(w.sum, 900);
  assert.equal(w.ads, 10);
});

test('Opsi 1: tanggal payday & double date dikeluarkan dari jumlah DAN pembagi', () => {
  const sales = constantSales(10, 120);
  const ex = new Set<DateKey>(['2026-09-09', '2026-08-25', '2026-07-25', '2026-08-08', '2026-07-07', '2026-06-25']);
  for (const d of ex) sales[d] = 1000; // hari campaign ramai
  sales['2026-09-09'] = 3000;
  const r = computeSku(input({ salesByDate: sales }), S, ctx({ exclusionDates: ex }));
  assert.equal(r.w1.excludedDays, 6);
  assert.equal(r.w1.days, 84);
  assert.equal(r.ads1, 10);
  // Opsi 2 bawaan TIDAK mengecualikan → 2 minggu memuat 9.9 yang ramai
  assert.ok(r.w2.ads > 10);
  assert.equal(r.ads2Source, '2w');
});

test('Opsi 2 memilih yang terbesar dari 8w/4w/2w', () => {
  const sales = constantSales(10, 120);
  // 2 minggu terakhir sepi, 4 minggu sebelumnya ramai
  for (let i = 1; i <= 14; i++) sales[addDays(TODAY, -i)] = 2;
  for (let i = 15; i <= 28; i++) sales[addDays(TODAY, -i)] = 30;
  const r = computeSku(input({ salesByDate: sales }), S, ctx());
  assert.equal(r.w2.ads, 2);
  assert.equal(r.w4.ads, 16); // (14×2 + 14×30) / 28
  assert.equal(r.ads2, Math.max(r.w8.ads, r.w4.ads, r.w2.ads));
  assert.equal(r.ads2Source, '4w');
});

test('NPL: pembagi dipotong pada tanggal penjualan pertama, bukan 90 hari', () => {
  const first = addDays(TODAY, -20);
  const sales: Record<DateKey, number> = {};
  for (let i = 1; i <= 20; i++) sales[addDays(TODAY, -i)] = 5;
  const r = computeSku(input({ salesByDate: sales, firstSalesDate: first }), S, ctx());
  assert.equal(r.isNpl, true);
  assert.equal(r.ageDays, 20);
  assert.equal(r.w1.days, 20);
  assert.equal(r.ads1, 5);
  assert.match(r.nplNote ?? '', /umur jual 20 hari/);
  assert.notEqual(r.status, 'NPL_WAIT');
});

test('NPL < 14 hari: status NPL_WAIT, tanpa saran PO', () => {
  const first = addDays(TODAY, -5);
  const sales: Record<DateKey, number> = {};
  for (let i = 1; i <= 5; i++) sales[addDays(TODAY, -i)] = 50;
  const r = computeSku(input({ salesByDate: sales, firstSalesDate: first, availableQty: 10 }), S, ctx());
  assert.equal(r.status, 'NPL_WAIT');
  assert.equal(r.suggested1, 0);
  assert.match(r.nplNote ?? '', /belum cukup/);
});

test('tanggal pertama = awal data → bukan NPL, ditandai truncated', () => {
  const r = computeSku(input({ firstSalesDate: '2026-01-01' }), S, ctx({ earliestDataDate: '2026-01-01' }));
  assert.equal(r.firstSalesTruncated, true);
  assert.equal(r.isNpl, false);
});

test('status mengikuti lead time: kritis, low, tunggu kiriman, aman, overstock', () => {
  // ADS 10, lead time 7, safety 3, target 14
  const base = input({ leadTimeDays: 7 });
  assert.equal(computeSku({ ...base, availableQty: 60 }, S, ctx()).status, 'CRITICAL');   // DOI 6 ≤ 7
  assert.equal(computeSku({ ...base, availableQty: 90 }, S, ctx()).status, 'LOW');        // DOI 9 ≤ 10
  assert.equal(computeSku({ ...base, availableQty: 60, transitQty: 100 }, S, ctx()).status, 'WAITING'); // 6 di tangan, 16 dengan transit
  assert.equal(computeSku({ ...base, availableQty: 120 }, S, ctx()).status, 'HEALTHY');   // DOI 12
  assert.equal(computeSku({ ...base, availableQty: 200 }, S, ctx()).status, 'OVERSTOCK'); // DOI 20 > 14
});

test('saran qty = target DOI × ADS − (stok + transit), tidak negatif', () => {
  const r = computeSku(input({ availableQty: 50, transitQty: 20, leadTimeDays: 7 }), S, ctx());
  assert.equal(r.suggested1, 14 * 10 - 70);
  const over = computeSku(input({ availableQty: 500 }), S, ctx());
  assert.equal(over.suggested1, 0);
});

test('basis konservatif memakai ADS terbesar (DOI terkecil)', () => {
  const sales = constantSales(10, 120);
  for (let i = 1; i <= 14; i++) sales[addDays(TODAY, -i)] = 30;
  const r = computeSku(input({ salesByDate: sales, availableQty: 300 }), S, ctx());
  assert.ok(r.ads2 > r.ads1);
  assert.equal(r.refAds, r.ads2);
  assert.equal(r.refDoi, r.doi2);
  const opsi1 = computeSku(input({ salesByDate: sales, availableQty: 300 }), { ...S, actionBasis: 'OPSI1' }, ctx());
  assert.equal(opsi1.refDoi, opsi1.doi1);
});

test('dead stock vs belum terjual', () => {
  const dead = computeSku(input({ salesByDate: {}, firstSalesDate: '2026-02-01', availableQty: 40 }), S, ctx());
  assert.equal(dead.status, 'DEAD_STOCK');
  assert.equal(dead.doi1, null);
  const never = computeSku(input({ salesByDate: {}, firstSalesDate: null, availableQty: 40 }), S, ctx());
  assert.equal(never.status, 'NO_SALES');
});

test('hari stok kosong dikeluarkan dari pembagi bila diaktifkan', () => {
  const sales = constantSales(10, 120);
  const oos = new Set<DateKey>();
  for (let i = 1; i <= 10; i++) { const k = addDays(TODAY, -i); sales[k] = 0; oos.add(k); }
  const off = computeSku(input({ salesByDate: sales, stockoutDates: oos }), S, ctx());
  const on = computeSku(input({ salesByDate: sales, stockoutDates: oos }), { ...S, excludeStockoutDays: true }, ctx());
  assert.equal(off.w1.days, 90);
  assert.equal(on.w1.days, 80);
  assert.equal(on.w1.stockoutDays, 10);
  assert.equal(on.ads1, 10);
  assert.ok(off.ads1 < 10);
});

test('ABC 70/90 berdasarkan pangsa qty kumulatif', () => {
  const mk = (sku: string, s90: number) => ({ ...computeSku(input({ sku }), S, ctx()), sales90: s90 });
  const rows = assignAbc([mk('X', 700), mk('Y', 200), mk('Z', 100), mk('N', 0)], 70, 90);
  const cls = Object.fromEntries(rows.map((r) => [r.sku, r.abcClass]));
  assert.deepEqual(cls, { X: 'A', Y: 'B', Z: 'C', N: 'C' });
  assert.equal(rows.find((r) => r.sku === 'X')!.abcShare, 70);
});

test('DOI total = total stok ÷ total ADS', () => {
  const a = computeSku(input({ sku: 'A', availableQty: 100 }), S, ctx());            // ADS 10
  const b = computeSku(input({ sku: 'B', availableQty: 300, salesByDate: constantSales(20, 120) }), S, ctx()); // ADS 20
  const t = totalDoi([a, b]);
  assert.equal(t.stock, 400);
  assert.equal(t.ads1, 30);
  assert.equal(t.doi1, 13.33);
  const sum = summarize(assignAbc([a, b], 70, 90));
  assert.equal(sum.total.doi1, 13.33);
  assert.equal(sum.byStatus.HEALTHY + sum.byStatus.OVERSTOCK + sum.byStatus.LOW + sum.byStatus.CRITICAL + sum.byStatus.WAITING, 2);
});

test('SKU dikecualikan tidak masuk DOI total', () => {
  const a = computeSku(input({ sku: 'A', availableQty: 100 }), S, ctx());
  const x = computeSku(input({ sku: 'X', availableQty: 9999, isExcluded: true }), S, ctx());
  assert.equal(x.status, 'EXCLUDED');
  assert.equal(totalDoi([a, x]).stock, 100);
});

test('aturan pengecualian: double date & payday tanggal tunggal', () => {
  const rule = { paydayDay: 25, excludeDoubleDates: true };
  assert.equal(ruleReason('2026-09-09', rule), 'DOUBLE_DATE');
  assert.equal(ruleReason('2026-09-25', rule), 'PAYDAY');
  assert.equal(ruleReason('2026-09-10', rule), null);
  assert.equal(ruleReason('2026-09-08', rule), null); // bukan jendela H-1
  const map = buildExclusionMap('2026-09-01', '2026-09-30', rule, [{ date: '2026-09-17', reason: 'Flash sale' }]);
  assert.deepEqual([...map.keys()].sort(), ['2026-09-09', '2026-09-17', '2026-09-25']);
  assert.equal(map.get('2026-09-17'), 'Flash sale');
});
