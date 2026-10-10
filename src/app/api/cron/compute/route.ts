import { getSettings, runCompute } from '@/lib/compute';
import { checkCronAuth, fail, json } from '@/lib/http';
import { AMBANG_ATP_BAWAAN } from '@/lib/atp';

export const dynamic = 'force-dynamic';
// Vercel Hobby membatasi satu fungsi 60 dtk. Menulis 300 tidak menaikkannya —
// prosesnya tetap dibunuh di detik ke-60, dan kuncinya ikut tertinggal.
export const maxDuration = 60;

/** Jadwal 07.30 WIB (00:30 UTC): tarik stok → hitung DOI → simpan snapshot hari ini. */
async function run(req: Request) {
  const denied = checkCronAuth(req);
  if (denied) return fail(denied, 401);
  const settings = await getSettings();
  if (!settings.autoCompute) return json({ ok: true, skipped: true, message: 'Perhitungan otomatis dimatikan di Pengaturan' });
  try {
    const hasil = await runCompute('cron', true);

    /*
      Potret ATP harian DIREKAM DI SINI, SESUDAH perhitungan DOI selesai.

      Kenapa menumpang di cron ini, bukan cron sendiri: paket Vercel Hobby
      membatasi jumlah cron, dan `vercel.json` sudah punya dua. Menambah yang
      ketiga bisa membuat DEPLOY-nya gagal — dan itu memadamkan seluruh
      aplikasi, bukan cuma ATP.

      Keberatan asli terhadap penumpangan ini (lihat /api/cron/atp) adalah
      "hari di mana ATP lambat akan MEMBUNUH perhitungan DOI". Keberatan itu
      dijawab oleh URUTAN dan try/catch di bawah: saat baris ini berjalan,
      snapshot DOI SUDAH tertulis. Kegagalan ATP tidak bisa lagi merugikan DOI;
      yang hilang hanya satu titik di grafik tren ATP.

      Tanpa ini, `atp_daily` hanya terisi kalau ada orang menekan tombolnya —
      dan grafik "TREN ATP — 30 HARI" di poster tidak akan pernah terisi.
    */
    let atp: string;
    try {
      const { muatAtp, rekamAtpHarian } = await import('@/lib/atp-store');
      const { hasil: perArea, siap } = await muatAtp();
      atp = siap ? `${await rekamAtpHarian(perArea, AMBANG_ATP_BAWAAN)} area direkam` : 'tabel atp_share belum ada';
    } catch (e) {
      atp = `GAGAL: ${e instanceof Error ? e.message : 'tidak diketahui'}`;
    }

    return json({ ...hasil, atp });
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Perhitungan gagal', 502);
  }
}

export const GET = run;
export const POST = run;
