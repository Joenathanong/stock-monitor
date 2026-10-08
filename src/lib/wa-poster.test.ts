import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pitaDoi } from './area-master';
import { adsTeks, angkaRingkas, deretTren, jalurSpark, labelDoi, lebarKartu, lebarTeksKira, gutterLabel, potongTeks, JEDA_LABEL, STATUS_POSTER, URUT_STATUS, URUT_LAIN, rupiahRingkas, segmenStatus, segmenLain, kunciTampil, labelPita, tinggiKartu, tataLetakStatus, tampil1, tampil2, KANVAS, KARTU, tinggiKartuTersedia, BIAYA_BLOK } from './wa-poster';

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
  // Angka di tes ini SENGAJA angka LAMA (kanvas 900), karena yang direkamnya
  // adalah fakta sejarah: kartu 628px dengan semua blok aktif dan kritisMaks 6
  // memang tidak cukup. SVG tanpa clipPath tidak memotong, jadi kelebihannya
  // tergambar menimpa kaki poster tanpa ada yang gagal. Jangan diganti mengikuti
  // kanvas sekarang — tes ini bukan tentang kanvas sekarang.
  const KARTU_H = 900 - 216 - 56;
  assert.equal(KARTU_H, 628);
  const semua = { angka: true, status: true, tren: true, po: true };
  // 5 baris pada jarak 20 (tata letak lama) + daftar 6 SKU.
  assert.ok(tinggiKartu({ blok: semua, nBaris: 5, pitch: 20, kritisMaks: 6 }) > KARTU_H);
});

test('sepuluh baris berbatang MUAT, dengan jarak baris yang mengalah', () => {
  const KARTU_H = tinggiKartuTersedia();
  const semua = { angka: true, status: true, tren: true, po: true };
  const t = tataLetakStatus({ tinggiKartu: KARTU_H, blok: semua, nBaris: 10, diminta: 6 });
  assert.ok(t.pitch >= 13 && t.pitch <= 20, `jarak ${t.pitch}`);
  const butuh = tinggiKartu({ blok: semua, nBaris: 10, pitch: t.pitch, kritisMaks: t.poMuat });
  assert.ok(butuh <= KARTU_H, `butuh ${butuh} dari ${KARTU_H} (jarak ${t.pitch}, po ${t.poMuat})`);
  assert.ok(t.poMuat >= 1, 'daftar mendesak harus kebagian minimal satu baris');
});

test('jarak baris dipilih yang TERBESAR yang masih muat, bukan yang terkecil', () => {
  const KARTU_H = tinggiKartuTersedia();
  const semua = { angka: true, status: true, tren: true, po: true };
  const t = tataLetakStatus({ tinggiKartu: KARTU_H, blok: semua, nBaris: 10, diminta: 6 });
  // Satu langkah lebih longgar harus membuat daftar PO kehabisan tempat —
  // kalau tidak, pilihannya terlalu pelit dan ruang terbuang.
  const lebihLonggar = [20, 18, 16, 14, 13].filter((p) => p > t.pitch).pop();
  if (lebihLonggar) {
    const tanpaPo = tinggiKartu({ blok: { ...semua, po: false }, nBaris: 10, pitch: lebihLonggar, kritisMaks: 0 });
    assert.ok(KARTU_H - tanpaPo - 22 < 30, `jarak ${lebihLonggar} seharusnya tidak menyisakan ruang untuk 1 baris PO`);
  }
});

test('mematikan blok memberi ruang balik — jarak melonggar atau daftar memanjang', () => {
  const KARTU_H = tinggiKartuTersedia();
  const semua = tataLetakStatus({ tinggiKartu: KARTU_H, blok: { angka: true, status: true, tren: true, po: true }, nBaris: 10, diminta: 6 });
  const tanpaTren = tataLetakStatus({ tinggiKartu: KARTU_H, blok: { angka: true, status: true, tren: false, po: true }, nBaris: 10, diminta: 6 });
  assert.ok(
    tanpaTren.pitch > semua.pitch || tanpaTren.poMuat > semua.poMuat,
    `tanpa tren: jarak ${tanpaTren.pitch} po ${tanpaTren.poMuat} vs semua: ${semua.pitch}/${semua.poMuat}`,
  );
});

