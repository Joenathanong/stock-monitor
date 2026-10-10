import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  teksTarget, teksTargetAtp, ruangTarget, pilihKanan, arahDoi, arahAtp, WARNA_TARGET, TANDA_TARGET,
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

const SIZE = 11;
/** Lebar isi kartu (di dalam padding) untuk sejumlah cabang. */
const isiUntuk = (n: number) => lebarKartu(n) - 2 * KARTU.pad;
/**
 * Kandidat teks sisi kanan dalam kasus TERBURUK: mode dua opsi DOI, persen dan
 * target sama-sama tiga digit. Diurut persis seperti di poster.tsx.
 */
const KANDIDAT_KANAN = ['ATP 100,0% · Target 100% (-)', 'ATP 100,0% / 100%', 'ATP 100,0%'];

// ---------------------------------------------------------------------------
// Arah: angka aktual terhadap targetnya
// ---------------------------------------------------------------------------

test('arah DOI memakai batas yang SAMA PERSIS dengan pitaDoi', () => {
  // `arahDoi` menyalin batas pita dari area-master alih-alih mengimpornya —
  // area-master memuat prisma, dan wa-poster ikut terbundel ke browser. Salinan
  // yang melenceng akan membuat poster menandai merah sebuah angka yang di
  // tabel DOI tertulis "Aman", tanpa ada yang gagal. Jadi disamakan di sini,
  // nilai demi nilai, bukan dipercaya.
  for (const ambang of [
    { kritis: 4, min: 5, max: 7 },
    { kritis: 7, min: 14, max: 21 },
    { kritis: 14, min: 31, max: 45 },
    { kritis: 0, min: 0, max: 0 },
  ]) {
    for (let doi = 0; doi <= 60; doi += 0.5) {
      const pita = pitaDoi(doi, ambang);
      const harap = pita === 'OVERSTOCK' ? 'lewat' : pita === 'HEALTHY' ? 'aman' : 'kurang';
      assert.equal(
        arahDoi(doi, ambang), harap,
        `DOI ${doi} pada ambang ${JSON.stringify(ambang)}: pitaDoi bilang ${pita}`,
      );
    }
  }
});

test('DOI di bawah pita aman JUGA ditandai, bukan hanya yang di atas', () => {
  // Kalau hanya sisi atas yang ditandai, kartu ber-DOI 2 hari (berisiko habis)
  // tampil setenang kartu yang memang sehat. Sisi bawah justru yang lebih mahal
  // akibatnya.
  const ambang = { kritis: 4, min: 5, max: 7 };
  assert.equal(arahDoi(2, ambang), 'kurang');
  assert.equal(arahDoi(6, ambang), 'aman');
  assert.equal(arahDoi(9.4, ambang), 'lewat');
});

test('tanpa angka atau tanpa ambang, arahnya null — bukan "aman"', () => {
  // "aman" adalah pernyataan. Yang belum diketahui tidak boleh dinyatakan aman.
  assert.equal(arahDoi(null, { kritis: 4, min: 5, max: 7 }), null);
  assert.equal(arahDoi(7, null), null);
  assert.equal(arahAtp(null, 90), null);
  assert.equal(arahAtp(72, null), null);
  assert.equal(arahAtp(72, 0), null);
});

test('ATP hanya punya sisi bawah — di atas target bukan masalah', () => {
  assert.equal(arahAtp(72, 90), 'kurang');
  assert.equal(arahAtp(90, 90), 'aman');
  assert.equal(arahAtp(99.9, 90), 'aman');
  assert.notEqual(arahAtp(99.9, 90), 'lewat');
});

// ---------------------------------------------------------------------------
// Penandaan: warna TIDAK pernah jadi satu-satunya pembawa arti
// ---------------------------------------------------------------------------

test('merah berarti "di luar target", untuk kedua arah', () => {
  assert.equal(WARNA_TARGET.lewat, WARNA.kritisFg);
  assert.equal(WARNA_TARGET.kurang, WARNA.kritisFg);
  assert.notEqual(WARNA_TARGET.aman, WARNA.kritisFg);
});

test('arah dibedakan oleh TANDA, bukan hanya warna', () => {
  // Poster ini dikirim sebagai gambar ke grup WhatsApp: diteruskan, dicetak,
  // dilihat orang yang tidak membedakan merah-hijau. Dua keadaan yang menuntut
  // tindakan BERLAWANAN (kurangi PO vs tambah PO) tidak boleh terlihat sama.
  assert.notEqual(TANDA_TARGET.lewat, TANDA_TARGET.kurang);
  assert.equal(TANDA_TARGET.aman, '');
  for (const t of [TANDA_TARGET.lewat, TANDA_TARGET.kurang]) {
    // ASCII saja: glyph di luar Latin dasar bisa jadi kotak tofu di mesin
    // perender bot, di gambar yang sudah terkirim.
    assert.match(t, /^[\x20-\x7E]+$/, `tanda "${t}" memuat karakter non-ASCII`);
  }
});

test('ejaan target memakai ambang "aman" apa adanya, plus tandanya', () => {
  assert.equal(teksTarget(7), 'Target 7 hari');
  assert.equal(teksTarget(7, 'lewat'), 'Target 7 hari (+)');
  assert.equal(teksTarget(45, 'kurang'), 'Target 45 hari (-)');
  assert.equal(teksTargetAtp(90), 'Target 90%');
  assert.equal(teksTargetAtp(90, 'kurang'), 'Target 90% (-)');
});

test('tanpa ambang/target tidak menulis "Target — hari"', () => {
  // "—" terbaca seperti ada nilai yang HILANG. Area tanpa ambang sendiri bukan
  // kehilangan apa pun: ia memakai ambang global. Target ATP yang belum diisi
  // juga bukan "0%", yang akan membuat semua kartu lulus diam-diam.
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
      for (const arah of ['aman', 'lewat', 'kurang'] as const) {
        const teks = teksTarget(max, arah);
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
  const kiri = teksTarget(999, 'lewat');
  const kanan = pilihKanan(KANDIDAT_KANAN, isi, kiri, SIZE);
  assert.notEqual(kanan, KANDIDAT_KANAN[0], 'bentuk terpanjang mestinya tidak muat di sini');
  assert.equal(potongTeks(kiri, ruangTarget(isi, kanan, SIZE), SIZE), kiri);
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
        const kiriPenuh = teksTarget(max, 'lewat');
        const kanan = pilihKanan(kandidat, isi, kiriPenuh, SIZE);
        const digambar = potongTeks(kiriPenuh, ruangTarget(isi, kanan, SIZE), SIZE);
        const wKiri = lebarTeksKira(digambar, SIZE);
        const wKanan = lebarTeksKira(potongTeks(kanan, isi, SIZE), SIZE);
        assert.ok(
          wKiri + JEDA_LABEL + wKanan <= isi + 0.001,
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
