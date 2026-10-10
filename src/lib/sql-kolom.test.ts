import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Penjaga: SQL MENTAH TIDAK BOLEH MENYEBUT KOLOM YANG TIDAK ADA.
 *
 * KEJADIAN NYATA 10 Okt 2026, dilaporkan user: tombol "Lihat usulan dari 6
 * digit" menjawab `Unexpected end of JSON input`. Penyebabnya satu baris di
 * `sku-link-store.ts`:
 *
 *   SELECT sku, sapCode, name FROM sku_master
 *
 * `sku_master` tidak punya `sapCode` maupun `name` — isinya sku, leadTimeDays,
 * isExcluded, note. TiDB menolak dengan error 1054, lemparannya tidak
 * tertangkap, route membalas 500 berbadan kosong, dan layar gagal mengurai
 * badan kosong. Pesan yang sampai ke user sama sekali tidak menyebut kolom.
 *
 * Kenapa ini butuh penjaga sendiri: Prisma Client memeriksa nama kolom saat
 * kompilasi, tapi `$queryRawUnsafe` / `$executeRawUnsafe` adalah string biasa —
 * `tsc` dan `next build` dua-duanya lulus. Kesalahannya baru muncul saat
 * tombolnya ditekan, dan ini berkas ketiga yang kena pola "SQL mentah salah,
 * ketahuan di produksi" setelah kata cadangan (lihat sql-cadangan.test.ts).
 *
 * Cakupannya SENGAJA sempit: hanya SELECT satu tabel tanpa JOIN/subquery, dan
 * hanya identifier telanjang di daftar kolomnya. Penjaga yang mencoba mengerti
 * seluruh SQL akan penuh tuduhan palsu, lalu dilonggarkan, lalu tidak menjaga
 * apa pun.
 */

/** Kolom tiap tabel, dibaca dari schema.prisma. Tidak ada `@map` per medan di repo ini. */
function kolomPerTabel(): Map<string, Set<string>> {
  const skema = readFileSync(join('prisma', 'schema.prisma'), 'utf8');
  const out = new Map<string, Set<string>>();
  const model = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  let m: RegExpExecArray | null;
  while ((m = model.exec(skema))) {
    const isi = m[2];
    const tabel = /@@map\("([^"]+)"\)/.exec(isi)?.[1];
    if (!tabel) continue;
    const kolom = new Set<string>();
    for (const baris of isi.split('\n')) {
      const t = baris.trim();
      if (!t || t.startsWith('//') || t.startsWith('///') || t.startsWith('@@')) continue;
      const f = /^(\w+)\s+\w/.exec(t);
      if (f) kolom.add(f[1]);
    }
    out.set(tabel, kolom);
  }
  return out;
}

function berkas(dir: string, hasil: string[] = []): string[] {
  for (const nama of readdirSync(dir)) {
    if (nama === 'node_modules' || nama === '.next') continue;
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) berkas(p, hasil);
    else if (/\.(ts|tsx)$/.test(nama)) hasil.push(p);
  }
  return hasil;
}

/**
 * Kata kunci SQL yang kalau muncul di daftar kolom berarti PEMINDAINYA yang
 * salah baca, bukan kodenya. Statemennya dilewati, bukan dituduh.
 *
 * Tuduhan palsu adalah cara penjaga mati: satu saja, dan orang berikutnya akan
 * melonggarkan tesnya alih-alih memperbaiki kodenya.
 */
const TANDA_SALAH_BACA = /\b(AND|OR|WHERE|GROUP|ORDER|LIMIT|HAVING|UNION|INSERT|UPDATE|DELETE|VALUES|SET)\b/i;

/** Kata yang bukan nama kolom. */
// Kata kunci yang boleh muncul DI DALAM ekspresi kolom (mis. CASE WHEN ... END).
// Diabaikan satu per satu, bukan membuat seluruh statemen dilewati — supaya
// identifier lain di ekspresi yang sama TETAP diperiksa.
const BUKAN_KOLOM = new Set([
  'distinct', 'as', 'null', 'true', 'false',
  'case', 'when', 'then', 'else', 'end', 'is', 'not', 'in', 'like', 'between', 'interval', 'collate',
]);

/** Komentar dibuang dulu — komentar yang MENJELASKAN query lama bukan query. */
const tanpaKomentar = (kode: string) =>
  kode.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');

/**
 * Identifier kolom di daftar SELECT.
 *
 * `MAX(sapCode) AS sapCode` -> ambil `sapCode` (argumennya), buang aliasnya.
 * `COUNT(*)` -> tidak ada identifier. Backtick dilepas.
 */
