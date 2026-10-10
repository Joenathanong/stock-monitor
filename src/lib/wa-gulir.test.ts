import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Penjaga: /wa HARUS BISA DIGULIR, DAN MODE BOT HARUS TETAP TIDAK BISA.
 *
 * KEJADIAN NYATA 10 Okt 2026. User: "buat agar tampilan /wa bisa di scroll
 * page nya". Sebabnya dua aturan yang masing-masing benar tapi bertabrakan:
 *
 *   html, body { overflow: hidden }     // supaya hanya satu scroller per layar
 *   .wa-root   { min-height: 100dvh }   // tumbuh mengikuti isi
 *
 * Dengan `min-height`, kotak .wa-root ikut membesar sebesar isinya, jadi ia
 * TIDAK PERNAH MELUAP — dan karena html/body dikunci, tidak ada satu pun elemen
 * di halaman itu yang punya overflow. Poster 16:10 di layar 1366×768 tingginya
 * ~854px: tombol "Unduh JPG" dan kaki poster berada di bawah lipatan dan tidak
 * bisa dijangkau dengan cara apa pun. Tidak ada error, tidak ada scrollbar —
 * halamannya cuma terpotong, dan itu sebabnya lama tidak ketahuan.
 *
 * Pola yang benar sudah ada dua kali di berkas yang sama (.app-main dan
 * .pub-main, keduanya berkomentar "harus jadi scroller-nya sendiri"). Jadi yang
 * dikunci di sini adalah: .wa-root memakai tinggi PASTI + overflow-y: auto.
 *
 * Sisi sebaliknya sama berbahayanya. `?bare=1` adalah mode yang dipotret bot
 * WhatsApp. Kalau .wa-root.is-bare ikut jadi scroller dan viewport bot lebih
 * pendek daripada 1000px, kaki poster terpotong DI GAMBAR YANG DIKIRIM ke grup
 * — tanpa gejala di sisi aplikasi. Jadi is-bare wajib height:auto + overflow
 * yang tidak memotong.
 */

const css = readFileSync(join('src', 'app', 'globals.css'), 'utf8');

/** Ambil isi satu blok aturan CSS berdasarkan selectornya yang persis. */
function blok(selector: string): string {
  const i = css.indexOf(`\n${selector} {`);
  assert.notEqual(i, -1, `Blok CSS "${selector}" tidak ditemukan di globals.css`);
  const buka = css.indexOf('{', i);
  const tutup = css.indexOf('}', buka);
  assert.notEqual(tutup, -1, `Blok CSS "${selector}" tidak ditutup`);
  return css.slice(buka + 1, tutup);
}

test('html/body memang dikunci — itu premis tes ini', () => {
  // Kalau suatu hari kuncinya dilepas, tes di bawah jadi tidak relevan dan
  // harus ditinjau ulang, bukan dibiarkan lulus karena kebetulan.
  assert.match(
    blok('html, body'),
    /overflow:\s*hidden/,
    'html/body tidak lagi overflow:hidden. Tinjau ulang siapa scroller di /wa.',
  );
});

test('.wa-root memakai tinggi pasti, bukan hanya min-height', () => {
  const b = blok('.wa-root');
  assert.match(
    b,
    /(^|[;{\s])height:\s*100dvh/,
    '.wa-root harus punya `height: 100dvh` (tinggi PASTI). Dengan min-height saja '
    + 'kotaknya tumbuh mengikuti isi dan tidak pernah meluap, jadi tidak ada yang bisa digulir.',
  );
});

test('.wa-root adalah scroller-nya sendiri', () => {
  const b = blok('.wa-root');
  assert.match(
    b,
    /overflow-y:\s*auto/,
    '.wa-root harus `overflow-y: auto`. html/body dikunci overflow:hidden, jadi '
    + 'kalau /wa tidak jadi scroller sendiri, isi di bawah lipatan tidak bisa dijangkau.',
  );
});

test('item di dalam .wa-root tidak boleh diperas agar pas', () => {
  // .wa-root adalah flex column. Item flex boleh menyusut (flex-shrink: 1),
  // jadi di viewport pendek poster bisa diperas alih-alih digulir.
  for (const sel of ['.wa-canvas', '.wa-bar']) {
    assert.match(
      blok(sel),
      /flex:\s*none/,
      `${sel} harus \`flex: none\` — tanpa itu ia menyusut agar pas di .wa-root `
      + 'yang tingginya pasti, bukan membuat halaman meluap dan bisa digulir.',
    );
  }
});

test('mode bot (?bare=1) tidak jadi scroller dan tingginya mengikuti isi', () => {
  const b = blok('.wa-root.is-bare');
  assert.match(
    b,
    /(^|[;{\s])height:\s*auto/,
    '.wa-root.is-bare harus `height: auto` supaya tingginya mengikuti poster. '
    + 'Kalau ia mewarisi height:100dvh dari .wa-root, ukuran gambar jadi ditentukan '
    + 'viewport bot, bukan KANVAS di wa-poster.ts.',
  );
  assert.match(
    b,
    /overflow:\s*visible/,
    '.wa-root.is-bare harus `overflow: visible`. Mewarisi overflow-y:auto berarti '
    + 'kaki poster terpotong di gambar yang dikirim ke grup kalau viewport bot < 1000px.',
  );
  assert.doesNotMatch(
    b,
    /overflow(-y)?:\s*(auto|scroll|hidden)/,
    '.wa-root.is-bare tidak boleh memotong atau menggulir isinya.',
  );
});
