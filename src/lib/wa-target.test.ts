import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  teksTarget, teksTargetAtp, ruangTarget, pilihKanan, nilaiDoi, nilaiAtp, warnaTarget, UKURAN_TARGET,
  potongTeks, lebarTeksKira, lebarKartu, KARTU, JEDA_LABEL, WARNA,
} from './wa-poster';
import { pitaDoi } from './area-master';

/**
 * Penjaga: TARGET DOI & TARGET ATP DI POSTER /wa.
 *
 * Permintaan user 10 Okt 2026, dua langkah:
 *   1. "Masukan Target DOI untuk setiap Area ke /wa. Target DOI diambil dari
 *      angka aman (hari) cabang per area."
 *   2. "buat agar target di bold dan beri warna yang mencolok, merah misalnya
 *      jika aktual lebih dari target. lalu atp juga akan ada Targetnya ... dan
 *      merah jika dibawah atp."
 *
 * KENAPA target DOI bukan hiasan. Ambang asli per cabang (Pengaturan, 10 Okt):
 *
 *   Pusat aman <=7   Medan aman <=21   Surabaya aman <=20
 *   Makassar aman <=45   Yogyakarta aman <=35
 *
 * Targetnya berbeda 6,4x antar cabang. Tanpa target tertulis di kartu, angka
 * DOI besar TIDAK BISA dibandingkan antar kartu: "9,4" di Pusat (target 7) dan
 * "48,3" di Makassar (target 45) terbaca seperti dua dunia yang berlawanan,
 * padahal keduanya sama-sama lewat target — dan Pusat justru yang paling jauh
 * secara relatif.
 */

const SIZE = UKURAN_TARGET;
/** Lebar isi kartu (di dalam padding) untuk sejumlah cabang. */
const isiUntuk = (n: number) => lebarKartu(n) - 2 * KARTU.pad;
/**
 * Kandidat teks sisi kanan dalam kasus TERBURUK: mode dua opsi DOI, persen dan
 * target sama-sama tiga digit. Diurut persis seperti di poster.tsx.
 */
const KANDIDAT_KANAN = ['ATP 100,0% · Target 100% (-)', 'ATP 100,0% / 100%', 'ATP 100,0%'];

// ---------------------------------------------------------------------------
// Arah penilaian: DOI dan ATP BERLAWANAN
// ---------------------------------------------------------------------------

test('DOI di bawah atau tepat di target = HIJAU; di atas = merah', () => {
  // KEPUTUSAN USER 12 Okt 2026: "target DOI itu adalah max (semakin kecil
  // semakin bagus), jadi seharusnya jika IEG tidak sampai 7, targetnya menjadi
  // hijau. Ini berlaku di semua cabang."
  const pusat = { kritis: 4, min: 6, max: 7 };
  assert.equal(nilaiDoi(5, pusat)!.baik, true, 'di bawah plafon = target tercapai');
  assert.equal(nilaiDoi(7, pusat)!.baik, true, 'tepat di plafon masih tercapai');
  assert.equal(nilaiDoi(7.1, pusat)!.baik, false);
  assert.equal(nilaiDoi(9.4, pusat)!.baik, false);
});

test('DOI tipis TIDAK lagi dimerahkan di baris target', () => {
  // Perubahan sadar dari aturan 10 Okt, yang memerahkan kedua sisi. Alasannya
  // tidak salah — kehabisan stok lebih mahal daripada kelebihan — tapi
  // tempatnya bukan baris ini: risiko kehabisan sudah dibawa lencana "N kritis"
  // di kepala kartu dan pita Kritis/Low tepat di bawahnya. Baris target
  // menjawab pertanyaan lain: "apakah kita di dalam plafon persediaan?".
  const pusat = { kritis: 4, min: 6, max: 7 };
  const tipis = nilaiDoi(2, pusat)!;
  assert.equal(tipis.baik, true, 'DOI 2 hari tetap "di dalam plafon"');
  assert.equal(tipis.tanda, ' (-)', 'tapi tandanya tetap menyatakan posisinya di bawah target');
});

test('ATP arahnya KEBALIKAN: di atas atau tepat target = hijau', () => {
  assert.equal(nilaiAtp(95, 90)!.baik, true);
  assert.equal(nilaiAtp(90, 90)!.baik, true, 'tepat di target sudah tercapai');
  assert.equal(nilaiAtp(72, 90)!.baik, false);
});

