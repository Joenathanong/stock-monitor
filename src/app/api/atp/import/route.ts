import { prisma } from '@/lib/prisma';
import { fail, json, safe } from '@/lib/http';
import { sessionFromRequest, canWrite } from '@/lib/auth';
import { readSheetRinci } from '@/lib/xlsx';
import { susunImpor } from '@/lib/atp-impor';
import { muatStokAtp, muatSebaran, simpanSebaran } from '@/lib/atp-store';
import { kelayakan } from '@/lib/atp';

export const dynamic = 'force-dynamic';
// Vercel Hobby membunuh satu fungsi di detik ke-60. Menulis angka lebih besar
// TIDAK menaikkannya — prosesnya tetap dibunuh, dan menuliskan 120 hanya membuat
// kita mengira punya waktu yang tidak kita punya.
export const maxDuration = 60;

/**
 * Unggah lembar "Sebaran" hasil unduhan, setelah diedit di Excel.
 *
 * DUA LANGKAH, dan langkah pertama tidak bisa dilewati tanpa sengaja:
 *
 *   POST /api/atp/import              → PRATINJAU. Tidak menulis apa pun.
 *   POST /api/atp/import?terap=1      → menulis.
 *
 * Kenapa dipaksa begitu: di lembar unduhan, sel kosong berarti "belum
 * diputuskan". Supaya bolak-baliknya setia, sel kosong saat diunggah berarti
 * "kosongkan keputusannya" — dan itu artinya satu berkas yang keliru bisa
 * MENGHAPUS ribuan keputusan sekaligus. Angka "akan dikosongkan" harus dibaca
 * orang sebelum ada yang ditulis.
 *
 * `abaikanKosong=1` untuk berkas yang memang sengaja diisi sebagian.
 */
export async function POST(req: Request) {
  const sesi = await sessionFromRequest(req);
  if (!canWrite(sesi?.r)) return fail('Tidak berwenang mengubah sebaran', 403);

  const u = new URL(req.url);
  const terap = u.searchParams.get('terap') === '1';
  const abaikanKosong = u.searchParams.get('abaikanKosong') === '1';

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return fail('Kirim berkas XLSX di medan `file`');
  if (file.size > 12 * 1024 * 1024) return fail('Berkas terlalu besar (maks 12 MB)');

  let rows; let barisHeader = 1;
  try {
    // `cariKolom` WAJIB di sini: lembar yang kita ekspor sendiri menaruh baris
    // catatan di atas header, jadi tanpa ini berkas hasil unduh tidak bisa
    // diunggah kembali — baris catatan terbaca sebagai nama kolom dan seluruh
    // isinya jadi omong kosong tanpa satu pun galat.
    const r = await readSheetRinci(await file.arrayBuffer(), { cariKolom: 'SKU', namaLembar: 'Sebaran' });
    rows = r.rows; barisHeader = r.barisHeader;
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Berkas tidak terbaca');
  }
  if (!rows.length) return fail('Lembar "Sebaran" kosong — tidak ada baris yang bisa dibaca');

  const [stok, { sebaran, siap }] = await Promise.all([muatStokAtp(), muatSebaran()]);
  if (!siap) return fail('Tabel atp_share belum ada — jalankan `npm run db:push`', 503);

  const areas = [...new Set(stok.map((r) => r.areaId))].filter(Boolean).sort();
  // SKU yang dikenal = yang LAYAK ATP di suatu area. SKU yang ada di stok tapi
  // di luar kategori ATP tetap dilaporkan asing: menulis keputusan untuknya
  // hanya menghasilkan baris yang tidak pernah dipakai menghitung apa pun.
  const dikenal = new Set(stok.filter((r) => kelayakan(r, 'AKTIF').layak).map((r) => r.sku));

  // `barisPertama` diteruskan supaya nomor baris di laporan masalah menunjuk
  // baris yang user lihat di Excel, bukan indeks data.
  const hasil = susunImpor(rows, areas, dikenal, sebaran, {
    abaikanKosong, barisPertama: barisHeader + 1,
  });

  if (!terap) {
    return json(safe({
      ok: true, pratinjau: true, ...hasil,
      barisDibaca: rows.length,
      // Daftar dipotong: 8.000 masalah tidak membantu siapa pun, dan respons
      // sebesar itu membuat halamannya sendiri berat.
      masalah: hasil.masalah.slice(0, 50),
      masalahTotal: hasil.masalah.length,
      putusan: undefined,
      pesan: hasil.putusan.length
        ? `${hasil.putusan.length} keputusan akan berubah. Periksa angkanya, lalu tekan Terapkan.`
        : 'Tidak ada yang berubah — isi berkas sama dengan keadaan sekarang.',
    }));
  }

  if (!hasil.putusan.length) {
    return json(safe({ ok: true, diterapkan: 0, ...hasil, putusan: undefined, pesan: 'Tidak ada yang perlu diubah.' }));
  }

  const oleh = sesi?.n || sesi?.u || '';
  const h = await simpanSebaran(hasil.putusan, oleh);
  await prisma.auditLog.create({
    data: {
      action: 'ATP_SHARE_IMPORT',
      entity: 'atp_share',
      detail: `${h.tersimpan} disimpan, ${h.dihapus} dikosongkan, ${h.gagal.length} gagal `
        + `dari berkas ${file.name} (oleh ${oleh || '?'})`,
    },
  });

  return json(safe({
    ok: true,
    diterapkan: h.tersimpan + h.dihapus,
    ...h,
    ringkas: hasil.ringkas,
    masalah: hasil.masalah.slice(0, 50),
    masalahTotal: hasil.masalah.length,
    pesan: `${h.tersimpan} keputusan disimpan, ${h.dihapus} dikosongkan`
      + `${h.gagal.length ? `, ${h.gagal.length} gagal` : ''}.`,
  }));
}
