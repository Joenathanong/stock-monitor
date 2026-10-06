import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Penjaga: nama kolom yang merupakan KATA CADANGAN MySQL/TiDB harus dibungkus
 * backtick di setiap SQL mentah.
 *
 * Dua kali kena di produksi, dua-duanya error 1064 yang hanya muncul saat
 * dijalankan — bukan saat `tsc` atau `next build`:
 *
 *   25 Sep 2026  sales_pull.rows   → kolomnya diganti nama jadi rowCount
 *   29 Sep 2026  doi_summary.trigger → dibungkus backtick di compute.ts
 *
 * Prisma Client mengutip nama kolom sendiri, jadi masalahnya hanya ada di
 * $queryRawUnsafe / $executeRawUnsafe / $queryRaw. Tes ini membaca sumbernya dan
 * gagal kalau ada kata cadangan telanjang di dalam pernyataan SQL, supaya
 * ketahuan di `npm test` bukan di layar user.
 */

/** Kata cadangan yang masuk akal dipakai orang sebagai nama kolom. */
const CADANGAN = new Set([
  'add', 'all', 'alter', 'and', 'as', 'asc', 'before', 'between', 'by', 'call', 'case', 'change',
  'char', 'character', 'check', 'collate', 'column', 'condition', 'constraint', 'continue',
  'convert', 'create', 'cross', 'cube', 'current_date', 'current_time', 'current_timestamp',
  'current_user', 'cursor', 'database', 'databases', 'dec', 'decimal', 'declare', 'default',
  'delayed', 'delete', 'dense_rank', 'desc', 'describe', 'distinct', 'div', 'double', 'drop',
  'dual', 'each', 'else', 'empty', 'except', 'exists', 'exit', 'explain', 'false', 'fetch',
  'first_value', 'float', 'for', 'force', 'foreign', 'from', 'function', 'generated', 'grant',
  'group', 'grouping', 'groups', 'having', 'if', 'ignore', 'in', 'index', 'infile', 'inner',
  'inout', 'insert', 'int', 'integer', 'interval', 'into', 'is', 'join', 'key', 'keys', 'kill',
  'lag', 'last_value', 'lateral', 'lead', 'leading', 'leave', 'left', 'like', 'limit', 'lines',
  'load', 'localtime', 'lock', 'long', 'loop', 'match', 'maxvalue', 'mod', 'natural', 'not',
  'nth_value', 'ntile', 'null', 'numeric', 'of', 'on', 'optimize', 'option', 'or', 'order', 'out',
  'outer', 'over', 'partition', 'percent_rank', 'precision', 'primary', 'procedure', 'purge',
  'range', 'rank', 'read', 'real', 'recursive', 'references', 'regexp', 'release', 'rename',
  'repeat', 'replace', 'require', 'restrict', 'return', 'reverse', 'revoke', 'right', 'row',
  'row_number', 'rows', 'schema', 'schemas', 'select', 'sensitive', 'separator', 'set', 'show',
  'signal', 'smallint', 'spatial', 'specific', 'sql', 'stored', 'system', 'table', 'then',
  'tinyint', 'to', 'trailing', 'trigger', 'true', 'undo', 'union', 'unique', 'unlock', 'update',
  'usage', 'use', 'using', 'values', 'varchar', 'varying', 'virtual', 'when', 'where', 'while',
  'window', 'with', 'write', 'xor',
]);

/** Kata cadangan yang memang BAGIAN DARI sintaks SQL, bukan nama kolom. */
const SINTAKS = new Set([
  'select', 'insert', 'update', 'delete', 'from', 'where', 'and', 'or', 'not', 'null', 'into',
  'values', 'set', 'on', 'as', 'by', 'group', 'order', 'having', 'limit', 'join', 'inner', 'left',
  'right', 'outer', 'cross', 'union', 'all', 'distinct', 'is', 'in', 'between', 'like', 'asc',
  'desc', 'case', 'when', 'then', 'else', 'if', 'default', 'primary', 'key', 'table', 'index',
  'create', 'drop', 'alter', 'rename', 'to', 'using', 'with', 'interval', 'replace', 'ignore',
  'duplicate', 'exists', 'for', 'schema', 'database', 'show', 'true', 'false', 'over',
  'partition', 'row', 'rows', 'range', 'window', 'lateral', 'recursive', 'of', 'use', 'force',
]);

