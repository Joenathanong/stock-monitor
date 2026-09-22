import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapProductPrices, type OcsProductSkuRow } from './ocs';

test('SalePrice array: ambil terendah antar marketplace', () => {
  const r = mapProductPrices([{ SellerSku: 'A', Title: 'Produk A', SalePrice: [53513, 47091, 51000] }]);
  assert.deepEqual(r, [{ sku: 'A', name: 'Produk A', price: 47091, min: 47091, max: 53513, sources: 3 }]);
});

test('pilihan MAX dan AVG', () => {
  const row: OcsProductSkuRow = { SellerSku: 'A', SalePrice: [10, 20, 30] };
  assert.equal(mapProductPrices([row], 'MAX')[0].price, 30);
  assert.equal(mapProductPrices([row], 'AVG')[0].price, 20);
});

test('satu produk dengan beberapa SKU dipisah koma', () => {
  const r = mapProductPrices([{ SellerSku: 'SKU-A, SKU-B , SKU-C', SalePrice: [1000] }]);
  assert.deepEqual(r.map((x) => x.sku), ['SKU-A', 'SKU-B', 'SKU-C']);
  assert.ok(r.every((x) => x.price === 1000));
});

test('harga nol / null / negatif diabaikan, bukan dianggap gratis', () => {
  assert.equal(mapProductPrices([{ SellerSku: 'A', SalePrice: [0, 0] }]).length, 0);
  assert.equal(mapProductPrices([{ SellerSku: 'A', SalePrice: null }]).length, 0);
  assert.equal(mapProductPrices([{ SellerSku: 'A' }]).length, 0);
  const campur = mapProductPrices([{ SellerSku: 'A', SalePrice: [0, -5, 9000] }]);
  assert.equal(campur[0].price, 9000);
  assert.equal(campur[0].sources, 1);
});

test('SalePrice berupa angka tunggal (bukan array) tetap diterima', () => {
  const r = mapProductPrices([{ SellerSku: 'A', SalePrice: 12345 as unknown as number[] }]);
  assert.equal(r[0].price, 12345);
  assert.equal(r[0].sources, 1);
});

test('SKU yang muncul dua kali: yang lebih murah menang (mode MIN)', () => {
  const r = mapProductPrices([
    { SellerSku: 'A', SalePrice: [50000] },
    { SellerSku: 'A', SalePrice: [35000] },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].price, 35000);
});

test('baris tanpa SellerSku tidak membuat entri kosong', () => {
  assert.equal(mapProductPrices([{ SellerSku: '  ,  ', SalePrice: [1000] }]).length, 0);
});

test('contoh nyata dari halaman OCS 22 Sep 2026', () => {
  const r = mapProductPrices([
    { SellerSku: 'BALMTINT-SASSY-3', Title: 'Butter Balm Tint Sassy', SalePrice: [35000, 53513] },
    { SellerSku: 'ACNE-NIGHT-CREAM', Title: 'Acne Night Cream', SalePrice: [45103] },
  ]);
  assert.equal(r.find((x) => x.sku === 'BALMTINT-SASSY-3')?.price, 35000, 'halaman menampilkan Rp 35.000 - Rp 53.513');
  assert.equal(r.find((x) => x.sku === 'ACNE-NIGHT-CREAM')?.price, 45103);
});
