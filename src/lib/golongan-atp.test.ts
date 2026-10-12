import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  adalahClearance, golonganSku, golonganDikecualikan, bundlingTerblokir, hitungAtp,
  atpKeseluruhan, skuBelumDiset, kunciSebaran, KECUALI_BAWAAN, teksKeluarPembagi,
  susunTurunan, kunciBundle,
  type BarisStokAtp, type Sebaran, type PetaBundle, type SetelanKecuali, type BahanGolongan,
  type OpsiGolongan, type HasilArea,
} from './atp';
import { setelanArea, type BarisArea } from './area-master';
import { KOLOM_KETERANGAN, kolomStok, normalKolom } from './atp-impor';

/**
 * Penjaga aturan golongan ATP — Phase Out / Clearance / Gimmick (12 Okt 2026).
 *
 * Yang dikunci di sini BUKAN "angkanya benar" melainkan tiga hal yang kalau
 * rusak tidak akan terlihat dari layar:
 *
 *   1. aturannya satu, dipakai di tiga tempat (baris, bundling, pengingat);
 *   2. sebab pengecualian bisa DIBEDAKAN (golongan vs keputusan orang) — angka
 *      pendamping ATP bergantung penuh pada itu;
 *   3. setiap baris masuk TEPAT SATU pencacah, jadi tidak ada baris yang hilang
 *      dari laporan atau terhitung dua kali.
 */

const baris = (o: Partial<BarisStokAtp> = {}): BarisStokAtp => ({
  sku: 'ACNE-CLEANSER', areaId: 'Pusat', availableQty: 100,
  isActive: true, category: 'Sku', sapCode: '1201010101', ...o,
});

const sebaran = (xs: [string, string, boolean][]): Sebaran =>
  new Map(xs.map(([sku, area, v]) => [kunciSebaran(sku, area), v]));

const petaB = (xs: [string, string, number][]): PetaBundle => {
  const m = new Map<string, { itemSku: string; qty: number }[]>();
  for (const [b, item, qty] of xs) m.set(b, [...(m.get(b) ?? []), { itemSku: item, qty }]);
  return m;
};

const bahan = (phaseOut: string[] = [], kategori: [string, string][] = []): BahanGolongan =>
  ({ phaseOut: new Set(phaseOut), kategori: new Map(kategori) });

const opsi = (b: BahanGolongan, per: [string, SetelanKecuali][]): OpsiGolongan =>
  ({ bahan: b, setelan: new Map(per) });

const SEMUA: SetelanKecuali = { phaseOut: true, clearance: true, gimmick: true };
const TANPA: SetelanKecuali = { phaseOut: false, clearance: false, gimmick: false };

// --- pengenalan golongan ----------------------------------------------------

test('CS- dikenali di mana pun, termasuk SKU berawalan kotor', () => {
  // Bentuk nyata di OCS: '- BDL-…' dan '90 FYNE-…'. Saringan DOI
  // (`sku NOT LIKE 'CS-%'`) akan melewatkan keduanya tanpa ada yang tahu.
  assert.equal(adalahClearance('CS-HANASUI-SERUM'), true);
  assert.equal(adalahClearance('- CS-HANASUI-SERUM'), true);
  assert.equal(adalahClearance('90 CS-FYNE-TONER'), true);
  assert.equal(adalahClearance('BDL-CS-PAKET'), true);
});

test('CS- TIDAK ikut kalau cuma kebetulan ada huruf CS di dalam kode', () => {
  // Kalau ikut, SKU biasa akan hilang dari pembagi ATP dan tidak ada yang bisa
  // menebak sebabnya dari layar.
  assert.equal(adalahClearance('DISCS-FOO'), false);
  assert.equal(adalahClearance('CSX-FOO'), false);
  assert.equal(adalahClearance('ACNE-CLEANSER'), false);
});

test('gimmick ditentukan KATEGORI OCS, bukan prefiks kodenya', () => {
  // Sengaja berbeda dari `brandDariKode` yang memang membaca kode: segmen kedua
  // GIMMICK-* sering bukan brand maupun penanda apa pun (TAS, TUMBLER, VOUCHER).
  // Kategori adalah pernyataan OCS yang eksplisit; kode hanya penamaan.
  const b = bahan([], [['GIMMICK-TAS', 'Sku'], ['PAKET-ULTAH', 'Gimmick']]);
  assert.equal(golonganSku('GIMMICK-TAS', b), null);
  assert.equal(golonganSku('PAKET-ULTAH', b), 'GIMMICK');
});

