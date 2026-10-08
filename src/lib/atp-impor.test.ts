import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bacaSel, susunImpor } from './atp-impor';

const AREAS = ['Medan', 'Pusat'];
const DIKENAL = new Set(['A', 'B', 'C']);
const kunci = (sku: string, a: string) => `${a}\u0000${sku}`;

test('ejaan sel longgar, tapi yang tidak dikenali TIDAK dianggap kosong', () => {
  for (const v of ['Ya', 'ya', ' YA ', 'y', '1', 'x', 'ok', 'disebar']) assert.equal(bacaSel(v), 'YA', String(v));
  for (const v of ['Tidak', 'tdk', 'no', '0', '-']) assert.equal(bacaSel(v), 'TIDAK', String(v));
  for (const v of ['', '   ', null, undefined]) assert.equal(bacaSel(v), 'KOSONG', String(v));
  // Inilah yang penting: sel berisi catatan orang harus DILAPORKAN, bukan
  // diperlakukan sebagai kosong dan menghapus keputusan yang ada.
  for (const v of ['mungkin', 'cek dulu', '??']) assert.equal(bacaSel(v), 'ASING', String(v));
});

test('hanya yang BERBEDA dari keadaan sekarang yang ditulis', () => {
  // Mengunggah berkas yang baru diunduh tanpa diedit tidak boleh terlihat
  // seperti perubahan besar.
  const sekarang = new Map([[kunci('A', 'Medan'), true], [kunci('A', 'Pusat'), false]]);
  const h = susunImpor(
    [{ sku: 'A', medan: 'Ya', pusat: 'Tidak' }], AREAS, DIKENAL, sekarang,
  );
  assert.deepEqual(h.putusan, []);
  assert.equal(h.ringkas.takBerubah, 2);
});

test('sel kosong MENGOSONGKAN keputusan — dan itu dihitung terpisah', () => {
  const sekarang = new Map([[kunci('A', 'Medan'), true], [kunci('A', 'Pusat'), true]]);
  const h = susunImpor([{ sku: 'A', medan: '', pusat: 'Ya' }], AREAS, DIKENAL, sekarang);
  assert.deepEqual(h.putusan, [{ sku: 'A', areaId: 'Medan', dibagikan: null }]);
  assert.equal(h.ringkas.dikosongkan, 1);
  assert.equal(h.ringkas.takBerubah, 1);
});

test('abaikanKosong melindungi berkas yang sengaja diisi sebagian', () => {
  // Tanpa mode ini, mengunggah berkas berisi 3 baris akan menghapus keputusan
  // semua baris lain yang kebetulan ikut terbawa kosong.
  const sekarang = new Map([[kunci('A', 'Medan'), true], [kunci('A', 'Pusat'), true]]);
  const h = susunImpor(
    [{ sku: 'A', medan: '', pusat: 'Tidak' }], AREAS, DIKENAL, sekarang,
    { abaikanKosong: true },
  );
  assert.deepEqual(h.putusan, [{ sku: 'A', areaId: 'Pusat', dibagikan: false }]);
  assert.equal(h.ringkas.dikosongkan, 0, 'sel kosong tidak boleh menghapus apa pun di mode ini');
});

test('SKU asing dan isi asing DILAPORKAN, bukan ditelan', () => {
  const h = susunImpor(
    [
      { sku: 'ZZZ', medan: 'Ya' },
      { sku: 'B', medan: 'mungkin', pusat: 'Ya' },
    ],
    AREAS, DIKENAL, new Map(),
  );
  assert.equal(h.masalah.length, 2);
  assert.match(h.masalah[0].pesan, /tidak dikenal/);
  assert.equal(h.masalah[0].baris, 2, 'nomor baris harus menunjuk baris yang user lihat di Excel');
  assert.match(h.masalah[1].pesan, /tidak dikenali/);
  assert.equal(h.masalah[1].areaId, 'Medan');
  // Yang sah di baris yang sama tetap diproses.
  assert.deepEqual(h.putusan, [{ sku: 'B', areaId: 'Pusat', dibagikan: true }]);
});

test('nomor baris mengikuti baris HEADER, bukan indeks data', () => {
  // Lembar unduhan punya baris catatan di atas header, jadi data pertama ada di
  // baris 5 (3 catatan + 1 header). Tanpa `barisPertama`, laporan menunjuk
  // baris 2 dan user memeriksa baris yang salah lalu menyimpulkan laporannya
  // ngawur. Kena di uji bolak-balik nyata 8 Okt 2026.
  const h = susunImpor(
    [{ sku: 'A', medan: 'Ya' }, { sku: 'ZZZ', medan: 'Ya' }],
    AREAS, DIKENAL, new Map(), { barisPertama: 5 },
  );
  assert.equal(h.masalah[0].baris, 6, 'baris data ke-2 dengan header di baris 4 = baris 6');

  // Tanpa opsi: perilaku lama (header baris 1).
  const h2 = susunImpor([{ sku: 'ZZZ', medan: 'Ya' }], AREAS, DIKENAL, new Map());
  assert.equal(h2.masalah[0].baris, 2);
});

test('kolom yang bukan area diabaikan tapi disebut namanya', () => {
  const h = susunImpor(
    [{ sku: 'A', medan: 'Ya', bali: 'Ya', catatanku: 'abc' }], AREAS, DIKENAL, new Map(),
  );
  assert.deepEqual(h.kolomAsing, ['bali', 'catatanku']);
  assert.deepEqual(h.putusan, [{ sku: 'A', areaId: 'Medan', dibagikan: true }]);
});

test('kolom bawaan unduhan tidak dikira area', () => {
  // Lembar "Sebaran" memuat Nama, Brand, Kategori di samping SKU.
  const h = susunImpor(
    [{ sku: 'A', nama: 'Serum', brand: 'Hanasui', kategori: 'Sku', medan: 'Ya' }],
    AREAS, DIKENAL, new Map(),
  );
  assert.deepEqual(h.kolomAsing, []);
  assert.equal(h.putusan.length, 1);
});

test('nama area dicocokkan tanpa peduli spasi dan besar-kecil huruf', () => {
  const h = susunImpor([{ sku: 'A', 'yogyakarta': 'Ya' }], ['Yogyakarta'], DIKENAL, new Map());
  assert.deepEqual(h.putusan, [{ sku: 'A', areaId: 'Yogyakarta', dibagikan: true }]);
});
