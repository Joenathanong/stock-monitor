/**
 * Pembaca tabel `area` — satu-satunya jalan kode mengetahui daftar cabang.
 *
 * Dipisah dari `area-master.ts` supaya aturannya tetap bisa diuji tanpa
 * database: yang ini menyentuh Prisma, yang itu murni.
 */
import { prisma } from './prisma';
import { toDateKeyUtc } from './dates';
import { KODE_AREA_BAWAAN, petaKodeArea, areaAktif, type BarisArea } from './area-master';
import { AREA_GABUNGAN, KODE_GABUNGAN } from './areas';

/**
 * Ambang baris GABUNGAN saat pertama dibuat — SAMA PERSIS dengan tiga
 * pengaturan global yang dicabut 10 Okt 2026 (lead time 7, safety 3, target 14).
 *
 * Disamakan dengan sengaja: pemindahan ini soal DI MANA angkanya diatur, bukan
 * BERAPA angkanya. Kalau baris gabungan lahir dengan angka lain, laporan
 * gabungan berubah di hari yang sama tanpa ada yang meminta, dan perubahan itu
 * akan dikira akibat perhitungannya — bukan akibat pemindahan setelan.
 */
export const AMBANG_GABUNGAN_AWAL = { doiCritical: 7, doiMin: 10, doiMax: 14, leadTimeDays: 7 } as const;

const bersih = (r: {
  code: string; name: string; isActive: boolean; sortOrder: number;
  // Opsional, bukan kelalaian: kolomnya `Int?`, dan Prisma Client yang
  // di-generate SEBELUM kolom ini ada tidak memuatnya. `?? null` di bawah
  // adalah nilai yang benar untuk keduanya, jadi `prisma generate` yang
  // tertinggal tidak memutus build.
  doiCritical?: number | null; doiMin: number | null; doiMax: number | null;
  leadTimeDays?: number | null; atpTarget?: number | null;
  startDate: Date | null; note: string | null;
}): BarisArea => ({
  code: r.code,
  name: r.name,
  isActive: r.isActive,
  sortOrder: r.sortOrder,
  doiCritical: r.doiCritical ?? null,
  doiMin: r.doiMin,
  doiMax: r.doiMax,
  leadTimeDays: r.leadTimeDays ?? null,
  atpTarget: r.atpTarget ?? null,
  startDate: r.startDate ? toDateKeyUtc(r.startDate) : null,
  note: r.note,
});

/** Seluruh baris area, termasuk yang nonaktif (data lama tetap harus terbaca). */
export async function muatArea(): Promise<BarisArea[]> {
  const rows = await prisma.area.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  return rows.map(bersih);
}

/**
 * Pastikan baris GABUNGAN ada. Aman dipanggil berulang.
 *
 * Dipanggil di awal `runCompute`, dan itu bukan kerapian — itu menutup lubang
 * deploy. Ambang laporan gabungan pindah dari pengaturan global ke baris ini
 * pada 10 Okt 2026; kalau kodenya sudah ter-deploy tapi barisnya belum dibuat
 * (user belum menekan "Isi dari data yang ada"), perhitungan area GABUNGAN
 * tidak punya ambang sama sekali dan cron 07.30 GAGAL — setiap hari, sampai ada
 * yang menyadari hubungannya dengan deploy kemarin.
 *
 * Isinya 7/10/14, angka global yang dulu dipakai gabungan, jadi menambahkannya
 * tidak menggeser satu status pun. Lima cabang tidak terpengaruh: ambangnya
 * sudah lengkap, jadi mereka tidak pernah menyentuh baris ini.
 */
export async function pastikanBarisGabungan(): Promise<boolean> {
  const ada = await prisma.area.findUnique({ where: { code: KODE_GABUNGAN }, select: { code: true } });
  if (ada) return false;
  await prisma.area.create({
    data: { code: KODE_GABUNGAN, name: AREA_GABUNGAN, sortOrder: 0, ...AMBANG_GABUNGAN_AWAL },
  });
  return true;
}

/** Peta kode gudang → nama area, untuk `mapReceive`. */
export async function petaArea(): Promise<Map<string, string>> {
  return petaKodeArea(await muatArea());
}

/** Area yang ikut ditarik & dihitung, berurut. */
export async function areaAktifDb(): Promise<BarisArea[]> {
  return areaAktif(await muatArea());
}

/**
 * Isi tabel `area` kalau masih kosong.
 *
 * Dua sumber, digabung: lima kode bawaan yang dulu ditulis di `receive.ts`, dan
 * nama area yang sudah ada di `stock_current`. Yang kedua perlu karena nama di
 * stok adalah nama yang SUDAH dipakai seluruh data lama — kalau tidak ikut
 * didaftarkan, baris lamanya jadi "area asing".
 *
 * Aman dijalankan berulang: baris yang sudah ada tidak diubah.
 */
export async function isiAreaBawaan(): Promise<{ dibuat: string[]; sudahAda: number; perluKode: string[] }> {
  const ada = await prisma.area.findMany({ select: { code: true, name: true } });
  const kodeAda = new Set(ada.map((a) => a.code));
  const namaAda = new Set(ada.map((a) => a.name));

  const dibuat: string[] = [];
  let urut = 10;
  for (const [code, name] of Object.entries(KODE_AREA_BAWAAN)) {
    if (kodeAda.has(code) || namaAda.has(name)) { urut += 10; continue; }
    await prisma.area.create({ data: { code, name, sortOrder: urut } });
    dibuat.push(`${code} → ${name}`);
    namaAda.add(name); kodeAda.add(code);
    urut += 10;
  }

  // Baris ambang laporan GABUNGAN. Bukan cabang: tidak punya gudang, tidak
  // ditarik stoknya, tidak dicocokkan SIT-nya. Ia ada semata supaya angka
  // gabungan diatur di tabel yang sama dengan cabang lain, bukan di pengaturan
  // global terpisah seperti sebelum 10 Okt 2026.
  if (!kodeAda.has(KODE_GABUNGAN)) {
    await prisma.area.create({
      data: { code: KODE_GABUNGAN, name: AREA_GABUNGAN, sortOrder: 0, ...AMBANG_GABUNGAN_AWAL },
    });
    dibuat.push(`${KODE_GABUNGAN} → ${AREA_GABUNGAN} (ambang laporan gabungan)`);
    kodeAda.add(KODE_GABUNGAN); namaAda.add(AREA_GABUNGAN);
  }

  // Nama area dari stok yang kodenya TIDAK diketahui sengaja TIDAK dibuatkan
  // baris. Dulu di sini dibuat baris berkode "TBD…" supaya kelihatan lengkap —
  // itu keliru: barisnya tampak terdaftar padahal tidak berfungsi, karena yang
  // dipakai mencocokkan SIT adalah kode gudangnya, bukan namanya. Separuh
  // terdaftar lebih berbahaya daripada belum terdaftar, karena tidak ada lagi
  // yang memperingatkan. Namanya dikembalikan sebagai `perluKode` supaya
  // Pengaturan bisa meminta user mengisi kode yang BENAR.
  const dariStok = await prisma.$queryRawUnsafe<{ areaId: string }[]>(
    "SELECT DISTINCT areaId FROM stock_current WHERE areaId <> '' ORDER BY areaId",
  );
  const perluKode = [...new Set(dariStok.map((r) => String(r.areaId ?? '').trim()))]
    .filter((nama) => nama && !namaAda.has(nama))
    .sort();

  return { dibuat, sudahAda: ada.length, perluKode };
}
