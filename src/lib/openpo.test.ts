import test from 'node:test';
import assert from 'node:assert/strict';
import { hitungBaris, hitungSemua, urutKemendesakan, type BarisOpenPo, type KodeSumber } from './openpo';

/** Kode sumber: prioritas 1 = 122 (wadah IEG), prioritas 2 = 120 (wadah EJI). */
const k = (sapCode: string, priority: number, perCtn: number, saldo: number): KodeSumber =>
  ({ sapCode, priority, perCtn, saldo });

/** Sumber dengan gudang: `w` menentukan urutan gudang (0 = diperiksa dulu). */
const kw = (sapCode: string, priority: number, perCtn: number, saldo: number, whs: string, w: number): KodeSumber =>
  ({ sapCode, priority, perCtn, saldo, supplierWhs: whs, whsPriority: w });

const baris = (o: Partial<BarisOpenPo> = {}): BarisOpenPo => ({
  groupKey: 'SERUM-GOLD',
  sku: 'SERUM-GOLD',
  name: 'Serum Gold 20ml',
  areaId: 'Surabaya',
  need: 100,
  status: 'HEALTHY',
  doi: 10,
  kode: [k('1222010110', 1, 48, 480), k('1201010110', 2, 48, 480)],
  ...o,
});

const ambilan = (h: ReturnType<typeof hitungBaris>) => h.ambil.map((a) => [a.sapCode, a.ctn, a.qty]);

test('kebutuhan dibulatkan NAIK ke karton, diambil dari prioritas teratas', () => {
  const h = hitungBaris(baris({ need: 100 }));
  // ceil(100/48) = 3 ctn = 144 pcs, semuanya dari kode prioritas 1.
  assert.deepEqual(ambilan(h), [['1222010110', 3, 144]]);
  assert.equal(h.qtyTotal, 144);
  assert.equal(h.kurang, 0);
  assert.equal(h.alasan, 'OK');
});

test('prioritas 1 tidak cukup → karton utuh dari 1, sisanya dari prioritas 2', () => {
  const h = hitungBaris(baris({ need: 240, kode: [k('A', 1, 48, 100), k('B', 2, 48, 480)] }));
  // A: min(ceil(240/48)=5, floor(100/48)=2) = 2 ctn = 96; sisa 144 → B: 3 ctn = 144.
  assert.deepEqual(ambilan(h), [['A', 2, 96], ['B', 3, 144]]);
  assert.equal(h.qtyTotal, 240);
  assert.equal(h.alasan, 'OK');
});

test('CONTOH USER 2 Okt 2026: isi karton berbeda, 48 + 12, kebutuhan 96', () => {
  // "misalkan SKU A isinya 48, dan sku b isi 12, jika permintaan 96. dan sku a
  //  hanya ada 50, maka sku A akan open 48 pc, dan sku B akan Open 48 pc"
  const h = hitungBaris(baris({ need: 96, kode: [k('SKU-A', 1, 48, 50), k('SKU-B', 2, 12, 600)] }));
  assert.deepEqual(ambilan(h), [['SKU-A', 1, 48], ['SKU-B', 4, 48]]);
  assert.equal(h.qtyTotal, 96, 'tepat 96, dan kedua kode full box');
  assert.equal(h.kurang, 0);
  assert.equal(h.alasan, 'OK');
});

test('lebih dari dua kode: diambil berurut sampai kebutuhan terpenuhi', () => {
  const h = hitungBaris(baris({
    need: 300,
    kode: [k('A', 1, 48, 48), k('B', 2, 24, 48), k('C', 3, 100, 1000), k('D', 4, 10, 1000)],
  }));
  // A: 1 ctn 48 (sisa 252) → B: min(ceil(252/24)=11, floor(48/24)=2) = 2 ctn 48
  // (sisa 204) → C: min(ceil(204/100)=3, 10) = 3 ctn 300 → sisa habis, D tidak disentuh.
  assert.deepEqual(ambilan(h), [['A', 1, 48], ['B', 2, 48], ['C', 3, 300]]);
  assert.equal(h.alasan, 'OK');
  assert.equal(h.ambil.some((x) => x.sapCode === 'D'), false, 'kode terakhir tidak perlu dipakai');
});

test('urutan ditentukan priority, bukan urutan di array', () => {
  const h = hitungBaris(baris({ need: 48, kode: [k('BELAKANG', 9, 48, 480), k('DEPAN', 1, 48, 480)] }));
  assert.deepEqual(ambilan(h), [['DEPAN', 1, 48]]);
});

