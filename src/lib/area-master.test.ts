import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KODE_AREA_BAWAAN, TANPA_KODE, petaKodeArea, namaAreaDari, areaAktif,
  ambangDoi, pitaDoi, ringkasPita, validasiArea, areaBelumTerdaftar, normalKode, type BarisArea,
} from './area-master';

const area = (o: Partial<BarisArea> = {}): BarisArea => ({
  code: 'GJSB', name: 'Surabaya', isActive: true, sortOrder: 10,
  doiCritical: null, doiMin: null, doiMax: null, startDate: null, note: null, ...o,
});

test('peta kode dibangun dari tabel, bukan dari konstanta', () => {
  const peta = petaKodeArea([area(), area({ code: 'GJBL', name: 'Bali' })]);
  assert.equal(namaAreaDari('GJBL', peta).name, 'Bali');
  assert.equal(namaAreaDari('gjbl', peta).name, 'Bali', 'huruf kecil ikut dikenali');
  // Cabang baru cukup ditambahkan di tabel - tidak ada yang perlu diubah di kode.
  assert.equal(KODE_AREA_BAWAAN.GJBL, undefined);
});

test('kode tak dikenal TIDAK pernah jadi Pusat', () => {
  const peta = petaKodeArea([area({ code: 'GBJD', name: 'Pusat' })]);
  const asing = namaAreaDari('GXXX', peta);
  assert.equal(asing.name, 'GXXX');
  assert.equal(asing.asing, true, 'harus ditandai asing supaya kelihatan di layar');
  assert.notEqual(asing.name, 'Pusat');
});

test('kode kosong juga tidak jadi Pusat', () => {
  const peta = petaKodeArea([area({ code: 'GBJD', name: 'Pusat' })]);
  const kosong = namaAreaDari('', peta);
  assert.equal(kosong.name, TANPA_KODE);
  assert.equal(kosong.asing, true);
});

test('area nonaktif tetap bisa diterjemahkan, tapi tidak ikut ditarik', () => {
  const rows = [area(), area({ code: 'GJYG', name: 'Yogyakarta', isActive: false, sortOrder: 20 })];
  assert.equal(namaAreaDari('GJYG', petaKodeArea(rows)).name, 'Yogyakarta', 'data lama tetap terbaca');
  assert.deepEqual(areaAktif(rows).map((r) => r.name), ['Surabaya']);
});

test('area aktif berurut sortOrder lalu nama', () => {
  const rows = [
    area({ code: 'C', name: 'Ceko', sortOrder: 5 }),
    area({ code: 'A', name: 'Aceh', sortOrder: 5 }),
    area({ code: 'B', name: 'Bali', sortOrder: 1 }),
  ];
  assert.deepEqual(areaAktif(rows).map((r) => r.name), ['Bali', 'Aceh', 'Ceko']);
});

const GLOBAL = { kritis: 7, min: 10, max: 14 };

test('ambang DOI: per area menang, yang kosong jatuh ke global', () => {
  assert.deepEqual(
    ambangDoi(area({ doiCritical: 4, doiMin: 5, doiMax: 7 }), GLOBAL),
    { kritis: 4, min: 5, max: 7 },
  );
  assert.deepEqual(ambangDoi(area({ doiMin: 21 }), GLOBAL), { kritis: 7, min: 21, max: 21 },
    'maks global 14 diangkat ke min 21 — "pesan sampai penuh" tidak boleh mengurangi stok');
  assert.deepEqual(ambangDoi(null, GLOBAL), GLOBAL);
});

test('kritis DIPAKSA di bawah min, bukan hanya divalidasi di form', () => {
  // Baris yang tersimpan sebelum aturan ini ada tidak boleh membuat pita LOW
  // hilang. 20 >= 10, jadi dipotong ke 9.
  assert.deepEqual(ambangDoi(area({ doiCritical: 20, doiMin: 10 }), GLOBAL), { kritis: 9, min: 10, max: 14 });
  // min 0 -> kritis tidak boleh negatif.
  assert.equal(ambangDoi(area({ doiCritical: 5, doiMin: 0 }), GLOBAL).kritis, 0);
});

test('pitaDoi: batasnya INKLUSIF di tiap ujung atas', () => {
  const a = { kritis: 7, min: 14, max: 21 };   // Surabaya
  assert.equal(pitaDoi(7, a), 'CRITICAL', 'tepat di batas kritis masih CRITICAL');
  assert.equal(pitaDoi(8, a), 'LOW');
  assert.equal(pitaDoi(14, a), 'LOW', 'tepat di batas low masih LOW');
  assert.equal(pitaDoi(15, a), 'HEALTHY');
  assert.equal(pitaDoi(21, a), 'HEALTHY', 'tepat di batas aman masih HEALTHY');
  assert.equal(pitaDoi(22, a), 'OVERSTOCK');
  assert.equal(pitaDoi(0, a), 'CRITICAL');
});

