import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { susunBarisPo, masukPo, STATUS_PO, type BarisSnapshotPo } from './sugest-po';
import { hitungSemua } from './openpo';
import { groupPerSku, sapPerGroup, kunciSaldo, type BarisSkuLink, type SaldoPemasok } from './sku-link';

/**
 * Penjaga: SUGEST PO — tiga keputusan yang kalau salah TIDAK BERGEJALA.
 *
 * Halaman ini menyuruh orang memesan barang. Kesalahan di sini tidak memunculkan
 * error merah; ia memunculkan karton yang dikirim padahal belum perlu, atau
 * tidak dikirim padahal gudang hampir kosong — dan baru terbaca berminggu
 * kemudian dari akibatnya, bukan dari gejalanya.
 */

const link: BarisSkuLink[] = [
  { groupKey: 'G1', system: 'OCS', code: 'SKU-A', priority: 1, perCtn: null, note: null },
  { groupKey: 'G1', system: 'SAP', code: '1222000001', priority: 1, perCtn: 48, note: null },
  { groupKey: 'G1', system: 'SAP', code: '1201000001', priority: 2, perCtn: 12, note: null },
];
const grup = groupPerSku(link);
const perGrup = sapPerGroup(link);

const saldoPeta = (isi: [string, string, number][]): Map<string, SaldoPemasok> => {
  const m = new Map<string, SaldoPemasok>();
  for (const [kode, whs, bal] of isi) m.set(kunciSaldo(kode, whs), { balance: bal, supplierWhs: whs });
  return m;
};

const snap = (o: Partial<BarisSnapshotPo> = {}): BarisSnapshotPo => ({
  areaId: 'Pusat', sku: 'SKU-A', name: 'Produk A', status: 'LOW', abcClass: 'B',
  doi1: 5, doi2: 6, suggested1: 96, suggested2: 96, ...o,
});

const opsiDasar = { opsi: 1 as const, grup, perGrup, saldo: saldoPeta([['1222000001', 'GBJD', 500]]), gudang: ['GBJD'] };

// ---------------------------------------------------------------------------
// 1. Siapa yang masuk daftar
// ---------------------------------------------------------------------------

test('hanya Kritis & Low yang masuk daftar PO', () => {
  // PERNAH SALAH, dan mahal. Sampai 7 Okt 2026 syaratnya "bukan status mati",
  // sehingga SKU AMAN ikut disarankan — AMAN berarti DOI ada DI ANTARA min dan
  // max, jadi `max*ads - posisi` selalu positif. Terukur di poster: Medan
  // perluPo 121 padahal yang benar 72, melebih-lebihkan beban PO 68%.
  assert.equal(masukPo('CRITICAL'), true);
  assert.equal(masukPo('LOW'), true);
  for (const s of ['HEALTHY', 'OVERSTOCK', 'WAITING', 'DEAD_STOCK', 'NO_SALES', 'NPL_WAIT', 'PHASE_OUT', 'EXCLUDED']) {
    assert.equal(masukPo(s), false, `${s} tidak boleh masuk daftar PO`);
  }
});

test('SIT (WAITING) tidak ikut — kirimannya sudah di jalan', () => {
  // Stoknya memang tipis, tapi kiriman yang sedang jalan sudah menutupinya.
  // Memesan lagi berarti pesan dua kali untuk kebutuhan yang sama.
  const { baris } = susunBarisPo([snap({ status: 'WAITING' })], opsiDasar);
  assert.equal(baris.length, 0);
});

test('kebutuhan 0 tidak jadi baris, walau statusnya Low', () => {
  const { baris } = susunBarisPo([snap({ suggested1: 0 })], opsiDasar);
  assert.equal(baris.length, 0);
});

// ---------------------------------------------------------------------------
// 2. Batas atas = kebutuhan, supaya karton raksasa tidak melesat
// ---------------------------------------------------------------------------