test('kartu mustahil kecil: poMuat 0, dan tetap tidak melempar', () => {
  const t = tataLetakStatus({ tinggiKartu: 100, blok: { angka: true, status: true, tren: true, po: true }, nBaris: 10, diminta: 6 });
  assert.equal(t.poMuat, 0);
  assert.ok(t.pitch >= 13);
});

// ---------------------------------------------------------------------------
// Baris nol disembunyikan — tapi LINTAS AREA (aturan user 7 Okt 2026).
// ---------------------------------------------------------------------------

test('baris yang 0 di SEMUA area disembunyikan', () => {
  const tampil = kunciTampil([
    { CRITICAL: 5, HEALTHY: 100, WAITING: 2 },
    { CRITICAL: 1, HEALTHY: 90, WAITING: 0 },
  ]);
  assert.ok(!tampil.has('EXCLUDED'), 'Dikecualikan 0 di semua area -> hilang');
  assert.ok(!tampil.has('DEAD_STOCK'));
  assert.ok(!tampil.has('LOW'), 'aturan berlaku untuk pita DOI juga');
  assert.ok(tampil.has('CRITICAL') && tampil.has('HEALTHY') && tampil.has('WAITING'));
});

test('terisi di SATU area saja sudah cukup — barisnya muncul di SEMUA kartu', () => {
  const byStatus: Record<string, number>[] = [
    { HEALTHY: 100 },                    // Pusat: tidak ada dead stock
    { HEALTHY: 90, DEAD_STOCK: 3 },      // Medan: ada 3
  ];
  const tampil = kunciTampil(byStatus);
  assert.ok(tampil.has('DEAD_STOCK'));
  // Dan di kartu Pusat barisnya TETAP ada dengan nilai 0, supaya sejajar.
  const pusat = segmenLain(byStatus[0], tampil);
  const dead = pusat.find((x) => x.key === 'DEAD_STOCK');
  assert.equal(dead?.n, 0, 'tetap tampil sebagai 0, bukan hilang');
  // Jumlah baris harus SAMA di kedua kartu — kalau tidak, kolomnya tidak sejajar.
  assert.equal(segmenLain(byStatus[1], tampil).length, pusat.length);
  assert.equal(segmenStatus(byStatus[1], tampil).length, segmenStatus(byStatus[0], tampil).length);
});

test('semua nol: empat pita DOI tetap tampil, bukan blok kosong', () => {
  const tampil = kunciTampil([{}, null, undefined]);
  assert.deepEqual([...tampil].sort(), ['CRITICAL', 'HEALTHY', 'LOW', 'OVERSTOCK']);
  assert.equal(segmenLain({}, tampil).length, 0, 'kelompok keterangan kosong seluruhnya');
});

test('status tak dikenal ikut aturan yang sama', () => {
  const adaAsing = kunciTampil([{ HEALTHY: 5 }, { STATUS_BARU: 2 }]);
  assert.ok(adaAsing.has('LAIN'));
  // Dan muncul di kartu yang TIDAK punya status itu, bernilai 0.
  const tanpa = segmenLain({ HEALTHY: 5 }, adaAsing);
  assert.equal(tanpa.find((x) => x.key === 'LAIN')?.n, 0);
  assert.ok(!kunciTampil([{ HEALTHY: 5 }]).has('LAIN'), 'tanpa status asing, tidak ada baris itu');
});

test('jumlah baris menyusut, jadi jarak baris bisa melonggar', () => {
  const KARTU_H = tinggiKartuTersedia();
  const semua = { angka: true, status: true, tren: true, po: true };
  const sepuluh = tataLetakStatus({ tinggiKartu: KARTU_H, blok: semua, nBaris: 10, diminta: 6 });
  const enam = tataLetakStatus({ tinggiKartu: KARTU_H, blok: semua, nBaris: 6, diminta: 6 });
  assert.ok(
    enam.pitch >= sepuluh.pitch && (enam.pitch > sepuluh.pitch || enam.poMuat > sepuluh.poMuat),
    `6 baris: ${enam.pitch}/${enam.poMuat} vs 10 baris: ${sepuluh.pitch}/${sepuluh.poMuat}`,
  );
});

