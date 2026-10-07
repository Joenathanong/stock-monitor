import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adsTeks, angkaRingkas, deretTren, jalurSpark, labelDoi, lebarKartu, rupiahRingkas, segmenStatus, segmenLain, tinggiKartu, kritisYangMuat, tampil1, tampil2 } from './wa-poster';

test('rupiah diringkas per satuan', () => {
  assert.equal(rupiahRingkas(52_431_882_100), 'Rp 52,4 M');
  assert.equal(rupiahRingkas(1_400_000_000), 'Rp 1,4 M');
  assert.equal(rupiahRingkas(4_200_000), 'Rp 4,2 jt');
  assert.equal(rupiahRingkas(0), 'Rp 0');
  // >= 100 satuan: desimalnya dibuang supaya tidak jadi "Rp 120,4 M" yang panjang
  assert.equal(rupiahRingkas(120_400_000_000), 'Rp 120 M');
});

test('angka besar diringkas', () => {
  assert.equal(angkaRingkas(1_380_422), '1,4 jt');
  assert.equal(angkaRingkas(104_804), '105 rb');
  assert.equal(angkaRingkas(346), '346');
});

test('status non-DOI TIDAK lagi dilipat jadi "Lain" — dipindah ke segmenLain', () => {
  // Perilaku ini DIGANTI 7 Okt 2026 atas permintaan user. Tesnya dipertahankan
  // dalam bentuk baru, bukan dihapus: yang dikunci sekarang adalah bahwa dua
  // kelompok itu TIDAK saling mencampuri, dan tidak ada angka yang hilang.
  const b = { CRITICAL: 12, LOW: 28, HEALTHY: 180, OVERSTOCK: 61, NPL_WAIT: 14, DEAD_STOCK: 21 };
  const pita = segmenStatus(b);
  assert.deepEqual(pita.map((s) => s.key), ['CRITICAL', 'LOW', 'HEALTHY', 'OVERSTOCK']);
  assert.equal(pita.reduce((t, s) => t + s.n, 0), 281, 'hanya pita DOI');

  const lain = segmenLain(b);
  assert.equal(lain.reduce((t, s) => t + s.n, 0), 35, '14 + 21, persis seperti "Lain" dulu');

  // Tidak ada satu pun SKU yang hilang maupun dihitung dua kali.
  const semua = Object.values(b).reduce((t, v) => t + v, 0);
  assert.equal(pita.reduce((t, s) => t + s.n, 0) + lain.reduce((t, s) => t + s.n, 0), semua);
});

test('tanpa status lain, segmennya tetap empat', () => {
  const seg = segmenStatus({ CRITICAL: 1, LOW: 2, HEALTHY: 3, OVERSTOCK: 4 });
  assert.equal(seg.length, 4);
});

test('byStatus kosong tidak melempar', () => {
  assert.equal(segmenStatus(null).length, 4);
  assert.equal(segmenStatus(null).every((s) => s.n === 0), true);
});

test('sparkline memutus garis di titik kosong, tidak menyambung lurus', () => {
  const { d } = jalurSpark([10, null, 30, 40], 100, 20);
  // Dua 'M' = dua potongan; kalau disambung hanya ada satu.
  assert.equal((d.match(/M/g) ?? []).length, 2);
});

test('sparkline butuh minimal dua titik', () => {
  assert.equal(jalurSpark([5], 100, 20).d, '');
  assert.equal(jalurSpark([null, null], 100, 20).d, '');
});

test('nilai datar tidak membagi nol', () => {
  const { d, titikAkhir } = jalurSpark([7, 7, 7], 100, 20);
  assert.ok(d.length > 0);
  assert.ok(titikAkhir && Number.isFinite(titikAkhir.y));
});

test('lima kartu pas di dalam margin poster', () => {
  const w = lebarKartu(5);
  assert.equal(32 + 5 * w + 4 * 16 + 32, 1600);
});

test('setelan doi_display menentukan opsi mana yang digambar', () => {
  assert.equal(tampil1('OPSI1'), true);
  assert.equal(tampil2('OPSI1'), false);
  assert.equal(tampil1('OPSI2'), false);
  assert.equal(tampil2('OPSI2'), true);
  assert.equal(tampil1('BOTH'), true);
  assert.equal(tampil2('BOTH'), true);
  // Tanpa setelan (data lama) jangan menyembunyikan apa pun.
  assert.equal(tampil1(undefined), true);
  assert.equal(tampil2(undefined), true);
});

test('nomor opsi hilang dari label saat cuma satu yang tampil', () => {
  assert.equal(labelDoi(1, 'BOTH'), 'DOI OPSI 1');
  assert.equal(labelDoi(2, 'BOTH'), 'DOI OPSI 2');
  assert.equal(labelDoi(1, 'OPSI1'), 'DOI');
  assert.equal(labelDoi(2, 'OPSI2'), 'DOI');
});

test('sparkline memakai deret opsi yang ditampilkan, bukan selalu opsi 1', () => {
  const tren = [{ doi1: 10, doi2: 20 }, { doi1: 11, doi2: 21 }];
  assert.deepEqual(deretTren(tren, 'OPSI1'), [10, 11]);
  assert.deepEqual(deretTren(tren, 'OPSI2'), [20, 21]);
  assert.deepEqual(deretTren(tren, 'BOTH'), [10, 11]);
});

test('ADS besar tanpa desimal, ADS kecil dengan satu desimal', () => {
  assert.equal(adsTeks(33501), '33.501/hari');
  assert.equal(adsTeks(2180.4), '2.180/hari');
  assert.equal(adsTeks(12.54), '12,5/hari');
  assert.equal(adsTeks(0), '0,0/hari');
  assert.equal(adsTeks(null), '—');
});

