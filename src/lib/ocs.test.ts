import test from 'node:test';
import assert from 'node:assert/strict';
import { mapBundleItems } from './ocs';

// ---------------------------------------------------------------------------
// mapBundleItems — komposisi bundling dari /MasterData/GetBundleStock
// ---------------------------------------------------------------------------

test('mapBundleItems: bentuk nyata OCS (dibongkar 9 Okt 2026)', () => {
  const h = mapBundleItems([{
    BundleSku: 'BDL-TESTING-005',
    BundleName: 'Testing',
    TotalQty: 3,
    Items: [
      { SellerSku: 'BLURRY-MUFFEEL-3', SellerSkuQty: 2, Stocks: [{ AreaId: 'Medan', AvailableQty: 7677 }] },
      { SellerSku: 'GIMMICK-FYNE-SERUM-POWER', SellerSkuQty: 1, Stocks: [] },
    ],
  }]);
  assert.deepEqual(h, [
    { bundleSku: 'BDL-TESTING-005', itemSku: 'BLURRY-MUFFEEL-3', qty: 2, name: 'Testing' },
    { bundleSku: 'BDL-TESTING-005', itemSku: 'GIMMICK-FYNE-SERUM-POWER', qty: 1, name: 'Testing' },
  ]);
});

test('mapBundleItems: komponen GANDA dijumlahkan, bukan yang terakhir menang', () => {
  // Kunci tabelnya (bundleSku, itemSku). Tanpa penjumlahan, satu baris akan
  // menimpa yang lain diam-diam dan isi bundle berkurang tanpa ada tandanya.
  const h = mapBundleItems([{
    BundleSku: 'B', Items: [
      { SellerSku: 'A', SellerSkuQty: 2 },
      { SellerSku: 'A', SellerSkuQty: 3 },
    ],
  }]);
  assert.equal(h.length, 1);
  assert.equal(h[0].qty, 5);
});

test('mapBundleItems: qty tidak sah jadi 1, bukan membuang komponennya', () => {
  const h = mapBundleItems([{
    BundleSku: 'B', Items: [
      { SellerSku: 'NOL', SellerSkuQty: 0 },
      { SellerSku: 'MINUS', SellerSkuQty: -4 },
      { SellerSku: 'KOSONG' },
    ],
  }]);
  assert.deepEqual(h.map((x) => [x.itemSku, x.qty]), [['NOL', 1], ['MINUS', 1], ['KOSONG', 1]]);
});

test('mapBundleItems: baris tanpa SKU dan yang menunjuk dirinya sendiri dibuang', () => {
  const h = mapBundleItems([
    { BundleSku: '', Items: [{ SellerSku: 'A', SellerSkuQty: 1 }] },
    { BundleSku: 'B', Items: [{ SellerSku: '  ', SellerSkuQty: 1 }, { SellerSku: 'B', SellerSkuQty: 1 }] },
  ]);
  assert.deepEqual(h, []);
});

test('mapBundleItems: Items kosong/absen tidak melempar', () => {
  assert.deepEqual(mapBundleItems([{ BundleSku: 'B' }, { BundleSku: 'C', Items: [] }]), []);
});
