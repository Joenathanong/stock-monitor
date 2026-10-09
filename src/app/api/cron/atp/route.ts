import { checkCronAuth, fail, json } from '@/lib/http';
import { muatAtp, rekamAtpHarian } from '@/lib/atp-store';
import { syncBundle } from '@/lib/sync';
import { getSettings } from '@/lib/compute';
import { AMBANG_ATP_BAWAAN } from '@/lib/atp';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Rekam potret ATP hari ini ke `atp_daily`.
 *
 * TIDAK ditempelkan ke `/api/cron/compute`. Alasannya batas waktu: satu fungsi
 * Vercel Hobby dibunuh di detik ke-60, dan `runCompute` sudah memakai hampir
 * seluruhnya. Menambah pekerjaan ATP di sana berarti hari di mana ATP lambat
 * akan MEMBUNUH perhitungan DOI — program yang sudah jalan rusak oleh fitur
 * baru. Dipisah, kegagalan ATP hanya merugikan ATP.
 *
 * BELUM dimasukkan ke `vercel.json`. Paket Hobby membatasi jumlah cron, dan
 * `vercel.json` sudah punya dua; menambah yang ketiga bisa membuat DEPLOY-nya
 * gagal — dan itu memadamkan seluruh aplikasi, bukan cuma ATP. Jadi barisnya
 * ditawarkan ke user, tidak dipasang sendiri:
 *
 *   { "path": "/api/cron/atp", "schedule": "45 0 * * *" }   // 07.45 WIB
 *
 * Sementara itu endpoint ini tetap berfungsi dipanggil tangan atau oleh bot WA
 * (butuh CRON_SECRET), dan tombol di halaman ATP memakai PATCH /api/atp.
 */
async function run(req: Request) {
  const denied = checkCronAuth(req);
  if (denied) return fail(denied, 401);

  const u = new URL(req.url);
  const raw = Number(u.searchParams.get('ambang'));
  const ambang = Number.isFinite(raw) ? Math.min(10_000, Math.max(0, Math.trunc(raw))) : AMBANG_ATP_BAWAAN;

  try {
    // Komposisi bundling ditarik DULU, dan kegagalannya TIDAK membatalkan
    // perekaman: `bundle_item` cuma mengisi kolom Turunan di layar, sementara
    // `atp_daily` adalah riwayat yang tidak bisa dibuat ulang besok. Urutan
    // sebaliknya akan membuat OCS yang sedang mati menghapus satu hari riwayat.
    let bundle = 'dilewati';
    try {
      const s = await getSettings();
      const b = await syncBundle(20_000, s.bundleRefreshHours);
      bundle = b.skipped ? 'masih segar' : b.ok ? (b.message ?? 'ok') : `GAGAL: ${b.message ?? ''}`;
    } catch (e) {
      bundle = `GAGAL: ${e instanceof Error ? e.message : 'tidak diketahui'}`;
    }

    const { hasil, siap, keseluruhan } = await muatAtp(ambang);
    if (!siap) return fail('Tabel atp_share belum ada — jalankan `npm run db:push`', 503);
    const direkam = await rekamAtpHarian(hasil, ambang);
    return json({
      ok: true, direkam, ambang, bundle,
      persen: keseluruhan.persen,
      pesan: `${direkam} area direkam ke atp_daily (ambang ${ambang}). Komposisi bundling: ${bundle}.`,
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Rekam ATP gagal', 502);
  }
}

export const GET = run;
export const POST = run;
