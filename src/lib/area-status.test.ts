import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_STATUS_CODES, CANCEL_STATUS, OCS_STATUS, demandStatusCodes } from './ocs';
import { gabungSales, mapSalesRows, antreanTarik, areaSudahJalan, type SalesRowInput } from './sync';
import { parseAreaStart } from './settings';

const baris = (sku: string, area: string, qty: number): SalesRowInput =>
  ({ salesDate: '2026-09-20', sku, areaId: area, qty, qtyCancel: 0 });

test('ALL_STATUS_CODES memuat SELURUH status, termasuk yang dulu dibuang', () => {
  for (const c of [OCS_STATUS.NA, OCS_STATUS.UNPAID, OCS_STATUS.IN_CANCEL, OCS_STATUS.CANCELLED]) {
    assert.ok(ALL_STATUS_CODES.includes(c), `status ${c} harus ikut ditarik`);
  }
  // Tidak ada yang tertinggal dan tidak ada duplikat.
  assert.equal(ALL_STATUS_CODES.length, new Set(Object.values(OCS_STATUS)).size);
  assert.deepEqual(ALL_STATUS_CODES, [...ALL_STATUS_CODES].sort((a, b) => a - b));
});

test('status konsumsi stok tidak pernah memuat status batal', () => {
  const inti = demandStatusCodes({ includeReady: true, includeReturn: true });
  for (const c of CANCEL_STATUS) assert.ok(!inti.includes(c), `status batal ${c} tidak boleh masuk ADS`);
});

test('gabungSales: selisih semua − konsumsi jadi qtyCancel', () => {
  const out = gabungSales([baris('A', 'Pusat', 120)], [baris('A', 'Pusat', 100)]);
  assert.equal(out.length, 1);
  assert.equal(out[0].qty, 100);
  assert.equal(out[0].qtyCancel, 20);
});

test('SKU yang hanya punya order batal tetap tercatat, qty 0', () => {
  const out = gabungSales([baris('B', 'Pusat', 40)], []);
  assert.deepEqual(
    { qty: out[0].qty, cancel: out[0].qtyCancel },
    { qty: 0, cancel: 40 },
  );
});

test('area dipisah — SKU sama di dua area tidak saling menimpa', () => {
  const out = gabungSales(
    [baris('A', 'Pusat', 120), baris('A', 'Surabaya', 55)],
    [baris('A', 'Pusat', 100), baris('A', 'Surabaya', 50)],
  );
  assert.equal(out.length, 2);
  const pusat = out.find((r) => r.areaId === 'Pusat')!;
  const sby = out.find((r) => r.areaId === 'Surabaya')!;
  assert.deepEqual([pusat.qty, pusat.qtyCancel], [100, 20]);
  assert.deepEqual([sby.qty, sby.qtyCancel], [50, 5]);
});

test('selisih negatif dijadikan 0, bukan angka karangan', () => {
  // Bisa terjadi kalau status order berubah di antara dua panggilan.
  const out = gabungSales([baris('A', 'Pusat', 90)], [baris('A', 'Pusat', 100)]);
  assert.equal(out[0].qtyCancel, 0);
  assert.equal(out[0].qty, 100);
});

test('mapSalesRows membaca area dari baris OCS, bawaan Pusat', () => {
  const rows = mapSalesRows(
    [
      { Date: '2026-09-20', SellerSku: 'A', Area: 'Surabaya', Qty: 10, Detail: [{ CommercePlatform: 'SHOPEE', Qty: 6 }] },
      { Date: '2026-09-20', SellerSku: 'A', Area: '', Qty: 4 },
    ],
    '2026-09-20',
  );
  assert.deepEqual(rows.map((r) => r.areaId), ['Surabaya', 'Pusat']);
  assert.equal(rows[0].qtyShopee, 6);
  assert.equal(rows[0].qtyOther, 4);
  assert.equal(rows[0].qtyCancel, 0);
});

