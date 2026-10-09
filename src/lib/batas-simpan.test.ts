import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Penjaga: potongan yang DIKIRIM halaman tidak boleh lebih besar dari batas
 * yang DITERIMA server.
 *
 * Kejadian 9 Okt 2026: batas server 5.000 keputusan dipasang saat ATP hanya
 * menghitung kategori 'Sku' — "375 SKU x 6 cabang = 2.250, dipasang di atas
 * kebutuhan nyata". Begitu Bundle & Gimmick ikut (8 Okt), "Semua disebar" di
 * "Semua cabang" jadi 8.320 keputusan dan langsung ditolak — sesudah user
 * menekan konfirmasi dan menunggu.
 *
 * Dua angka ini sekarang hidup di dua berkas berbeda: `KELOMPOK_SIMPAN` di
 * halaman dan `MAKS` di route. Keduanya tidak akan pernah diubah bersamaan
 * oleh orang yang sama, dan kalau potongan melampaui batas, gejalanya cuma
 * satu pesan galat di tengah penyimpanan panjang. Jadi hubungannya dikunci di
 * sini, bukan diingat.
 */

const angka = (teks: string, pola: RegExp, nama: string): number => {
  const m = pola.exec(teks);
  assert.ok(m, `${nama} tidak ditemukan — apakah namanya diubah?`);
  return Number(m![1]);
};

test('potongan simpan halaman <= batas per permintaan di server', () => {
  const halaman = readFileSync(join('src', 'app', 'atp', 'page.tsx'), 'utf8');
  const route = readFileSync(join('src', 'app', 'api', 'atp', 'route.ts'), 'utf8');

  const kelompok = angka(halaman, /const KELOMPOK_SIMPAN = (\d+)/, 'KELOMPOK_SIMPAN');
  const maks = angka(route, /const MAKS = (\d+)/, 'MAKS');

  assert.ok(
    kelompok <= maks,
    `Halaman mengirim ${kelompok} keputusan per permintaan, server hanya menerima ${maks}. `
    + 'Penyimpanan akan ditolak di tengah jalan.',
  );
  assert.ok(kelompok > 0, 'KELOMPOK_SIMPAN harus lebih dari 0');
});

test('halaman memang memecah, bukan mengirim sekaligus', () => {
  // Kalau suatu hari pemecahannya dihapus, batas server akan menggigit lagi
  // pada data yang sudah 13.645 keputusan.
  const halaman = readFileSync(join('src', 'app', 'atp', 'page.tsx'), 'utf8');
  assert.match(halaman, /for \(let i = 0; i < semua\.length; i \+= KELOMPOK_SIMPAN\)/,
    'perulangan pemecah hilang dari simpan()');
  assert.match(halaman, /ringkas=1/,
    'potongan di tengah harus memakai ringkas=1 supaya tidak menarik ulang seluruh matriks');
});

test('server mengenali ringkas=1', () => {
  const route = readFileSync(join('src', 'app', 'api', 'atp', 'route.ts'), 'utf8');
  assert.match(route, /searchParams\.get\('ringkas'\) === '1'/,
    'route tidak lagi melayani ringkas=1 — halaman akan menarik ratusan KB per potongan');
});
