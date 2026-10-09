import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sapKey, phaseOutKey, pencocokPhaseOut, DISPOSITION_LABEL } from './phase-out';

const cocok = (rows: { matchType: string; matchValue: string; tanda: string }[]) =>
  pencocokPhaseOut(rows, (r) => r.tanda);

test('sapKey: 6 digit terakhir, pemisah dibuang, terlalu pendek = null', () => {
  assert.equal(sapKey('1222-010203'), '010203');
  assert.equal(sapKey('1201 010203'), '010203', 'dua kode berbeda prefiks punya kunci sama');
  assert.equal(sapKey('123'), null);
  assert.equal(sapKey(''), null);
  assert.equal(sapKey(null), null);
  assert.equal(sapKey(undefined), null);
});

test('baris SKU menang atas baris SAP', () => {
  // Baris SKU lebih khusus: satu baris SAP bisa mengenai beberapa SKU.
  const c = cocok([
    { matchType: 'SKU', matchValue: 'ACNE-SERUM', tanda: 'dari-sku' },
    { matchType: 'SAP', matchValue: '010203', tanda: 'dari-sap' },
  ]);
  assert.equal(c('ACNE-SERUM', '1222-010203'), 'dari-sku');
});

test('tanpa baris SKU, dicocokkan lewat 6 digit terakhir kode SAP', () => {
  const c = cocok([{ matchType: 'SAP', matchValue: '010203', tanda: 'dari-sap' }]);
  assert.equal(c('APA-SAJA', '1201010203'), 'dari-sap');
  assert.equal(c('APA-SAJA', '1222010203'), 'dari-sap', 'prefiks berbeda, kunci sama');
});

test('sapCode kosong/pendek TIDAK pernah cocok dengan entri bernilai kosong', () => {
  // Penjaga nyata: `sapKey` mengembalikan null, dan null tidak boleh berubah
  // jadi pencarian kunci '' yang kebetulan ada isinya.
  const c = cocok([
    { matchType: 'SAP', matchValue: '', tanda: 'JANGAN-KENA' },
    { matchType: 'SAP', matchValue: '010203', tanda: 'benar' },
  ]);
  assert.equal(c('X', null), null);
  assert.equal(c('X', ''), null);
  assert.equal(c('X', '12'), null);
});

test('SKU yang tidak terdaftar menjawab null, bukan undefined', () => {
  const c = cocok([{ matchType: 'SAP', matchValue: '010203', tanda: 'x' }]);
  assert.equal(c('BUKAN-PHASE-OUT', '1222-999999'), null);
});

test('matchType asing diabaikan, tidak melempar', () => {
  const c = cocok([{ matchType: 'ENTAH', matchValue: 'X', tanda: 'x' }]);
  assert.equal(c('X', '1222-010203'), null);
});

test('phaseOutKey berprefiks supaya SAP dan SKU tidak bertabrakan', () => {
  assert.equal(phaseOutKey('SAP', '010203'), 'SAP:010203');
  assert.equal(phaseOutKey('SKU', '010203'), 'SKU:010203');
  assert.notEqual(phaseOutKey('SAP', 'X'), phaseOutKey('SKU', 'X'));
});

test('setiap disposisi punya labelnya', () => {
  for (const d of ['SELL_DOWN', 'RETURN_VENDOR', 'WRITE_OFF', 'BUNDLING'] as const) {
    assert.ok(DISPOSITION_LABEL[d], `${d} tanpa label`);
  }
});

/**
 * Penjaga: aturan pencocokan phase out hanya boleh ada DI SATU TEMPAT.
 *
 * Sebelum 9 Okt 2026 aturan ini hanya hidup di `compute.ts`. Ketika halaman
 * ATP ikut menampilkan phase out, menyalinnya berarti dua tempat yang bisa
 * berbeda diam-diam — dan gejalanya cuma "kenapa SKU ini phase out di satu
 * layar tapi tidak di layar lain", tanpa galat apa pun.
 */
test('compute.ts dan atp-store.ts memakai pencocokPhaseOut, bukan salinannya', () => {
  for (const f of [join('src', 'lib', 'compute.ts'), join('src', 'lib', 'atp-store.ts')]) {
    const kode = readFileSync(f, 'utf8');
    assert.match(kode, /pencocokPhaseOut/, `${f} tidak memakai pencocokPhaseOut`);
    assert.doesNotMatch(
      kode,
      /matchType === 'SAP'|matchType === 'SKU'/,
      `${f} menyalin aturan pencocokan phase out — pakai pencocokPhaseOut()`,
    );
  }
});
