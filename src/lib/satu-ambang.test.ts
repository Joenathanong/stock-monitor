import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { setelanArea, ambangDoi, type BarisArea } from './area-master';

/**
 * Penjaga: AMBANG DOI HANYA PUNYA SATU SUMBER DAN SATU ATURAN CADANGAN.
 *
 * Permintaan user 10 Okt 2026: "saya cek ada ambang tindakan yang mengatur doi
 * 14 hari? sedangkan dibawah ada pengaturan per Cabang / Area. saya mau semua
 * mengikuti cabang area saja."
 *
 * Ia menemukan sendiri apa yang terjadi kalau satu hal diatur di dua tempat.
 * Yang ditemukan audit sesudahnya:
 *
 *   - Tiga pengaturan global (target_doi_days 14, safety_days 3,
 *     default_lead_time_days 7) sudah MATI untuk kelima cabang — begitu kolom
 *     ambang cabang terisi, cabang kode yang memakainya tidak pernah dijalankan.
 *     Tapi angkanya tetap terpajang sebagai fakta di Dashboard, /tv, halaman SKU
 *     dan /simulasi: "Target DOI 14 hari", yang tidak benar untuk satu cabang
 *     pun (7 / 21 / 20 / 45 / 35).
 *   - `compute.ts` hanya memakai ambang cabang kalau kolomnya terisi, sedangkan
 *     route poster SELALU menyusunnya dari angka global. Belum terlihat karena
 *     semua kolom kebetulan terisi — tapi satu cabang baru berkolom kosong akan
 *     membuat poster menulis "Aman <=14D" untuk cabang yang statusnya dihitung
 *     dengan batas lain. Label yang berbohong, tanpa ada yang gagal.
 *
 * Dua kerusakan itu lahir dari sebab yang sama: aturan cadangan ditulis ulang di
 * tiap pemanggil. Jadi yang dikunci di sini bukan "angkanya benar" melainkan
 * "aturannya cuma ada di satu tempat" — satu-satunya bentuk yang membuat
 * perbedaan seperti itu MUSTAHIL, bukan sekadar belum terjadi.
 */

const baris = (o: Partial<BarisArea> = {}): BarisArea => ({
  code: 'X', name: 'X', isActive: true, sortOrder: 10,
  doiCritical: null, doiMin: null, doiMax: null,
  leadTimeDays: null, atpTarget: null, startDate: null, note: null, ...o,
});

const PUSAT = baris({ code: 'GBJD', name: 'Pusat', doiCritical: 4, doiMin: 5, doiMax: 7, leadTimeDays: 7, atpTarget: 95 });
const GAB = baris({ code: 'GABUNGAN', name: 'GABUNGAN', doiCritical: 7, doiMin: 10, doiMax: 14, leadTimeDays: 7, atpTarget: 90 });
const BARU = baris({ code: 'GJBL', name: 'Bali' });

test('cabang yang lengkap memakai angkanya SENDIRI, bukan angka gabungan', () => {
  const s = setelanArea([GAB, PUSAT], 'Pusat');
  assert.deepEqual(s.ambang, { kritis: 4, min: 5, max: 7 });
  assert.equal(s.leadTimeDays, 7);
  assert.equal(s.atpTarget, 95);
});

test('cabang yang belum lengkap jatuh ke baris GABUNGAN, bukan ke konstanta', () => {
  // Cadangannya harus baris yang ADA DI LAYAR dan bisa diperbaiki orang.
  // Angka global yang lama tidak bisa ditelusuri dari mana pun di aplikasi.
  const s = setelanArea([GAB, BARU], 'Bali');
  assert.deepEqual(s.ambang, { kritis: 7, min: 10, max: 14 });
  assert.equal(s.leadTimeDays, 7);
  assert.equal(s.atpTarget, 90);
});

test('tanpa baris GABUNGAN pun, tidak ada angka yang dikarang', () => {
  // null = "belum bisa dihitung", dan pemanggilnya yang harus berisik soal itu
  // (compute.ts melempar galat bernama). Mengembalikan angka tebakan berarti
  // seluruh status hari itu dihitung dengan ambang yang tidak pernah dipilih
  // siapa pun, dan tidak akan ada yang tahu.
  assert.equal(setelanArea([BARU], 'Bali').ambang, null);
  assert.equal(setelanArea([], 'Bali').ambang, null);
  assert.equal(setelanArea([], null).ambang, null);
});

