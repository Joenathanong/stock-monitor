/**
 * Penyiapan data untuk Simulasi Target DOI — dipakai bersama oleh endpoint JSON
 * dan endpoint export XLSX supaya keduanya PASTI memakai parameter & angka yang
 * sama. Kalau dipisah, export gampang diam-diam berbeda dari yang di layar.
 */
import { latestSnapshot } from './query';
import { ABC, simulate, solveFloor, type AbcClass, type SimOptions, type SimRow } from './simulate';

export type SimParams = SimOptions & { opsi: 1 | 2 };

const num = (v: string | null, fallback: number, lo: number, hi: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

export function parseParams(url: URL, doiDisplay: string | undefined): SimParams {
  const opsi: 1 | 2 = (url.searchParams.get('opsi') ?? (doiDisplay === 'OPSI2' ? '2' : '1')) === '2' ? 2 : 1;
  const targetDoi = num(url.searchParams.get('target'), 7, 0, 3650);

  const rawClasses = (url.searchParams.get('classes') ?? 'B,C').split(',').map((c) => c.trim().toUpperCase());
  const classes = ABC.filter((c) => rawClasses.includes(c));

  const floorDays = Object.fromEntries(
    ABC.map((c) => [c, num(url.searchParams.get(`floor${c}`), targetDoi, 0, 3650)]),
  ) as Record<AbcClass, number>;

  const orderRaw = (url.searchParams.get('order') ?? 'QTY').toUpperCase();
  const order: SimOptions['order'] = orderRaw === 'DOI' ? 'DOI' : orderRaw === 'PROPORSIONAL' ? 'PROPORSIONAL' : 'QTY';

  return {
    opsi, targetDoi,
    classes: classes.length ? classes : ['B', 'C'],
    floorDays,
    excludePhaseOut: url.searchParams.get('phaseOut') !== '1',
    order,
  };
}

export async function runSimulation(url: URL) {
  const snap = await latestSnapshot();
  if (!snap.rows.length) return { snap, params: null, hasil: null, saran: null } as const;

  const params = parseParams(url, snap.settings?.doiDisplay);
  const rows: SimRow[] = snap.rows.map((r) => ({
    sku: r.sku, name: r.name, sapCode: r.sapCode, abcClass: r.abcClass, status: r.status,
    availableQty: r.availableQty, transitQty: r.transitQty,
    ads: params.opsi === 2 ? r.ads2 : r.ads1,
    doi: params.opsi === 2 ? r.doi2 : r.doi1,
    isPhaseOut: r.isPhaseOut,
    runOutDate: r.runOutDate,
    unitPrice: r.unitPrice,
  }));

  const hasil = simulate(rows, params);
  // Lantai seragam tertinggi yang masih memenuhi target — dipakai sebagai saran,
  // supaya pemakai tidak menebak-nebak angka lantai sendiri.
  const saran = solveFloor(rows, {
    targetDoi: params.targetDoi, classes: params.classes, excludePhaseOut: params.excludePhaseOut,
  });
  return { snap, params, hasil, saran } as const;
}
