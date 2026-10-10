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
    areaId: snap.areaId,
    areas: snap.areas,
    computedAt: snap.computedAt,
    settings: {
      doiDisplay: snap.settings?.doiDisplay ?? 'BOTH',
      // Target simulasi = batas AMAN area yang sedang dilihat (umumnya baris
      // GABUNGAN, karena halaman ini mensimulasikan DOI total). Dulu angka
      // global 14 — yang tidak benar untuk cabang mana pun.
      targetDoiDays: snap.ambang?.max ?? 14,
      areaScope: snap.settings?.areaScope ?? '',
    },
    params,
    saranLantai: saran,
    hasil,
  }));
}
