import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Penjaga: TIDAK ADA nilai rahasia yang ditulis langsung di dalam kode.
 *
 * Nyaris kejadian 8 Okt 2026. User meminta poster WhatsApp dimasukkan ke menu
 * sidebar, dan menempelkan URL lengkapnya — berikut `?k=<WA_PAGE_TOKEN>`.
 * Menuliskan URL itu apa adanya di `Shell.tsx` akan menyalin tokennya ke dalam
 * bundel JavaScript yang diunduh SETIAP pengguna, termasuk peran "Lihat saja",
 * dan siapa pun yang membuka source bisa membacanya lalu memakainya dari luar
 * tanpa login. Token yang ada di dalam bundel klien bukan token lagi.
 *
 * Jalan yang benar: `/api/public/wa` menerima token (untuk bot) ATAU sesi login
 * (untuk orang), jadi menu cukup menunjuk `/wa` tanpa parameter apa pun.
 *
 * Tes ini membaca sumbernya. Nama environment variable BOLEH disebut; yang
 * dilarang adalah NILAINYA.
 */

function berkas(dir: string, hasil: string[] = []): string[] {
  for (const nama of readdirSync(dir)) {
    if (nama === 'node_modules' || nama === '.next') continue;
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) berkas(p, hasil);
    else if (/\.(ts|tsx|js|jsx)$/.test(nama)) hasil.push(p);
  }
  return hasil;
}

/** `?k=` atau `&k=` diikuti nilai panjang — bentuk token yang ditulis mati. */
const TOKEN_DI_URL = /[?&]k=[A-Za-z0-9_-]{8,}/;

/** Rahasia lain yang bentuknya khas dan sering tidak sengaja tertempel. */
const POLA_RAHASIA: { nama: string; re: RegExp }[] = [
  { nama: 'token di query string', re: TOKEN_DI_URL },
  { nama: 'URL database dengan sandi', re: /mysql:\/\/[^'"\s]*:[^'"\s@]+@/ },
  { nama: 'Bearer token tertulis mati', re: /Bearer\s+[A-Za-z0-9_-]{20,}/ },
];

test('tidak ada rahasia yang ditulis langsung di kode', () => {
  const pelanggaran: string[] = [];
  for (const f of [...berkas('src'), ...berkas('scripts')]) {
    // Berkas tes ini sendiri memuat polanya sebagai regex — dilewati.
    if (/rahasia\.test\.ts$/.test(f)) continue;
    const kode = readFileSync(f, 'utf8');
    for (const { nama, re } of POLA_RAHASIA) {
      const m = re.exec(kode);
      if (!m) continue;
      // `?k=${…}` dan `?k=' + …` adalah perakitan dari variabel, bukan nilai mati.
      if (/\$\{|'\s*\+|"\s*\+/.test(m[0])) continue;
      const baris = kode.slice(0, m.index).split('\n').length;
      pelanggaran.push(`${f}:${baris} — ${nama}: ${m[0].slice(0, 24)}…`);
    }
  }
  assert.deepEqual(
    pelanggaran,
    [],
    `\n${pelanggaran.join('\n')}\n\n`
      + 'Rahasia tidak boleh ditulis di kode — bundel klien bisa dibaca siapa saja.\n'
      + 'Untuk poster WhatsApp: tunjuk `/wa` tanpa parameter; sesi login sudah cukup.',
  );
});

test('penjaga ini benar-benar menangkap bentuk yang dilarang', () => {
  // Tanpa tes ini, regex yang salah akan lolos diam-diam dan penjaganya jadi
  // hiasan. Bentuk-bentuk ini HARUS tertangkap.
  for (const contoh of [
    "href: '/api/public/wa/svg?k=KitaEkaKitaJayaKitaEka'",
    'fetch("/api/public/wa?k=RahasiaPanjangSekali123")',
    "const u = 'https://x/a?b=1&k=TokenPanjangSekali12345'",
  ]) {
    assert.ok(TOKEN_DI_URL.test(contoh), `seharusnya tertangkap: ${contoh}`);
  }
  // Dan bentuk yang SAH tidak boleh ikut tertangkap.
  for (const contoh of [
    'fetch(`/api/public/wa?k=${encodeURIComponent(kunci)}`)',
    "searchParams.get('k')",
    "process.env.WA_PAGE_TOKEN",
    "'/api/public/wa'",
  ]) {
    const m = TOKEN_DI_URL.exec(contoh);
    const kena = !!m && !/\$\{|'\s*\+|"\s*\+/.test(m[0]);
    assert.equal(kena, false, `seharusnya LOLOS: ${contoh}`);
  }
});
