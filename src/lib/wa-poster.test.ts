import { test } from 'node:test';
import assert from 'node:assert/strict';
import { angkaRingkas, deretTren, jalurSpark, labelDoi, lebarKartu, rupiahRingkas, segmenStatus, tampil1, tampil2 } from './wa-poster';

test('rupiah diringkas per satuan', () => {
  assert.equal(rupiahRingkas(52_431_882_100), 'Rp 52,4 M');
  assert.equal(rupiahRingkas(1_400_000_000), 'Rp 1,4 M');
  assert.equal(rupiahRingkas(4_200_000), 'Rp 4,2 jt');
  assert.equal(rupiahRingkas(0), 'Rp 0');
  // >= 100 satuan: desimalnya dibuang supaya tidak jadi "Rp 120,4 M" yang panjang
  assert.equal(rupiahRingkas(120_400_000_000), 'Rp 120 M');
});

test('angka besar diringkas', () => {
  assert.equal(angkaRingkas(1_380_422), '1,4 jt');
  assert.equal(angkaRingkas(104_804), '105 rb');
  assert.equal(angkaRingkas(346), '346');
});

test('status di luar empat inti dilipat jadi Lain', () => {
  const seg = segmenStatus({ CRITICAL: 12, LOW: 28, HEALTHY: 180, OVERSTOCK: 61, NPL_WAIT: 14, DEAD_STOCK: 21 });
  assert.deepEqual(seg.map((s) => s.key), ['CRITICAL', 'LOW', 'HEALTHY', 'OVERSTOCK', 'LAIN']);
  assert.equal(seg[4].n, 35);
});

test('tanpa status lain, segmennya tetap empat', () => {
  const seg = segmenStatus({ CRITICAL: 1, LOW: 2, HEALTHY: 3, OVERSTOCK: 4 });
  assert.equal(seg.length, 4);
});

test('byStatus kosong tidak melempar', () => {
  assert.equal(segmenStatus(null).length, 4);
  assert.equal(segmenStatus(null).every((s) => s.n === 0), true);
});

test('sparkline memutus garis di titik kosong, tidak menyambung lurus', () => {
  const { d } = jalurSpark([10, null, 30, 40], 100, 20);
  // Dua 'M' = dua potongan; kalau disambung hanya ada satu.
  assert.equal((d.match(/M/g) ?? []).length, 2);
});

test('sparkline butuh minimal dua titik', () => {
  assert.equal(jalurSpark([5], 100, 20).d, '');
  assert.equal(jalurSpark([null, null], 100, 20).d, '');
});

test('nilai datar tidak membagi nol', () => {
  const { d, titikAkhir } = jalurSpark([7, 7, 7], 100, 20);
  assert.ok(d.length > 0);
  assert.ok(titikAkhir && Number.isFinite(titikAkhir.y));
});

test('lima kartu pas di dalam margin poster', () => {
  const w = lebarKartu(5);
  assert.equal(32 + 5 * w + 4 * 16 + 32, 1600);
});

test('setelan doi_display menentukan opsi mana yang digambar', () => {
  assert.equal(tampil1('OPSI1'), true);
  assert.equal(tampil2('OPSI1'), false);
  assert.equal(tampil1('OPSI2'), false);
  assert.equal(tampil2('OPSI2'), true);
  assert.equal(tampil1('BOTH'), true);
  assert.equal(tampil2('BOTH'), true);
  // Tanpa setelan (data lama) jangan menyembunyikan apa pun.
  assert.equal(tampil1(undefined), true);
  assert.equal(tampil2(undefined), true);
});

test('nomor opsi hilang dari label saat cuma satu yang tampil', () => {
  assert.equal(labelDoi(1, 'BOTH'), 'DOI OPSI 1');
  assert.equal(labelDoi(2, 'BOTH'), 'DOI OPSI 2');
  assert.equal(labelDoi(1, 'OPSI1'), 'DOI');
  assert.equal(labelDoi(2, 'OPSI2'), 'DOI');
});

test('sparkline memakai deret opsi yang ditampilkan, bukan selalu opsi 1', () => {
  const tren = [{ doi1: 10, doi2: 20 }, { doi1: 11, doi2: 21 }];
  assert.deepEqual(deretTren(tren, 'OPSI1'), [10, 11]);
  assert.deepEqual(deretTren(tren, 'OPSI2'), [20, 21]);
  assert.deepEqual(deretTren(tren, 'BOTH'), [10, 11]);
});