test('maxQty SELALU sama dengan need — batas Aman tidak boleh hilang', () => {
  const { baris } = susunBarisPo([snap({ suggested1: 50 })], opsiDasar);
  assert.equal(baris[0].need, 50);
  assert.equal(baris[0].maxQty, 50, 'tanpa batas ini, karton 1000 pcs dipesan untuk kebutuhan 50');
});

test('karton raksasa TETAP dikirim di daftar PO — tapi tidak pernah tanpa label', () => {
  // Angka nyata dari GBJD: Naturgo Peel Off Mask isinya 1000 pcs/karton.
  // Untuk kebutuhan 50 pcs, satu karton terkecil pun sudah 20x kebutuhan.
  //
  // Aturannya di `openpo` sengaja bergantung pada kemendesakan: DOI tipis
  // (CRITICAL/LOW) -> tetap dikirim 1 karton, karena kehabisan barang lebih
  // mahal daripada kelebihan stok; selain itu -> tidak dikirim, biar orangnya
  // yang memutuskan.
  //
  // Konsekuensi yang perlu dicatat: daftar Sugest PO HANYA berisi CRITICAL dan
  // LOW, jadi di halaman ini cabang "tidak dikirim" tidak pernah tercapai —
  // karton raksasa SELALU dikirim. Itu boleh, asalkan tidak pernah muncul
  // sebagai angka telanjang: alasannya wajib `KARTON_LEBIH_DARI_MAX` dan
  // keterangannya wajib menyebut berapa kali lipat kebutuhan. Tanpa itu, baris
  // "pesan 1000 pcs" untuk kebutuhan 50 terbaca seperti perhitungan biasa.
  const linkBesar: BarisSkuLink[] = [
    { groupKey: 'G2', system: 'OCS', code: 'SKU-B', priority: 1, perCtn: null, note: null },
    { groupKey: 'G2', system: 'SAP', code: '1201999999', priority: 1, perCtn: 1000, note: null },
  ];
  const { baris } = susunBarisPo(
    [snap({ sku: 'SKU-B', suggested1: 50 })],
    { ...opsiDasar, grup: groupPerSku(linkBesar), perGrup: sapPerGroup(linkBesar), saldo: saldoPeta([['1201999999', 'GBJD', 5000]]) },
  );
  const { hasil } = hitungSemua(baris, { toleransiCtn: 1, lipatMaks: 2 });
  assert.equal(hasil[0].qtyTotal, 1000, 'DOI tipis -> karton terkecil tetap dikirim');
  assert.equal(hasil[0].alasan, 'KARTON_LEBIH_DARI_MAX', 'tidak boleh lolos sebagai OK');
  assert.match(hasil[0].keterangan, /20x kebutuhan 50 pcs/, 'lipatnya harus tertulis, bukan disimpulkan sendiri');
});

test('toleransi karton TIDAK berlaku untuk karton yang jauh lebih besar dari kebutuhan', () => {
  // Pembedanya syarat "karton <= 2x kebutuhan" yang user setujui 8 Okt 2026.
  // Karton 48 untuk kebutuhan 40 boleh lewat sedikit; karton 1000 tidak, dan
  // karena itu ia jatuh ke jalur KARTON_LEBIH_DARI_MAX di atas — bukan
  // dibulatkan naik diam-diam lewat toleransi.
  const { baris } = susunBarisPo([snap({ suggested1: 40 })], opsiDasar);
  const { hasil } = hitungSemua(baris, { toleransiCtn: 1, lipatMaks: 2 });
  assert.equal(hasil[0].qtyTotal, 48, 'karton 48 <= 2x40 -> boleh dibulatkan naik');
  assert.equal(hasil[0].alasan, 'TOLERANSI_DOI_MAX');
});

// ---------------------------------------------------------------------------
// 3. SKU tanpa mapping harus TERLIHAT, bukan hilang
// ---------------------------------------------------------------------------