test('gabungSales menggabung hasil beberapa panggilan area tanpa saling menimpa', () => {
  // Meniru mode loop per area: hasil tiap area digabung dulu, baru diselisihkan.
  const semua = [baris('A', 'Pusat', 120), baris('A', 'Surabaya', 55), baris('B', 'Medan', 30)];
  const konsumsi = [baris('A', 'Pusat', 100), baris('A', 'Surabaya', 50), baris('B', 'Medan', 30)];
  const out = gabungSales(semua, konsumsi);
  assert.equal(out.length, 3);
  assert.deepEqual(
    out.map((r) => [r.areaId, r.qty, r.qtyCancel]).sort(),
    [['Medan', 30, 0], ['Pusat', 100, 20], ['Surabaya', 50, 5]].sort(),
  );
  // Total per area utuh — tidak ada area yang hilang karena SKU-nya sama.
  assert.equal(out.reduce((a, r) => a + r.qty, 0), 180);
});

test('SKU sama di area berbeda punya baris sendiri-sendiri', () => {
  const out = gabungSales(
    [baris('SAMA', 'Pusat', 10), baris('SAMA', 'Medan', 10), baris('SAMA', 'Makassar', 10)],
    [baris('SAMA', 'Pusat', 8), baris('SAMA', 'Medan', 10)],
  );
  assert.equal(out.length, 3);
  const makassar = out.find((r) => r.areaId === 'Makassar')!;
  // Hanya muncul di penarikan semua-status → seluruhnya dianggap batal.
  assert.deepEqual([makassar.qty, makassar.qtyCancel], [0, 10]);
});

test('antrean adalah pasangan tanggal × area, bukan tanggal saja', async (t) => {
  // antreanTarik menyentuh database untuk umur data; di sini yang diuji
  // bentuk antreannya saat database kosong (semua umur 0).
  const areas = ['Pusat', 'Surabaya', 'Medan'];
  let antre;
  try {
    antre = await antreanTarik('2026-09-20', '2026-09-24', areas);
  } catch {
    t.skip('butuh database');
    return;
  }
  // 5 tanggal × 3 area
  assert.equal(antre.length, 15);
  // Dua tanggal terbaru didahulukan, LENGKAP dengan seluruh areanya —
  // ini yang mencegah area terakhir tidak pernah kebagian waktu.
  const enamPertama = antre.slice(0, 6);
  assert.deepEqual([...new Set(enamPertama.map((x) => x.day))].sort(), ['2026-09-23', '2026-09-24']);
  assert.deepEqual([...new Set(enamPertama.map((x) => x.area))].sort(), [...areas].sort());
  // Tiap pasangan muncul tepat sekali.
  assert.equal(new Set(antre.map((x) => `${x.day}|${x.area}`)).size, 15);
});

test('parseAreaStart membaca daftar tanggal mulai per area', () => {
  assert.deepEqual(
    parseAreaStart('Surabaya=2026-06-01, Medan=2026-06-01 ,Makassar=2026-06-01'),
    { Surabaya: '2026-06-01', Medan: '2026-06-01', Makassar: '2026-06-01' },
  );
});

test('entri salah ketik dilewati, tidak menggagalkan sisanya', () => {
  // Pengaturan yang salah ketik tidak boleh membuat seluruh penarikan gagal —
  // area itu cukup ikut ditarik penuh seperti biasa.
  assert.deepEqual(
    parseAreaStart('Surabaya=1 Juni 2026,Medan=2026-06-01,=2026-06-01,Rusak'),
    { Medan: '2026-06-01' },
  );
  assert.deepEqual(parseAreaStart(''), {});
});

test('area tanpa tanggal mulai selalu dianggap sudah jalan', () => {
  const mulai = { Surabaya: '2026-06-01' };
  assert.equal(areaSudahJalan('Pusat', '2026-01-01', mulai), true);
  assert.equal(areaSudahJalan('Surabaya', '2026-05-31', mulai), false);
  assert.equal(areaSudahJalan('Surabaya', '2026-06-01', mulai), true, 'tanggal mulai ikut ditarik');
  assert.equal(areaSudahJalan('Surabaya', '2026-06-02', mulai), true);
});

test('antrean melewati tanggal sebelum cabang beroperasi', async (t) => {
  let antre;
  try {
    antre = await antreanTarik('2026-05-30', '2026-06-02', ['Pusat', 'Surabaya'], { Surabaya: '2026-06-01' });
  } catch { t.skip('butuh database'); return; }
  // Pusat 4 tanggal + Surabaya 2 tanggal (1 & 2 Juni) = 6, bukan 8.
  assert.equal(antre.length, 6);
  assert.equal(antre.filter((x) => x.area === 'Surabaya').length, 2);
  assert.ok(!antre.some((x) => x.area === 'Surabaya' && x.day < '2026-06-01'));
});