// ---------------------------------------------------------------------------
// Tata letak: tidak ada teks yang boleh keluar dari kartunya.
// Dilaporkan user 7 Okt 2026. SVG tidak membungkus & tidak punya ellipsis, jadi
// teks yang terlalu panjang MENIMPA tetangganya tanpa ada yang gagal — maka
// aturannya ditegakkan dengan assertion (ISO 9241-112 legibility, §6 skill).
// ---------------------------------------------------------------------------

const KARTU_W = lebarKartu(5, 1600, 32, 16);   // 294,4px — 5 area
const ISI = KARTU_W - 2 * 16;

test('lebar kartu 5 area seperti yang diasumsikan tes tata letak', () => {
  assert.ok(Math.abs(KARTU_W - 294.4) < 0.1, `${KARTU_W}`);
});

test('SETIAP label status muat di kolom labelnya — termasuk yang terpanjang', () => {
  const label = [...URUT_STATUS, ...URUT_LAIN, 'LAIN' as const].map((k) => STATUS_POSTER[k].label);
  for (const fs of [10, 11]) {
    const g = gutterLabel(label, fs);
    for (const t of label) {
      assert.ok(
        lebarTeksKira(t, fs) <= g - JEDA_LABEL + 0.01,
        `"${t}" ${lebarTeksKira(t, fs).toFixed(0)}px tidak muat di gutter ${g}px (fs ${fs})`,
      );
    }
  }
});

test('gutter 62px yang LAMA memang tidak cukup — ini bug yang dilaporkan user', () => {
  // Rekaman fakta: dengan gutter dipatok 62px, dua label baru menabrak batang.
  assert.ok(lebarTeksKira('Belum Terjual', 11) > 62);
  assert.ok(lebarTeksKira('Dikecualikan', 11) > 62);
  // Dan dengan gutter terhitung, keduanya aman.
  const g = gutterLabel(['Belum Terjual', 'Dikecualikan'], 11);
  assert.ok(lebarTeksKira('Belum Terjual', 11) <= g - JEDA_LABEL);
});

test('label + batang + angka selalu muat dalam isi kartu', () => {
  const label = [...URUT_STATUS, ...URUT_LAIN].map((k) => STATUS_POSTER[k].label);
  for (const fs of [10, 11]) {
    const gLabel = gutterLabel(label, fs);
    // Angka terburuk yang realistis: 4 digit (ribuan SKU).
    const gAngka = Math.ceil(lebarTeksKira('9999', fs, true)) + 8;
    const barW = Math.max(24, ISI - gLabel - gAngka);
    assert.ok(gLabel + barW + gAngka <= ISI + 0.01, `fs ${fs}: ${gLabel}+${barW}+${gAngka} > ${ISI}`);
    assert.ok(barW >= 60, `batang ${barW}px terlalu pendek untuk dibaca sebagai porsi`);
  }
});

test('potongTeks memangkas yang kepanjangan, membiarkan yang muat', () => {
  assert.equal(potongTeks('Low', 60, 11), 'Low');
  const p = potongTeks('Belum Terjual Sekali Pun', 50, 11);
  assert.ok(p.endsWith('…') && p.length < 'Belum Terjual Sekali Pun'.length);
  assert.ok(lebarTeksKira(p, 11) <= 50 + 11 * 0.56, 'hasil potongan muat (toleransi 1 karakter elipsis)');
});

