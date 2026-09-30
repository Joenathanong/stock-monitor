import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { latestSnapshot, summaryHistory } from '@/lib/query';
import { getSettingsMap } from '@/lib/compute';
import { AREA_GABUNGAN } from '@/lib/areas';
import { toDateKeyUtc } from '@/lib/dates';

export const dynamic = 'force-dynamic';

/**
 * Data untuk poster WhatsApp (/wa) — TANPA login, dijaga token.
 *
 * Bot WhatsApp berjalan di server lain, jadi ia tidak punya sesi. Token di
 * `WA_PAGE_TOKEN` yang menjaga: tanpa `?k=<token>` permintaan ditolak 401.
 * Kalau token TIDAK diset, endpoint ini ditolak sepenuhnya — bukan dibiarkan
 * terbuka. Angka stok dan nilai rupiah seluruh area tidak boleh jadi publik
 * hanya karena seseorang lupa mengisi environment variable.
 */
const TREN_HARI = 30;

export async function GET(req: Request) {
  const token = process.env.WA_PAGE_TOKEN;
  const k = new URL(req.url).searchParams.get('k');
  if (!token) {
    return NextResponse.json(
      { ok: false, error: 'WA_PAGE_TOKEN belum diset di environment. Poster WhatsApp dimatikan sampai token diisi.' },
      { status: 503 },
    );
  }
  if (k !== token) return NextResponse.json({ ok: false, error: 'Kunci salah' }, { status: 401 });

  const raw = await getSettingsMap();
  const blok = {
    angka: raw.wa_blok_angka !== '0',
    status: raw.wa_blok_status !== '0',
    tren: raw.wa_blok_tren !== '0',
    po: raw.wa_blok_po !== '0',
  };
  const kritisMaks = Math.max(0, Math.min(6, Number(raw.wa_kritis_maks ?? 3)));
  const judul = raw.wa_judul || 'Ringkasan DOI Harian — IEG';

  // Kota saja; GABUNGAN dihitung terpisah dan ditampilkan sebagai ringkasan atas,
  // bukan sebagai kartu ke-6 yang bisa disalahbaca sebagai cabang.
  const kota = (
    await prisma.$queryRawUnsafe<{ areaId: string }[]>(
      "SELECT DISTINCT areaId FROM doi_snapshot WHERE areaId <> ? ORDER BY areaId",
      AREA_GABUNGAN,
    )
  ).map((r) => r.areaId);

  const perArea = await Promise.all(
    kota.map(async (area) => {
      const snap = await latestSnapshot(area);
      const s = snap.summary;
      const tren = blok.tren ? (await summaryHistory(TREN_HARI, area)).reverse() : [];
      // Baris kritis: yang statusnya CRITICAL dulu, lalu LOW, masing-masing
      // diurut dari DOI terkecil — itu urutan yang benar-benar mendesak.
      const kritis = blok.po
        ? snap.rows
            .filter((r) => r.status === 'CRITICAL' || r.status === 'LOW')
            .sort((a, b) =>
              (a.status === 'CRITICAL' ? 0 : 1) - (b.status === 'CRITICAL' ? 0 : 1)
              || (a.refDoi ?? Infinity) - (b.refDoi ?? Infinity))
            .slice(0, kritisMaks)
            .map((r) => ({ sku: r.sku, name: r.name, doi: r.refDoi, status: r.status, sug: Math.max(r.suggested1, r.suggested2) }))
        : [];
      return {
        area,
        snapshotDate: snap.snapshotDate,
        sku: s?.totalSku ?? 0,
        doi1: s?.total.doi1 ?? null,
        doi2: s?.total.doi2 ?? null,
        stock: s?.total.stock ?? 0,
        transit: s?.total.transit ?? 0,
        value: s?.total.value ?? 0,
        noPrice: s?.total.noPrice ?? 0,
        byStatus: s?.byStatus ?? null,
        perluPo: blok.po ? snap.rows.filter((r) => Math.max(r.suggested1, r.suggested2) > 0).length : 0,
        tren: tren.map((t) => ({ date: t.date, doi1: t.doi1, doi2: t.doi2 })),
        kritis,
      };
    }),
  );

  const gab = await latestSnapshot(AREA_GABUNGAN);

  return NextResponse.json({
    ok: true,
    judul,
    blok,
    dibuatPada: new Date().toISOString(),
    snapshotDate: gab.snapshotDate ?? perArea[0]?.snapshotDate ?? null,
    computedAt: gab.computedAt,
    total: gab.summary
      ? {
          sku: gab.summary.totalSku,
          doi1: gab.summary.total.doi1,
          doi2: gab.summary.total.doi2,
          stock: gab.summary.total.stock,
          transit: gab.summary.total.transit,
          value: gab.summary.total.value,
          kritis: gab.summary.byStatus.CRITICAL,
          low: gab.summary.byStatus.LOW,
        }
      : null,
    areas: perArea,
    // Tanggal tren dipakai sebagai label sumbu; dikirim sekali, bukan per area.
    trenLabel: perArea[0]?.tren.map((t) => t.date) ?? [],
    hariIni: toDateKeyUtc(new Date()),
  });
}