test('lead time & target ATP kosong di cabang DAN di gabungan tetap null', () => {
  const gabKosong = baris({ code: 'GABUNGAN', name: 'GABUNGAN', doiCritical: 7, doiMin: 10, doiMax: 14 });
  const s = setelanArea([gabKosong, BARU], 'Bali');
  assert.deepEqual(s.ambang, { kritis: 7, min: 10, max: 14 }, 'ambang tetap jatuh ke gabungan');
  assert.equal(s.leadTimeDays, null, 'bukan 0, bukan 7 — belum diisi');
  assert.equal(s.atpTarget, null, 'bukan 0 — "Target 0%" akan meluluskan semua kartu');
});

// ---------------------------------------------------------------------------
// Aturan cadangan hanya boleh ditulis SEKALI
// ---------------------------------------------------------------------------

function berkas(dir: string, hasil: string[] = []): string[] {
  for (const nama of readdirSync(dir)) {
    if (nama === 'node_modules' || nama === '.next') continue;
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) berkas(p, hasil);
    else if (/\.(ts|tsx)$/.test(nama)) hasil.push(p);
  }
  return hasil;
}

test('tidak ada pemanggil yang menyusun cadangan ambangnya sendiri', () => {
  // Bentuk yang dilarang: `ambangDoi(a) ?? ambangDoi(b)` — itu aturan cadangan,
  // dan aturan cadangan cuma boleh hidup di `setelanArea`. Pemanggil yang
  // menulisnya sendiri adalah persis cara dua jalur bisa melenceng tanpa
  // ketahuan.
  const pelanggaran: string[] = [];
  for (const f of [...berkas('src'), ...berkas('scripts')]) {
    if (/area-master\.ts$/.test(f)) continue;          // satu-satunya tempat yang boleh
    if (/satu-ambang\.test\.ts$/.test(f)) continue;    // berkas ini memuat polanya
    const kode = readFileSync(f, 'utf8');
    const m = /ambangDoi\s*\([^)]*\)\s*\?\?/.exec(kode);
    if (m) pelanggaran.push(`${f}:${kode.slice(0, m.index).split('\n').length} — ${m[0]}`);
  }
  assert.deepEqual(
    pelanggaran, [],
    'Aturan cadangan ambang hanya boleh ada di setelanArea() (area-master.ts). '
    + 'Pemanggil memanggil setelanArea, bukan menyusun ulang cadangannya:\n' + pelanggaran.join('\n'),
  );
});

test('tiga pengaturan global yang dicabut tidak boleh kembali', () => {
  // Kalau salah satu nama ini muncul lagi di kode, berarti ada yang membuat
  // tempat KEDUA untuk mengatur ambang — dan seluruh kebingungan yang dilaporkan
  // user 10 Okt 2026 kembali, dalam bentuk yang persis sama.
  const dicabut = ['target_doi_days', 'safety_days', 'default_lead_time_days', 'atp_target_persen'];
  const pelanggaran: string[] = [];
  for (const f of [...berkas('src'), ...berkas('scripts')]) {
    if (/satu-ambang\.test\.ts$/.test(f)) continue;
    const kode = readFileSync(f, 'utf8');
    // Komentar sejarah boleh menyebutnya; yang dilarang adalah membacanya
    // sebagai setelan, yaitu muncul sebagai string berkutip.
    for (const nama of dicabut) {
      // Hanya bentuk PEMAKAIAN: string berkutip (kunci setelan) atau akses
      // properti pada peta setelan. Backtick sengaja TIDAK ikut — komentar
      // sejarah di berkas-berkas ini memang menyebut nama-nama itu, dan
      // melarang orang menjelaskan apa yang dicabut akan menghapus justru
      // keterangan yang membuat pencabutannya bisa dimengerti nanti.
      const re = new RegExp(`['"]${nama}['"]|\\.${nama}\\b`);
      const m = re.exec(kode);
      if (m) pelanggaran.push(`${f}:${kode.slice(0, m.index).split('\n').length} — ${nama}`);
    }
  }
  assert.deepEqual(
    pelanggaran, [],
    'Pengaturan global ambang sudah dicabut 10 Okt 2026 — semuanya kolom di tabel '
    + 'Cabang / Area sekarang, termasuk baris GABUNGAN:\n' + pelanggaran.join('\n'),
  );
});

test('ambangDoi sendiri tidak punya cadangan apa pun', () => {
  // Pengaman kalau suatu saat ada yang menambahkan parameter `bawaan` kembali:
  // begitu fungsi ini bisa menambal sendiri, `setelanArea` berhenti jadi
  // satu-satunya tempat aturan cadangan hidup.
  assert.equal(ambangDoi(BARU), null);
  assert.equal(ambangDoi(baris({ doiCritical: 4, doiMin: 5 })), null, 'doiMax kosong tetap null');
  assert.equal(ambangDoi.length, 1, 'ambangDoi hanya boleh menerima barisnya, tanpa angka cadangan');
});