// ---------------------------------------------------------------------------
// Rincian status (permintaan user 7 Okt 2026) + anggaran tinggi kartu.
// ---------------------------------------------------------------------------

test('pita DOI hanya empat, dan selalu empat walau nol', () => {
  const s = segmenStatus({ CRITICAL: 3, LOW: 2 });
  assert.deepEqual(s.map((x) => x.key), ['CRITICAL', 'LOW', 'HEALTHY', 'OVERSTOCK']);
  assert.deepEqual(s.map((x) => x.n), [3, 2, 0, 0]);
  // Status non-DOI TIDAK boleh bocor ke kelompok pita.
  assert.equal(segmenStatus({ WAITING: 9, DEAD_STOCK: 4 }).reduce((t, x) => t + x.n, 0), 0);
});

test('"Tunggu Kiriman" tampil sebagai SIT — istilah yang dipakai user', () => {
  const lain = segmenLain({ WAITING: 12 });
  const sit = lain.find((x) => x.key === 'WAITING');
  assert.equal(sit?.label, 'SIT');
  assert.equal(sit?.n, 12);
  assert.ok(!lain.some((x) => /tunggu/i.test(x.label)), 'istilah lama tidak boleh muncul lagi');
});

test('enam status keterangan dirinci satu per satu, bukan dilipat jadi "Lain"', () => {
  const lain = segmenLain({ WAITING: 1, DEAD_STOCK: 2, NO_SALES: 3, NPL_WAIT: 4, PHASE_OUT: 5, EXCLUDED: 6 });
  assert.deepEqual(lain.map((x) => x.label),
    ['SIT', 'Dead Stock', 'Belum Terjual', 'NPL', 'Phase Out', 'Dikecualikan']);
  assert.deepEqual(lain.map((x) => x.n), [1, 2, 3, 4, 5, 6]);
  assert.ok(!lain.some((x) => x.key === 'LAIN'), 'tidak ada baris lipatan saat semuanya dikenal');
});

test('yang bernilai 0 TETAP ditampilkan — tinggi kartu harus sama di semua area', () => {
  assert.equal(segmenLain({}).length, 6);
  assert.deepEqual(segmenLain({}).map((x) => x.n), [0, 0, 0, 0, 0, 0]);
});

test('status yang BELUM dikenal tidak hilang tanpa jejak', () => {
  // Kalau nanti doi.ts menambah status baru, ia harus tetap terlihat.
  const lain = segmenLain({ WAITING: 1, STATUS_BARU: 7, ENTAH_APA: 3 });
  const sisa = lain.find((x) => x.key === 'LAIN');
  assert.equal(sisa?.n, 10, '7 + 3 dijumlahkan, bukan dibuang');
  assert.equal(sisa?.label, 'Lain-lain');
});

test('poster LAMA memang sudah meluber — ini yang membuktikannya', () => {
  // kartuH nyata = 900 - 216 - 56. Dengan semua blok aktif dan kritisMaks 6,
  // tata letak sebelum 7 Okt 2026 butuh lebih dari itu. SVG tanpa clipPath tidak
  // memotong, jadi kelebihannya tergambar menimpa kaki poster tanpa ada yang
  // gagal. Tes ini merekam fakta itu supaya tidak terulang diam-diam.
  const KARTU_H = 900 - 216 - 56;
  assert.equal(KARTU_H, 628);
  const semua = { angka: true, status: true, tren: true, po: true };
  assert.ok(
    tinggiKartu({ blok: semua, nLain: 0, kritisMaks: 6 }) > KARTU_H,
    'tata letak lama (tanpa kelompok keterangan) saja sudah tidak muat',
  );
});

test('kritisYangMuat memotong daftar supaya kartu TIDAK meluber', () => {
  const KARTU_H = 628;
  const semua = { angka: true, status: true, tren: true, po: true };
  const muat = kritisYangMuat({ tinggiKartu: KARTU_H, blok: semua, diminta: 6 });
  assert.ok(muat < 6, `diminta 6, yang muat ${muat}`);
  assert.ok(
    tinggiKartu({ blok: semua, kritisMaks: muat }) <= KARTU_H,
    `hasilnya harus MUAT: butuh ${tinggiKartu({ blok: semua, kritisMaks: muat })} dari ${KARTU_H}`,
  );
  // Dan satu baris lebih banyak harus TIDAK muat — kalau tidak, pemotongannya
  // terlalu pelit dan ruang terbuang.
  if (muat > 0) {
    assert.ok(tinggiKartu({ blok: semua, kritisMaks: muat + 1 }) > KARTU_H, 'tidak boleh terlalu pelit');
  }
});

test('mematikan blok memberi ruang balik ke daftar mendesak', () => {
  const KARTU_H = 628;
  const tanpaTren = { angka: true, status: true, tren: false, po: true };
  const semua = { angka: true, status: true, tren: true, po: true };
  assert.ok(
    kritisYangMuat({ tinggiKartu: KARTU_H, blok: tanpaTren, diminta: 6 })
    > kritisYangMuat({ tinggiKartu: KARTU_H, blok: semua, diminta: 6 }),
  );
});

test('kritisYangMuat tidak pernah negatif walau kartunya mustahil kecil', () => {
  const muat = kritisYangMuat({ tinggiKartu: 100, blok: { angka: true, status: true, tren: true, po: true }, diminta: 6 });
  assert.equal(muat, 0);
});