/** Nama kolom dari schema.prisma yang kebetulan kata cadangan — inilah yang wajib dijaga. */
function kolomBahaya(): string[] {
  const sch = readFileSync('prisma/schema.prisma', 'utf8');
  const out = new Set<string>();
  for (const m of sch.matchAll(/^ {2}(\w+)\s+\w/gm)) {
    const c = m[1].toLowerCase();
    if (CADANGAN.has(c) && !SINTAKS.has(c)) out.add(c);
  }
  return [...out];
}

function berkasTs(dir: string, hasil: string[] = []): string[] {
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (nama === 'node_modules' || nama === '.next') continue;
    if (statSync(p).isDirectory()) berkasTs(p, hasil);
    else if (nama.endsWith('.ts') || nama.endsWith('.tsx')) hasil.push(p);
  }
  return hasil;
}

/**
 * Potongan teks yang tampak seperti pernyataan SQL, dari literal apa pun.
 *
 * JEBAKAN yang kena 5 Okt 2026: pemindai ini tidak mengerti literal REGEX. Satu
 * apostrof di dalam regex — `/doesn't exist/` — dibaca sebagai pembuka string,
 * sehingga paritas kutip SELURUH berkas bergeser dan potongan KODE (bukan SQL)
 * ikut terbaca sebagai SQL. Hasilnya tuduhan palsu yang menunjuk baris yang
 * sama sekali tidak memuat SQL, dan itu memakan waktu untuk dibedah.
 *
 * Penangkalnya: kandidat harus BERAWAL dengan kata kerja SQL setelah dirapikan.
 * SQL mentah yang nyata selalu begitu; potongan kode yang kebetulan memuat kata
 * "update" di tengahnya tidak. Ini menyempitkan tanpa melemahkan — tes
 * "masih menangkap pelanggaran" di bawah membuktikannya.
 */
const AWALAN_SQL = /^\s*\(?\s*(SELECT|INSERT|UPDATE|DELETE|REPLACE|RENAME|WITH)\b/i;

function petikanSql(kode: string): string[] {
  const out: string[] = [];
  for (const m of kode.matchAll(/(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g)) {
    const t = m[2];
    if (!AWALAN_SQL.test(t)) continue;
    if (/\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|DUPLICATE\s+KEY|RENAME\s+TABLE)\b/i.test(t)) out.push(t);
  }
  return out;
}

test('kata cadangan SQL selalu dibungkus backtick di SQL mentah', () => {
  const bahaya = kolomBahaya();
  assert.ok(bahaya.length > 0, 'daftar kolom bahaya kosong — pembaca schema.prisma rusak');

  const pelanggaran: string[] = [];
  for (const f of [...berkasTs('src'), ...berkasTs('scripts')]) {
    const kode = readFileSync(f, 'utf8');
    if (!/\$(query|execute)Raw/.test(kode)) continue;
    for (const sql of petikanSql(kode)) {
      for (const w of bahaya) {
        // Kata itu muncul TANPA backtick di kiri maupun kanan, dan bukan bagian
        // nama lain (mis. rowCount tidak boleh kena aturan `rows`/`row`).
        const re = new RegExp(String.raw`(?<![\`\w.])${w}(?![\`\w])`, 'gi');
        if (re.test(sql)) pelanggaran.push(`${f}: kata cadangan "${w}" tanpa backtick — ${sql.trim().slice(0, 90)}`);
      }
    }
  }
  assert.deepEqual(pelanggaran, [], `\n${pelanggaran.join('\n')}\n`);
});

test('pemindai masih MENANGKAP pelanggaran setelah dipersempit', () => {
  // Tanpa tes ini, mempersempit AWALAN_SQL bisa membuat penjaga diam-diam
  // tidak menjaga apa pun — kegagalan yang tidak akan pernah terlihat.
  const jahat = `const q = 'SELECT id, system FROM sku_link WHERE groupKey = ?';`;
  const petikan = petikanSql(jahat);
  assert.equal(petikan.length, 1, 'SQL mentah yang jelas harus tetap terbaca');
  assert.match(petikan[0], /system/);

  // Dan tidak lagi tertipu apostrof di dalam regex.
  const palsu = `const ada = /doesn't exist/i.test(m);\n`
    + `const baris = lama ? await prisma.x.update({ a: 1 }) : await prisma.x.create({ b: 2 });`;
  assert.deepEqual(petikanSql(palsu), [], 'potongan kode bukan SQL');
});
