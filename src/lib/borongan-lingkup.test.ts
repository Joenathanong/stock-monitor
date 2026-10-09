import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Penjaga: tombol borongan /atp memakai hasil saringan TABEL, bukan hanya
 * filter halaman.
 *
 * Kejadian 9 Okt 2026: user menyaring kolom di dalam tabel (mis. "Stok Pusat
 * < 5"), menekan "Semua tidak", dan yang berubah jauh lebih banyak daripada
 * yang terlihat — karena `borongan()` memakai `baris` (hanya filter halaman:
 * brand, kategori, pencarian, status). Pencarian global dan filter per kolom
 * dikerjakan DI DALAM DataGrid, dan halaman tidak tahu hasilnya.
 *
 * Perbaikannya: DataGrid mengabarkan hasil saringannya lewat `onTersaring`,
 * halaman menampungnya di `tampil`, dan `borongan()` memakai itu.
 *
 * Tes ini menjaga rantai tersebut tetap tersambung. Kalau salah satu mata
 * rantainya putus, gejalanya BUKAN galat — melainkan ribuan keputusan berubah
 * diam-diam, dan baru ketahuan setelah tersimpan.
 */

const halaman = () => readFileSync(join('src', 'app', 'atp', 'page.tsx'), 'utf8');
const grid = () => readFileSync(join('src', 'components', 'DataGrid.tsx'), 'utf8');

test('DataGrid mengabarkan SELURUH baris tersaring, bukan halaman yang tampak', () => {
  const k = grid();
  assert.match(k, /onTersaring\?:\s*\(rows: T\[\]\) => void/, 'prop onTersaring hilang');
  assert.match(
    k,
    /useEffect\(\(\) => \{ onTersaring\?\.\(processed\); \}/,
    'onTersaring harus dipanggil dengan `processed` (semua yang lolos), bukan `pageRows`',
  );
  assert.doesNotMatch(k, /onTersaring\?\.\(pageRows\)/, 'pageRows cuma satu halaman — bukan lingkup borongan');
});

test('halaman /atp menyambungkan onTersaring ke penampungnya', () => {
  assert.match(halaman(), /onTersaring=\{setTampil\}/, 'DataGrid di /atp tidak lagi mengirim hasil saringannya');
});

test('borongan() memakai lingkup hasil saringan tabel, bukan `baris`', () => {
  const k = halaman();
  assert.match(k, /lingkupBorongan\(lingkup, areaKena\)/,
    'borongan() kembali memakai `baris` — filter kolom di tabel akan terabaikan lagi');
  assert.match(k, /const lingkup = tampil\.length/, 'penentuan lingkup hilang');
});
