/**
 * Anggaran waktu satu permintaan.
 *
 * Alasan keberadaannya: fungsi serverless PUNYA batas keras (Vercel Hobby 60
 * detik). Kalau dilewati, prosesnya DIBUNUH platform — blok `finally` tidak
 * pernah jalan, sehingga kunci sinkronisasi tertinggal dipegang proses yang
 * sudah mati dan Refresh berikutnya ditolak berulang kali. Dari layar, itu
 * terlihat seperti "lama sekali lalu tidak ada perubahan".
 *
 * Dengan anggaran ini, pekerjaan berhenti SENDIRI sebelum dibunuh, memberi
 * pesan yang jelas, dan melepas kuncinya.
 */

/** Batas keras platform. Hobby = 60 dtk; sisakan margin untuk menutup rapi. */
export const FUNCTION_LIMIT_MS = 60_000;
export const DEFAULT_BUDGET_MS = 52_000;

/**
 * Di luar Vercel (skrip CLI `npm run compute`, backfill pertama kali) tidak ada
 * batas fungsi, jadi anggarannya dilonggarkan. Anggaran ketat hanya masuk akal
 * ketika memang ada yang akan membunuh prosesnya.
 */
export const defaultBudgetMs = () => (process.env.VERCEL ? DEFAULT_BUDGET_MS : 15 * 60_000);

export class BudgetHabis extends Error {
  constructor(langkah: string, sisaMs: number, perluMs: number) {
    super(
      `Waktu habis sebelum ${langkah}: sisa ${Math.round(sisaMs / 1000)} dtk, ` +
      `butuh ${Math.round(perluMs / 1000)} dtk. Batas satu permintaan ${FUNCTION_LIMIT_MS / 1000} dtk.`,
    );
    this.name = 'BudgetHabis';
  }
}

export type Budget = {
  /** Sisa waktu (ms), tidak pernah negatif. */
  left(): number;
  /** Lempar error jelas bila sisa waktu tidak cukup untuk langkah berikutnya. */
  need(perluMs: number, langkah: string): void;
  /** Sisa waktu setelah menyisakan cadangan untuk langkah-langkah sesudahnya. */
  slice(cadanganMs: number, minMs?: number): number;
  elapsed(): number;
};

export function budget(totalMs = DEFAULT_BUDGET_MS, now = () => Date.now()): Budget {
  const t0 = now();
  const deadline = t0 + totalMs;
  const left = () => Math.max(0, deadline - now());
  return {
    left,
    elapsed: () => now() - t0,
    need(perluMs, langkah) {
      const sisa = left();
      if (sisa < perluMs) throw new BudgetHabis(langkah, sisa, perluMs);
    },
    slice(cadanganMs, minMs = 5_000) {
      return Math.max(minMs, left() - cadanganMs);
    },
  };
}

/** Catatan waktu per langkah — masuk ke sync_log supaya penyebab lambat terlihat. */
export class Timeline {
  private t0 = Date.now();
  private mark = Date.now();
  private steps: string[] = [];
  step(nama: string) {
    const now = Date.now();
    this.steps.push(`${nama} ${((now - this.mark) / 1000).toFixed(1)}s`);
    this.mark = now;
  }
  toString() {
    return `${this.steps.join(' · ')} — total ${((Date.now() - this.t0) / 1000).toFixed(1)}s`;
  }
  get totalMs() { return Date.now() - this.t0; }
}
