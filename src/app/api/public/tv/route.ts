import { NextResponse } from 'next/server';
import { latestSnapshot } from '@/lib/query';
import { getSettingsMap } from '@/lib/compute';

export const dynamic = 'force-dynamic';

/**
 * Data untuk dashboard TV — TANPA login. Bila PUBLIC_TV_TOKEN diset di
 * environment, halaman harus dibuka dengan ?key=<token>.
 * Yang dikirim hanya yang ditampilkan: ringkasan + baris untuk slide.
 */
export async function GET(req: Request) {
  const token = process.env.PUBLIC_TV_TOKEN;
  if (token && new URL(req.url).searchParams.get('key') !== token) {
    return NextResponse.json({ ok: false, error: 'Kunci dashboard salah' }, { status: 401 });
  }
  const [snap, settings] = await Promise.all([latestSnapshot(), getSettingsMap()]);
  const rows = snap.rows.map((r) => ({
    sku: r.sku, name: r.name, abc: r.abcClass, stock: r.availableQty, transit: r.transitQty,
    ads1: r.ads1, ads2: r.ads2, doi1: r.doi1, doi2: r.doi2, refDoi: r.refDoi, refDoiT: r.refDoiTransit,
    lt: r.leadTimeDays, sug: Math.max(r.suggested1, r.suggested2), status: r.status, action: r.action,
    isNpl: r.isNpl, age: r.ageDays, first: r.firstSalesDate, sales90: r.sales90,
  }));
  return NextResponse.json({
    ok: true,
    snapshotDate: snap.snapshotDate,
    computedAt: snap.computedAt,
    summary: snap.summary,
    settings: snap.settings,
    tv: {
      slideSeconds: Number(settings.tv_slide_seconds) || 15,
      rowsPerSlide: Number(settings.tv_rows_per_slide) || 12,
      refreshMinutes: Number(settings.tv_refresh_minutes) || 5,
    },
    rows,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