test('saklar diperiksa satu per satu, bukan golongan ditentukan dulu', () => {
  // SKU bisa phase out DAN berkode CS-. Kalau Phase Out dimatikan sementara
  // Clearance menyala, ia harus tetap keluar — lewat Clearance.
  const b = bahan(['CS-HANASUI-SERUM']);
  assert.equal(golonganDikecualikan('CS-HANASUI-SERUM', b, SEMUA), 'PHASE_OUT');
  assert.equal(
    golonganDikecualikan('CS-HANASUI-SERUM', b, { ...SEMUA, phaseOut: false }),
    'CLEARANCE',
  );
  assert.equal(golonganDikecualikan('CS-HANASUI-SERUM', b, TANPA), null);
});

// --- perambatan ke bundling -------------------------------------------------

test('bundling diblokir komponen phase out WALAU tidak ada centang apa pun', () => {
  // INILAH lubang yang ditutup aturan ini. Sebelum 12 Okt 2026 perambatan hanya
  // dipicu centang "Tidak" yang tegas, jadi SKU phase out yang dibiarkan
  // "Belum" aman untuk dirinya sendiri tapi bundling-nya tetap masuk pembagi.
  const b = bundlingTerblokir(
    petaB([['BDL-X', 'KOMP-PO', 1]]),
    new Map(),
    ['Pusat'],
    opsi(bahan(['KOMP-PO']), [['Pusat', SEMUA]]),
  );
  assert.deepEqual(b.get(kunciSebaran('BDL-X', 'Pusat')), [{ sku: 'KOMP-PO', sebab: 'PHASE_OUT' }]);
});

test('setelan per cabang: diblokir di Makassar, tetap dihitung di Pusat', () => {
  const b = bundlingTerblokir(
    petaB([['BDL-X', 'GIM-A', 1]]),
    new Map(),
    ['Makassar', 'Pusat'],
    opsi(bahan([], [['GIM-A', 'Gimmick']]), [['Makassar', SEMUA], ['Pusat', TANPA]]),
  );
  assert.equal(b.has(kunciSebaran('BDL-X', 'Makassar')), true);
  assert.equal(b.has(kunciSebaran('BDL-X', 'Pusat')), false, 'Pusat mematikan aturan gimmick');
});

test('sebab GOLONGAN menang atas TIDAK_DISEBAR untuk komponen yang sama', () => {
  // 617 sel sudah dicentang "Tidak" justru KARENA golongannya. Kalau sebabnya
  // terlapor 'TIDAK_DISEBAR', angka pendamping tidak bisa mengembalikannya dan
  // pengecualian 8-11 poin itu jadi tidak bisa diaudit.
  const b = bundlingTerblokir(
    petaB([['BDL-X', 'KOMP-PO', 1]]),
    sebaran([['KOMP-PO', 'Pusat', false]]),
    ['Pusat'],
    opsi(bahan(['KOMP-PO']), [['Pusat', SEMUA]]),
  );
  assert.deepEqual(b.get(kunciSebaran('BDL-X', 'Pusat')), [{ sku: 'KOMP-PO', sebab: 'PHASE_OUT' }]);
});

test('aturan golongan TIDAK menulis apa pun ke peta sebaran', () => {
  // Kalau ditulis, bundling-nya tetap "Tidak" selamanya setelah komponennya
  // keluar dari daftar phase out — dan tidak ada cara membedakan mana keputusan
  // orang dan mana tulisan mesin.
  const peta = sebaran([]);
  bundlingTerblokir(
    petaB([['BDL-X', 'KOMP-PO', 1]]), peta, ['Pusat'],
    opsi(bahan(['KOMP-PO']), [['Pusat', SEMUA]]),
  );
  assert.equal(peta.size, 0);
});

// --- pencacah & dua angka ---------------------------------------------------