test('prioritas 1 kosong → seluruhnya dari prioritas 2', () => {
  const h = hitungBaris(baris({ need: 50, kode: [k('A', 1, 48, 0), k('B', 2, 48, 480)] }));
  assert.deepEqual(ambilan(h), [['B', 2, 96]]);
  assert.equal(h.alasan, 'OK');
});

test('semua kurang → round down ke karton utuh yang ada, sisa dilaporkan', () => {
  const h = hitungBaris(baris({ need: 500, kode: [k('A', 1, 48, 100), k('B', 2, 48, 100)] }));
  assert.deepEqual(ambilan(h), [['A', 2, 96], ['B', 2, 96]]);
  assert.equal(h.qtyTotal, 192);
  assert.equal(h.kurang, 308);
  assert.equal(h.alasan, 'KURANG');
  assert.match(h.keterangan, /kurang 308 pcs/);
});

test('saldo nol → tanpa angka, keterangan "Stock GBJD Kosong"', () => {
  const h = hitungBaris(baris({ kode: [k('A', 1, 48, 0), k('B', 2, 48, 0)] }));
  assert.equal(h.qtyTotal, 0);
  assert.equal(h.alasan, 'KOSONG');
  assert.equal(h.keterangan, 'Stock GBJD Kosong');
  assert.equal(h.kurang, 100);
});

test('saldo negatif diperlakukan sama dengan kosong', () => {
  const h = hitungBaris(baris({ kode: [k('A', 1, 48, -500), k('B', 2, 48, -10)] }));
  assert.equal(h.alasan, 'KOSONG');
});

test('tanpa kode sumber sama sekali → kosong, bukan melempar', () => {
  const h = hitungBaris(baris({ kode: [] }));
  assert.equal(h.alasan, 'KOSONG');
  assert.deepEqual(h.ambil, []);
});

test('kurang dari 1 karton + DOI tipis → tetap diproses', () => {
  const h = hitungBaris(baris({ need: 30, status: 'CRITICAL', kode: [k('A', 1, 48, 20), k('B', 2, 48, 20)] }));
  assert.deepEqual(ambilan(h), [['A', 0, 20], ['B', 0, 10]]);
  assert.equal(h.qtyTotal, 30);
  assert.equal(h.ctnTotal, 0, 'pecahan tidak dihitung sebagai karton');
  assert.equal(h.alasan, 'PECAHAN_TIPIS');
});

test('kurang dari 1 karton tapi DOI BELUM tipis → tidak diproses', () => {
  const h = hitungBaris(baris({ need: 30, status: 'HEALTHY', kode: [k('A', 1, 48, 20), k('B', 2, 48, 20)] }));
  assert.equal(h.qtyTotal, 0);
  assert.equal(h.kurang, 30);
  assert.equal(h.alasan, 'KURANG');
  assert.match(h.keterangan, /belum tipis/);
});

test('pecahan tipis tidak melebihi kebutuhan', () => {
  const h = hitungBaris(baris({ need: 10, status: 'LOW', kode: [k('A', 1, 48, 40), k('B', 2, 48, 40)] }));
  assert.equal(h.qtyTotal, 10, 'hanya sebanyak yang dibutuhkan');
});

test('kebutuhan nol atau negatif → tidak ada saran', () => {
  for (const need of [0, -5]) {
    const h = hitungBaris(baris({ need }));
    assert.equal(h.qtyTotal, 0);
    assert.equal(h.alasan, 'TIDAK_PERLU');
    assert.equal(h.keterangan, '');
  }
});

test('isi karton tidak diketahui di SEMUA kode → pcs apa adanya, ditandai', () => {
  const h = hitungBaris(baris({ need: 70, kode: [k('A', 1, 0, 50), k('B', 2, 0, 50)] }));
  assert.deepEqual(ambilan(h), [['A', 0, 50], ['B', 0, 20]]);
  assert.equal(h.alasan, 'TANPA_ISI_KARTON');
});

test('satu kode tanpa isi karton dilewati kalau yang lain punya', () => {
  const h = hitungBaris(baris({ need: 50, kode: [k('TANPA', 1, 0, 500), k('ADA', 2, 48, 480)] }));
  assert.deepEqual(ambilan(h), [['ADA', 2, 96]], 'kode tanpa isi karton tidak dipakai saat ada yang punya');
  assert.equal(h.alasan, 'OK');
});

test('kebutuhan pas sekarton tidak dibulatkan naik jadi dua', () => {
  const h = hitungBaris(baris({ need: 48, kode: [k('A', 1, 48, 480)] }));
  assert.deepEqual(ambilan(h), [['A', 1, 48]]);
});

