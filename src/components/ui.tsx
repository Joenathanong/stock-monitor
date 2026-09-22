'use client';
import { useEffect, useState } from 'react';
import type { ProductStatus } from '@/lib/doi';

export const STATUS_TEXT: Record<string, string> = {
  CRITICAL: 'Kritis',
  LOW: 'Low Stock',
  WAITING: 'Tunggu Kiriman',
  HEALTHY: 'Aman',
  OVERSTOCK: 'Overstock',
  DEAD_STOCK: 'Dead Stock',
  NO_SALES: 'Belum Terjual',
  NPL_WAIT: 'NPL',
  PHASE_OUT: 'Phase Out',
  EXCLUDED: 'Dikecualikan',
};

export const STATUS_CHIP: Record<string, string> = {
  CRITICAL: 'chip-bad',
  LOW: 'chip-warn',
  WAITING: 'chip-info',
  HEALTHY: 'chip-ok',
  OVERSTOCK: 'chip-violet',
  DEAD_STOCK: 'chip-gray',
  NO_SALES: 'chip-gray',
  NPL_WAIT: 'chip-brand',
  PHASE_OUT: 'chip-warn',
  EXCLUDED: 'chip-gray',
};

/** Warna solid status untuk bar/grafik — token tema (§2.4 / §3.4). */
export const STATUS_COLOR: Record<string, string> = {
  CRITICAL: 'var(--negative-solid)', LOW: 'var(--critical-solid)', WAITING: 'var(--informative-solid)', HEALTHY: 'var(--positive-solid)',
  OVERSTOCK: 'var(--accent-violet)', NPL_WAIT: 'var(--primary)', PHASE_OUT: 'var(--critical-solid)', DEAD_STOCK: 'var(--neutral-solid)', NO_SALES: 'var(--neutral-border)', EXCLUDED: 'var(--border-strong)',
};

export const STATUS_ORDER: ProductStatus[] = ['CRITICAL', 'LOW', 'WAITING', 'HEALTHY', 'OVERSTOCK', 'NPL_WAIT', 'PHASE_OUT', 'DEAD_STOCK', 'NO_SALES', 'EXCLUDED'];

export function StatusChip({ status }: { status: string }) {
  return <span className={`chip ${STATUS_CHIP[status] ?? 'chip-gray'}`}>{STATUS_TEXT[status] ?? status}</span>;
}

export function AbcChip({ cls }: { cls: string }) {
  const c = cls === 'A' ? 'chip-brand' : cls === 'B' ? 'chip-info' : 'chip-gray';
  return <span className={`chip chip-noicon ${c} min-w-[30px] justify-center`} title={`Kelas ${cls}`}>{cls}</span>;
}

