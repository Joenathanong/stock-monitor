import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rincianAtp, hitungAtp, bundlingTerblokir, kunciSebaran, MASUK_PEMBAGI,
  type BarisStokAtp, type Sebaran, type PetaBundle, type SetelanKecuali,
  type BahanGolongan, type OpsiGolongan, type KelompokRincian,
} from './atp';

/**
 * Penjaga rincian ATP (permintaan user 12 Okt 2026: "agar angka atp transparan").
 *
 * SATU hal yang dijaga di sini, dan ia lebih penting daripada isi daftarnya:
 * rincian harus MENJELASKAN ANGKA YANG SAMA dengan yang dipajang. Rincian yang
 * menjelaskan angka lain bukan sekadar tidak berguna — ia lebih buruk daripada
 * tidak ada, karena orang akan memercayainya dan mengambil keputusan dari
 * penjelasan yang salah.
 *
 * Caranya: jumlah tiap kelompok di `rincianAtp` dibandingkan dengan pencacah
 * `hitungAtp` atas data yang SAMA. Dua urutan pemeriksaan yang menyimpang akan
 * gagal di sini, bukan ditemukan berbulan kemudian.
 */

const baris = (o: Partial<BarisStokAtp> = {}): BarisStokAtp => ({
  sku: 'SKU-X', areaId: 'Pusat', availableQty: 100,
  isActive: true, category: 'Sku', sapCode: '1201010101', ...o,
});

const sebaran = (xs: [string, string, boolean][]): Sebaran =>
  new Map(xs.map(([sku, area, v]) => [kunciSebaran(sku, area), v]));

const petaB = (xs: [string, string, number][]): PetaBundle => {
  const m = new Map<string, { itemSku: string; qty: number }[]>();
  for (const [b, item, qty] of xs) m.set(b, [...(m.get(b) ?? []), { itemSku: item, qty }]);
  return m;
};

const SEMUA: SetelanKecuali = { phaseOut: true, clearance: true, gimmick: true };
const bahan = (phaseOut: string[] = [], kategori: [string, string][] = []): BahanGolongan =>
  ({ phaseOut: new Set(phaseOut), kategori: new Map(kategori) });
const opsiG = (b: BahanGolongan): OpsiGolongan => ({ bahan: b, setelan: new Map([['Pusat', SEMUA]]) });

/** Satu kumpulan data yang memuat SEMUA kelompok sekaligus. */
function contoh() {
  const rows = [
    baris({ sku: 'SIAP-1', availableQty: 100 }),
    baris({ sku: 'SIAP-2', availableQty: 6 }),
    baris({ sku: 'TIPIS-1', availableQty: 5 }),          // tepat di ambang = BELUM siap
    baris({ sku: 'TIPIS-2', availableQty: 0 }),
    baris({ sku: 'TOLAK-1', availableQty: 50 }),          // dicentang Tidak
    baris({ sku: 'BELUM-1', availableQty: 50 }),          // tanpa keputusan
    baris({ sku: 'PO-1', availableQty: 50 }),
    baris({ sku: 'CS-A', availableQty: 50 }),
    baris({ sku: 'GIM-A', availableQty: 50, category: 'Gimmick' }),
    baris({ sku: 'BDL-X', availableQty: 50, category: 'Bundle' }),
    baris({ sku: 'MATI-1', availableQty: 50, isActive: false }),
    baris({ sku: 'LAIN-1', availableQty: 50, category: 'Material' }),
  ];
  const sb = sebaran([
    ['SIAP-1', 'Pusat', true], ['SIAP-2', 'Pusat', true],
    ['TIPIS-1', 'Pusat', true], ['TIPIS-2', 'Pusat', true],
    ['TOLAK-1', 'Pusat', false],
    ['PO-1', 'Pusat', true], ['CS-A', 'Pusat', true], ['GIM-A', 'Pusat', true],
    ['BDL-X', 'Pusat', true], ['KOMP-Z', 'Pusat', false],
    ['MATI-1', 'Pusat', true], ['LAIN-1', 'Pusat', true],
  ]);
  const peta = petaB([['BDL-X', 'KOMP-Z', 1]]);
  const o = opsiG(bahan(['PO-1'], [['GIM-A', 'Gimmick']]));
  const blokir = bundlingTerblokir(peta, sb, ['Pusat'], o);
  return { rows, sb, blokir, o };
}

