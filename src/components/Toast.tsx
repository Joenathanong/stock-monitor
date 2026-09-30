'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * Notifikasi popup.
 *
 * Sebelumnya hasil Refresh ditempel sebagai chip di samping tombolnya. Chip itu
 * dirancang untuk satu-dua kata status (§11.8: tinggi 22px, tidak membungkus),
 * jadi kalimat sepanjang "Selesai: 2000 SKU, 18 dtk (pengaturan 0.1s · stok
 * 13400 baris 5.4s · …)" memaksa tinggi, pembungkusan dan lebar 46ch dipaksakan
 * lewat style inline — hasilnya balon hijau besar yang mendorong tata letak
 * topbar dan menutupi judul halaman.
 *
 * Sekarang: satu baris ringkas di popup pojok yang hilang sendiri setelah 10
 * detik — SEMUA nada, termasuk galat. Yang dibutuhkan saat itu cuma "berhasil
 * atau tidak"; rincian langkahnya tinggal di halaman Riwayat Proses, yang tetap
 * ada setelah halaman ditutup atau dibuka dari perangkat lain. Notifikasi yang
 * menetap justru terabaikan, dan rincian di dalamnya hilang begitu ditutup.
 */
export type ToastTone = 'ok' | 'warn' | 'bad' | 'info';

export type ToastInput = {
  tone: ToastTone;
  /** Satu baris, ringkas. Ini yang selalu terbaca. */
  title: string;
  /**
   * Baris kedua yang pendek — mis. "Rincian ada di Riwayat Proses". BUKAN tempat
   * menaruh daftar langkah: itu di halaman Riwayat.
   */
  detail?: string;
  /** Milidetik sebelum hilang sendiri. Bawaan 10 dtk. 0 = menetap (jarang dipakai). */
  ttl?: number;
};

type Toast = ToastInput & { id: number };

let berikutnya = 1;
const antrean: Toast[] = [];
const pendengar = new Set<(t: Toast[]) => void>();
const siarkan = () => pendengar.forEach((f) => f([...antrean]));

/** Paling banyak 3 sekaligus — lebih dari itu menutupi halaman, bukan memberi tahu. */
const MAKS = 3;

export function toast(t: ToastInput): number {
  const id = berikutnya++;
  antrean.push({ ...t, id });
  while (antrean.length > MAKS) antrean.shift();
  siarkan();
  return id;
}

export function tutupToast(id: number) {
  const i = antrean.findIndex((t) => t.id === id);
  if (i >= 0) { antrean.splice(i, 1); siarkan(); }
}

const IKON: Record<ToastTone, string> = { ok: '✓', warn: '!', bad: '✕', info: 'i' };
/** 10 detik untuk semua nada — cukup dibaca, tidak menumpuk di layar. */
const TTL = 10_000;

function Baris({ t }: { t: Toast }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const ms = t.ttl ?? TTL;
    if (!ms) return;
    timer.current = setTimeout(() => tutupToast(t.id), ms);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [t.id, t.ttl]);

  return (
    <div className={`toast toast-${t.tone}`} role={t.tone === 'bad' ? 'alert' : 'status'}>
      <span className="toast-icon" aria-hidden="true">{IKON[t.tone]}</span>
      <div className="toast-body">
        <div className="toast-title">{t.title}</div>
        {t.detail ? <div className="toast-detail">{t.detail}</div> : null}
        <a className="toast-more" href="/riwayat">Lihat rincian di Riwayat Proses →</a>
      </div>
      <button type="button" className="toast-close" onClick={() => tutupToast(t.id)} aria-label="Tutup notifikasi">✕</button>
    </div>
  );
}

/** Dipasang sekali di layout. Semua halaman memakai antrean yang sama. */
export function Toaster() {
  const [daftar, setDaftar] = useState<Toast[]>([]);
  useEffect(() => {
    pendengar.add(setDaftar);
    setDaftar([...antrean]);
    return () => { pendengar.delete(setDaftar); };
  }, []);
  if (!daftar.length) return null;
  return (
    <div className="toast-host" aria-live="polite">
      {daftar.map((t) => <Baris key={t.id} t={t} />)}
    </div>
  );
}
