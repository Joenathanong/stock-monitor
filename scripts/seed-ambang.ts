/**
 * Isi ambang DOI (kritis / low / aman) untuk 5 kota, dari data user 5 Okt 2026.
 *
 * ANGKA ASLI YANG DIKIRIM USER, apa adanya:
 *
 *   Kritis    Pusat <4   Medan <14   Makassar <14   Surabaya <7   Yogyakarta <7
 *   Low       Pusat <5   Medan 15-21 Makassar 15-31 Surabaya 8-14 Yogyakarta 8-13
 *   Aman      Pusat =7   Medan 22-35 Makassar 32-45 Surabaya 15-21 Yogyakarta 14-20
 *   Overstock Pusat >7   Medan >35   Makassar >45   Surabaya >21  Yogyakarta >20
 *
 * DIBACA JADI TIGA BATAS (batas atas tiap pita, inklusif). Dasarnya: dengan
 * membaca "<N" sebagai "sampai N", keempat pita Medan/Makassar/Surabaya/
 * Yogyakarta menjadi RAPAT tanpa celah maupun tumpang-tindih. Dibaca harfiah
 * ("kurang dari N"), hari ke-14 (Medan/Makassar) dan hari ke-7
 * (Surabaya/Yogyakarta) tidak masuk pita mana pun.
 *
 * PUSAT DIKONFIRMASI USER 6 Okt 2026: low di 5 hari. Jadi 4/5/7 —
 * kritis 0-4, low tepat hari ke-5, aman 6-7, over >7. Rapat, tanpa celah.
 * (Dugaan awal saya low=6 SALAH; angka user yang benar.)
 *
 * Aman dijalankan berulang, TAPI hanya mengisi baris yang ambangnya masih
 * KOSONG. Nilai yang sudah diubah dari layar tidak ditimpa: skrip tidak boleh
 * membatalkan keputusan yang diambil user tanpa ia tahu. Pakai --paksa untuk
 * menimpa.
 */
import { prisma } from '../src/lib/prisma';
import { ambangDoi, ringkasPita, validasiArea } from '../src/lib/area-master';

/**
 * Dipakai SQL mentah, bukan Prisma Client, dengan sengaja: skrip ini menulis
 * kolom `doiCritical` yang baru, dan Prisma Client yang belum di-generate ulang
 * belum mengenalnya. SQL mentah membuat skrip ini jalan sebelum maupun sesudah
 * `prisma generate`, jadi tidak ada urutan tersembunyi yang harus diingat.
 */
type BarisDb = {
  code: string; name: string; isActive: number | boolean; sortOrder: number;
  doiCritical: number | null; doiMin: number | null; doiMax: number | null;
  note: string | null;
};

const paksa = process.argv.includes('--paksa');

/** [nama area, kritis, low, aman] */
const AMBANG: [string, number, number, number][] = [
  ['Pusat', 4, 5, 7],
  ['Medan', 14, 21, 35],
  ['Makassar', 14, 31, 45],
  ['Surabaya', 7, 14, 21],
  ['Yogyakarta', 7, 13, 20],
];

const baca = () => prisma.$queryRawUnsafe<BarisDb[]>(
  'SELECT code, name, isActive, sortOrder, doiCritical, doiMin, doiMax, note FROM area',
);

async function main() {
  console.log(`\nMengisi ambang DOI 5 kota${paksa ? ' (--paksa: menimpa nilai yang sudah ada)' : ''}\n`);

  const semua = await baca();
  const perNama = new Map(semua.map((a) => [a.name, a]));

  const belumAda: string[] = [];
  let diisi = 0; let dilewati = 0;

  for (const [nama, kritis, low, aman] of AMBANG) {
    const a = perNama.get(nama);
    if (!a) { belumAda.push(nama); continue; }

    // Divalidasi dengan aturan yang SAMA dengan form, bukan dipercaya begitu saja.
    const galat = validasiArea({
      code: a.code, name: a.name, doiCritical: kritis, doiMin: low, doiMax: aman,
    });
    if (galat.length) {
      console.log(`  ${nama.padEnd(12)} DITOLAK: ${galat[0].pesan}`);
      continue;
    }

    const sudahTerisi = a.doiCritical !== null || a.doiMin !== null || a.doiMax !== null;
    if (sudahTerisi && !paksa) {
      console.log(
        `  ${nama.padEnd(12)} DILEWATI — sudah terisi `
        + `${a.doiCritical ?? '-'}/${a.doiMin ?? '-'}/${a.doiMax ?? '-'} (pakai --paksa untuk menimpa)`,
      );
      dilewati++;
      continue;
    }

    await prisma.$executeRawUnsafe(
      'UPDATE area SET doiCritical = ?, doiMin = ?, doiMax = ? WHERE code = ?',
      kritis, low, aman, a.code,
    );
    // Angkanya sudah tiga-tiganya ada di sini, jadi tidak perlu lewat
    // `ambangDoi` — yang sejak 10 Okt 2026 mengembalikan null untuk baris yang
    // belum lengkap dan tidak lagi menerima angka cadangan.
    const pita = ringkasPita({ kritis, min: low, max: aman });
    console.log(
      `  ${nama.padEnd(12)} ${String(kritis).padStart(3)}/${String(low).padStart(3)}`
      + `/${String(aman).padStart(3)}   ${pita}`,
    );
    diisi++;
  }

  console.log(`\n${diisi} area diisi, ${dilewati} dilewati.`);

  if (belumAda.length) {
    console.log(`\n${belumAda.length} area BELUM terdaftar, jadi ambangnya tidak bisa diisi:`);
    for (const n of belumAda) console.log(`  - ${n}`);
    console.log('Jalankan "npm run seed:area" dulu, atau daftarkan di Pengaturan → Cabang / Area.');
  }

  // Area lain yang ambangnya masih kosong — tetap memakai perilaku lama, dan itu
  // harus disebut supaya tidak disangka sudah ikut aturan baru.
  const kosong = (await baca()).filter((a) =>
    (a.isActive === true || a.isActive === 1)
    && a.doiCritical === null && a.doiMin === null && a.doiMax === null);
  if (kosong.length) {
    console.log(`\n${kosong.length} area aktif masih TANPA ambang sendiri — statusnya tetap dihitung`);
    console.log('relatif terhadap lead time seperti sebelumnya (TIDAK berubah):');
    for (const a of kosong) console.log(`  - ${a.name} (${a.code})`);
  }
  console.log('');
}

main()
  .catch((e) => { console.error('\nGAGAL:', e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
