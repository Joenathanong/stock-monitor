/**
 * Tanggal yang dikecualikan dari ADS Opsi 1: campaign double date (1.1 … 12.12)
 * dan hari gajian (tanggal 25). Keduanya tanggal tunggal, sesuai keputusan user —
 * bukan jendela H-1..H+1.
 *
 * Aturan dihasilkan otomatis dari Pengaturan supaya tidak perlu diisi ulang tiap
 * tahun; tanggal tambahan (mis. flash sale khusus) disimpan di tabel exclusion_date.
 */
import { addDays, type DateKey } from './dates';

export type ExclusionRule = { paydayDay: number; excludeDoubleDates: boolean };

export type ExclusionReason = 'PAYDAY' | 'DOUBLE_DATE' | 'MANUAL';

/** Alasan sebuah tanggal dikecualikan menurut aturan, atau null bila hari biasa. */
export function ruleReason(key: DateKey, rule: ExclusionRule): ExclusionReason | null {
  const month = Number(key.slice(5, 7));
  const day = Number(key.slice(8, 10));
  if (rule.excludeDoubleDates && month === day) return 'DOUBLE_DATE';
  if (rule.paydayDay > 0 && day === rule.paydayDay) return 'PAYDAY';
  return null;
}

/**
 * Peta tanggal → alasan untuk rentang `from`..`to` (inklusif), digabung dengan
 * tanggal manual. Tanggal manual menang atas aturan supaya alasannya terlihat.
 */
export function buildExclusionMap(
  from: DateKey,
  to: DateKey,
  rule: ExclusionRule,
  manual: { date: DateKey; reason?: string }[] = [],
): Map<DateKey, string> {
  const map = new Map<DateKey, string>();
  for (let k = from; k <= to; k = addDays(k, 1)) {
    const r = ruleReason(k, rule);
    if (r) map.set(k, r === 'PAYDAY' ? `Gajian (tgl ${rule.paydayDay})` : `Double date ${Number(k.slice(5, 7))}.${Number(k.slice(8, 10))}`);
  }
  for (const m of manual) {
    if (m.date >= from && m.date <= to) map.set(m.date, m.reason?.trim() || 'Manual');
  }
  return map;
}