test('isi karton besar (3 digit) tetap terbaca', () => {
  const h = hitungBaris(baris({ need: 150, kode: [k('A', 1, 144, 1440)] }));
  assert.deepEqual(ambilan(h), [['A', 2, 288]]);
});

test('isi karton tiap kode memakai angkanya SENDIRI', () => {
  // Kasus nyata GBJD 28 Sep 2026: "Power Bright Expert Serum 20ml x 64 - IEG"
  // (122, isi 64) vs "… 20ml x 48" (120, isi 48).
  const h = hitungBaris(baris({ need: 200, kode: [k('122X', 1, 64, 64), k('120X', 2, 48, 480)] }));
  // 122: 1 ctn = 64 (sisa 136) → 120: ceil(136/48) = 3 ctn = 144.
  assert.deepEqual(ambilan(h), [['122X', 1, 64], ['120X', 3, 144]]);
  assert.equal(h.qtyTotal, 208);
});

test('saldo DIPAKAI BERSAMA — satu karton tidak dijanjikan ke dua kota', () => {
  const kode = [k('A', 1, 48, 96)];
  const { hasil, ringkas } = hitungSemua([
    baris({ areaId: 'Surabaya', need: 96, status: 'CRITICAL', doi: 2, kode }),
    baris({ areaId: 'Medan', need: 96, status: 'HEALTHY', doi: 20, kode }),
  ]);
  const sby = hasil.find((h) => h.areaId === 'Surabaya')!;
  const mdn = hasil.find((h) => h.areaId === 'Medan')!;
  assert.equal(sby.qtyTotal, 96, 'yang paling mendesak dilayani lebih dulu');
  assert.equal(mdn.qtyTotal, 0, 'saldo sudah habis dipakai Surabaya');
  assert.equal(ringkas.qtyTotal, 96, 'tidak menjanjikan lebih dari yang ada di gudang');
});

test('urutan kemendesakan: CRITICAL, lalu LOW, lalu DOI terkecil', () => {
  const rows = [
    baris({ areaId: 'A', status: 'HEALTHY', doi: 5 }),
    baris({ areaId: 'B', status: 'LOW', doi: 9 }),
    baris({ areaId: 'C', status: 'CRITICAL', doi: 9 }),
    baris({ areaId: 'D', status: 'HEALTHY', doi: 3 }),
  ];
  assert.deepEqual([...rows].sort(urutKemendesakan).map((r) => r.areaId), ['C', 'B', 'D', 'A']);
});

test('kode SAP berbeda punya saldo sendiri-sendiri', () => {
  const { ringkas } = hitungSemua([
    baris({ sku: 'X', groupKey: 'X', need: 48, kode: [k('XA', 1, 48, 48)] }),
    baris({ sku: 'Y', groupKey: 'Y', need: 48, kode: [k('YA', 1, 48, 48)] }),
  ]);
  assert.equal(ringkas.qtyTotal, 96, 'saldo X tidak mengurangi saldo Y');
  assert.equal(ringkas.sku, 2);
});

test('ringkasan menjumlahkan per kode SAP, berapa pun jumlah kodenya', () => {
  const { ringkas } = hitungSemua([
    baris({ areaId: 'A', need: 96, kode: [k('P1', 1, 48, 480), k('P2', 2, 24, 240)] }),
    baris({ areaId: 'B', need: 24, kode: [k('P1', 1, 48, 480), k('P2', 2, 24, 240)] }),
  ]);
  const p = new Map(ringkas.perKode.map((x) => [x.sapCode, x]));
  // A: 2 ctn P1 = 96. B: 1 ctn P1 = 48 (P1 masih bersaldo, jadi P2 tidak dipakai).
  assert.equal(p.get('P1')?.qty, 144);
  assert.equal(p.get('P1')?.ctn, 3);
  assert.equal(p.get('P2'), undefined, 'kode yang tidak terpakai tidak muncul di ringkasan');
  assert.equal(ringkas.ctnTotal, 3);
});

test('ringkasan menghitung baris kosong & pecahan', () => {
  const { ringkas } = hitungSemua([
    baris({ areaId: 'A', kode: [k('A1', 1, 48, 0)] }),
    baris({ areaId: 'B', need: 20, status: 'CRITICAL', kode: [k('B1', 1, 48, 10)] }),
  ]);
  assert.equal(ringkas.kosong, 1);
  assert.equal(ringkas.pecahan, 1);
});