test('rincian menjelaskan ANGKA YANG SAMA dengan hitungAtp', () => {
  const { rows, sb, blokir, o } = contoh();
  const h = hitungAtp(rows, sb, 5, 'AKTIF', blokir, o)[0];
  const r = rincianAtp(rows, 'Pusat', sb, 5, blokir, o);

  assert.equal(r.dihitung, h.dihitung, 'pembagi');
  assert.equal(r.siap, h.siap, 'pembilang');
  assert.equal(r.persen, h.persen, 'persen');

  const n = (k: KelompokRincian) => r.grup.find((g) => g.kunci === k)?.n ?? 0;
  assert.equal(n('SIAP'), h.siap);
  assert.equal(n('BELUM_SIAP'), h.dihitung - h.siap);
  // HUBUNGAN YANG TIDAK LANGSUNG, dan tes ini yang menemukannya:
  // `hitungAtp.takDisebar` SUDAH MEMUAT bundling yang diblokir komponen yang
  // sengaja tidak disebar (`takDisebarTurunan` adalah bagian di dalamnya, bukan
  // pencacah terpisah). Rincian memisahkannya jadi kelompok 'KOMPONEN' sendiri,
  // karena bagi pembacanya dua hal itu butuh tindakan berbeda: yang satu
  // keputusan atas SKU itu sendiri, yang lain keputusan atas komponennya.
  //
  // Jadi yang harus cocok adalah jumlah KEDUANYA, bukan masing-masing.
  assert.equal(n('TIDAK_DISEBAR'), h.takDisebar - h.takDisebarTurunan);
  assert.equal(n('BELUM_DIPUTUS'), h.belumDiputus);
  assert.equal(n('PHASE_OUT'), h.takDihitungGolongan.PHASE_OUT);
  assert.equal(n('CLEARANCE'), h.takDihitungGolongan.CLEARANCE);
  assert.equal(n('GIMMICK'), h.takDihitungGolongan.GIMMICK);
  assert.equal(n('TIDAK_AKTIF'), h.ditolak.TIDAK_AKTIF);
  assert.equal(n('BUKAN_KATEGORI_SKU'), h.ditolak.BUKAN_KATEGORI_SKU);
  // Bundling yang diblokir komponen: di hitungAtp terbelah menurut sebab
  // komponennya, di rincian satu kelompok 'KOMPONEN' dengan sebab per baris.
  const golBdl = Object.values(h.takDisebarGolongan).reduce((a, b) => a + b, 0);
  assert.equal(n('KOMPONEN'), h.takDisebarTurunan + golBdl);
  // Dan ini penjaganya: apa pun cara membelahnya, jumlah yang keluar pembagi
  // karena keputusan/komponen harus sama di kedua sisi.
  assert.equal(
    n('TIDAK_DISEBAR') + n('KOMPONEN'),
    h.takDisebar + golBdl,
    'pembelahan takDisebar vs KOMPONEN tidak berjumlah sama',
  );
});

test('seluruh baris cabang itu masuk tepat satu kelompok', () => {
  const { rows, sb, blokir, o } = contoh();
  const r = rincianAtp(rows, 'Pusat', sb, 5, blokir, o);
  const total = r.grup.reduce((t, g) => t + g.n, 0);
  assert.equal(total, rows.filter((x) => x.areaId === 'Pusat').length);
});

test('kelompok yang ikut pembagi HANYA siap & belum siap', () => {
  // Kalau kelompok lain ikut ditandai masuk pembagi, panel akan menyalahkan
  // persennya pada baris yang tidak pernah mempengaruhinya.
  const { rows, sb, blokir, o } = contoh();
  const r = rincianAtp(rows, 'Pusat', sb, 5, blokir, o);
  const masuk = r.grup.filter((g) => g.masukPembagi).map((g) => g.kunci).sort();
  assert.deepEqual(masuk, ['BELUM_SIAP', 'SIAP']);
  assert.deepEqual([...MASUK_PEMBAGI].sort(), ['BELUM_SIAP', 'SIAP']);
  assert.equal(r.grup.filter((g) => g.masukPembagi).reduce((t, g) => t + g.n, 0), r.dihitung);
});

test('ambang inklusif: tepat di ambang berarti BELUM siap', () => {
  // `availableQty > ambang`, bukan >=. Kalau terbalik, satu SKU berpindah
  // kelompok dan persennya bergeser tanpa ada yang mengubah apa pun.
  const rows = [baris({ sku: 'A', availableQty: 5 }), baris({ sku: 'B', availableQty: 6 })];
  const sb = sebaran([['A', 'Pusat', true], ['B', 'Pusat', true]]);
  const r = rincianAtp(rows, 'Pusat', sb, 5);
  assert.deepEqual(r.grup.find((g) => g.kunci === 'SIAP')?.sku.map((x) => x.sku), ['B']);
  assert.deepEqual(r.grup.find((g) => g.kunci === 'BELUM_SIAP')?.sku.map((x) => x.sku), ['A']);
});

test('komponen pemblokir DISEBUT namanya di keterangan baris', () => {
  // Tanpa nama komponennya, "tidak dihitung" tidak bisa ditindaklanjuti — dan
  // itu inti permintaannya: alasannya apa, bukan cuma bahwa ada alasan.
  const { rows, sb, blokir, o } = contoh();
  const r = rincianAtp(rows, 'Pusat', sb, 5, blokir, o);
  const g = r.grup.find((x) => x.kunci === 'KOMPONEN');
  assert.equal(g?.n, 1);
  assert.match(g!.sku[0].ket, /KOMP-Z/);
  assert.match(g!.sku[0].ket, /tidak disebar/);
});

test('cabang lain tidak ikut terhitung', () => {
  const rows = [
    baris({ sku: 'A', areaId: 'Pusat', availableQty: 100 }),
    baris({ sku: 'A', areaId: 'Medan', availableQty: 0 }),
  ];
  const sb = sebaran([['A', 'Pusat', true], ['A', 'Medan', true]]);
  const r = rincianAtp(rows, 'Pusat', sb, 5);
  assert.equal(r.dihitung, 1);
  assert.equal(r.siap, 1);
});

test('batas baris memotong daftar tapi TIDAK jumlahnya', () => {
  // Jumlah yang ikut terpotong akan membuat panel berdebat dengan angka di
  // poster — persis kegagalan yang paling mahal untuk fitur transparansi.
  const rows = Array.from({ length: 12 }, (_, i) => baris({ sku: `S${i}`, availableQty: 100 }));
  const sb = sebaran(rows.map((r) => [r.sku, 'Pusat', true] as [string, string, boolean]));
  const r = rincianAtp(rows, 'Pusat', sb, 5, new Map(), undefined, 5);
  const g = r.grup.find((x) => x.kunci === 'SIAP')!;
  assert.equal(g.n, 12);
  assert.equal(g.sku.length, 5);
  assert.equal(g.lebih, 7);
  assert.equal(r.dihitung, 12);
});
