import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtRp, fmtRpShort, windowLabel } from './labels';

test('fmtRp menulis rupiah utuh dengan pemisah ribuan', () => {
  assert.equal(fmtRp(47091), 'Rp 47.091');
  assert.equal(fmtRp(1000000), 'Rp 1.000.000');
});

test('fmtRp: nol / kosong berarti TIDAK DIKETAHUI, bukan gratis', () => {
  assert.equal(fmtRp(0), '—');
  assert.equal(fmtRp(null), '—');
  assert.equal(fmtRp(undefined), '—');
  assert.equal(fmtRp(NaN), '—');
});

test('fmtRpShort memakai satuan Indonesia', () => {
  assert.equal(fmtRpShort(16_400_000_000), 'Rp 16,4 M');
  assert.equal(fmtRpShort(303_900_000), 'Rp 303,9 jt');
  assert.equal(fmtRpShort(9_560_000_000), 'Rp 9,56 M');
  assert.equal(fmtRpShort(1_200_000_000_000), 'Rp 1,2 T');
  assert.equal(fmtRpShort(45_000), 'Rp 45 rb');
  assert.equal(fmtRpShort(700), 'Rp 700');
});

test('fmtRpShort menangani angka negatif', () => {
  assert.equal(fmtRpShort(-303_900_000), '-Rp 303,9 jt');
});

test('windowLabel masih berperilaku sama', () => {
  assert.equal(windowLabel(90), '3 bln');
  assert.equal(windowLabel(45), '45 hari');
});
