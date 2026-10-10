import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KODE_AREA_BAWAAN, TANPA_KODE, petaKodeArea, namaAreaDari, areaAktif,
  ambangDoi, pitaDoi, ringkasPita, validasiArea, peringatanArea, kolomTersimpan, areaBelumTerdaftar, normalKode, type BarisArea,
} from './area-master';

const area = (o: Partial<BarisArea> = {}): BarisArea => ({
  code: 'GJSB', name: 'Surabaya', isActive: true, sortOrder: 10,
  doiCritical: null, doiMin: null, doiMax: null,
  leadTimeDays: null, atpTarget: null, startDate: null, note: null, ...o,
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

test('ambang DOI dibaca dari BARISNYA SENDIRI, tanpa angka global', () => {
  assert.deepEqual(
    ambangDoi(area({ doiCritical: 4, doiMin: 5, doiMax: 7 })),
    { kritis: 4, min: 5, max: 7 },
  );
});

test('baris yang belum lengkap mengembalikan null, BUKAN angka tebakan', () => {
  // PERUBAHAN 10 Okt 2026. Dulu kolom kosong jatuh ke tiga pengaturan global,
  // dan itu yang membuat ada dua tempat mengatur satu hal: yang global mati
  // diam-diam untuk kelima cabang, tapi angkanya tetap terpajang di Dashboard
  // dan /tv sebagai "Target DOI 14 hari" — tidak benar untuk satu cabang pun.
  //
  // Sekarang "belum lengkap" adalah keadaan yang HARUS diputuskan pemanggil
  // (compute.ts jatuh ke baris GABUNGAN, layar menulis "belum diatur"), bukan
  // ditambal di dalam fungsi ini tanpa ada yang tahu.
  assert.equal(ambangDoi(area({ doiMin: 21 })), null, 'dua kolom lain masih kosong');
  assert.equal(ambangDoi(area({ doiCritical: 4, doiMin: 5 })), null, 'doiMax kosong');
  assert.equal(ambangDoi(null), null);
  assert.equal(ambangDoi(area()), null);
});

test('kritis DIPAKSA di bawah min, bukan hanya divalidasi di form', () => {
  // Baris yang tersimpan sebelum aturan ini ada tidak boleh membuat pita LOW
  // hilang. 20 >= 10, jadi dipotong ke 9.
  assert.deepEqual(ambangDoi(area({ doiCritical: 20, doiMin: 10, doiMax: 14 })), { kritis: 9, min: 10, max: 14 });
  // min 0 -> kritis tidak boleh negatif.
  assert.equal(ambangDoi(area({ doiCritical: 5, doiMin: 0, doiMax: 0 }))!.kritis, 0);
});

test('maks DIANGKAT ke min — "pesan sampai penuh" tidak boleh mengurangi stok', () => {
  assert.deepEqual(ambangDoi(area({ doiCritical: 7, doiMin: 21, doiMax: 14 })), { kritis: 7, min: 21, max: 21 });
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
    const a = ambangDoi(area({ doiCritical: kritis, doiMin: min, doiMax: max }))!;
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

/** Baris yang sah: ketiga ambang terisi — wajib sejak 10 Okt 2026. */
const SAH = { doiCritical: 7, doiMin: 14, doiMax: 21 };

test('validasi: ketiga ambang WAJIB diisi', () => {
  // Dulu boleh kosong dan jatuh ke pengaturan global. Global sudah dicabut,
  // jadi baris tanpa ambang bukan "pakai bawaan" lagi — ia tidak bisa dihitung
  // sama sekali. Ditolak di sini, bukan dibiarkan lalu ditambal diam-diam saat
  // menghitung.
  const g = validasiArea({ code: 'GJSB', name: 'Surabaya' });
  assert.deepEqual(g.map((x) => x.field).sort(), ['doiCritical', 'doiMax', 'doiMin']);
  assert.deepEqual(validasiArea({ code: 'GJSB', name: 'Surabaya', ...SAH }), []);
});

test('validasi: lead time & target ATP boleh kosong, tapi dibatasi kalau diisi', () => {
  // Berbeda dari ambang: keduanya tidak menentukan status, jadi barisnya tetap
  // bisa dipakai tanpa mereka — kekosongannya muncul sebagai PERINGATAN, bukan
  // galat, supaya orang tidak terkunci saat membuka cabang baru.
  assert.deepEqual(validasiArea({ code: 'A1', name: 'X', ...SAH, leadTimeDays: null, atpTarget: null }), []);
  assert.equal(validasiArea({ code: 'A1', name: 'X', ...SAH, leadTimeDays: -1 }).some((g) => g.field === 'leadTimeDays'), true);
  assert.equal(validasiArea({ code: 'A1', name: 'X', ...SAH, atpTarget: 0 }).some((g) => g.field === 'atpTarget'), true);
  assert.equal(validasiArea({ code: 'A1', name: 'X', ...SAH, atpTarget: 101 }).some((g) => g.field === 'atpTarget'), true);
  assert.deepEqual(validasiArea({ code: 'A1', name: 'X', ...SAH, leadTimeDays: 7, atpTarget: 95 }), []);
});

test('peringatan: lead time lebih lama daripada ambang kritis = gudang dipastikan kosong', () => {
  // Bukan galat — angkanya mungkin memang begitu, dan menolaknya berarti
  // menghalangi orang menyimpan keadaan yang sebenarnya. Tapi diam soal ini
  // berarti alarm "kritis" berbunyi ketika kehabisan stok SUDAH tidak bisa
  // dihindari, dan tidak ada satu layar pun yang menyebutkannya.
  //
  // Kasus nyata hari ini: Pusat kritis <=4 hari dengan lead time 7 hari.
  const p = peringatanArea({ code: 'GBJD', name: 'Pusat', doiCritical: 4, doiMin: 5, doiMax: 7, leadTimeDays: 7 });
  const lubang = p.find((x) => x.field === 'doiCritical');
  assert.ok(lubang, 'lubang lead time vs kritis harus diperingatkan');
  assert.match(lubang!.pesan, /3 hari/, 'selisihnya disebut, bukan cuma "tidak cocok"');
  // Lead time <= kritis: tidak ada lubang.
  assert.equal(
    peringatanArea({ code: 'A1', name: 'X', doiCritical: 14, doiMin: 21, doiMax: 35, leadTimeDays: 7 })
      .some((x) => x.field === 'doiCritical'),
    false,
  );
});

test('validasi: kode & nama wajib, format kode dijaga', () => {
  assert.deepEqual(validasiArea({ code: 'GJSB', name: 'Surabaya', ...SAH }), []);
  assert.equal(validasiArea({ code: '', name: 'X' }).some((g) => g.field === 'code'), true);
  assert.equal(validasiArea({ code: 'G-JSB', name: 'X' }).some((g) => g.field === 'code'), true);
  assert.equal(validasiArea({ code: 'GJSB', name: '' }).some((g) => g.field === 'name'), true);
});

test('nama GABUNGAN hanya untuk baris berkode GABUNGAN', () => {
  // Sejak 10 Okt 2026 laporan gabungan punya barisnya sendiri di tabel ini.
  // Yang menentukan baris itu adalah KODE-nya, bukan namanya — kalau namanya,
  // dua baris bisa sama-sama mengaku gabungan dan yang dipakai jadi urusan
  // urutan baris.
  assert.equal(validasiArea({ code: 'GAB', name: 'GABUNGAN', ...SAH }).some((g) => g.field === 'name'), true);
  assert.equal(validasiArea({ code: 'GAB', name: 'gabungan', ...SAH }).some((g) => g.field === 'name'), true);
  assert.deepEqual(validasiArea({ code: 'GABUNGAN', name: 'GABUNGAN', ...SAH }), [], 'baris gabungan yang sah');
  assert.equal(
    validasiArea({ code: 'GABUNGAN', name: 'Pusat', ...SAH }).some((g) => g.field === 'name'), true,
    'kode GABUNGAN tapi bernama kota = baris gabungan yang menyamar jadi cabang',
  );
});

test('validasi: maks tidak boleh di bawah min, negatif ditolak', () => {
  assert.equal(validasiArea({ code: 'A1', name: 'X', doiCritical: 4, doiMin: 10, doiMax: 5 }).some((g) => g.field === 'doiMax'), true);
  assert.equal(validasiArea({ code: 'A1', name: 'X', doiCritical: 0, doiMin: -1, doiMax: 5 }).some((g) => g.field === 'doiMin'), true);
  assert.deepEqual(validasiArea({ code: 'A1', name: 'X', doiCritical: 4, doiMin: 5, doiMax: 5 }), []);
});

test('validasi: tanggal mulai harus YYYY-MM-DD', () => {
  assert.equal(validasiArea({ code: 'A1', name: 'X', ...SAH, startDate: '01-06-2026' }).some((g) => g.field === 'startDate'), true);
  assert.deepEqual(validasiArea({ code: 'A1', name: 'X', ...SAH, startDate: '2026-06-01' }), []);
});

test('area yang ada di data tapi belum terdaftar ikut dilaporkan', () => {
  const rows = [area({ code: 'GBJD', name: 'Pusat' })];
  assert.deepEqual(areaBelumTerdaftar(['Pusat', 'Bali', 'GABUNGAN', '', 'Bali'], rows), ['Bali']);
});

test('normalKode merapikan spasi & huruf', () => {
  assert.equal(normalKode('  gjsb '), 'GJSB');
  assert.equal(normalKode(null), '');
});

// ---------------------------------------------------------------------------
// Penyimpanan: TIDAK BOLEH ADA KOLOM YANG DIJATUHKAN DIAM-DIAM
// ---------------------------------------------------------------------------

test('kolomTersimpan memuat SETIAP kolom baris, tanpa kecuali', () => {
  // KEJADIAN NYATA 10 Okt 2026. Kolom lead time & target ATP dipasang pagi
  // harinya; siangnya user melapor: "seting leadtime pusat sudah di set 1,
  // kenapa data tabel masih menampilkan 2?" Ternyata angkanya tidak pernah
  // tersimpan — di database masih null.
  //
  // Route PUT menyusun objek untuk Prisma dengan mengetik ulang nama kolomnya
  // satu per satu. Dua kolom baru lolos validasi, diterima API, lalu dijatuhkan
  // di langkah terakhir. Layar menampilkan pesan hijau "tersimpan" untuk
  // perubahan yang tidak terjadi.
  //
  // Tes ini membandingkan kolom yang DISIMPAN dengan kolom yang ADA di baris.
  // Menambah kolom ke BarisArea tanpa menyimpannya kini gagal di sini, bukan
  // berbulan kemudian saat ada yang sadar angkanya tidak pernah berubah.
  const lengkap: BarisArea = {
    code: 'GBJD', name: 'Pusat', isActive: true, sortOrder: 10,
    doiCritical: 4, doiMin: 6, doiMax: 7,
    leadTimeDays: 1, atpTarget: 95, startDate: '2026-06-01', note: 'catatan',
  };
  const tersimpan = kolomTersimpan(lengkap);
  const diharapkan = Object.keys(lengkap).filter((k) => k !== 'code').sort();
  assert.deepEqual(
    Object.keys(tersimpan).sort(), diharapkan,
    'Ada kolom BarisArea yang tidak ikut tersimpan — persis bug 10 Okt 2026.',
  );
  // Nilainya ikut, bukan cuma kuncinya.
  assert.equal(tersimpan.leadTimeDays, 1);
  assert.equal(tersimpan.atpTarget, 95);
  assert.equal(tersimpan.doiMin, 6);
  assert.deepEqual(tersimpan.startDate, new Date('2026-06-01T00:00:00.000Z'));
});

test('kolomTersimpan membuang code dan mengubah tanggal jadi Date', () => {
  const r = kolomTersimpan(area({ startDate: null }));
  assert.equal('code' in r, false, 'code adalah kunci baris, bukan kolom yang diperbarui');
  assert.equal(r.startDate, null, 'tanggal kosong tetap null, bukan Invalid Date');
});
