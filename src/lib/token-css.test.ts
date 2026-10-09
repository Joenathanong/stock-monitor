import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Penjaga: TIDAK ADA `var(--nama)` yang menunjuk token yang tidak pernah
 * didefinisikan.
 *
 * KEJADIAN NYATA 9 Okt 2026. Popup "SKU belum diatur" di /atp dilaporkan user
 * **tembus pandang**. Sebabnya satu nama token yang salah:
 *
 *   style={{ background: 'var(--surface)' }}      // yang benar: --bg-surface
 *
 * Yang membuatnya berbahaya bukan sekadar "warnanya tidak muncul". Nilai
 * custom property yang tidak terdefinisi TIDAK diabaikan oleh browser: ia jadi
 * invalid at computed-value time, yang artinya `unset` — dan untuk
 * `background-color` itu berarti **transparent**. Jadi deklarasi itu bukan
 * gagal diam-diam, ia MEMBATALKAN latar yang sudah benar dari kelas `.card`.
 * Hasilnya elemen yang kelihatan "sengaja" transparan, bukan rusak, sehingga
 * tidak ada yang mencurigainya saat dibaca ulang.
 *
 * Nama token di aplikasi ini mudah tertukar karena memang mirip:
 * `--bg-surface` / `--bg-surface-alt` / `--border` / `--border-subtle`.
 * Dan satu lagi yang ikut ketemu lewat tes ini: `--line` dipakai di 6 tempat
 * padahal tidak pernah ada — border-nya selama ini dirender sebagai
 * `currentColor`, jadi warnanya ikut warna teks tanpa ada yang sadar.
 *
 * `var(--nama, fallback)` DIKECUALIKAN dengan sengaja: menulis cadangan berarti
 * penulisnya memang tahu tokennya bisa tidak ada.
 */

function berkas(dir: string, hasil: string[] = []): string[] {
  for (const nama of readdirSync(dir)) {
    if (nama === 'node_modules' || nama === '.next') continue;
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) berkas(p, hasil);
    else if (/\.(ts|tsx|css)$/.test(nama)) hasil.push(p);
  }
  return hasil;
}

/** Berkas yang hanya MEMBICARAKAN token di komentar, bukan memakainya. */
const KOMENTAR_SAJA = [/wa-poster\.ts$/, /token-css\.test\.ts$/];

test('setiap var(--token) yang dipakai benar-benar didefinisikan', () => {
  const semua = berkas('src');

  // Definisi dikumpulkan dari SELURUH src, bukan cuma globals.css: sebagian
  // token dipasang lewat style inline (mis. lebar kolom DataGrid).
  const ada = new Set<string>();
  for (const f of semua) {
    for (const m of readFileSync(f, 'utf8').matchAll(/--([A-Za-z0-9_-]+)\s*:/g)) ada.add(m[1]);
  }

  const dipakai = new Map<string, Set<string>>();
  for (const f of semua) {
    if (KOMENTAR_SAJA.some((re) => re.test(f))) continue;
    for (const m of readFileSync(f, 'utf8').matchAll(/var\(\s*--([A-Za-z0-9_-]+)\s*([,)])/g)) {
      if (m[2] === ',') continue;                 // ada fallback — disengaja
      if (!dipakai.has(m[1])) dipakai.set(m[1], new Set());
      dipakai.get(m[1])!.add(f);
    }
  }

  const hilang = [...dipakai.entries()]
    .filter(([nama]) => !ada.has(nama))
    .map(([nama, f]) => `--${nama} dipakai di ${[...f].sort().join(', ')}`);

  assert.deepEqual(
    hilang,
    [],
    'Token CSS tidak terdefinisi — nilainya jadi `unset`, dan untuk background '
    + 'itu berarti TRANSPARAN (bukan diabaikan). Periksa ejaannya di '
    + 'src/app/globals.css:\n' + hilang.join('\n'),
  );
});

test('token yang paling sering tertukar memang ada ejaannya', () => {
  // Kalau suatu hari salah satu di-rename, tes di atas hanya akan gagal untuk
  // berkas yang memakainya. Daftar ini membuat rename-nya sendiri terlihat.
  const css = readFileSync(join('src', 'app', 'globals.css'), 'utf8');
  for (const t of ['--bg-surface', '--bg-surface-alt', '--bg-canvas', '--border', '--border-subtle', '--overlay', '--z-modal']) {
    assert.ok(new RegExp(`${t}\\s*:`).test(css), `${t} tidak lagi didefinisikan di globals.css`);
  }
});
