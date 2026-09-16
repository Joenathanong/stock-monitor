/**
 * Seluruh aplikasi memakai "tanggal WIB" berbentuk string `YYYY-MM-DD`.
 *
 * Alasannya: penjualan dan stok dibaca orang gudang menurut hari kerja WIB,
 * sementara Vercel menjalankan fungsi dalam UTC. Menyimpan tanggal sebagai
 * string menghilangkan seluruh kelas bug "mundur satu hari" yang muncul kalau
 * Date dipakai langsung.
 */

export const TZ_OFFSET_MINUTES = Number(process.env.APP_TZ_OFFSET_MINUTES ?? 420); // WIB = UTC+7

export type DateKey = string; // YYYY-MM-DD

const MS_PER_DAY = 86_400_000;

/** Tanggal WIB saat ini (atau dari `now` yang diberikan) sebagai `YYYY-MM-DD`. */
export function todayKey(now: Date = new Date()): DateKey {
  return toDateKey(now);
}

/** Ubah sebuah Date (instan UTC) menjadi tanggal kalender WIB. */
export function toDateKey(d: Date): DateKey {
  const shifted = new Date(d.getTime() + TZ_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** Tengah malam UTC dari sebuah tanggal kalender — bentuk yang disimpan di kolom DATE. */
export function keyToUtcDate(key: DateKey): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

export function addDays(key: DateKey, days: number): DateKey {
  return new Date(keyToUtcDate(key).getTime() + days * MS_PER_DAY).toISOString().slice(0, 10);
}

export function diffDays(from: DateKey, to: DateKey): number {
  return Math.round((keyToUtcDate(to).getTime() - keyToUtcDate(from).getTime()) / MS_PER_DAY);
}

/** Daftar tanggal `from`..`to` inklusif. */
export function rangeKeys(from: DateKey, to: DateKey): DateKey[] {
  const out: DateKey[] = [];
  for (let k = from; diffDays(k, to) >= 0; k = addDays(k, 1)) out.push(k);
  return out;
}

/**
 * Batas hari WIB yang di-ISO-kan ke UTC — bentuk yang diminta OCS.
 * `dayKey` 2026-09-01 menghasilkan from 2026-08-31T17:00:00.000Z.
 */
export function wibDayStartIso(dayKey: DateKey): string {
  return new Date(keyToUtcDate(dayKey).getTime() - TZ_OFFSET_MINUTES * 60_000).toISOString();
}

/**
 * Sengaja mengembalikan `boolean`, bukan type predicate `v is DateKey`:
 * DateKey hanyalah alias `string`, sehingga predikat itu akan mempersempit
 * cabang negatifnya menjadi `never` dan memblokir pemakaian normal.
 */
export function isValidDateKey(v: unknown): boolean {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

/**
 * Terima berbagai bentuk tanggal dari berkas XLSX dan ubah ke `YYYY-MM-DD`.
 * Menangani: Date asli, serial Excel, `YYYY-MM-DD`, `DD/MM/YYYY`, `DD-MM-YYYY`.
 * Mengembalikan null bila tidak dikenali — pemanggil yang memutuskan cara melapor.
 */
export function parseDateCell(value: unknown): DateKey | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return toDateKeyUtc(value);
  if (typeof value === 'number') {
    // Serial Excel: hari sejak 1899-12-30 (memperhitungkan bug tahun kabisat 1900).
    if (!Number.isFinite(value) || value <= 0) return null;
    return toDateKeyUtc(new Date(Date.UTC(1899, 11, 30) + Math.round(value) * MS_PER_DAY));
  }
  const s = String(value).trim();
  if (isValidDateKey(s)) return s;
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const key = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    return isValidDateKey(key) ? key : null;
  }
  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? null : toDateKeyUtc(new Date(parsed));
}

/** Untuk nilai yang SUDAH berupa tanggal kalender (kolom DATE / serial Excel) — jangan digeser zona waktu. */
export function toDateKeyUtc(d: Date): DateKey {
  return d.toISOString().slice(0, 10);
}
