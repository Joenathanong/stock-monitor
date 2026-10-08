import { test } from 'node:test';
import assert from 'node:assert/strict';
import { petaParalel } from './paralel';

const tunggu = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

test('urutan hasil ikut masukan, bukan urutan selesai', async () => {
  // Yang paling lambat ditaruh pertama: kalau hasilnya diurut menurut waktu
  // selesai, 'a' akan jatuh ke belakang dan pemanggil salah pasang.
  const r = await petaParalel(
    [30, 1, 1],
    async (ms, i) => { await tunggu(ms); return `${i}:${ms}`; },
    { batas: 3 },
  );
  assert.deepEqual(r.hasil.map((s) => (s.ada ? s.nilai : null)), ['0:30', '1:1', '2:1']);
  assert.equal(r.jalan, 3);
  assert.equal(r.dilewati, 0);
});

test('tidak pernah lebih dari `batas` yang jalan serentak', async () => {
  let sekarang = 0; let puncak = 0;
  await petaParalel(
    Array.from({ length: 20 }, (_, i) => i),
    async () => { sekarang++; puncak = Math.max(puncak, sekarang); await tunggu(5); sekarang--; },
    { batas: 4 },
  );
  assert.equal(puncak, 4, `puncak ${puncak}`);
  assert.equal(sekarang, 0, 'semua pekerja harus selesai');
});

test('batas 1 sama dengan berurutan', async () => {
  const urut: number[] = [];
  await petaParalel([1, 2, 3], async (n) => { urut.push(n); await tunggu(1); }, { batas: 1 });
  assert.deepEqual(urut, [1, 2, 3]);
});

test('boleh() menghentikan sisanya, dan sisanya ditandai ada:false', async () => {
  // Inilah yang dipakai anggaran waktu: begitu waktunya habis, pekerjaan yang
  // belum mulai TIDAK dijalankan — dan harus bisa dibedakan dari yang selesai.
  let n = 0;
  const r = await petaParalel(
    [1, 2, 3, 4, 5, 6],
    async (x) => { n++; return x * 10; },
    { batas: 1, boleh: () => n < 2 },
  );
  assert.equal(r.jalan, 2);
  assert.equal(r.dilewati, 4);
  assert.deepEqual(r.hasil.map((s) => (s.ada ? s.nilai : 'LEWAT')), [10, 20, 'LEWAT', 'LEWAT', 'LEWAT', 'LEWAT']);
});

test('boleh() yang menolak di awal tidak menjalankan apa pun', async () => {
  let n = 0;
  const r = await petaParalel([1, 2, 3], async () => { n++; }, { boleh: () => false });
  assert.equal(n, 0);
  assert.equal(r.jalan, 0);
  assert.equal(r.dilewati, 3);
  assert.ok(r.hasil.every((s) => !s.ada));
});

test('anggaran habis tidak memicu permintaan tambahan sebanyak `batas`', async () => {
  // Tanpa penanda `berhenti`, setiap pekerja masih mengambil satu tugas lagi
  // setelah waktunya lewat — pada batas 6 itu 6 permintaan ekstra ke OCS.
  let mulai = 0;
  let bolehJalan = true;
  const p = petaParalel(
    Array.from({ length: 30 }, (_, i) => i),
    async () => { mulai++; await tunggu(20); },
    { batas: 6, boleh: () => bolehJalan },
  );
  await tunggu(5);
  bolehJalan = false;
  await p;
  assert.equal(mulai, 6, `yang sempat mulai ${mulai} — harus tepat 6, yaitu yang sudah jalan`);
});

test('daftar kosong aman', async () => {
  const r = await petaParalel([], async () => 1, { batas: 4 });
  assert.deepEqual(r, { hasil: [], jalan: 0, dilewati: 0 });
});

test('galat di satu pekerjaan tidak boleh ditelan modul ini', async () => {
  // Modul ini TIDAK menangkap galat: penarik transit perlu tahu dokumen mana
  // yang gagal supaya pembersihan dilewati. Jadi galatnya harus naik, dan
  // pemanggil yang memutuskan — dibuktikan di sini supaya tidak ada yang
  // "memperbaikinya" dengan try/catch di dalam sini.
  await assert.rejects(
    petaParalel([1], async () => { throw new Error('gagal'); }, { batas: 1 }),
    /gagal/,
  );
});