test('ambang 5 kota dari user 5 Okt 2026 menutup SELURUH garis hari, tanpa celah', () => {
  // Inilah alasan 3 batas dipilih, bukan 6. Ditulis sebagai pasangan batas,
  // data aslinya meninggalkan hari ke-14 (Medan/Makassar) dan ke-7
  // (Surabaya/Yogyakarta) tanpa pita.
  const kota: [string, number, number, number][] = [
    ['Pusat', 4, 5, 7],
    ['Medan', 14, 21, 35],
    ['Makassar', 14, 31, 45],
    ['Surabaya', 7, 14, 21],
    ['Yogyakarta', 7, 13, 20],
  ];
  for (const [nama, kritis, min, max] of kota) {
    const a = ambangDoi(area({ doiCritical: kritis, doiMin: min, doiMax: max }), GLOBAL);
    assert.deepEqual(a, { kritis, min, max }, nama);
    // Setiap hari dari 0 sampai max+5 harus punya pita, dan urutannya tidak
    // boleh mundur. Itu membuktikan tidak ada celah DAN tidak ada tumpang-tindih.
    const urut = ['CRITICAL', 'LOW', 'HEALTHY', 'OVERSTOCK'];
    let terakhir = 0;
    for (let d = 0; d <= max + 5; d++) {
      const i = urut.indexOf(pitaDoi(d, a));
      assert.ok(i >= 0, `${nama} hari ${d} tidak masuk pita mana pun`);
      assert.ok(i >= terakhir, `${nama} hari ${d}: pita mundur ke ${urut[i]}`);
      terakhir = i;
    }
    assert.equal(pitaDoi(max, a), 'HEALTHY', `${nama}: hari ke-${max} harus masih aman`);
    assert.equal(pitaDoi(max + 1, a), 'OVERSTOCK', `${nama}: hari ke-${max + 1} harus overstock`);
  }
});

test('ringkasPita menulis pita satu-hari tanpa rentang palsu', () => {
  assert.match(ringkasPita({ kritis: 4, min: 5, max: 7 }), /kritis ≤4 · low 5 · aman 6-7 · over >7/);
  // low sepanjang satu hari: "8" bukan "8-8".
  assert.match(ringkasPita({ kritis: 7, min: 8, max: 14 }), /low 8 /);
});

test('validasi menolak kritis >= low, dan menyebut AKIBATNYA', () => {
  const g = validasiArea({ code: 'GJSB', name: 'Surabaya', doiCritical: 14, doiMin: 14, doiMax: 21 });
  assert.equal(g.length, 1);
  assert.equal(g[0].field, 'doiCritical');
  assert.match(g[0].pesan, /pita LOW hilang/);
});

test('validasi menolak aman < low', () => {
  const g = validasiArea({ code: 'GJSB', name: 'Surabaya', doiCritical: 4, doiMin: 20, doiMax: 10 });
  assert.equal(g[0].field, 'doiMax');
  assert.match(g[0].pesan, /pita AMAN hilang/);
});

test('ambang 5 kota lolos validasi', () => {
  for (const [kritis, min, max] of [[4, 5, 7], [14, 21, 35], [14, 31, 45], [7, 14, 21], [7, 13, 20]]) {
    assert.deepEqual(
      validasiArea({ code: 'GJSB', name: 'Surabaya', doiCritical: kritis, doiMin: min, doiMax: max }),
      [], `${kritis}/${min}/${max}`,
    );
  }
});

test('validasi: kode & nama wajib, format kode dijaga', () => {
  assert.deepEqual(validasiArea({ code: 'GJSB', name: 'Surabaya' }), []);
  assert.equal(validasiArea({ code: '', name: 'X' }).some((g) => g.field === 'code'), true);
  assert.equal(validasiArea({ code: 'G-JSB', name: 'X' }).some((g) => g.field === 'code'), true);
  assert.equal(validasiArea({ code: 'GJSB', name: '' }).some((g) => g.field === 'name'), true);
});

test('validasi: nama GABUNGAN ditolak — itu nama khusus laporan gabungan', () => {
  assert.equal(validasiArea({ code: 'GAB', name: 'GABUNGAN' }).some((g) => g.field === 'name'), true);
  assert.equal(validasiArea({ code: 'GAB', name: 'gabungan' }).some((g) => g.field === 'name'), true);
});

test('validasi: maks tidak boleh di bawah min, negatif ditolak', () => {
  assert.equal(validasiArea({ code: 'A1', name: 'X', doiMin: 10, doiMax: 5 }).some((g) => g.field === 'doiMax'), true);
  assert.equal(validasiArea({ code: 'A1', name: 'X', doiMin: -1 }).some((g) => g.field === 'doiMin'), true);
  assert.deepEqual(validasiArea({ code: 'A1', name: 'X', doiMin: 5, doiMax: 5 }), []);
});

test('validasi: tanggal mulai harus YYYY-MM-DD', () => {
  assert.equal(validasiArea({ code: 'A1', name: 'X', startDate: '01-06-2026' }).some((g) => g.field === 'startDate'), true);
  assert.deepEqual(validasiArea({ code: 'A1', name: 'X', startDate: '2026-06-01' }), []);
});

test('area yang ada di data tapi belum terdaftar ikut dilaporkan', () => {
  const rows = [area({ code: 'GBJD', name: 'Pusat' })];
  assert.deepEqual(areaBelumTerdaftar(['Pusat', 'Bali', 'GABUNGAN', '', 'Bali'], rows), ['Bali']);
});

test('normalKode merapikan spasi & huruf', () => {
  assert.equal(normalKode('  gjsb '), 'GJSB');
  assert.equal(normalKode(null), '');
});
