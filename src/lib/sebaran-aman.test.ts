import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Penjaga: REFRESH TIDAK BOLEH BISA MENGHAPUS SEBARAN ATP.
 *
 * Pertanyaan user 8 Okt 2026: "saat saya tarik ulang data ocs (refresh), semua
 * perubahan saya apakah akan hilang? perubahan hanya berlaku jika sku di
 * delete, ada create baru, dan perubahan quantity. untuk sebaran jangan sampai
 * berubah."
 *
 * Jawabannya: tidak hilang — dan alasannya struktural. Keputusan sebaran hidup
 * di tabelnya sendiri (`atp_share`, kunci sku+areaId), sementara Refresh hanya
 * menulis `stock_current`. `syncStock` memang menghapus baris yang tidak ada
 * lagi di OCS, tapi barisnya di `stock_current`, bukan di `atp_share`.
 *
 * "Memang begitu hari ini" bukan jaminan. Satu baris `DELETE FROM atp_share` di
 * jalur sinkronisasi akan menghapus ribuan keputusan TANPA gejala apa pun di
 * layar — kerusakan yang baru ketahuan berbulan-bulan kemudian, saat ATP% turun
 * dan tak ada yang bisa menjelaskan sebabnya. Jadi sifatnya dikunci di sini:
 *
 *   penghapusan atp_share HANYA boleh ada di `src/lib/atp-store.ts`, yaitu di
 *   `simpanSebaran()` — yang jalan ketika ORANG menekan "Kosongkan" atau
 *   mengirim sel kosong lewat Excel.
 *
 * Kalau tes ini gagal, jangan dilonggarkan: pindahkan penghapusannya ke
 * atp-store, atau memang jangan menghapus.
 */

function berkas(dir: string, hasil: string[] = []): string[] {
  for (const nama of readdirSync(dir)) {
    if (nama === 'node_modules' || nama === '.next') continue;
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) berkas(p, hasil);
    else if (/\.(ts|tsx)$/.test(nama)) hasil.push(p);
  }
  return hasil;
}

/** Bentuk penghapusan yang mungkin, lewat SQL mentah maupun Prisma. */
const POLA_HAPUS: RegExp[] = [
  /DELETE\s+FROM\s+`?atp_share`?/i,
  /TRUNCATE\s+(?:TABLE\s+)?`?atp_share`?/i,
  /atpShare\s*\.\s*delete(?:Many)?\s*\(/,
];

/** Satu-satunya tempat yang boleh menghapus — dan hanya atas perintah orang. */
const DIIZINKAN = /src[\\/]lib[\\/]atp-store\.ts$/;

test('tidak ada penghapusan atp_share di luar atp-store.ts', () => {
  const pelanggaran: string[] = [];
  for (const f of [...berkas('src'), ...berkas('scripts')]) {
    if (/sebaran-aman\.test\.ts$/.test(f)) continue;   // berkas ini memuat polanya
    if (DIIZINKAN.test(f)) continue;
    const kode = readFileSync(f, 'utf8');
    for (const re of POLA_HAPUS) {
      const m = re.exec(kode);
      if (!m) continue;
      const baris = kode.slice(0, m.index).split('\n').length;
      pelanggaran.push(`${f}:${baris} — ${m[0]}`);
    }
  }
  assert.deepEqual(
    pelanggaran,
    [],
    'Sebaran ATP hanya boleh dihapus dari atp-store.ts (simpanSebaran), '
    + 'tidak dari jalur sinkronisasi/Refresh mana pun:\n' + pelanggaran.join('\n'),
  );
});

test('jalur sinkronisasi stok tidak menyebut atp_share sama sekali', () => {
  // Lebih keras untuk satu berkas yang paling berbahaya: `sync.ts` adalah yang
  // dijalankan tombol Refresh dan cron. Ia tidak punya urusan apa pun dengan
  // keputusan sebaran — membacanya pun tidak.
  const kode = readFileSync(join('src', 'lib', 'sync.ts'), 'utf8');
  assert.ok(
    !/atp_share|atpShare/.test(kode),
    'src/lib/sync.ts menyebut atp_share — Refresh tidak boleh menyentuh sebaran',
  );
});

/**
 * Model yang BOLEH dihapus barisnya di jalur sinkronisasi, berikut alasannya.
 *
 * Daftar ini sengaja pendek dan harus ditambah MANUAL. Tes ini pernah gagal
 * 9 Okt 2026 saat `syncBundle` ditambahkan — dan itu memang gunanya: setiap
 * penghapusan baru di jalur sinkronisasi harus dibaca orang dulu, bukan lolos
 * karena polanya mirip yang sudah ada.
 */
const HAPUS_DIIZINKAN: Record<string, string> = {
  // Baris stok yang tidak ada lagi di OCS. Inilah yang membuat SKU yang
  // dihapus di OCS ikut hilang dari tampilan — diminta user.
  stockCurrent: 'baris stok yang hilang dari OCS',
  // Komposisi bundling yang lebih tua dari penarikan ini. Yang dihapus
  // KOMPOSISI, bukan keputusan sebaran — dan hanya kalau penarikannya ada
  // isinya (daftar kosong dari OCS tidak pernah menimpa apa pun).
  bundleItem: 'baris komposisi bundling yang sudah tidak ada di OCS',
};

test('pembersihan di jalur sinkronisasi hanya mengenai model yang diizinkan', () => {
  const kode = readFileSync(join('src', 'lib', 'sync.ts'), 'utf8');
  const model = [...kode.matchAll(/(\w+)\s*\.\s*deleteMany\s*\(/g)].map((m) => m[1]);
  const asing = [...new Set(model)].filter((m) => !(m in HAPUS_DIIZINKAN));
  assert.deepEqual(
    asing,
    [],
    'Ada deleteMany ke model yang belum diizinkan di jalur sinkronisasi: ' + asing.join(', ')
    + '. Baca dulu apa yang dihapusnya, lalu tambahkan ke HAPUS_DIIZINKAN berikut alasannya '
    + '— jangan dilonggarkan tanpa membacanya.',
  );
  // Penjaga atas penjaga: `atp_share` tidak boleh pernah masuk daftar izin.
  assert.ok(!('atpShare' in HAPUS_DIIZINKAN), 'atp_share TIDAK boleh diizinkan dihapus di jalur sinkronisasi');
});

test('firstSeenAt tidak ikut ditimpa saat Refresh', () => {
  // `firstSeenAt` yang dipakai daftar "SKU belum diatur" hanya berarti kalau ia
  // TIDAK disetel ulang tiap sinkronisasi. Kolomnya memang ada di daftar INSERT
  // tapi harus TIDAK ada di blok ON DUPLICATE KEY UPDATE.
  const kode = readFileSync(join('src', 'lib', 'sync.ts'), 'utf8');
  const i = kode.indexOf('ON DUPLICATE KEY UPDATE');
  assert.ok(i > 0, 'blok ON DUPLICATE KEY UPDATE stock_current tidak ditemukan');
  const blok = kode.slice(i, i + 600);
  assert.ok(
    !/firstSeenAt\s*=\s*VALUES\(firstSeenAt\)/.test(blok),
    'firstSeenAt ikut ditimpa saat Refresh — "terlihat sejak" jadi tanggal hari ini untuk semua SKU',
  );
});