test('GUDANG menentukan lebih dulu, kode kedua (keputusan user 2 Okt 2026)', () => {
  // Empat sumber: 122 & 120 di GBJD2, dan 122 & 120 di GBJD.
  // Urutan yang diminta: habiskan GBJD2 dulu apa pun kodenya.
  const h = hitungBaris(baris({
    need: 144,
    kode: [
      kw('122X', 1, 48, 48, 'GBJD', 1),
      kw('120X', 2, 48, 480, 'GBJD', 1),
      kw('122X', 1, 48, 48, 'GBJD2', 0),
      kw('120X', 2, 48, 480, 'GBJD2', 0),
    ],
  }));
  assert.deepEqual(h.ambil.map((a) => [a.supplierWhs, a.sapCode, a.qty]), [
    ['GBJD2', '122X', 48],
    ['GBJD2', '120X', 96],
  ], 'GBJD2 dihabiskan dulu; GBJD tidak disentuh karena kebutuhan sudah cukup');
  assert.equal(h.alasan, 'OK');
});

test('akibat yang disengaja: 120 dari GBJD2 terkirim walau 122 masih ada di GBJD', () => {
  const h = hitungBaris(baris({
    need: 96,
    kode: [
      kw('122X', 1, 48, 480, 'GBJD', 1),   // 122 masih banyak di GBJD
      kw('122X', 1, 48, 48, 'GBJD2', 0),   // tapi GBJD2 diperiksa dulu
      kw('120X', 2, 48, 480, 'GBJD2', 0),
    ],
  }));
  assert.deepEqual(h.ambil.map((a) => [a.supplierWhs, a.sapCode, a.qty]), [
    ['GBJD2', '122X', 48],
    ['GBJD2', '120X', 48],
  ]);
  assert.match(h.keterangan, /GBJD2\/120X/, 'keterangan menyebut gudang asalnya');
});

test('saldo per (gudang, kode) terpisah — kode sama di dua gudang bukan satu saldo', () => {
  const kode = [kw('A', 1, 48, 48, 'GBJD2', 0), kw('A', 1, 48, 48, 'GBJD', 1)];
  const { hasil, ringkas } = hitungSemua([
    baris({ areaId: 'Surabaya', need: 48, status: 'CRITICAL', doi: 2, kode }),
    baris({ areaId: 'Medan', need: 48, status: 'HEALTHY', doi: 20, kode }),
  ]);
  const sby = hasil.find((h) => h.areaId === 'Surabaya')!;
  const mdn = hasil.find((h) => h.areaId === 'Medan')!;
  assert.deepEqual(sby.ambil.map((a) => a.supplierWhs), ['GBJD2'], 'yang mendesak ambil dari GBJD2');
  assert.deepEqual(mdn.ambil.map((a) => a.supplierWhs), ['GBJD'], 'GBJD2 habis → jatuh ke GBJD');
  assert.equal(ringkas.qtyTotal, 96);
  assert.equal(ringkas.perKode.length, 2, 'dilaporkan terpisah per gudang');
});

test('ringkasan memisahkan gudang walau kode SAP-nya sama', () => {
  const { ringkas } = hitungSemua([baris({
    need: 96,
    kode: [kw('A', 1, 48, 48, 'GBJD2', 0), kw('A', 1, 48, 480, 'GBJD', 1)],
  })]);
  const per = new Map(ringkas.perKode.map((x) => [`${x.supplierWhs}/${x.sapCode}`, x.qty]));
  assert.equal(per.get('GBJD2/A'), 48);
  assert.equal(per.get('GBJD/A'), 48);
});

// ---------------------------------------------------------------------------
// Batas atas DOI max. Ditambahkan 5 Okt 2026 setelah isi karton NYATA terbaca
// dari GBJD: ada yang 1000 pcs/karton (Naturgo Peel Off Mask).
// ---------------------------------------------------------------------------

/** Baris dengan satu sumber; ringkas supaya kasusnya yang terlihat, bukan boilerplate. */
const satuSumber = (o: {
  need: number; perCtn: number; saldo: number; maxQty?: number; status?: string;
}): BarisOpenPo => ({
  groupKey: 'G', sku: 'SKU', name: 'Naturgo Peel Off Mask 10gr x 1000',
  areaId: 'PUSAT', need: o.need, status: o.status ?? 'OK', doi: 20,
  maxQty: o.maxQty,
  kode: [{ sapCode: '1201010201', priority: 2, perCtn: o.perCtn, saldo: o.saldo }],
});

test('TANPA maxQty perilaku lama tidak berubah — karton 1000 untuk kebutuhan 50', () => {
  const r = hitungBaris(satuSumber({ need: 50, perCtn: 1000, saldo: 300000 }));
  assert.equal(r.qtyTotal, 1000, 'bulat naik ke 1 karton, seperti sebelumnya');
  assert.equal(r.alasan, 'OK');
});