const hitung = (rows: BarisStokAtp[], sb: Sebaran, o: OpsiGolongan, peta: PetaBundle = new Map()) => {
  const areas = [...new Set(rows.map((r) => r.areaId))];
  const blokir = bundlingTerblokir(peta, sb, areas, o);
  return hitungAtp(rows, sb, 5, 'AKTIF', blokir, o);
};

test('baris bergolongan masuk takDihitungGolongan, BUKAN takDisebar', () => {
  // Keputusan user: "biarkan, sebab kategori menang". Itu yang membuat angka
  // "sengaja tidak disebar" kembali berarti apa yang ditulisnya — sebelumnya
  // +-separuhnya adalah SKU phase out yang menyamar jadi keputusan sebaran.
  const rows = [
    baris({ sku: 'PO-1', availableQty: 100 }),
    baris({ sku: 'BIASA', availableQty: 100 }),
  ];
  const h = hitung(
    rows,
    sebaran([['PO-1', 'Pusat', false], ['BIASA', 'Pusat', true]]),
    opsi(bahan(['PO-1']), [['Pusat', SEMUA]]),
  )[0];
  assert.equal(h.takDihitungGolongan.PHASE_OUT, 1);
  assert.equal(h.takDisebar, 0, 'centang "Tidak" itu tidak boleh dihitung dua kali');
  assert.equal(h.dihitung, 1);
});

test('angka pendamping mengembalikan yang keluar karena golongan', () => {
  const rows = [
    baris({ sku: 'PO-1', availableQty: 100 }),      // siap, tapi phase out
    baris({ sku: 'BIASA', availableQty: 1 }),       // ikut pembagi, belum siap
  ];
  const h = hitung(
    rows,
    sebaran([['PO-1', 'Pusat', false], ['BIASA', 'Pusat', true]]),
    opsi(bahan(['PO-1']), [['Pusat', SEMUA]]),
  )[0];
  assert.equal(h.dihitung, 1);
  assert.equal(h.persen, 0);
  assert.equal(h.dihitungTermasuk, 2);
  assert.equal(h.siapTermasuk, 1);
  assert.equal(h.persenTermasuk, 50);
});

test('angka pendamping TIDAK mengembalikan yang ditahan keputusan orang', () => {
  // "Belum diputuskan" dan komponen yang sengaja tidak disebar bukan akibat
  // aturan golongan, jadi keduanya tetap di luar KEDUA angka.
  const rows = [
    baris({ sku: 'BELUM', availableQty: 100 }),
    baris({ sku: 'TOLAK', availableQty: 100 }),
  ];
  const h = hitung(
    rows,
    sebaran([['TOLAK', 'Pusat', false]]),
    opsi(bahan([]), [['Pusat', SEMUA]]),
  )[0];
  assert.equal(h.belumDiputus, 1);
  assert.equal(h.takDisebar, 1);
  assert.equal(h.dihitungTermasuk, 0, 'tak satu pun boleh kembali');
});

test('bundling yang diblokir komponen bergolongan kembali di angka pendamping', () => {
  const rows = [
    baris({ sku: 'BDL-X', availableQty: 100, category: 'Bundle' }),
    baris({ sku: 'GIM-A', availableQty: 100, category: 'Gimmick' }),
  ];
  const h = hitung(
    rows,
    sebaran([['BDL-X', 'Pusat', true], ['GIM-A', 'Pusat', true]]),
    opsi(bahan([], [['GIM-A', 'Gimmick']]), [['Pusat', SEMUA]]),
    petaB([['BDL-X', 'GIM-A', 1]]),
  )[0];
  assert.equal(h.dihitung, 0, 'bundling keluar, komponen gimmick juga keluar');
  assert.equal(h.takDisebarGolongan.GIMMICK, 1);
  assert.equal(h.takDihitungGolongan.GIMMICK, 1);
  assert.equal(h.dihitungTermasuk, 2);
});