function kolomDiSelect(daftar: string): string[] | null {
  // Nilai berkutip bukan kolom ("category = 'Sku'" pernah dituduh begitu).
  const bersihDaftar = daftar.replace(/'[^']*'/g, ' ').replace(/"[^"]*"/g, ' ');
  if (TANDA_SALAH_BACA.test(bersihDaftar)) return null;

  const out: string[] = [];
  for (let bagian of bersihDaftar.split(',')) {
    bagian = bagian.trim();
    if (!bagian || bagian === '*') continue;
    bagian = bagian.replace(/\s+AS\s+[`\w]+\s*$/i, '');   // alias hasil, bukan kolom
    bagian = bagian.replace(/\b[A-Za-z_]\w*\s*\(/g, '(');  // nama fungsi: MAX(, GROUP_CONCAT(
    bagian = bagian.replace(/\b[A-Za-z_]\w*\./g, '');      // awalan alias tabel: b.sku -> sku
    for (const id of bagian.match(/`?\b[A-Za-z_]\w*\b`?/g) ?? []) {
      const nama = id.replace(/`/g, '');
      if (BUKAN_KOLOM.has(nama.toLowerCase())) continue;
      out.push(nama);
    }
  }
  return out;
}

test('setiap kolom di SELECT satu-tabel benar-benar ada di schema.prisma', () => {
  const tabel = kolomPerTabel();
  assert.ok(tabel.size > 20, 'pembaca schema.prisma rusak — tidak menemukan tabel');
  assert.ok(tabel.get('sku_master')?.has('leadTimeDays'), 'pembaca schema.prisma rusak');
  assert.equal(tabel.get('sku_master')?.has('sapCode'), false, 'justru kolom inilah yang dulu salah dipakai');

  const pelanggaran: string[] = [];
  const pola = /SELECT\s+([\s\S]+?)\s+FROM\s+`?(\w+)`?([\s\S]{0,400}?)(?:['"`]|$)/gi;

  for (const f of [...berkas('src'), ...berkas('scripts')]) {
    if (/sql-kolom\.test\.ts$/.test(f)) continue;   // berkas ini memuat contohnya
    const kode = tanpaKomentar(readFileSync(f, 'utf8'));
    let m: RegExpExecArray | null;
    pola.lastIndex = 0;
    while ((m = pola.exec(kode))) {
      const [, daftar, namaTabel, ekor] = m;
      const kolom = tabel.get(namaTabel);
      if (!kolom) continue;                              // bukan tabel kita
      if (/\bJOIN\b|\bSELECT\b/i.test(`${daftar} ${ekor}`)) continue;   // di luar cakupan
      if (/\$\{/.test(daftar)) continue;                 // daftar kolom disusun di runtime
      const kolomnya = kolomDiSelect(daftar);
      if (!kolomnya) continue;                           // pemindai salah baca
      const baris = kode.slice(0, m.index).split('\n').length;
      for (const k of kolomnya) {
        if (!kolom.has(k)) pelanggaran.push(`${f}:${baris} — ${namaTabel} tidak punya kolom "${k}"`);
      }
    }
  }

  assert.deepEqual(
    pelanggaran, [],
    'SQL mentah menyebut kolom yang tidak ada di schema.prisma. `tsc` dan `next build` '
    + 'TIDAK memeriksa ini — kesalahannya baru muncul saat tombolnya ditekan, sebagai '
    + '500 berbadan kosong:\n' + pelanggaran.join('\n'),
  );
});

test('penjaga ini masih menangkap pelanggaran yang nyata', () => {
  // Tanpa tes ini, regex yang rusak akan lulus diam-diam dengan 0 pelanggaran —
  // penjaga yang tidak menjaga apa pun justru lebih berbahaya daripada tidak ada,
  // karena ia memberi rasa aman.
  const tabel = kolomPerTabel();
  const kolom = tabel.get('sku_master')!;
  const salah = (kolomDiSelect('sku, sapCode, name') ?? []).filter((k) => !kolom.has(k));
  assert.deepEqual(salah, ['sapCode', 'name'], 'pemindai harus menangkap query yang dulu gagal');

  const benar = (kolomDiSelect('sku, MAX(sapCode) AS sapCode, MAX(name) AS name') ?? [])
    .filter((k) => !tabel.get('stock_current')!.has(k));
  assert.deepEqual(benar, [], 'bentuk yang benar tidak boleh dituduh');

  // Bentuk yang dulu jadi tuduhan palsu — semuanya harus bersih sekarang.
  const sc = tabel.get('stock_current')!;
  assert.deepEqual((kolomDiSelect("sku, category") ?? []).filter((k) => !sc.has(k)), []);
  assert.deepEqual((kolomDiSelect('b.sku, b.areaId') ?? []).filter((k) => !sc.has(k)), [], 'awalan alias tabel');
  assert.equal(kolomDiSelect("areaId, sku FROM x WHERE category = 'Sku' AND isActive"), null, 'salah baca -> dilewati');
});
