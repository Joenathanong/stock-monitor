import { prisma } from '@/lib/prisma';
import { fail, json, safe } from '@/lib/http';
import { sessionFromRequest, canWrite } from '@/lib/auth';
import { muatAtp, simpanSebaran, simpanBrandManual, rekamAtpHarian, type SatuPutusan } from '@/lib/atp-store';
import { AMBANG_ATP_BAWAAN, type SaringAktif } from '@/lib/atp';

export const dynamic = 'force-dynamic';
// Vercel Hobby membunuh satu fungsi di detik ke-60. Menulis angka lebih besar
// TIDAK menaikkannya — prosesnya tetap dibunuh, dan menuliskan 120 hanya membuat
// kita mengira punya waktu yang tidak kita punya.
export const maxDuration = 60;

/**
 * Saringan tampilan aktif/non-aktif dari URL. Bawaan `AKTIF`.
 *
 * Nilai asing SENGAJA jatuh ke `AKTIF`, bukan ke `SEMUA`: salah ketik di URL
 * tidak boleh diam-diam melebarkan daftar dengan barang yang sudah dinonaktifkan.
 */
function saringDariUrl(u: URL): SaringAktif {
  const v = String(u.searchParams.get('saring') ?? '').toUpperCase();
  return v === 'NONAKTIF' || v === 'SEMUA' ? v : 'AKTIF';
}

/** Ambang dari URL, dibatasi masuk akal. Bawaan 5 (keputusan user 7 Okt 2026). */
function ambangDariUrl(u: URL): number {
  const v = Number(u.searchParams.get('ambang'));
  if (!Number.isFinite(v)) return AMBANG_ATP_BAWAAN;
  return Math.min(10_000, Math.max(0, Math.trunc(v)));
}

/**
 * Seluruh bahan halaman ATP: checklist sebaran + persen per area.
 *
 * Satu endpoint, bukan dua, supaya centang dan persennya berasal dari potret
 * yang sama — lihat alasannya di `muatAtp()`.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const ambang = ambangDariUrl(u);
  const hasil = await muatAtp(ambang, saringDariUrl(u));

  return json(safe({
    ok: true,
    ...hasil,
    pesan: !hasil.siap
      ? 'Tabel atp_share belum ada — jalankan `npm run db:push` dulu.'
      : hasil.keseluruhan.dihitung === 0
        ? 'Belum ada SKU yang diputuskan sebarannya, jadi pembaginya 0 dan persennya belum bisa dihitung. '
          + 'Centang dulu SKU yang memang disebar ke tiap cabang.'
        : '',
  }));
}

/**
 * Simpan keputusan sebaran — satu baris atau borongan, bentuknya sama.
 *
 * `dibagikan: null` menghapus keputusannya (kembali ke "belum diputuskan").
 * Itu BUKAN sama dengan `false`; lihat alasannya di `simpanSebaran()`.
 */
