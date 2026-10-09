import test from 'node:test';
import assert from 'node:assert/strict';
import {
  susunRekap, rekapPerArea, rekapTotal, terjualTanpaStok,
  type BarisStokHarian, type BarisJualHarian,
} from './rekap';

const st = (sku: string, areaId: string, qty: number): BarisStokHarian =>
  ({ sku, areaId, availableQty: qty, qtyOnHand: qty, qtyOnOrder: 0 });

const jl = (sku: string, areaId: string, qty: number, o: Partial<BarisJualHarian> = {}): BarisJualHarian =>
  ({ sku, areaId, qty, qtyCancel: 0, qtyShopee: qty, qtyTiktok: 0, qtyTokped: 0, qtyLazada: 0, qtyOther: 0, ...o });

test('gabungan luar DUA arah: yang hanya ada di penjualan tidak hilang', () => {
  // Justru baris inilah yang paling ingin dilihat: terjual padahal potret
  // stoknya sudah tidak memuat SKU-nya.
  const h = susunRekap([st('A', 'Pusat', 10)], [jl('B', 'Pusat', 3)]);
  assert.deepEqual(h.map((r) => r.sku), ['B', 'A'], 'diurutkan terjual terbanyak dulu');
  assert.equal(h[0].stok, null, 'tidak ada barisnya di potret → null, bukan 0');
  assert.equal(h[1].terjual, 0, 'ada stok tapi tidak terjual → 0, bukan hilang');
});

test('stok null DIBEDAKAN dari stok 0', () => {
  const h = susunRekap([st('A', 'Pusat', 0)], [jl('B', 'Pusat', 1)]);
  const a = h.find((r) => r.sku === 'A')!;
  const b = h.find((r) => r.sku === 'B')!;
  assert.equal(a.stok, 0, 'tercatat kosong');
  assert.equal(b.stok, null, 'tidak diketahui');
});

test('nama diambil dari peta, dan baris tanpa nama tidak jadi "undefined"', () => {
  const h = susunRekap([st('A', 'Pusat', 1)], [], new Map([['A', 'Serum 20ml']]));
  assert.equal(h[0].name, 'Serum 20ml');
  assert.equal(susunRekap([st('X', 'Pusat', 1)], [])[0].name, '');
});

test('rekap per area: stok kosong dan SKU terjual dihitung terpisah', () => {
  const baris = susunRekap(
    [st('A', 'Pusat', 0), st('B', 'Pusat', 50), st('A', 'Medan', 7)],
    [jl('A', 'Pusat', 4), jl('A', 'Medan', 0)],
  );
  const per = rekapPerArea(baris);
  const pusat = per.find((p) => p.areaId === 'Pusat')!;
  assert.equal(pusat.skuStok, 2);
  assert.equal(pusat.stok, 50);
  assert.equal(pusat.stokKosong, 1, 'A tercatat 0 di Pusat');
  assert.equal(pusat.skuJual, 1, 'qty 0 tidak dihitung sebagai terjual');
  assert.equal(pusat.terjual, 4);
});

test('KESELURUHAN menghitung SKU UNIK, bukan menjumlahkan kolom per area', () => {
  // Satu SKU di lima cabang bukan lima SKU. Kesalahan ini tidak pernah
  // terlihat salah secara aritmetika, cuma angkanya jadi 5x.
  const baris = susunRekap(
    [st('A', 'Pusat', 1), st('A', 'Medan', 1), st('A', 'Surabaya', 1)],
    [jl('A', 'Pusat', 2), jl('A', 'Medan', 3)],
  );
  const t = rekapTotal(baris);
  assert.equal(t.skuStok, 1, 'tiga baris, satu SKU');
  assert.equal(t.skuJual, 1);
  assert.equal(t.stok, 3, 'tapi qty-nya memang dijumlahkan');
  assert.equal(t.terjual, 5);
  // Jumlah kolom per area akan memberi 3 — itu angka yang salah arti.
  assert.notEqual(t.skuStok, rekapPerArea(baris).reduce((x, p) => x + p.skuStok, 0));
});

test('pecahan platform dijumlahkan apa adanya, tidak dihitung ulang dari total', () => {
  const baris = susunRekap([], [jl('A', 'Pusat', 10, {
    qtyShopee: 4, qtyTiktok: 3, qtyTokped: 2, qtyLazada: 1, qtyOther: 0, qtyCancel: 5,
  })]);
  const t = rekapTotal(baris);
  assert.equal(t.terjual, 10);
  assert.equal(t.shopee + t.tiktok + t.tokped + t.lazada + t.lain, 10);
  assert.equal(t.batal, 5, 'qty batal disimpan terpisah, tidak masuk terjual');
});

test('terjualTanpaStok menangkap stok 0 MAUPUN stok tidak diketahui', () => {
  const baris = susunRekap(
    [st('ADA', 'Pusat', 100), st('KOSONG', 'Pusat', 0)],
    [jl('ADA', 'Pusat', 5), jl('KOSONG', 'Pusat', 2), jl('HILANG', 'Pusat', 1)],
  );
  assert.deepEqual(
    terjualTanpaStok(baris).map((r) => r.sku).sort(),
    ['HILANG', 'KOSONG'],
  );
});
