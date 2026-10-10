import { prisma } from '@/lib/prisma';
import { fail, json, safe } from '@/lib/http';
import { muatArea, isiAreaBawaan } from '@/lib/area-store';
import { areaBelumTerdaftar, validasiArea, normalKode, type BarisArea } from '@/lib/area-master';

export const dynamic = 'force-dynamic';

/**
 * Daftar cabang / gudang. Inilah sumber satu-satunya daftar area — kode tidak
 * lagi menyimpan daftarnya sendiri, jadi menambah cabang tidak perlu deploy.
 *
 * Nama area yang dipakai `stock_current` tapi belum terdaftar ikut dikembalikan
 * (`belumTerdaftar`) supaya halaman Pengaturan bisa menawarkan mendaftarkannya;
 * tanpa itu, area yang datang dari OCS hanya terlihat sebagai angka yang tidak
 * pernah muncul di mana pun.
 */
export async function GET() {
  const [areas, dariStok] = await Promise.all([
    muatArea(),
    prisma.$queryRawUnsafe<{ areaId: string }[]>(
      "SELECT DISTINCT areaId FROM stock_current WHERE areaId <> '' ORDER BY areaId",
    ),
  ]);
  return json(safe({
    ok: true,
    areas,
    belumTerdaftar: areaBelumTerdaftar(dariStok.map((r) => r.areaId), areas),
    // `bawaan` DIHAPUS 10 Okt 2026. Dulu ia mengirim tiga angka global sebagai
    // cadangan untuk kolom yang dikosongkan — dan justru itu yang membuat ada
    // dua tempat mengatur ambang. Sekarang kolomnya wajib, dan laporan
    // GABUNGAN punya barisnya sendiri di tabel yang sama.
  }));
}

const angka = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
};

/** Tambah atau ubah satu area. Kode gudang adalah kuncinya. */
export async function PUT(req: Request) {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return fail('Body harus JSON');

  const calon: Partial<BarisArea> = {
    code: normalKode(typeof b.code === 'string' ? b.code : ''),
    doiCritical: angka(b.doiCritical),
    name: String(b.name ?? '').trim(),
    isActive: b.isActive === undefined ? true : Boolean(b.isActive),
    sortOrder: angka(b.sortOrder) ?? 100,
    doiMin: angka(b.doiMin),
    doiMax: angka(b.doiMax),
    leadTimeDays: angka(b.leadTimeDays),
    atpTarget: angka(b.atpTarget),
    startDate: b.startDate ? String(b.startDate).slice(0, 10) : null,
    note: b.note ? String(b.note).slice(0, 300) : null,
  };

  const galat = validasiArea(calon);
  if (galat.length) return json({ ok: false, error: galat[0].pesan, galat }, 400);

  // Nama area dipakai sebagai kunci di stock_current, sales_daily, transit_stock
  // dan doi_summary. Dua kode dengan nama sama akan menggabungkan dua gudang
  // jadi satu angka tanpa ada yang kelihatan keliru.
  const bentrok = await prisma.area.findFirst({
    where: { name: calon.name as string, NOT: { code: calon.code as string } },
    select: { code: true },
  });
  if (bentrok) return fail(`Nama area "${calon.name}" sudah dipakai kode ${bentrok.code}`);

  const data = {
    name: calon.name as string,
    isActive: calon.isActive as boolean,
    sortOrder: calon.sortOrder as number,
    doiCritical: calon.doiCritical,
    doiMin: calon.doiMin,
    doiMax: calon.doiMax,
    startDate: calon.startDate ? new Date(`${calon.startDate}T00:00:00.000Z`) : null,
    note: calon.note,
  };
  const sebelum = await prisma.area.findUnique({ where: { code: calon.code as string } });
  await prisma.area.upsert({
    where: { code: calon.code as string },
    create: { code: calon.code as string, ...data },
    update: data,
  });
  await prisma.auditLog.create({
    data: {
      action: sebelum ? 'AREA_UPDATE' : 'AREA_CREATE',
      entity: 'area',
      detail: JSON.stringify({ code: calon.code, ...data }),
    },
  });
  return json(safe({ ok: true, areas: await muatArea() }));
}

/**
 * Nonaktifkan atau hapus area.
 *
 * Bawaannya NONAKTIF, bukan hapus: data lama (stok, penjualan, SIT, ringkasan
 * DOI) memakai NAMA area sebagai kunci, dan menghapus barisnya membuat seluruh
 * riwayat itu jadi "area asing". Hapus betulan hanya kalau diminta tegas lewat
 * `?hard=1`, dan hanya kalau belum ada data yang memakai namanya.
 */
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const code = normalKode(url.searchParams.get('code'));
  const hard = url.searchParams.get('hard') === '1';
  if (!code) return fail('Kode area wajib diisi');

  const area = await prisma.area.findUnique({ where: { code } });
  if (!area) return fail('Area tidak ditemukan', 404);

  if (!hard) {
    await prisma.area.update({ where: { code }, data: { isActive: false } });
    await prisma.auditLog.create({ data: { action: 'AREA_DISABLE', entity: 'area', detail: code } });
    return json(safe({ ok: true, mode: 'nonaktif', areas: await muatArea() }));
  }

  const [stok, jual] = await Promise.all([
    prisma.$queryRawUnsafe<{ n: number }[]>('SELECT COUNT(*) AS n FROM stock_current WHERE areaId = ?', area.name),
    prisma.$queryRawUnsafe<{ n: number }[]>('SELECT COUNT(*) AS n FROM sales_daily WHERE areaId = ?', area.name),
  ]);
  const dipakai = Number(stok[0]?.n ?? 0) + Number(jual[0]?.n ?? 0);
  if (dipakai > 0) {
    return fail(
      `"${area.name}" masih dipakai ${dipakai.toLocaleString('id-ID')} baris data (stok/penjualan). `
      + 'Nonaktifkan saja — menghapusnya membuat seluruh riwayat itu jadi area asing.',
    );
  }
  await prisma.area.delete({ where: { code } });
  await prisma.auditLog.create({ data: { action: 'AREA_DELETE', entity: 'area', detail: code } });
  return json(safe({ ok: true, mode: 'hapus', areas: await muatArea() }));
}

/** Isi tabel dari data yang sudah ada — tombol sekali pakai di Pengaturan. */
export async function POST() {
  const hasil = await isiAreaBawaan();
  return json(safe({ ok: true, ...hasil, areas: await muatArea() }));
}
