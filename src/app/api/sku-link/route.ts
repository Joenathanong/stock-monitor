import { prisma } from '@/lib/prisma';
import { fail, json, safe } from '@/lib/http';
import {
  muatLink, simpanLink, hapusLink, simpanBanyak, bahanUsulan,
} from '@/lib/sku-link-store';
import { usulkanDari6Digit, normalKode, type BarisSkuLink } from '@/lib/sku-link';

export const dynamic = 'force-dynamic';

/**
 * Pemetaan SKU OCS ↔ kode SAP.
 *
 * Inilah sumber satu-satunya hubungan antar kode. Sebelum tabel ini ada,
 * hubungannya disimpulkan dari 6 digit terakhir kode — dan itu batal karena ada
 * produk yang berbagi SKU dengan 6 digit berbeda. Heuristiknya tetap tersedia,
 * tapi hanya sebagai USULAN yang harus ditinjau (lihat GET ?usul=1).
 */
export async function GET(req: Request) {
  const u = new URL(req.url);

  // Mode usulan: hitung tebakan 6-digit dan kembalikan untuk DITINJAU.
  // Tidak menulis apa pun — penyimpanan butuh POST eksplisit.
  if (u.searchParams.get('usul') === '1') {
    const { skuOcs, kodeSap, supplierSiap } = await bahanUsulan();
    const sudah = await muatLink();
    const terdaftar = new Set(sudah.rows.map((r) => `${r.system}\u0000${r.code}`));
    const { usul, takCocok } = usulkanDari6Digit(skuOcs, kodeSap);

    // Sisakan hanya yang BELUM terdaftar, supaya user tidak diminta meninjau
    // ulang mapping yang sudah ia setujui.
    const baru = usul
      .map((g) => ({ ...g, baris: g.baris.filter((b) => !terdaftar.has(`${b.system}\u0000${b.code}`)) }))
      .filter((g) => g.baris.some((b) => b.system === 'SAP'));

    return json(safe({
      ok: true,
      usul: baru,
      takCocok,
      supplierSiap,
      pesan: !supplierSiap
        ? 'Tabel supplier_stock belum ada atau belum terisi — jalankan `npm run sync:supplier` dulu, '
          + 'kalau tidak daftar kode SAP-nya kosong dan tidak ada yang bisa diusulkan.'
        : `${baru.length} produk diusulkan dari ${kodeSap.length} kode SAP di gudang pemasok. `
          + 'SEMUANYA tebakan dari 6 digit terakhir — periksa sebelum disimpan.',
    }));
  }

  const hasil = await muatLink();
  return json(safe({
    ok: true,
    ...hasil,
    pesan: hasil.siap ? '' : 'Tabel sku_link belum ada — jalankan `npm run db:push`.',
  }));
}

/** Tambah / ubah satu baris mapping. */
export async function PUT(req: Request) {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return fail('Body harus JSON');

  const r = await simpanLink({
    groupKey: String(b.groupKey ?? '').trim(),
    system: b.system === 'OCS' ? 'OCS' : 'SAP',
    code: normalKode(typeof b.code === 'string' ? b.code : ''),
    priority: b.priority === undefined || b.priority === null || b.priority === ''
      ? undefined
      : Number(b.priority),
    perCtn: b.perCtn === undefined || b.perCtn === null || b.perCtn === '' ? null : Number(b.perCtn),
  }, b.bolehPindah === true);

  if (!r.ok) return json({ ok: false, error: r.galat[0].pesan, galat: r.galat }, 400);
  await prisma.auditLog.create({
    data: { action: 'SKU_LINK_SAVE', entity: 'sku_link', detail: `${r.baris.system} ${r.baris.code} → ${r.baris.groupKey}` },
  });
  return json(safe({ ok: true, ...(await muatLink()) }));
}

/**
 * Simpan usulan yang sudah ditinjau user.
 *
 * Sengaja menerima baris yang DIKIRIM user, bukan menghitung ulang usulannya di
 * sini: kalau dihitung ulang, yang tersimpan bisa berbeda dari yang dilihat dan
 * disetujui user — dan untuk mapping yang menentukan ke mana barang di-PO, itu
 * tidak boleh terjadi.
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { baris?: Partial<BarisSkuLink>[]; bolehPindah?: boolean } | null;
  const baris = Array.isArray(b?.baris) ? b!.baris : null;
  if (!baris || !baris.length) return fail('Kirim `baris`: daftar mapping yang sudah ditinjau');
  if (baris.length > 2000) return fail('Terlalu banyak sekaligus (maks 2000 baris)');

  const hasil = await simpanBanyak(baris, b?.bolehPindah === true);
  await prisma.auditLog.create({
    data: {
      action: 'SKU_LINK_BULK',
      entity: 'sku_link',
      detail: `${hasil.tersimpan} tersimpan, ${hasil.gagal.length} gagal`,
    },
  });
  return json(safe({
    ok: true,
    ...hasil,
    ...(await muatLink()),
    pesan: hasil.gagal.length
      ? `${hasil.tersimpan} tersimpan, ${hasil.gagal.length} dilewati karena kodenya sudah dipakai produk lain.`
      : `${hasil.tersimpan} mapping tersimpan.`,
  }));
}

export async function DELETE(req: Request) {
  const id = Number(new URL(req.url).searchParams.get('id'));
  if (!Number.isFinite(id)) return fail('id wajib');
  if (!(await hapusLink(id))) return fail('Baris tidak ditemukan', 404);
  await prisma.auditLog.create({ data: { action: 'SKU_LINK_DELETE', entity: 'sku_link', detail: String(id) } });
  return json(safe({ ok: true, ...(await muatLink()) }));
}
