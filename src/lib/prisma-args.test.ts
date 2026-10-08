import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Penjaga: argumen metode Prisma tidak boleh berupa ternary.
 *
 * Kena 30 Sep 2026 — build Vercel gagal, `tsc` lokal LOLOS:
 *
 *   prisma.transitStock.deleteMany(semua ? {} : { where: { source: 'manual' } })
 *   → Argument of type '{} | { where: { source: string; } }' is not assignable…
 *     Property 'where' is missing in type '{}'
 *
 * Metode Prisma bergeneric — `deleteMany<T extends …Args>(args?: SelectSubset<T, …>)`
 * — dan T disimpulkan dari argumennya. Argumen union membuat penyimpulan memilih
 * satu bentuk lalu menolak bentuk lainnya.
 *
 * Kenapa tidak tertangkap di sini: engine Prisma tidak bisa diunduh di lingkungan
 * ini, jadi `node_modules/.prisma/client` isinya stub tulis tangan dengan
 * `deleteMany(args?: any)` — jauh lebih longgar daripada tipe asli. Jadi `tsc`
 * lokal TIDAK bisa dipercaya untuk kelas galat ini, dan penggantinya tes teks ini.
 *
 * Aturannya: pilih di antara dua PANGGILAN, jangan di antara dua ARGUMEN.
 *
 *   BOLEH : cond ? prisma.x.findMany({ where: a }) : prisma.x.findMany({ where: b })
 *   BOLEH : cond ? prisma.x.findMany() : Promise.resolve([])
 *   JANGAN: prisma.x.findMany(cond ? { where: a } : {})
 */
const METODE = [
  'findMany', 'findFirst', 'findUnique', 'create', 'createMany', 'update', 'updateMany',
  'upsert', 'delete', 'deleteMany', 'count', 'aggregate', 'groupBy',
];

function berkasTs(dir: string, hasil: string[] = []): string[] {
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (nama === 'node_modules' || nama === '.next') continue;
    if (statSync(p).isDirectory()) berkasTs(p, hasil);
    // Berkas tes dilewati: contoh JANGAN di komentar tes ini sendiri akan kena.
    else if ((nama.endsWith('.ts') || nama.endsWith('.tsx')) && !nama.endsWith('.test.ts')) hasil.push(p);
  }
  return hasil;
}

/**
 * Buang komentar supaya contoh kode di dalamnya tidak dianggap pelanggaran.
 * Panjang berkas dijaga tetap (diganti spasi) agar nomor barisnya masih benar.
 */
function tanpaKomentar(kode: string): string {
  return kode
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

/** Isi tanda kurung panggilan yang dimulai di `mulai` (indeks '('), seimbang. */
function isiKurung(kode: string, mulai: number): string | null {
  let dalam = 0;
  for (let i = mulai; i < kode.length; i++) {
    if (kode[i] === '(') dalam++;
    else if (kode[i] === ')') { dalam--; if (!dalam) return kode.slice(mulai + 1, i); }
  }
  return null;
}

test('argumen metode Prisma bukan ternary', () => {
  const pelanggaran: string[] = [];
  for (const f of [...berkasTs('src'), ...berkasTs('scripts')]) {
    const kode = tanpaKomentar(readFileSync(f, 'utf8'));
    if (!kode.includes('prisma.')) continue;
    const re = new RegExp(String.raw`\bprisma\.\w+\.(${METODE.join('|')})\s*\(`, 'g');
    for (let m = re.exec(kode); m; m = re.exec(kode)) {
      const isi = isiKurung(kode, m.index + m[0].length - 1);
      if (!isi) continue;
      // '?' di kedalaman nol, bukan '?.' dan bukan '??' — itu ternary.
      let dalam = 0;
      for (let i = 0; i < isi.length; i++) {
        const c = isi[i];
        if ('([{'.includes(c)) dalam++;
        else if (')]}'.includes(c)) dalam--;
        else if (c === '?' && !dalam && isi[i + 1] !== '.' && isi[i + 1] !== '?' && isi[i - 1] !== '?') {
          const baris = kode.slice(0, m.index).split('\n').length;
          pelanggaran.push(`${f}:${baris} — argumen ternary di ${m[0]}…) · pisah jadi dua panggilan`);
          break;
        }
      }
    }
  }
  assert.deepEqual(pelanggaran, [], `\n${pelanggaran.join('\n')}\n`);
});

/**
 * Penjaga kedua, kelas galat yang sama: nama KUNCI GABUNGAN yang dikarang.
 *
 * Untuk `@@id([sku, areaId])` tanpa `name:`, Prisma menamai kuncinya
 * `sku_areaId`. Menulis `where: { atp_share_key: { … } }` lolos `tsc` di
 * lingkungan ini — stub client-nya bertipe `any` (lihat catatan di atas) — lalu
 * gagal saat dijalankan dengan pesan validasi Prisma, di tengah penyimpanan
 * user. Kena 8 Okt 2026 saat `atp-store.ts` ditulis.
 *
 * Aturannya: nama kunci gabungan hanya boleh (a) `name:` yang tertulis di
 * schema, atau (b) daftar medannya digabung pakai `_`. Tidak ada pilihan
 * ketiga, dan `schema.prisma` adalah satu-satunya hakimnya.
 */
function kunciSah(): { sah: Set<string>; medan: Set<string> } {
  const sch = readFileSync('prisma/schema.prisma', 'utf8');
  const sah = new Set<string>();
  const medan = new Set<string>();
  for (const m of sch.matchAll(/^ {2}(\w+)\s+\w/gm)) medan.add(m[1]);
  for (const m of sch.matchAll(/@@(?:id|unique)\(\s*\[([^\]]+)\]([^)]*)\)/g)) {
    const bidang = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    if (bidang.length < 2) continue;
    sah.add(bidang.join('_'));
    const nama = /name:\s*['"]([^'"]+)['"]/.exec(m[2] ?? '');
    if (nama) sah.add(nama[1]);
  }
  return { sah, medan };
}

test('nama kunci gabungan Prisma ada di schema.prisma', () => {
  const { sah, medan } = kunciSah();
  assert.ok(sah.size > 0, 'tidak ada @@id/@@unique gabungan terbaca — pembaca schema-nya rusak');

  const pelanggaran: string[] = [];
  // `where: { <ident>: {` — hanya ident ber-underscore yang diperiksa, karena
  // itulah bentuk nama kunci gabungan; medan biasa di repo ini camelCase.
  const re = /where:\s*\{\s*([A-Za-z_]\w*_\w+)\s*:\s*\{/g;
  for (const f of [...berkasTs('src'), ...berkasTs('scripts')]) {
    const kode = tanpaKomentar(readFileSync(f, 'utf8'));
    if (!kode.includes('prisma.')) continue;
    for (let m = re.exec(kode); m; m = re.exec(kode)) {
      const k = m[1];
      if (sah.has(k) || medan.has(k)) continue;
      const baris = kode.slice(0, m.index).split('\n').length;
      pelanggaran.push(
        `${f}:${baris} — kunci "${k}" tidak ada di schema.prisma`
        + ` · yang sah: ${[...sah].sort().join(', ')}`,
      );
    }
    re.lastIndex = 0;
  }
  assert.deepEqual(pelanggaran, [], `\n${pelanggaran.join('\n')}\n`);
});
