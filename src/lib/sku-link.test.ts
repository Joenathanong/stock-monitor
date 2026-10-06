import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prioritasUsulan, groupPerSku, sapPerGroup, kodeSumber, usulkanDari6Digit,
  validasiLink, kodeBentrok, kunciSaldo, type BarisSkuLink,
} from './sku-link';
import { hitungBaris } from './openpo';

const L = (o: Partial<BarisSkuLink>): BarisSkuLink =>
  ({ groupKey: 'SERUM', system: 'SAP', code: '1222010110', priority: 1, perCtn: 48, ...o });

test('prioritas usulan ditentukan TIGA digit pertama, bukan empat', () => {
  // Wadah ditentukan 122x (IEG) vs 120x (EJI) - digit keempat tidak menentukan.
  // Kode nyata yang pernah muncul: 1222/1228 di stok, 1201/1208 di receive.
  assert.equal(prioritasUsulan('1222010110'), 1);
  assert.equal(prioritasUsulan('1228050302'), 1);
  assert.equal(prioritasUsulan('1201010110'), 2);
  assert.equal(prioritasUsulan('1207010401'), 2);
  assert.equal(prioritasUsulan('1208050302'), 2);
  // Prefiks lain tidak ditebak - ditaruh paling belakang supaya user menyusunnya.
  assert.equal(prioritasUsulan('1300010101'), 9);
  assert.equal(prioritasUsulan(' 1222010110 '), 1, 'spasi dirapikan');
});

test('SKU OCS dipetakan ke groupKey-nya', () => {
  const rows = [L({ system: 'OCS', code: 'SERUM-GOLD', priority: 0, perCtn: null }), L({})];
  assert.equal(groupPerSku(rows).get('SERUM-GOLD'), 'SERUM');
  assert.equal(groupPerSku(rows).get('1222010110'), undefined, 'kode SAP bukan SKU OCS');
});

test('kode SAP per produk berurut prioritas', () => {
  const rows = [
    L({ code: 'C', priority: 3 }), L({ code: 'A', priority: 1 }), L({ code: 'B', priority: 2 }),
    L({ groupKey: 'LAIN', code: 'Z', priority: 1 }),
  ];
  assert.deepEqual(sapPerGroup(rows).get('SERUM')!.map((r) => r.code), ['A', 'B', 'C']);
  assert.deepEqual(sapPerGroup(rows).get('LAIN')!.map((r) => r.code), ['Z']);
});

test('isi karton dari tabel MENANG atas angka gudang pemasok', () => {
  const sap = sapPerGroup([L({ code: 'A', priority: 1, perCtn: 48 })]);
  const saldo = new Map([[kunciSaldo('A'), { balance: 480, perCtn: 64 }]]);
  assert.deepEqual(kodeSumber('SERUM', sap, saldo), [{ sapCode: 'A', priority: 1, perCtn: 48, saldo: 480 }]);
});

test('isi karton kosong di tabel → pakai angka gudang pemasok', () => {
  const sap = sapPerGroup([L({ code: 'A', priority: 1, perCtn: null })]);
  const saldo = new Map([[kunciSaldo('A'), { balance: 480, perCtn: 64 }]]);
  assert.equal(kodeSumber('SERUM', sap, saldo)[0].perCtn, 64);
});

test('kode terdaftar tapi tanpa saldo tetap muncul dengan saldo 0', () => {
  // Supaya "Stock GBJD Kosong" bisa dibedakan dari "kodenya belum didaftarkan".
  const sap = sapPerGroup([L({ code: 'A', priority: 1 })]);
  const hasil = kodeSumber('SERUM', sap, new Map());
  assert.equal(hasil.length, 1);
  assert.equal(hasil[0].saldo, 0);
  assert.equal(hitungBaris({
    groupKey: 'SERUM', sku: 'S', name: 'S', areaId: 'A', need: 100, status: 'HEALTHY', doi: 9, kode: hasil,
  }).alasan, 'KOSONG');
});

test('produk tanpa kode SAP sama sekali → daftar kosong, bukan melempar', () => {
  assert.deepEqual(kodeSumber('TIDAK-ADA', sapPerGroup([]), new Map()), []);
});