export async function POST(req: Request) {
  const sesi = await sessionFromRequest(req);
  if (!canWrite(sesi?.r)) return fail('Tidak berwenang mengubah sebaran', 403);

  const b = (await req.json().catch(() => null)) as { putusan?: unknown[] } | null;
  const masuk = Array.isArray(b?.putusan) ? b!.putusan : null;
  if (!masuk || !masuk.length) return fail('Kirim `putusan`: daftar { sku, areaId, dibagikan }');
  // Batas per PERMINTAAN, bukan batas pekerjaan.
  //
  // Angka lamanya 5.000 dengan alasan "375 SKU x 6 cabang = 2.250, dipasang di
  // atas kebutuhan nyata". Alasan itu kedaluwarsa 8 Okt 2026 ketika Bundle &
  // Gimmick ikut dihitung: sekarang 1.664 SKU aktif x 5 cabang = 8.320, dan
  // dengan non-aktif 2.729 x 5 = 13.645. Jadi "Semua disebar" di "Semua cabang"
  // DITOLAK — sesudah user menekan konfirmasi dan menunggu, dengan seluruh
  // pekerjaannya masih menggantung. Dilaporkan user 9 Okt 2026.
  //
  // Yang benar bukan menaikkan angkanya sampai muat apa pun: satu permintaan
  // tetap punya batas 60 detik. Halamannya sekarang MEMECAH sendiri jadi
  // potongan 2.000 dan mengirim berurutan, jadi batas ini kembali ke peran
  // aslinya — penjaga ukuran satu permintaan, bukan penghalang pekerjaan.
  const MAKS = 5000;
  if (masuk.length > MAKS) {
    return fail(
      `Satu permintaan maksimal ${MAKS.toLocaleString('id-ID')} keputusan (dikirim ${masuk.length.toLocaleString('id-ID')}). `
      + 'Halaman ATP memecahnya otomatis — kalau pesan ini muncul di layar, '
      + 'muat ulang halamannya supaya memakai versi terbaru.',
    );
  }

  const putusan: SatuPutusan[] = masuk.map((x) => {
    const r = (x ?? {}) as Record<string, unknown>;
    return {
      sku: String(r.sku ?? ''),
      areaId: String(r.areaId ?? ''),
      dibagikan: r.dibagikan === null ? null : r.dibagikan === true,
      note: r.note === undefined ? undefined : (r.note === null ? null : String(r.note)),
    };
  });

  const oleh = sesi?.n || sesi?.u || '';
  const h = await simpanSebaran(putusan, oleh);
  await prisma.auditLog.create({
    data: {
      action: 'ATP_SHARE_SAVE',
      entity: 'atp_share',
      detail: `${h.tersimpan} disimpan, ${h.dihapus} dikosongkan, ${h.gagal.length} gagal (oleh ${oleh || '?'})`,
    },
  });

  const u = new URL(req.url);
  // `ringkas=1` melewati pembacaan ulang seluruh matriks ATP.
  //
  // Jawaban lengkapnya ratusan KB dan ±460 ms — wajar untuk satu kali simpan,
  // tapi saat halaman mengirim 5 potongan berurutan itu berarti 5 kali
  // pekerjaan yang 4 di antaranya langsung dibuang. Potongan terakhir tetap
  // meminta yang lengkap, jadi layar tetap menyegarkan dirinya sekali.
  if (u.searchParams.get('ringkas') === '1') {
    return json(safe({
      ok: true,
      ...h,
      pesan: h.gagal.length
        ? `${h.tersimpan} keputusan disimpan, ${h.gagal.length} gagal.`
        : `${h.tersimpan} keputusan disimpan${h.dihapus ? `, ${h.dihapus} dikosongkan` : ''}.`,
    }));
  }
  return json(safe({
    ok: true,
    ...h,
    ...(await muatAtp(ambangDariUrl(u), saringDariUrl(u))),
    pesan: h.gagal.length
      ? `${h.tersimpan} keputusan disimpan, ${h.gagal.length} gagal.`
      : `${h.tersimpan} keputusan disimpan${h.dihapus ? `, ${h.dihapus} dikosongkan` : ''}.`,
  }));
}

/** Isi brand manual untuk SKU yang tidak punya brand di OCS. */
export async function PUT(req: Request) {
  const sesi = await sessionFromRequest(req);
  if (!canWrite(sesi?.r)) return fail('Tidak berwenang mengubah brand', 403);

  const b = (await req.json().catch(() => null)) as { sku?: string; brand?: string } | null;
  const sku = String(b?.sku ?? '').trim();
  if (!sku) return fail('sku wajib');
  // Brand kosong SENGAJA diperbolehkan: itu cara membatalkan isian manual yang
  // salah. Yang tidak boleh adalah menghapus barisnya, karena `manual: true`
  // -lah yang melindunginya dari `sync:brand`.
  if (!(await simpanBrandManual(sku, String(b?.brand ?? '')))) return fail('Gagal menyimpan brand');

  await prisma.auditLog.create({
    data: {
      action: 'ATP_BRAND_MANUAL',
      entity: 'sku_brand',
      detail: `${sku} → "${String(b?.brand ?? '').trim()}" (oleh ${sesi?.n || sesi?.u || '?'})`,
    },
  });
  const u2 = new URL(req.url);
  return json(safe({ ok: true, ...(await muatAtp(ambangDariUrl(u2), saringDariUrl(u2))) }));
}

/**
 * Rekam potret ATP hari ini ke `atp_daily`.
 *
 * Dipisah dari GET: GET dipanggil tiap kali halaman dibuka, dan menulis potret
 * di sana berarti angka hari ini ditimpa setiap kali ada orang melihat — termasuk
 * setelah ia mencentang separuh. Potretnya harus dipicu sengaja (cron harian).
 */
export async function PATCH(req: Request) {
  const sesi = await sessionFromRequest(req);
  if (!canWrite(sesi?.r)) return fail('Tidak berwenang', 403);

  const ambang = ambangDariUrl(new URL(req.url));
  const { hasil, siap } = await muatAtp(ambang, 'AKTIF');
  if (!siap) return fail('Tabel atp_share belum ada — jalankan `npm run db:push`');

  const n = await rekamAtpHarian(hasil, ambang);
  return json(safe({ ok: true, direkam: n, ambang, pesan: `${n} area direkam ke atp_daily.` }));
}
