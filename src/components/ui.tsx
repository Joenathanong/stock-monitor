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
  EXCLUDED: 'chip-gray',
};

/** Warna solid status untuk bar/grafik — token tema (§2.4 / §3.4). */
export const STATUS_COLOR: Record<string, string> = {
  CRITICAL: 'var(--negative-solid)', LOW: 'var(--critical-solid)', WAITING: 'var(--informative-solid)', HEALTHY: 'var(--positive-solid)',
  OVERSTOCK: 'var(--accent-violet)', NPL_WAIT: 'var(--primary)', DEAD_STOCK: 'var(--neutral-solid)', NO_SALES: 'var(--neutral-border)', EXCLUDED: 'var(--border-strong)',
};

export const STATUS_ORDER: ProductStatus[] = ['CRITICAL', 'LOW', 'WAITING', 'HEALTHY', 'OVERSTOCK', 'NPL_WAIT', 'DEAD_STOCK', 'NO_SALES', 'EXCLUDED'];

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

export async function postJson(url: string, body?: unknown, method = 'POST') {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
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
export function RefreshButton({ onDone, withStock = true, label }: { onDone?: () => void; withStock?: boolean; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function run() {
    setBusy(true); setMsg(null);
    try {
      const r = await postJson('/api/compute', { withStock });
      setMsg(r.skipped ? r.message : `Selesai: ${r.skuCount} SKU dalam ${Math.round(r.durationMs / 1000)} dtk`);
      onDone?.();
    } catch (e) {
      setMsg(`Gagal: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button className={withStock ? 'btn btn-primary' : 'btn'} onClick={run} disabled={busy}>
        {busy ? 'Menghitung…' : label ?? (withStock ? 'Refresh (tarik stok OCS + hitung)' : 'Hitung ulang')}
      </button>
      {msg ? <span className="text-[12px] text-label">{msg}</span> : null}
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