test('nama area dan lencana kritis muat di kepala kartu', () => {
  // Kepala: nama area 19px di kiri, lencana "NNN kritis" 74px di kanan.
  for (const nama of ['Pusat', 'Medan', 'Makassar', 'Surabaya', 'Yogyakarta']) {
    assert.ok(
      lebarTeksKira(nama, 19) + 74 + 8 <= ISI,
      `"${nama}" ${lebarTeksKira(nama, 19).toFixed(0)}px + lencana tidak muat di ${ISI}px`,
    );
  }
});

test('strip ringkasan atas: label terpanjang muat di kolomnya', () => {
  // 9 kolom saat kedua opsi DOI tampil; label 12px, angka rFs 20px.
  const kolom = (1600 - 2 * 32) / 9;
  for (const l of ['SKU dihitung', 'Dalam perjalanan', 'Nilai + Nilai SIT', 'Kritis + Low', 'DOI Opsi 1', 'ADS']) {
    assert.ok(lebarTeksKira(l, 12) <= kolom, `label "${l}" tidak muat di kolom ${kolom.toFixed(0)}px`);
  }
  for (const v of ['Rp 52,4 M', '56.115/hari', '1,1 jt pcs', '20,4 hari', '157 SKU']) {
    assert.ok(lebarTeksKira(v, 20) <= kolom, `angka "${v}" tidak muat di kolom ${kolom.toFixed(0)}px`);
  }
});

// ---------------------------------------------------------------------------
// Label pita dengan ambang hari (permintaan user 7 Okt 2026).
// ---------------------------------------------------------------------------

test('label pita memuat ambang hari area itu', () => {
  const pusat = { kritis: 4, min: 5, max: 7 };
  assert.equal(labelPita('CRITICAL', pusat), 'Kritis ≤4D');
  assert.equal(labelPita('LOW', pusat), 'Low ≤5D');
  assert.equal(labelPita('HEALTHY', pusat), 'Aman ≤7D');
  assert.equal(labelPita('OVERSTOCK', pusat), 'Over >7D');
});

test('Over memakai ">" BUKAN "≥" — hari ke-max masih Aman', () => {
  const pusat = { kritis: 4, min: 5, max: 7 };
  const l = labelPita('OVERSTOCK', pusat);
  assert.ok(!l.includes('≥'), `"${l}" tidak boleh memakai ≥: hari ke-7 itu AMAN, bukan overstock`);
  // Dan harus konsisten dengan pitaDoi, bukan hanya enak dibaca.
  assert.equal(pitaDoi(7, pusat), 'HEALTHY');
  assert.equal(pitaDoi(8, pusat), 'OVERSTOCK');
});

test('ambang beda per kota -> label beda', () => {
  assert.equal(labelPita('CRITICAL', { kritis: 14, min: 31, max: 45 }), 'Kritis ≤14D');
  assert.equal(labelPita('OVERSTOCK', { kritis: 14, min: 31, max: 45 }), 'Over >45D');
});

test('tanpa ambang, label tetap terbaca (Over tanpa angka)', () => {
  assert.equal(labelPita('OVERSTOCK', null), 'Over');
  assert.equal(labelPita('CRITICAL', undefined), 'Kritis');
  assert.equal(labelPita('DEAD_STOCK', null), 'Dead Stock', 'kelompok keterangan tidak punya ambang hari');
  assert.equal(labelPita('WAITING', { kritis: 4, min: 5, max: 7 }), 'SIT');
});

test('label berambang TETAP muat di kolom label kartu 294px', () => {
  // Inilah yang mudah terlewat: menambah "≤45D" membuat label lebih panjang.
  for (const ambang of [{ kritis: 4, min: 5, max: 7 }, { kritis: 14, min: 31, max: 45 }]) {
    const semua = [...URUT_STATUS, ...URUT_LAIN].map((k) => labelPita(k, ambang));
    for (const fs of [10, 11]) {
      const g = gutterLabel(semua, fs);
      const gAngka = Math.ceil(lebarTeksKira('9999', fs, true)) + 8;
      const barW = Math.max(24, ISI - g - gAngka);
      for (const t of semua) {
        assert.ok(lebarTeksKira(t, fs) <= g - JEDA_LABEL + 0.01, `"${t}" tidak muat di gutter ${g}px (fs ${fs})`);
      }
      assert.ok(barW >= 60, `batang ${barW.toFixed(0)}px terlalu pendek (gutter ${g}px, fs ${fs})`);
    }
  }
});

