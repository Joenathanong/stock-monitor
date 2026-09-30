import { prisma } from '@/lib/prisma';
import { json, safe } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Riwayat proses: setiap penarikan & perhitungan, lengkap dengan rincian langkahnya.
 *
 * Notifikasi di layar sekarang hilang sendiri setelah 10 detik dan hanya memuat
 * satu baris. Rincian yang dulu dipaksa masuk ke situ — "stok 13400 baris 5.2s ·
 * transit 3 baris SEBAGIAN (18 dokumen belum terbaca) 15.5s · …" — tinggal di
 * sini, dan tetap ada setelah halaman ditutup atau dibuka dari perangkat lain.
 *
 * Sumbernya `sync_log`, yang memang sudah ditulis tiap proses sejak awal; yang
 * belum ada cuma layarnya.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(500, Math.max(10, Number(url.searchParams.get('limit') ?? 200)));
  const kind = url.searchParams.get('kind');
  const status = url.searchParams.get('status');

  const rows = await prisma.syncLog.findMany({
    where: {
      ...(kind && kind !== 'SEMUA' ? { kind } : {}),
      ...(status && status !== 'SEMUA' ? { status } : {}),
    },
    orderBy: { startedAt: 'desc' },
    take: limit,
  });

  return json(safe({
    ok: true,
    rows: rows.map((r) => ({
      id: String(r.id),
      kind: r.kind,
      trigger: r.trigger,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      // Lama proses dihitung di server: klien tidak perlu tahu bentuk tanggalnya.
      durationMs: r.finishedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null,
      rows: r.rows,
      message: r.message,
      // Tanda cepat supaya baris bermasalah bisa disaring tanpa membaca pesannya.
      bermasalah: r.status === 'error' || /GAGAL|SEBAGIAN/.test(r.message ?? ''),
    })),
  }));
}
