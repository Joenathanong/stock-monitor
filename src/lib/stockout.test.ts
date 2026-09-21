import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSku, clampRange, findDataGaps, salesBaseline, type DaySales, type SkuInput, type StockoutOptions } from './stockout';
import { addDays, rangeKeys, type DateKey } from './dates';

const TO: DateKey = '2026-09-20';
const FROM: DateKey = addDays(TO, -29);
const DAYS = rangeKeys(FROM, TO);

const day = (qty: number, over: Partial<DaySales> = {}): DaySales =>
  ({ qty, shopee: qty, tiktok: 0, tokped: 0, lazada: 0, other: 0, ...over });

function opt(over: Partial<StockoutOptions> = {}): StockoutOptions {
  return { days: DAYS, minRunDays: 2, minAds: 1, minSellShare: 0.5, platformMinShare: 0.05, platformMinRunDays: 3, campaignDates: new Set(), ...over };
}

function input(qtyByDay: (d: DateKey, i: number) => number, over: Partial<SkuInput> = {}): SkuInput {
  const byDate = new Map<DateKey, DaySales>();
  DAYS.forEach((d, i) => { const q = qtyByDay(d, i); if (q > 0) byDate.set(d, day(q)); });
  return {
    sku: 'SKU-A', byDate, firstSalesDate: FROM,
    adsAt: () => ({ ads: 10, estimated: false }),
    stockAt: () => null,
    ...over,
  };
}

test('SKU laku tiap hari tanpa nol: tidak ada temuan', () => {
  const { sku } = analyzeSku(input(() => 10), opt());
  assert.equal(sku, null);
});

test('nol 1 hari tidak dilaporkan bila minimal 2 hari', () => {
  const { sku } = analyzeSku(input((_d, i) => (i === 10 ? 0 : 10)), opt());
  assert.equal(sku, null);
});

test('nol 3 hari berturut jadi satu episode, estimasi = hari x ADS', () => {
  const { sku } = analyzeSku(input((_d, i) => (i >= 10 && i <= 12 ? 0 : 10)), opt());
  assert.ok(sku);
  assert.equal(sku.episodeCount, 1);
  assert.equal(sku.outDays, 3);
  assert.equal(sku.episodes[0].from, DAYS[10]);
  assert.equal(sku.episodes[0].to, DAYS[12]);
  assert.equal(sku.lostLow, 30);            // 3 hari x ADS 10
  assert.equal(sku.lostHigh, 30);           // ADS hari-laku juga 10
  assert.equal(sku.status, 'DUGAAN');       // tanpa riwayat stok
  assert.equal(sku.ongoing, false);
});

test('estimasi optimis memakai ADS hari-laku ketika lebih besar dari ADS acuan', () => {
  // laku 100/hari saat jalan, tapi ADS acuan cuma 10 karena banyak hari nol
  const { sku } = analyzeSku(input((_d, i) => (i >= 10 && i <= 13 ? 0 : 100)), opt());
  assert.ok(sku);
  assert.equal(sku.adsSelling, 100);
  assert.equal(sku.lostLow, 40);    // konservatif: 4 x 10
  assert.equal(sku.lostHigh, 400);  // optimis: 4 x 100
});

test('stok terbukti 0 -> TERKONFIRMASI; stok terbukti ada -> STOK_ADA', () => {
  const kosong = analyzeSku(input((_d, i) => (i >= 10 && i <= 12 ? 0 : 10), { stockAt: () => 0 }), opt());
  assert.equal(kosong.sku?.status, 'TERKONFIRMASI');
  assert.equal(kosong.sku?.episodes[0].stockState, 'KOSONG');

  const ada = analyzeSku(input((_d, i) => (i >= 10 && i <= 12 ? 0 : 10), { stockAt: () => 500 }), opt());
  assert.equal(ada.sku?.status, 'STOK_ADA');
  assert.equal(ada.sku?.episodes[0].stockState, 'ADA');
});

test('episode yang menyentuh hari terakhir ditandai masih berlangsung', () => {
  const { sku } = analyzeSku(input((_d, i) => (i >= 27 ? 0 : 10)), opt());
  assert.equal(sku?.ongoing, true);
  assert.equal(sku?.episodes[0].ongoing, true);
});

test('hari sebelum penjualan pertama tidak dihitung kosong', () => {
  const { sku } = analyzeSku(
    input((_d, i) => (i < 10 ? 0 : 10), { firstSalesDate: DAYS[10] }),
    opt(),
  );
  assert.equal(sku, null);
});

test('ADS acuan di bawah ambang disaring', () => {
  const kecil = analyzeSku(
    input((_d, i) => (i >= 10 && i <= 12 ? 0 : 1), { adsAt: () => ({ ads: 0.2, estimated: false }) }),
    opt({ minAds: 1 }),
  );
  assert.equal(kecil.sku, null);
});

test('produk slow-moving tidak dilaporkan walau sering nol berturut-turut', () => {
  // laku 1 pcs tiap 4 hari: adsSelling = 1 (lolos kalau dipakai menyaring),
  // tapi pangsa hari lakunya cuma 25% -> harus dibuang.
  const { sku } = analyzeSku(
    input((_d, i) => (i % 4 === 0 ? 1 : 0), { adsAt: () => ({ ads: 1, estimated: false }) }),
    opt(),
  );
  assert.equal(sku, null);
});