export function Kpi({ label, value, unit, hint, tone }: { label: string; value: React.ReactNode; unit?: string; hint?: React.ReactNode; tone?: string }) {
  return (
    <div className="card card-pad">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value whitespace-nowrap ${tone ?? ''}`}>{value}{unit ? <span className="ml-1 text-[13px] font-medium text-label">{unit}</span> : null}</div>
      {hint ? <div className="kpi-hint">{hint}</div> : null}
    </div>
  );
}

export const fmt = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined || !Number.isFinite(n)
    ? '—'
    : n.toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const fmtDoi = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n >= 100 ? fmt(n, 0) : fmt(n, 1));

export function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' WIB';
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-10 text-center text-[13px] text-label">{children}</div>;
}

export function Alert({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'ok'; children: React.ReactNode }) {
  const style = {
    info: { color: 'var(--informative)', background: 'var(--informative-bg)', borderColor: 'var(--informative-border)' },
    warn: { color: 'var(--critical)', background: 'var(--critical-bg)', borderColor: 'var(--critical-border)' },
    error: { color: 'var(--negative)', background: 'var(--negative-bg)', borderColor: 'var(--negative-border)' },
    ok: { color: 'var(--positive)', background: 'var(--positive-bg)', borderColor: 'var(--positive-border)' },
  }[tone];
  return <div role={tone === 'error' ? 'alert' : 'status'} className="rounded-control border px-3 py-2 text-[13px]" style={style}>{children}</div>;
}

/** Pemuat data sederhana: fetch JSON dari API, dengan reload manual. */
export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    setLoading(true);
    fetch(url)
      .then(async (r) => {
        const j = await r.json();
        if (!alive) return;
        if (!r.ok || j.ok === false) setError(j.error || `HTTP ${r.status}`);
        else { setData(j as T); setError(null); }
      })
      .catch((e) => alive && setError(String(e)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [url, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}

export async function postJson(url: string, body?: unknown, method = 'POST', signal?: AbortSignal) {
  const r = await fetch(url, {
    method, signal,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

export async function postForm(url: string, form: FormData) {
  const r = await fetch(url, { method: 'POST', body: form });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

/** Tombol Refresh: tarik stok OCS + hitung ulang. Dipakai di beberapa halaman. */
/**
 * Batas satu permintaan di server 60 dtk; klien menunggu sedikit lebih lama lalu
 * menyerah sendiri. Tanpa ini tombolnya menggantung tanpa batas dan terlihat
 * seperti aplikasi yang macet.
 */
const REFRESH_TIMEOUT_MS = 70_000;

export function RefreshButton({ onDone, withStock = true, label }: { onDone?: () => void; withStock?: boolean; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [detik, setDetik] = useState(0);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn' | 'bad'; text: string } | null>(null);

  // Penghitung detik: tanpa ini 40 dtk menunggu terasa seperti aplikasi mati.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setDetik((d) => d + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  async function run() {
    setBusy(true); setDetik(0); setMsg(null);
    const ac = new AbortController();
    const batas = setTimeout(() => ac.abort(), REFRESH_TIMEOUT_MS);
    try {
      const r = await postJson('/api/compute', { withStock }, 'POST', ac.signal);
      if (r.skipped) {
        // Ini BUKAN keberhasilan: snapshot tidak berubah. Dulu tampil sebagai
        // teks abu kecil sehingga terbaca seperti sukses.
        setMsg({ tone: 'warn', text: r.message || 'Dilewati — perhitungan lain sedang berjalan' });
      } else {
        setMsg({ tone: 'ok', text: `Selesai: ${r.skuCount} SKU, ${Math.round(r.durationMs / 1000)} dtk${r.steps ? ` (${r.steps})` : ''}` });
      }
      onDone?.();
    } catch (e) {
      const gagal = e instanceof Error && e.name === 'AbortError'
        ? `Tidak selesai dalam ${REFRESH_TIMEOUT_MS / 1000} dtk. Perhitungan mungkin masih jalan di server — tunggu sebentar lalu muat ulang halaman.`
        : `Gagal: ${e instanceof Error ? e.message : e}`;
      setMsg({ tone: 'bad', text: gagal });
    } finally {
      clearTimeout(batas);
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button className={withStock ? 'btn btn-primary' : 'btn'} onClick={run} disabled={busy}>
        {busy ? `Menghitung… ${detik} dtk` : label ?? (withStock ? 'Refresh (tarik stok OCS + hitung)' : 'Hitung ulang')}
      </button>
      {msg ? (
        <span className={`chip chip-noicon ${msg.tone === 'bad' ? 'chip-bad' : msg.tone === 'warn' ? 'chip-warn' : 'chip-ok'}`}
          style={{ height: 'auto', whiteSpace: 'normal', maxWidth: '46ch', padding: '4px 10px', fontWeight: 500 }}>
          {msg.text}
        </span>
      ) : null}
    </span>
  );
}

/** Bar horizontal sederhana untuk distribusi — tanpa pustaka grafik. */
export function Bars({ items, color = 'var(--c1)' }: { items: { label: string; value: number; color?: string }[]; color?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-2">
      {items.map((i) => (
        <div key={i.label} className="grid grid-cols-[110px_1fr_56px] items-center gap-2 text-[12.5px]">
          <div className="truncate text-label">{i.label}</div>
          <div className="h-3 rounded-sm" style={{ background: 'var(--chart-track)' }}>
            <div className="h-3 rounded-sm" style={{ width: `${(i.value / max) * 100}%`, background: i.color ?? color }} />
          </div>
          <div className="num font-semibold">{fmt(i.value)}</div>
        </div>
      ))}
    </div>
  );
}

/** Keterangan jendela — dipakai juga oleh route server, jadi tinggal di lib. */
export { windowLabel, weekLabel, opsi2Label, fmtRp, fmtRpShort } from '@/lib/labels';

/** Opsi DOI mana yang ditampilkan — setelan `doi_display` di Pengaturan. */
export type DoiDisplay = 'OPSI1' | 'OPSI2' | 'BOTH';
export const show1 = (d: DoiDisplay | undefined) => d !== 'OPSI2';
export const show2 = (d: DoiDisplay | undefined) => d !== 'OPSI1';
/**
 * Saat hanya satu opsi ditampilkan, nomornya tidak perlu ditulis — metodenya sudah
 * jelas dari Pengaturan dan dari keterangan kecil di bawah angka.
 */
export const doiLabel = (base: string, n: 1 | 2, d?: DoiDisplay) =>
  d === 'OPSI1' || d === 'OPSI2' ? base : `${base} ${n}`;

/** Judul KPI: "DOI Total" bila satu opsi, "DOI total — Opsi 1/2" bila keduanya. */
export const doiTotalLabel = (n: 1 | 2, d?: DoiDisplay) =>
  d === 'OPSI1' || d === 'OPSI2' ? 'DOI Total' : `DOI total — Opsi ${n}`;