test('usulan 6-digit mengelompokkan kode yang 6 digitnya sama', () => {
  const { usul, takCocok } = usulkanDari6Digit(
    [{ sku: 'SERUM-GOLD', sapCode: '1222010110' }],
    [{ sapCode: '1222010110', perCtn: 48 }, { sapCode: '1201010110', perCtn: 64 }],
  );
  assert.equal(usul.length, 1);
  assert.equal(usul[0].groupKey, 'SERUM-GOLD');
  const sap = usul[0].baris.filter((b) => b.system === 'SAP');
  assert.deepEqual(sap.map((b) => [b.code, b.priority, b.perCtn]), [['1222010110', 1, 48], ['1201010110', 2, 64]]);
  assert.equal(usul[0].baris.some((b) => b.system === 'OCS' && b.code === 'SERUM-GOLD'), true);
  assert.deepEqual(takCocok, []);
  assert.match(usul[0].alasan, /PERIKSA, ini tebakan/);
});

test('kode SAP yang tidak cocok TIDAK dipaksa masuk kelompok mana pun', () => {
  // Inilah kasus yang membatalkan aturan 6-digit: produk sama, 6 digit berbeda.
  const { usul, takCocok } = usulkanDari6Digit(
    [{ sku: 'SERUM-GOLD', sapCode: '1222010110' }],
    [{ sapCode: '1222010110' }, { sapCode: '1201999999' }],
  );
  assert.deepEqual(takCocok, ['1201999999']);
  assert.equal(usul[0].baris.filter((b) => b.system === 'SAP').length, 1);
});

test('SKU tanpa kode SAP di gudang tidak diusulkan', () => {
  const { usul } = usulkanDari6Digit([{ sku: 'X', sapCode: '1222000001' }], []);
  assert.deepEqual(usul, [], 'tidak ada gunanya mendaftarkan produk tanpa kode sumber');
});

test('kode bentrok di dua produk dilaporkan', () => {
  const b = kodeBentrok([
    L({ groupKey: 'A', code: 'X' }), L({ groupKey: 'B', code: 'X' }), L({ groupKey: 'A', code: 'Y' }),
  ]);
  assert.equal(b.length, 1);
  assert.deepEqual(b[0], { code: 'X', system: 'SAP', groups: ['A', 'B'] });
});

test('kode sama di sistem berbeda BUKAN bentrok', () => {
  assert.deepEqual(kodeBentrok([
    L({ groupKey: 'A', system: 'OCS', code: 'X' }), L({ groupKey: 'A', system: 'SAP', code: 'X' }),
  ]), []);
});

test('validasi link', () => {
  assert.deepEqual(validasiLink({ groupKey: 'A', system: 'SAP', code: 'X', priority: 1, perCtn: 48 }), []);
  assert.equal(validasiLink({ groupKey: '', system: 'SAP', code: 'X' }).some((g) => g.field === 'groupKey'), true);
  assert.equal(validasiLink({ groupKey: 'A', system: 'XX' as 'SAP', code: 'X' }).some((g) => g.field === 'system'), true);
  assert.equal(validasiLink({ groupKey: 'A', system: 'SAP', code: '' }).some((g) => g.field === 'code'), true);
  assert.equal(validasiLink({ groupKey: 'A', system: 'SAP', code: 'X', perCtn: -1 }).some((g) => g.field === 'perCtn'), true);
});

test('dua gudang: satu kode jadi DUA sumber, urut gudang', () => {
  const sap = sapPerGroup([L({ code: 'A', priority: 1, perCtn: 48 })]);
  const saldo = new Map([
    [kunciSaldo('A', 'GBJD2'), { balance: 96 }],
    [kunciSaldo('A', 'GBJD'), { balance: 480 }],
  ]);
  const hasil = kodeSumber('SERUM', sap, saldo, ['GBJD2', 'GBJD']);
  assert.deepEqual(hasil.map((k) => [k.supplierWhs, k.whsPriority, k.saldo]),
    [['GBJD2', 0, 96], ['GBJD', 1, 480]]);
});

test('gudang tanpa saldo tetap jadi sumber dengan 0 — bukan hilang dari daftar', () => {
  // Kalau barisnya hilang, "kosong di GBJD2" tidak bisa dibedakan dari
  // "kodenya tidak terdaftar di mapping".
  const sap = sapPerGroup([L({ code: 'A', priority: 1, perCtn: 48 })]);
  const hasil = kodeSumber('SERUM', sap, new Map([[kunciSaldo('A', 'GBJD'), { balance: 480 }]]), ['GBJD2', 'GBJD']);
  assert.deepEqual(hasil.map((k) => [k.supplierWhs, k.saldo]), [['GBJD2', 0], ['GBJD', 480]]);
});

test('dua kode x dua gudang = empat sumber', () => {
  const sap = sapPerGroup([L({ code: '122X', priority: 1, perCtn: 48 }), L({ code: '120X', priority: 2, perCtn: 48 })]);
  const hasil = kodeSumber('SERUM', sap, new Map(), ['GBJD2', 'GBJD']);
  assert.equal(hasil.length, 4);
});