test('bundling yang diblokir komponen SENGAJA tidak disebar tetap di luar keduanya', () => {
  const rows = [baris({ sku: 'BDL-X', availableQty: 100, category: 'Bundle' })];
  const h = hitung(
    rows,
    sebaran([['BDL-X', 'Pusat', true], ['KOMP-A', 'Pusat', false]]),
    opsi(bahan([]), [['Pusat', SEMUA]]),
    petaB([['BDL-X', 'KOMP-A', 1]]),
  )[0];
  assert.equal(h.takDisebarTurunan, 1);
  assert.equal(h.dihitungTermasuk, 0);
});

test('setiap baris masuk TEPAT SATU pencacah', () => {
  // Penjaga paling berharga di berkas ini: begitu sebuah baris bisa masuk dua
  // pencacah (atau nol), laporan per cabang berhenti berjumlah dan tidak ada
  // yang akan menyadarinya dari persennya saja.
  const rows = [
    baris({ sku: 'PO-1' }), baris({ sku: 'CS-A' }), baris({ sku: 'GIM-A', category: 'Gimmick' }),
    baris({ sku: 'BIASA-YA' }), baris({ sku: 'BIASA-TIDAK' }), baris({ sku: 'BIASA-BELUM' }),
    baris({ sku: 'MATI', isActive: false }), baris({ sku: 'BUKAN-SKU', category: 'Material' }),
    baris({ sku: 'BDL-X', category: 'Bundle' }),
  ];
  const h = hitung(
    rows,
    sebaran([
      ['PO-1', 'Pusat', true], ['CS-A', 'Pusat', true], ['GIM-A', 'Pusat', true],
      ['BIASA-YA', 'Pusat', true], ['BIASA-TIDAK', 'Pusat', false],
      ['BDL-X', 'Pusat', true], ['KOMP-Z', 'Pusat', false],
    ]),
    opsi(bahan(['PO-1'], [['GIM-A', 'Gimmick']]), [['Pusat', SEMUA]]),
    petaB([['BDL-X', 'KOMP-Z', 1]]),
  )[0];
  const gol = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
  const total = h.dihitung + h.takDisebar + h.belumDiputus
    + gol(h.takDihitungGolongan) + gol(h.takDisebarGolongan)
    + h.ditolak.TIDAK_AKTIF + h.ditolak.BUKAN_KATEGORI_SKU;
  assert.equal(total, rows.length, JSON.stringify(h, null, 1));
  // takDisebarTurunan adalah BAGIAN dari takDisebar, bukan pencacah terpisah.
  assert.ok(h.takDisebarTurunan <= h.takDisebar);
});

test('atpKeseluruhan menjumlahkan angka pendamping juga', () => {
  const hasil: HasilArea[] = hitung(
    [baris({ sku: 'PO-1', areaId: 'Pusat' }), baris({ sku: 'PO-1', areaId: 'Medan' })],
    sebaran([['PO-1', 'Pusat', true], ['PO-1', 'Medan', true]]),
    opsi(bahan(['PO-1']), [['Pusat', SEMUA], ['Medan', SEMUA]]),
  );
  const t = atpKeseluruhan(hasil);
  assert.equal(t.dihitung, 0);
  assert.equal(t.persen, null, 'pembagi 0 bukan 0%');
  assert.equal(t.dihitungTermasuk, 2);
  assert.equal(t.persenTermasuk, 100);
});

// --- pengingat "belum diset" ------------------------------------------------

test('golongan yang dikecualikan hilang dari pengingat belum-diset', () => {
  // Kalau ikut, daftar pengingat tidak akan pernah bisa kosong — dan pengingat
  // yang tidak bisa dikosongkan adalah pengingat yang diabaikan.
  const rows = [baris({ sku: 'GIM-A', category: 'Gimmick' }), baris({ sku: 'BIASA' })];
  const b = skuBelumDiset(
    rows, new Map(), 'AKTIF',
    opsi(bahan([], [['GIM-A', 'Gimmick']]), [['Pusat', SEMUA]]),
  );
  assert.deepEqual(b.map((x) => x.sku), ['BIASA']);
});

test('dikecualikan di satu cabang saja: tetap perlu diputuskan di cabang lain', () => {
  const rows = [
    baris({ sku: 'GIM-A', areaId: 'Makassar', category: 'Gimmick' }),
    baris({ sku: 'GIM-A', areaId: 'Pusat', category: 'Gimmick' }),
  ];
  const b = skuBelumDiset(
    rows, new Map(), 'AKTIF',
    opsi(bahan([], [['GIM-A', 'Gimmick']]), [['Makassar', SEMUA], ['Pusat', TANPA]]),
  );
  assert.deepEqual(b.map((x) => x.areas), [['Pusat']]);
});