test('tanda selalu POSISI, warna selalu BAIK — dua kanal terpisah', () => {
  // Inilah yang membuat dua ukuran berlawanan bisa duduk bersebelahan di satu
  // kartu tanpa membingungkan. Kalau tanda ikut memikul "baik/buruk", simbol
  // yang sama akan berarti hal berbeda di dua angka yang bertetangga.
  const pusat = { kritis: 4, min: 6, max: 7 };
  const doiBawah = nilaiDoi(5, pusat)!;
  const atpBawah = nilaiAtp(72, 90)!;
  assert.equal(doiBawah.tanda, atpBawah.tanda, 'sama-sama di bawah target -> tanda sama');
  assert.notEqual(doiBawah.baik, atpBawah.baik, 'tapi artinya berlawanan');
  assert.equal(warnaTarget(doiBawah.baik), WARNA.amanFg, 'DOI di bawah target = hijau');
  assert.equal(warnaTarget(atpBawah.baik), WARNA.kritisFg, 'ATP di bawah target = merah');
});

test('tepat di target tidak memakai tanda sama sekali', () => {
  assert.equal(nilaiDoi(7, { kritis: 4, min: 6, max: 7 })!.tanda, '');
  assert.equal(nilaiAtp(90, 90)!.tanda, '');
});

test('tanda memakai ASCII, bukan simbol yang bisa jadi tofu', () => {
  // Poster diserialkan jadi SVG lalu dirender ke JPG oleh bot. Glyph di luar
  // Latin dasar bergantung pada font yang kebetulan ada di mesin perender, dan
  // yang hilang jadi kotak kosong di gambar yang SUDAH terkirim ke grup.
  for (const t of [nilaiDoi(9, { kritis: 4, min: 6, max: 7 })!.tanda, nilaiDoi(2, { kritis: 4, min: 6, max: 7 })!.tanda]) {
    assert.match(t, /^[\x20-\x7E]*$/, `tanda "${t}" memuat karakter non-ASCII`);
  }
});

test('tanpa angka atau tanpa target, nilainya null — bukan "baik"', () => {
  // "baik" adalah pernyataan. Yang belum diketahui tidak boleh dinyatakan baik,
  // karena kartunya akan berwarna hijau untuk sesuatu yang belum diukur.
  assert.equal(nilaiDoi(null, { kritis: 4, min: 6, max: 7 }), null);
  assert.equal(nilaiDoi(7, null), null);
  assert.equal(nilaiAtp(null, 90), null);
  assert.equal(nilaiAtp(72, null), null);
  assert.equal(nilaiAtp(72, 0), null, '0 = belum diatur, bukan "semua lulus"');
});

test('ejaan target memakai ambang apa adanya, plus tandanya', () => {
  const pusat = { kritis: 4, min: 6, max: 7 };
  assert.equal(teksTarget(7), 'Target 7 hari');
  assert.equal(teksTarget(7, nilaiDoi(9, pusat)), 'Target 7 hari (+)');
  assert.equal(teksTarget(7, nilaiDoi(5, pusat)), 'Target 7 hari (-)');
  assert.equal(teksTargetAtp(90), 'Target 90%');
  assert.equal(teksTargetAtp(90, nilaiAtp(72, 90)), 'Target 90% (-)');
  assert.equal(teksTargetAtp(90, nilaiAtp(95, 90)), 'Target 90% (+)');
});

test('tanpa ambang/target tidak menulis "Target — hari"', () => {
  for (const kosong of [null, undefined, NaN, Infinity]) {
    assert.equal(teksTarget(kosong as number), '');
    assert.equal(teksTargetAtp(kosong as number), '');
  }
});

// ---------------------------------------------------------------------------
// Tata letak: kedua teks berbagi SATU baris 26px yang sudah ada
// ---------------------------------------------------------------------------

test('di 5 cabang, target DOI TIDAK pernah terpotong', () => {
  // 5 cabang adalah keadaan nyata hari ini. Target yang terpotong jadi
  // "Target 4…" membalik artinya, persis seperti ambang "<=14D" yang terpotong
  // jadi "<=1D". Diuji sampai 999 hari supaya ambang yang digeser jauh pun aman.
  const isi = isiUntuk(5);
  for (const kandidat of [[], ['Target 90% (-)'], KANDIDAT_KANAN]) {
    for (const max of [7, 20, 21, 35, 45, 99, 365, 999]) {
      for (const arah of ['', ' (+)', ' (-)'] as const) {
        const teks = teksTarget(max, { tanda: arah, baik: true });
        const kanan = pilihKanan(kandidat, isi, teks, SIZE);
        const ruang = ruangTarget(isi, kanan, SIZE);
        assert.equal(
          potongTeks(teks, ruang, SIZE), teks,
          `"${teks}" terpotong di 5 cabang (ruang ${ruang.toFixed(1)}px, kanan "${kanan}")`,
        );
      }
    }
  }
});