test('SKU tanpa mapping dilaporkan, tidak dilewati diam-diam', () => {
  // Kalau hanya dilewati, SKU yang hampir habis lenyap dari daftar PO tanpa
  // jejak — dan orang gudang membacanya sebagai "memang belum perlu dipesan",
  // persis kebalikan dari keadaannya.
  const { baris, tanpaMapping } = susunBarisPo(
    [snap(), snap({ sku: 'SKU-ASING', suggested1: 300 })],
    opsiDasar,
  );
  assert.equal(baris.length, 1);
  assert.deepEqual(tanpaMapping.map((x) => x.sku), ['SKU-ASING']);
  assert.equal(tanpaMapping[0].need, 300);
});

test('yang tanpa mapping diurut kebutuhan terbesar dulu', () => {
  const { tanpaMapping } = susunBarisPo(
    [snap({ sku: 'X1', suggested1: 10 }), snap({ sku: 'X2', suggested1: 900 })],
    opsiDasar,
  );
  assert.deepEqual(tanpaMapping.map((x) => x.sku), ['X2', 'X1']);
});

// ---------------------------------------------------------------------------
// 4. Opsi DOI yang dipakai ikut Pengaturan
// ---------------------------------------------------------------------------

test('opsi 2 memakai suggested2 dan doi2, bukan angka opsi 1', () => {
  const { baris } = susunBarisPo(
    [snap({ suggested1: 10, suggested2: 500, doi1: 5, doi2: 9 })],
    { ...opsiDasar, opsi: 2 },
  );
  assert.equal(baris[0].need, 500);
  assert.equal(baris[0].doi, 9);
});

// ---------------------------------------------------------------------------
// 5. Satu karton tidak boleh dijanjikan ke dua cabang
// ---------------------------------------------------------------------------

test('saldo dipakai BERSAMA antar cabang, bukan direset tiap cabang', () => {
  // Kesalahan ini tidak bergejala di layar: tiap cabang tampak kebagian penuh,
  // dan kekurangannya baru ketahuan di gudang saat barangnya tidak ada.
  const { baris } = susunBarisPo(
    [snap({ areaId: 'Pusat', suggested1: 96 }), snap({ areaId: 'Medan', suggested1: 96 })],
    { ...opsiDasar, saldo: saldoPeta([['1222000001', 'GBJD', 100]]) },
  );
  const { hasil, ringkas } = hitungSemua(baris, { toleransiCtn: 1, lipatMaks: 2 });
  const total = hasil.reduce((a, h) => a + h.qtyTotal, 0);
  assert.ok(total <= 100, `total ${total} melebihi saldo 100 — saldo dipakai dua kali`);
  assert.equal(ringkas.qtyTotal, total);
});

// ---------------------------------------------------------------------------
// 6. GABUNGAN tidak boleh ikut dihitung
// ---------------------------------------------------------------------------

test('query store mengecualikan GABUNGAN', () => {
  // Baris GABUNGAN adalah penjumlahan SELURUH cabang. Ikut dihitung berarti
  // kebutuhan yang sama dihitung dua kali, dan saldo pemasok yang sama
  // dijanjikan ke "cabang" yang tidak punya gudang. Tidak ada error, cuma
  // angka PO yang dua kali lipat.
  const kode = readFileSync(join('src', 'lib', 'sugest-po-store.ts'), 'utf8');
  const sql = kode.match(/FROM doi_snapshot[\s\S]*?`/);
  assert.ok(sql, 'query doi_snapshot tidak ditemukan — tes ini perlu diperbarui');
  assert.match(sql![0], /areaId <> \?/, 'GABUNGAN harus dikecualikan di query');
  assert.match(kode, /AREA_GABUNGAN/, 'parameternya harus AREA_GABUNGAN, bukan string lepas');
});

test('status pemicu di query SAMA dengan STATUS_PO, bukan daftar kedua', () => {
  // Dua daftar status yang terpisah akan melenceng: query menyaring satu
  // himpunan, `susunBarisPo` menyaring himpunan lain, dan selisihnya jadi
  // baris yang diambil dari database lalu dibuang diam-diam.
  const kode = readFileSync(join('src', 'lib', 'sugest-po-store.ts'), 'utf8');
  assert.match(kode, /\.\.\.STATUS_PO/, 'query harus memakai STATUS_PO dari sugest-po.ts');
  assert.equal(STATUS_PO.length, 2);
});