// --- setelan per cabang & warisan GABUNGAN ----------------------------------

const area = (o: Partial<BarisArea> = {}): BarisArea => ({
  code: 'X', name: 'X', isActive: true, sortOrder: 10,
  doiCritical: 4, doiMin: 6, doiMax: 7, leadTimeDays: null, atpTarget: null,
  atpKecualiPhaseOut: null, atpKecualiClearance: null, atpKecualiGimmick: null,
  startDate: null, note: null, ...o,
});

test('bawaan: ketiganya dikecualikan walau tabel area masih kosong', () => {
  assert.deepEqual(setelanArea([], 'Pusat').kecualiAtp, KECUALI_BAWAAN);
  assert.deepEqual(KECUALI_BAWAAN, { phaseOut: true, clearance: true, gimmick: true });
});

test('warisan GABUNGAN berlaku PER KOLOM, bukan per objek', () => {
  // Kalau diwarisi per objek, cabang yang menyentuh satu kolom akan diam-diam
  // berhenti mengikuti GABUNGAN untuk dua kolom lainnya.
  const rows = [
    area({ code: 'GABUNGAN', name: 'GABUNGAN', atpKecualiPhaseOut: false, atpKecualiClearance: false, atpKecualiGimmick: false }),
    area({ code: 'GBJD', name: 'Pusat', atpKecualiGimmick: true }),
  ];
  assert.deepEqual(setelanArea(rows, 'Pusat').kecualiAtp, { phaseOut: false, clearance: false, gimmick: true });
  assert.deepEqual(setelanArea(rows, 'GABUNGAN').kecualiAtp, { phaseOut: false, clearance: false, gimmick: false });
});

test('cabang yang mematikan satu golongan tidak mengubah cabang lain', () => {
  const rows = [
    area({ code: 'GABUNGAN', name: 'GABUNGAN' }),
    area({ code: 'GJMK', name: 'Makassar', atpKecualiGimmick: false }),
  ];
  assert.equal(setelanArea(rows, 'Makassar').kecualiAtp.gimmick, false);
  assert.equal(setelanArea(rows, 'Medan').kecualiAtp.gimmick, true, 'Medan ikut GABUNGAN');
});

// --- penjaga statis: tidak boleh ada jalur yang melewatkan aturannya ---------