test('SKU yang biasanya laku tiap hari tetap lolos walau lama kosong', () => {
  // kosong 20 dari 30 hari? pangsa laku 33% -> dibuang. Kosong 12 hari -> 60% -> lolos.
  const { sku } = analyzeSku(input((_d, i) => (i >= 8 && i <= 19 ? 0 : 50)), opt());
  assert.ok(sku);
  assert.equal(sku.outDays, 12);
  assert.ok(sku.sellSharePct > 50);
});

test('hari campaign yang ikut kosong dihitung terpisah', () => {
  const { sku } = analyzeSku(
    input((_d, i) => (i >= 10 && i <= 12 ? 0 : 10)),
    opt({ campaignDates: new Set([DAYS[11]]) }),
  );
  assert.equal(sku?.campaignDays, 1);
});

test('gap platform: Shopee nol sementara TikTok jalan -> bukan stok kosong', () => {
  const byDate = new Map<DateKey, DaySales>();
  DAYS.forEach((d, i) => {
    const shopee = i >= 10 && i <= 14 ? 0 : 60;
    const tiktok = 40;
    byDate.set(d, { qty: shopee + tiktok, shopee, tiktok, tokped: 0, lazada: 0, other: 0 });
  });
  const { sku, gaps } = analyzeSku({
    sku: 'SKU-B', byDate, firstSalesDate: FROM,
    adsAt: () => ({ ads: 100, estimated: false }), stockAt: () => null,
  }, opt());

  assert.equal(sku, null, 'total qty tidak pernah nol, jadi bukan episode stok kosong');
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].platform, 'shopee');
  assert.equal(gaps[0].days, 5);
  assert.equal(gaps[0].otherQty, 200, 'platform lain terbukti masih jalan (5 x 40)');
  assert.ok(gaps[0].sharePct > 50);
});

test('platform dengan pangsa kecil tidak dilaporkan', () => {
  const byDate = new Map<DateKey, DaySales>();
  DAYS.forEach((d, i) => {
    const lazada = i >= 10 && i <= 14 ? 0 : 1;   // pangsa ~1%
    byDate.set(d, { qty: 100 + lazada, shopee: 100, tiktok: 0, tokped: 0, lazada, other: 0 });
  });
  const { gaps } = analyzeSku({
    sku: 'SKU-C', byDate, firstSalesDate: FROM,
    adsAt: () => ({ ads: 100, estimated: false }), stockAt: () => null,
  }, opt());
  assert.equal(gaps.length, 0);
});

test('findDataGaps menandai hari tanpa sinkronisasi dan hari yang jauh di bawah kebiasaan', () => {
  const aktif = new Map<DateKey, number>();
  DAYS.forEach((d, i) => aktif.set(d, i === 5 ? 0 : i === 6 ? 3 : 200));
  const gaps = findDataGaps(DAYS, aktif);
  assert.deepEqual(gaps, [DAYS[5], DAYS[6]]);
});

test('clampRange menutup rentang di kemarin dan membatasi panjangnya', () => {
  const r = clampRange('2026-01-01', '2026-12-31', '2026-09-21', 180);
  assert.equal(r.to, '2026-09-20');
  assert.equal(r.from, addDays('2026-09-20', -179));
});

// ---- SKU tanpa ADS di snapshot (mis. sudah tidak terdaftar di daftar stok OCS)

test('tanpa ADS snapshot, angka normal diambil dari median penjualan', () => {
  const { sku } = analyzeSku(
    input((_d, i) => (i >= 20 && i <= 24 ? 0 : 40), { adsAt: () => ({ ads: 0, estimated: false }) }),
    opt(),
  );
  assert.ok(sku, 'SKU tanpa ADS snapshot TIDAK boleh dibuang — justru itu yang dicari');
  assert.equal(sku.adsSource, 'PENJUALAN');
  assert.equal(sku.episodes[0].adsSource, 'PENJUALAN');
  assert.equal(sku.outDays, 5);
  assert.ok(sku.ads > 0, 'baseline harus terisi dari penjualan');
  assert.equal(sku.lostLow, 5 * sku.ads);
});

test('median kebal terhadap lonjakan campaign', () => {
  // 27 hari @20, satu hari @2000 (campaign) -> median tetap 20, rata-rata ~93
  const byDate = new Map<DateKey, DaySales>();
  DAYS.forEach((d, i) => byDate.set(d, day(i === 3 ? 2000 : 20)));
  const b = salesBaseline(byDate, DAYS, DAYS[DAYS.length - 1]);
  assert.equal(b, 20);
});

test('baseline memakai jendela SEBELUM episode, bukan seluruh rentang', () => {
  // 14 hari pertama @10, lalu naik ke @100, episode di ujung
  const byDate = new Map<DateKey, DaySales>();
  DAYS.forEach((d, i) => byDate.set(d, day(i < 14 ? 10 : 100)));
  const b = salesBaseline(byDate, DAYS, DAYS[DAYS.length - 1], 10);
  assert.equal(b, 100, 'sepuluh hari terakhir sebelum acuan semuanya 100');
});

test('ADS snapshot tetap menang bila tersedia', () => {
  const { sku } = analyzeSku(
    input((_d, i) => (i >= 20 && i <= 24 ? 0 : 40), { adsAt: () => ({ ads: 7, estimated: false }) }),
    opt(),
  );
  assert.equal(sku?.adsSource, 'SNAPSHOT');
  assert.equal(sku?.ads, 7);
});
