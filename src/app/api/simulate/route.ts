import { runSimulation } from '@/lib/simulate-server';
import { fail, json, safe } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const { snap, params, hasil, saran } = await runSimulation(new URL(req.url));
  if (!hasil || !params) return fail('Belum ada snapshot DOI — jalankan Refresh dulu', 409);

  return json(safe({
    ok: true,
    snapshotDate: snap.snapshotDate,
    computedAt: snap.computedAt,
    settings: {
      doiDisplay: snap.settings?.doiDisplay ?? 'BOTH',
      targetDoiDays: snap.settings?.targetDoiDays ?? 14,
      areaScope: snap.settings?.areaScope ?? '',
    },
    params,
    saranLantai: saran,
    hasil,
  }));
}
