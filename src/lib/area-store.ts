/**
 * Pembaca tabel `area` — satu-satunya jalan kode mengetahui daftar cabang.
 *
 * Dipisah dari `area-master.ts` supaya aturannya tetap bisa diuji tanpa
 * database: yang ini menyentuh Prisma, yang itu murni.
 */
import { prisma } from './prisma';
import { toDateKeyUtc } from './dates';
import { KODE_AREA_BAWAAN, petaKodeArea, areaAktif, type BarisArea } from './area-master';

const bersih = (r: {
  code: string; name: string; isActive: boolean; sortOrder: number;
  // Opsional, bukan kelalaian: kolomnya `Int?`, dan Prisma Client yang
  // di-generate SEBELUM kolom ini ada tidak memuatnya. `?? null` di bawah
  // adalah nilai yang benar untuk keduanya, jadi `prisma generate` yang
  // tertinggal tidak memutus build.
  doiCritical?: number | null; doiMin: number | null; doiMax: number | null;
  startDate: Date | null; note: string | null;
}): BarisArea => ({
  code: r.code,
  name: r.name,
  isActive: r.isActive,
  sortOrder: r.sortOrder,
  doiCritical: r.doiCritical ?? null,
  doiMin: r.doiMin,
  doiMax: r.doiMax,
  startDate: r.startDate ? toDateKeyUtc(r.startDate) : null,
  note: r.note,
});

/** Seluruh baris area, termasuk yang nonaktif (data lama tetap harus terbaca). */
export async function muatArea(): Promise<BarisArea[]> {
  const rows = await prisma.area.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  return rows.map(bersih);
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