/** Seluruh berkas sumber (bukan tes) di bawah src/. */
function berkasSumber(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return berkasSumber(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/** Teks argumen satu pemanggilan `nama(...)`, dengan tanda kurung diseimbangkan. */
function argumen(kode: string, nama: string): string[] {
  const out: string[] = [];
  const pola = new RegExp(`\\b${nama}\\(`, 'g');
  for (let m = pola.exec(kode); m; m = pola.exec(kode)) {
    let d = 1;
    let i = m.index + m[0].length;
    for (; i < kode.length && d > 0; i++) {
      if (kode[i] === '(') d++;
      else if (kode[i] === ')') d--;
    }
    out.push(kode.slice(m.index + m[0].length, i - 1));
  }
  return out;
}

test('setiap pemanggil aturan ATP menyalurkan setelan golongan', () => {
  // INI penjaga yang paling penting di berkas ini, dan sebabnya tertulis di
  // `atp-store.ts`: halaman /atp, poster /wa dan Dashboard membaca tabel yang
  // SAMA. Kalau satu jalur menerapkan aturan golongan dan jalur lain tidak, dua
  // angka bernama "ATP" akan berselisih tanpa ada yang gagal — persis kesalahan
  // yang user temukan 8 Okt 2026 (Available 69,6% vs ATP 69,8%), dan yang
  // dicurigai akan perhitungannya, bukan kedua pemanggilnya.
  //
  // Jadi yang dikunci bukan hasilnya, melainkan bentuknya: tiga fungsi aturan
  // ini TIDAK BOLEH dipanggil tanpa menyalurkan `opsi`.
  const salah: string[] = [];
  for (const f of berkasSumber('src')) {
    if (f === join('src', 'lib', 'atp.ts')) continue;   // tempat aturannya didefinisikan
    const kode = readFileSync(f, 'utf8');
    for (const fn of ['hitungAtp', 'bundlingTerblokir', 'skuBelumDiset']) {
      for (const arg of argumen(kode, fn)) {
        if (!/\bopsi\b/.test(arg)) salah.push(`${f}: ${fn}(${arg.replace(/\s+/g, ' ').slice(0, 80)})`);
      }
    }
  }
  assert.deepEqual(salah, [], `pemanggilan tanpa setelan golongan:\n${salah.join('\n')}`);
});

test('setiap kolom keterangan di lembar unduhan dikenali importer', () => {
  // KEJADIAN NYATA: kolom "Tak dihitung ATP" dan "Keluar pembagi" ditambahkan ke
  // lembar Sebaran, dan importer belum mengenalnya. Akibatnya mengunggah ulang
  // berkas yang DIHASILKAN APLIKASI SENDIRI akan melaporkan "kolom asing" —
  // peringatan yang berarti "berkas Anda salah", untuk berkas yang kita buat.
  //
  // Tesnya membaca HEADER literal dari route export, bukan daftar yang diketik
  // ulang di sini: daftar kedua akan ikut ketinggalan sama seperti yang pertama.
  const kode = readFileSync(join('src', 'app', 'api', 'atp', 'export', 'route.ts'), 'utf8');
  const lembarSebaran = kode.slice(kode.indexOf("nama: 'Sebaran'"), kode.indexOf("nama: 'Stok'"));
  const header = [...lembarSebaran.matchAll(/header: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(header.length >= 8, `header lembar Sebaran tidak terbaca: ${header.length}`);

  // Nama cabang dinamis (`header: a`) tidak muncul sebagai teks, jadi seluruh
  // header literal di sini memang HARUS kolom keterangan.
  const asing = header.filter((h) => {
    const k = normalKolom(h);
    return !KOLOM_KETERANGAN.has(k) && !kolomStok(k);
  });
  assert.deepEqual(asing, [], `kolom ini akan dilaporkan sebagai "kolom asing" saat unggah ulang:\n${asing.join('\n')}`);
});

// --- kolom "Keluar pembagi" di berkas unduhan --------------------------------

test('kasus nyata BDL-HANASUI-0000000489: sebabnya terbaca di berkas', () => {
  // Bentuk persis seperti data produksi 12 Okt 2026: dicentang "Ya" di kelima
  // cabang, kedua komponennya phase out, jadi keluar pembagi di kelimanya.
  const blokir = [
    { sku: 'CUSHION-SOULMATTE-FAIRY-PINKISH-5', sebab: 'PHASE_OUT' as const },
    { sku: 'SETTINGPOWDER-TRANSLUCENT-4', sebab: 'PHASE_OUT' as const },
  ];
  const areas = ['Makassar', 'Medan', 'Pusat', 'Surabaya', 'Yogyakarta'];
  const area = Object.fromEntries(areas.map((a) => [a, { dibagikan: true, blokir, dikecualikan: null }]));
  assert.equal(
    teksKeluarPembagi(area, areas),
    'Makassar,Medan,Pusat,Surabaya,Yogyakarta — komponen phase out: '
      + 'CUSHION-SOULMATTE-FAIRY-PINKISH-5, SETTINGPOWDER-TRANSLUCENT-4',
  );
});

test('baris yang memang ikut pembagi menghasilkan kolom KOSONG', () => {
  // Kalau terisi untuk baris normal, kolomnya jadi derau dan berhenti dibaca.
  const areas = ['Pusat'];
  assert.equal(teksKeluarPembagi({ Pusat: { dibagikan: true, blokir: [], dikecualikan: null } }, areas), '');
  assert.equal(teksKeluarPembagi({ Pusat: { dibagikan: false, blokir: [], dikecualikan: null } }, areas), '');
  assert.equal(teksKeluarPembagi({ Pusat: { dibagikan: null, blokir: [], dikecualikan: null } }, areas), '');
});

test('sebab berbeda antar cabang tidak digabung jadi satu', () => {
  const areas = ['Pusat', 'Medan'];
  const teks = teksKeluarPembagi({
    Pusat: { dibagikan: true, blokir: [], dikecualikan: 'GIMMICK' },
    Medan: { dibagikan: true, blokir: [{ sku: 'KOMP-A', sebab: 'TIDAK_DISEBAR' }], dikecualikan: null },
  }, areas);
  assert.equal(teks, 'Pusat — Gimmick — SKU ini sendiri ; Medan — komponen tidak disebar: KOMP-A');
});

test('golongan SKU sendiri menang atas daftar blokir komponen', () => {
  // Kalau komponennya juga disebut, kolomnya menyalahkan komponen untuk baris
  // yang sebenarnya keluar karena dirinya sendiri — dan orang akan mengejar
  // komponen yang tidak perlu diapa-apakan.
  const areas = ['Pusat'];
  assert.equal(
    teksKeluarPembagi({ Pusat: {
      dibagikan: true,
      blokir: [{ sku: 'KOMP-A', sebab: 'TIDAK_DISEBAR' }],
      dikecualikan: 'CLEARANCE',
    } }, areas),
    'Pusat — Clearance (CS-) — SKU ini sendiri',
  );
});

// --- komposisi untuk SKU bundle berpenulisan kotor ---------------------------

test('SKU bundle berawalan kotor tetap menemukan komposisinya', () => {
  // KEJADIAN NYATA 12 Okt 2026: baris '- BDL-HANASUI-0000001615' di
  // stock_current menulis "belum ditarik" selamanya, karena daftar bundle OCS
  // menyebut kodenya bersih. Labelnya menuduh penarikan yang sudah berhasil.
  const peta: PetaBundle = new Map([['BDL-HANASUI-0000001615', [{ itemSku: 'KOMP-A', qty: 1 }, { itemSku: 'KOMP-B', qty: 2 }]]]);
  const stok = new Map([
    ['KOMP-A', new Map([['Pusat', { availableQty: 10, isActive: true, name: 'A' }]])],
    ['KOMP-B', new Map([['Pusat', { availableQty: 10, isActive: true, name: 'B' }]])],
  ]);
  const hasil = susunTurunan('- BDL-HANASUI-0000001615', peta, stok, ['Pusat']);
  assert.equal(hasil.n, 2);
  assert.equal(hasil.muat.Pusat, 5, 'min(10/1, 10/2) = 5');
});

test('pencarian sama-persis tetap menang, kunci bersih hanya cadangan', () => {
  // Kalau kunci yang dibersihkan dipakai lebih dulu, dua SKU berbeda yang
  // kebetulan berakhiran sama bisa saling menukar komposisi.
  const peta: PetaBundle = new Map([
    ['- BDL-X', [{ itemSku: 'KOTOR', qty: 1 }]],
    ['BDL-X', [{ itemSku: 'BERSIH', qty: 1 }]],
  ]);
  const stok = new Map([
    ['KOTOR', new Map([['Pusat', { availableQty: 1, isActive: true, name: 'k' }]])],
    ['BERSIH', new Map([['Pusat', { availableQty: 1, isActive: true, name: 'b' }]])],
  ]);
  assert.equal(susunTurunan('- BDL-X', peta, stok, ['Pusat']).turunan[0].itemSku, 'KOTOR');
  assert.equal(susunTurunan('BDL-X', peta, stok, ['Pusat']).turunan[0].itemSku, 'BERSIH');
});

test('kunciBundle membuang awalan sampah, bukan mengarang kode', () => {
  assert.equal(kunciBundle('- BDL-HANASUI-0000001615'), 'BDL-HANASUI-0000001615');
  assert.equal(kunciBundle('90 BDL-FYNE-00000000068'), 'BDL-FYNE-00000000068');
  assert.equal(kunciBundle('BDL-X'), 'BDL-X');
  // Bukan bundle: dikembalikan apa adanya (hanya di-trim), tidak dipotong-potong.
  assert.equal(kunciBundle('  ACNE-CLEANSER  '), 'ACNE-CLEANSER');
  assert.equal(kunciBundle(''), '');
});