test('maxQty memotong pembulatan naik yang berlebihan — ini inti perbaikannya', () => {
  // Kebutuhan 50 pcs, karton 1000, DOI max mengizinkan 400 pcs.
  // 1 karton = 1000 pcs = melewati max -> JANGAN dikirim diam-diam.
  const r = hitungBaris(satuSumber({ need: 50, perCtn: 1000, saldo: 300000, maxQty: 400 }));
  assert.equal(r.qtyTotal, 0, 'tidak mengirim 1000 pcs untuk kebutuhan 50');
  assert.equal(r.alasan, 'KARTON_LEBIH_DARI_MAX');
  assert.match(r.keterangan, /TIDAK dikirim/);
  assert.match(r.keterangan, /20x kebutuhan/, 'sebutkan berapa kali lipatnya');
  assert.equal(r.kurang, 50, 'kebutuhannya tetap dilaporkan, tidak dihapus');
});

test('karton melewati max TAPI DOI tipis → tetap dikirim, dan ditandai', () => {
  const r = hitungBaris(satuSumber({
    need: 50, perCtn: 1000, saldo: 300000, maxQty: 400, status: 'CRITICAL',
  }));
  assert.equal(r.qtyTotal, 1000, 'kehabisan barang lebih mahal daripada kelebihan stok');
  assert.equal(r.ctnTotal, 1);
  assert.equal(r.alasan, 'KARTON_LEBIH_DARI_MAX');
  assert.match(r.keterangan, /tetap dikirim/);
});

test('maxQty membulatkan TURUN kalau masih ada karton yang masuk', () => {
  // Kebutuhan 350 (DI BAWAH max, supaya yang diuji benar-benar aturan max),
  // karton 144, max 400 -> bulat naik = 3 ctn (432) lewat max;
  // yang masuk = floor(400/144) = 2 ctn = 288.
  const r = hitungBaris(satuSumber({ need: 350, perCtn: 144, saldo: 100000, maxQty: 400 }));
  assert.equal(r.qtyTotal, 288);
  assert.equal(r.ctnTotal, 2);
  assert.equal(r.alasan, 'DIBATASI_DOI_MAX');
  assert.equal(r.kurang, 62);
  assert.match(r.keterangan, /DOI max \(batas 400 pcs\)/);
});

test('kalau plafon berasal dari KEBUTUHAN, keterangannya tidak boleh bilang "DOI max <angka>"', () => {
  // need 500 > maxQty 400 -> plafon = 500, hasilnya 3 ctn = 432 pcs, yang
  // JELAS di atas 400. Versi pertama perbaikan ini menulis "agar tidak
  // melewati DOI max (batas 400 pcs)" untuk hasil 432 — pesan yang berbohong.
  const r = hitungBaris(satuSumber({ need: 500, perCtn: 144, saldo: 100000, maxQty: 400 }));
  assert.equal(r.qtyTotal, 432);
  assert.equal(r.alasan, 'DIBATASI_DOI_MAX');
  assert.doesNotMatch(r.keterangan, /melewati DOI max \(batas 400 pcs\)/);
  assert.match(r.keterangan, /kebutuhan yang dipakai/);
});

test('maxQty lebih kecil dari kebutuhan: KEBUTUHAN yang menang', () => {
  // Kalau tidak, DOI min dan DOI max saling mengunci sampai tidak ada yang
  // dikirim padahal barangnya memang kurang.
  const r = hitungBaris(satuSumber({ need: 1000, perCtn: 100, saldo: 100000, maxQty: 200 }));
  assert.equal(r.qtyTotal, 1000, 'plafon = max(maxQty, need)');
  assert.equal(r.alasan, 'OK');
});

test('maxQty tepat sama dengan satu karton → dikirim, bukan ditolak', () => {
  const r = hitungBaris(satuSumber({ need: 900, perCtn: 1000, saldo: 5000, maxQty: 1000 }));
  assert.equal(r.qtyTotal, 1000);
  assert.equal(r.alasan, 'OK');
});

test('maxQty tidak berlaku kalau isi karton tidak diketahui', () => {
  const r = hitungBaris({
    ...satuSumber({ need: 50, perCtn: 0, saldo: 300, maxQty: 10 }),
  });
  assert.equal(r.alasan, 'TANPA_ISI_KARTON', 'jalur pcs tidak menebak karton maupun plafon');
  assert.equal(r.qtyTotal, 50);
});
