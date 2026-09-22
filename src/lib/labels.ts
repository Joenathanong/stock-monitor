/**
 * Keterangan jendela perhitungan. Sengaja ditaruh di lib (bukan di komponen UI)
 * supaya route server — mis. judul kolom export XLSX — bisa memakainya tanpa
 * ikut menarik modul client.
 */

/**
 * Jendela hari → keterangan yang enak dibaca: 30 → "1 bln", 90 → "3 bln".
 * Angka yang bukan kelipatan bulan TIDAK dipaksa dibulatkan (45 tetap "45 hari"),
 * karena menyebut 45 hari sebagai "2 bln" justru menyesatkan.
 */
export function windowLabel(days: number | null | undefined): string {
  const d = Number(days);
  if (!Number.isFinite(d) || d <= 0) return '—';
  if (d >= 28) {
    const m = Math.round(d / 30);
    if (m >= 1 && Math.abs(d - m * 30) <= 3) return `${m} bln`;
  }
  return `${d} hari`;
}

/** Jendela pendek Opsi 2 dalam minggu: 56 → "8w", 28 → "4w"; selain itu "N hr". */
export function weekLabel(days: number | null | undefined): string {
  const d = Number(days);
  if (!Number.isFinite(d) || d <= 0) return '—';
  return d % 7 === 0 ? `${d / 7}w` : `${d} hr`;
}

/** Keterangan Opsi 2: "max(8w, 4w, 2w)" mengikuti angka di Pengaturan. */
export function opsi2Label(w8?: number | null, w4?: number | null, w2?: number | null): string {
  return `max(${weekLabel(w8)}, ${weekLabel(w4)}, ${weekLabel(w2)})`;
}

/** Rupiah utuh: 47091 → "Rp 47.091". Nol/tidak diketahui → "—". */
export function fmtRp(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return '—';
  return `Rp ${Math.round(v).toLocaleString('id-ID')}`;
}

/**
 * Rupiah ringkas untuk angka besar: 16.400.000.000 → "Rp 16,4 M".
 * Dipakai di KPI dan resume, karena angka penuh 12 digit tidak terbaca sekilas.
 * Satuan mengikuti kebiasaan Indonesia: rb / jt / M (miliar) / T (triliun).
 */
export function fmtRpShort(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return '—';
  const abs = Math.abs(v);
  const tanda = v < 0 ? '-' : '';
  const satuan: [number, string][] = [[1e12, 'T'], [1e9, 'M'], [1e6, 'jt'], [1e3, 'rb']];
  for (const [batas, label] of satuan) {
    if (abs >= batas) {
      const angka = abs / batas;
      return `${tanda}Rp ${angka.toLocaleString('id-ID', { maximumFractionDigits: angka < 10 ? 2 : 1 })} ${label}`;
    }
  }
  return `${tanda}Rp ${Math.round(abs).toLocaleString('id-ID')}`;
}
