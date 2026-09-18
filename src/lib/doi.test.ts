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

// ---------------------------------------------------------------- Phase out

const PO = { effectiveDate: '2026-09-01' as DateKey, targetOutDate: null, replacementSku: null, disposition: 'SELL_DOWN' };

test('phase out: status PHASE_OUT dan tidak pernah dapat saran PO', () => {
  // stok nyaris habis — tanpa phase out pasti CRITICAL dan dapat saran qty.
  const biasa = computeSku(input({ availableQty: 5 }), S, ctx());
  assert.equal(biasa.status, 'CRITICAL');
  assert.ok(biasa.suggested1 > 0);

  const po = computeSku(input({ availableQty: 5, phaseOut: PO }), S, ctx());
  assert.equal(po.status, 'PHASE_OUT');
  assert.equal(po.isPhaseOut, true);
  assert.equal(po.suggested1, 0);
  assert.equal(po.suggested2, 0);
});

test('phase out: dikecualikan manual tetap menang atas phase out', () => {
  const r = computeSku(input({ isExcluded: true, phaseOut: PO }), S, ctx());
  assert.equal(r.status, 'EXCLUDED');
  assert.equal(r.isPhaseOut, false);
});

test('phase out: sisa stok pada tanggal target dan keterlambatan', () => {
  // ADS 10/hari, target 10 hari lagi -> terjual 100. Stok 250 -> sisa 150, habis 25 hari lagi (telat 15).
  const target = addDays(TODAY, 10);
  const r = computeSku(input({ availableQty: 250, phaseOut: { ...PO, targetOutDate: target } }), S, ctx());
  assert.equal(r.phaseOutTargetDate, target);
  assert.equal(r.phaseOutExcessQty, 150);
  assert.equal(r.phaseOutLateDays, 15);
});

test('phase out: habis sebelum target -> tidak ada sisa, tidak telat', () => {
  // ADS 10/hari, target 60 hari lagi, stok 100 -> habis 10 hari lagi.
  const r = computeSku(input({ availableQty: 100, phaseOut: { ...PO, targetOutDate: addDays(TODAY, 60) } }), S, ctx());
  assert.equal(r.phaseOutExcessQty, 0);
  assert.equal(r.phaseOutLateDays, 0);
});

test('phase out: stok DAN ADS sama-sama keluar dari DOI total', () => {
  const aktif = computeSku(input({ sku: 'AKTIF', availableQty: 1000 }), S, ctx());
  const keluar = computeSku(input({ sku: 'PO-1', availableQty: 5000, phaseOut: PO }), S, ctx());
  const rows = [aktif, keluar];

  const dengan = totalDoi(rows, false);
  const tanpa = totalDoi(rows, true);
  assert.equal(dengan.stock, 6000);
  assert.equal(tanpa.stock, 1000);
  // ADS ikut berkurang — kalau tidak, DOI total jadi salah kecil.
  assert.equal(tanpa.ads1, aktif.ads1);
  assert.equal(tanpa.doi1, 100); // 1000 / 10
  assert.equal(tanpa.skuCount, 1);
});

test('phase out: tidak ikut menentukan batas kelas ABC', () => {
  const besar = computeSku(input({ sku: 'PO-BESAR', salesByDate: constantSales(100, 120), phaseOut: PO }), S, ctx());
  const a = computeSku(input({ sku: 'A', salesByDate: constantSales(10, 120) }), S, ctx());
  const b = computeSku(input({ sku: 'B', salesByDate: constantSales(2, 120) }), S, ctx());
  assignAbc([besar, a, b], S.abcAPct, S.abcBPct);
  // Tanpa SKU phase out, A menguasai ~83% penjualan aktif -> kelas A.
  assert.equal(a.abcClass, 'A');
  assert.equal(besar.abcClass, 'C');
  assert.equal(besar.abcShare, 0);
});

test('phase out: ringkasan menyimpan dua versi total', () => {
  const aktif = computeSku(input({ sku: 'AKTIF', availableQty: 1000 }), S, ctx());
  const keluar = computeSku(input({ sku: 'PO-1', availableQty: 5000, phaseOut: { ...PO, targetOutDate: addDays(TODAY, 10) } }), S, ctx());
  const sum = summarize([aktif, keluar], true);
  assert.equal(sum.total.stock, 1000);
  assert.equal(sum.totalWithPhaseOut.stock, 6000);
  assert.equal(sum.byStatus.PHASE_OUT, 1);
  assert.equal(sum.phaseOut.count, 1);
  assert.equal(sum.phaseOut.stock, 5000);
  assert.equal(sum.phaseOut.excessQty, 4900); // 5000 - 10*10
  assert.equal(sum.phaseOut.lateCount, 1);
});