test('bentuk kanan MENGALAH lebih dulu, bukan target DOI yang dipotong', () => {
  // Urutannya disengaja: sisi kanan punya beberapa bentuk, sisi kiri tidak.
  // Jadi yang pertama berkorban adalah kelengkapan teks kanan ("· Target 90%"
  // jadi "/ 90%"), bukan angka hari di kiri yang kalau terpotong jadi salah.
  const isi = isiUntuk(5);
  const kiri = teksTarget(999, { tanda: ' (+)', baik: false });
  const kanan = pilihKanan(KANDIDAT_KANAN, isi, kiri, SIZE);
  assert.notEqual(kanan, KANDIDAT_KANAN[0], 'bentuk terpanjang mestinya tidak muat di sini');
  assert.equal(potongTeks(kiri, ruangTarget(isi, kanan, SIZE), SIZE), kiri);
});

test('kartu terlalu sempit: sisi kanan DIHILANGKAN, bukan dua teks terpotong', () => {
  // Ditemukan tes ini sendiri saat ukuran dinaikkan 11 -> 13 pada 12 Okt 2026.
  // Di kartu 9 cabang teks kanan terpendek memakan 102px dari 124px isi kartu,
  // menyisakan 22px — cukup untuk "T…" dan tidak lebih, dan jumlah keduanya
  // justru melebihi lebar kartu.
  const isi = isiUntuk(9);
  assert.equal(pilihKanan(KANDIDAT_KANAN, isi, teksTarget(7, null), SIZE), '', 'terlalu sempit untuk keduanya');
  // Di 5 cabang masih muat, jadi penghilangan ini tidak kebablasan.
  assert.notEqual(pilihKanan(KANDIDAT_KANAN, isiUntuk(5), teksTarget(7, null), SIZE), '');
});

test('target DOI dan teks kanan tidak pernah bertumpuk, sampai 10 cabang', () => {
  // Menambah cabang menyempitkan kartu; di suatu titik kedua teks tidak muat
  // berdampingan betapapun kanannya diperpendek. Yang dijaga: pada titik itu
  // target DIPOTONG, bukan digambar menimpa teks di kanannya — SVG tidak punya
  // ellipsis dan tidak membungkus, jadi tabrakan tergambar tanpa ada yang gagal.
  for (let n = 5; n <= 10; n++) {
    const isi = isiUntuk(n);
    for (const max of [7, 45, 999]) {
      for (const kandidat of [['Target 90% (-)'], KANDIDAT_KANAN]) {
        const kiriPenuh = teksTarget(max, { tanda: ' (+)', baik: false });
        const kanan = pilihKanan(kandidat, isi, kiriPenuh, SIZE);
        const digambar = potongTeks(kiriPenuh, ruangTarget(isi, kanan, SIZE), SIZE);
        const wKiri = lebarTeksKira(digambar, SIZE);
        const wKanan = kanan ? lebarTeksKira(potongTeks(kanan, isi, SIZE), SIZE) : 0;
        // Jeda hanya ada kalau sisi kanan memang ada isinya.
        assert.ok(
          wKiri + (kanan ? JEDA_LABEL : 0) + wKanan <= isi + 0.001,
          `${n} cabang, target ${max}: "${digambar}" (${wKiri.toFixed(1)}px) + "${kanan}" `
          + `(${wKanan.toFixed(1)}px) melebihi isi kartu ${isi.toFixed(1)}px`,
        );
      }
    }
  }
});

test('tanpa teks kanan, seluruh lebar kartu milik target DOI', () => {
  const isi = isiUntuk(5);
  assert.equal(ruangTarget(isi, '', SIZE), isi);
  assert.equal(pilihKanan([], isi, 'Target 7 hari', SIZE), '');
  assert.ok(ruangTarget(isi, KANDIDAT_KANAN[0], SIZE) < isi);
});