// ---------------------------------------------------------------------------
// ATP masuk blok angka (8 Okt 2026) — kanvas naik 900 → 1000.
// ---------------------------------------------------------------------------

test('tinggi kartu berasal dari KANVAS, bukan angka tertulis', () => {
  // Dulu 628 ditulis mati di tes ini dan `900 - 216 - 56` ditulis di poster.tsx.
  // Dua tempat untuk satu angka: mengubah kanvas membuat tes menjaga tinggi yang
  // tidak dipakai siapa pun, dan luberan yang mestinya ketahuan jadi lolos.
  assert.equal(tinggiKartuTersedia(), KANVAS.h - KARTU.y - KARTU.bawah);
  assert.equal(tinggiKartuTersedia({ h: 900 }), 628, 'rumusnya sama dengan yang lama');
});

test('blok angka = 4 baris kotak, dan biayanya cocok dengan posternya', () => {
  // `BIAYA_BLOK.angka` harus sama dengan jumlah kenaikan `cy` di poster.tsx:
  //   26 (label) + 34 (angka besar) + 26 (jeda) + (4 * 46 - 6 + 8) (grid kotak)
  // Kalau salah satunya digeser sendirian, isinya meluber dan SVG tidak memotong.
  assert.equal(BIAYA_BLOK.angka, 26 + 34 + 26 + (4 * 46 - 6 + 8));
  assert.equal(BIAYA_BLOK.angka, 272);
  // Pasangan ATP menambah tepat satu baris kotak dari tata letak 3 baris.
  assert.equal(BIAYA_BLOK.angka - (26 + 34 + 26 + (3 * 46 - 6 + 8)), 46);
});

test('ATP masuk tanpa mengorbankan jarak baris atau daftar mendesak', () => {
  const semua = { angka: true, status: true, tren: true, po: true };
  const H = tinggiKartuTersedia();
  const t = tataLetakStatus({ tinggiKartu: H, blok: semua, nBaris: 10, diminta: 6 });

  // Inilah imbalan kanvas yang lebih tinggi, dan alasan kenaikannya layak:
  // jarak baris status naik ke yang PALING longgar (20, sebelumnya 16) DAN
  // daftar mendesak tetap kebagian baris. Kalau salah satu turun, kenaikan
  // kanvasnya tidak cukup dan angkanya harus ditinjau — bukan dibiarkan.
  assert.equal(t.pitch, BIAYA_BLOK.pitchPilihan[0], `jarak baris ${t.pitch}, harusnya paling longgar`);
  assert.ok(t.poMuat >= 1, `daftar mendesak kebagian ${t.poMuat} baris`);

  const butuh = tinggiKartu({ blok: semua, nBaris: 10, pitch: t.pitch, kritisMaks: t.poMuat });
  assert.ok(butuh <= H, `butuh ${butuh} dari ${H}`);
});

test('kanvas 900 TIDAK cukup lagi setelah ATP masuk — ini yang membayar kenaikannya', () => {
  // Pembenaran kenaikan kanvas, bukan selera. Di 628px, blok angka 4 baris
  // memaksa jarak baris status turun ke bawah 20 — persis mundur dari yang baru
  // saja diperbaiki 7 Okt 2026.
  const semua = { angka: true, status: true, tren: true, po: true };
  const lama = tataLetakStatus({ tinggiKartu: 628, blok: semua, nBaris: 10, diminta: 6 });
  const baru = tataLetakStatus({ tinggiKartu: tinggiKartuTersedia(), blok: semua, nBaris: 10, diminta: 6 });
  assert.ok(baru.pitch > lama.pitch, `kanvas baru ${baru.pitch} harus lebih longgar dari ${lama.pitch}`);
  assert.ok(baru.poMuat >= lama.poMuat, 'daftar mendesak tidak boleh memendek');
});
