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
 * Sekarang: satu baris ringkas di popup pojok, rincian langkah disembunyikan di
 * balik tombol "Rincian". Sukses hilang sendiri; peringatan dan galat menetap
 * sampai ditutup, karena itu yang perlu dibaca orang.
 */
export type ToastTone = 'ok' | 'warn' | 'bad' | 'info';

export type ToastInput = {
  tone: ToastTone;
  /** Satu baris, ringkas. Ini yang selalu terbaca. */
  title: string;
  /** Rincian panjang — disembunyikan sampai diminta. */
  detail?: string;
  /** Milidetik sebelum hilang sendiri; 0 = menetap. Bawaan: ok/info 6 dtk, sisanya menetap. */
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
const ttlBawaan = (tone: ToastTone) => (tone === 'ok' || tone === 'info' ? 6_000 : 0);

function Baris({ t }: { t: Toast }) {
  const [buka, setBuka] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hitung mundur berhenti selagi rinciannya dibuka — orang sedang membacanya.
  useEffect(() => {
    const ms = t.ttl ?? ttlBawaan(t.tone);
    if (!ms || buka) return;
    timer.current = setTimeout(() => tutupToast(t.id), ms);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [t.id, t.ttl, t.tone, buka]);

  return (
    <div className={`toast toast-${t.tone}`} role={t.tone === 'bad' ? 'alert' : 'status'}>
      <span className="toast-icon" aria-hidden="true">{IKON[t.tone]}</span>
      <div className="toast-body">
        <div className="toast-title">{t.title}</div>
        {t.detail ? (
          <>
            <button type="button" className="toast-more" onClick={() => setBuka((b) => !b)} aria-expanded={buka}>
              {buka ? 'Sembunyikan rincian' : 'Rincian'}
            </button>
            {buka ? <div className="toast-detail">{t.detail}</div> : null}
          </>
        ) : null}
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
