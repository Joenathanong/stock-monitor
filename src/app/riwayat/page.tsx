'use client';
import { useState } from 'react';
import { Alert, Kpi, fmt, fmtDateTime, useApi } from '@/components/ui';
import { DataGrid, type Column } from '@/components/DataGrid';

/**
 * Riwayat Proses.
 *
 * Notifikasi di layar sengaja pendek dan hilang sendiri setelah 10 detik — yang
 * dibutuhkan saat itu cuma "berhasil atau tidak". Rincian langkahnya tinggal di
 * sini, dan tetap ada setelah halaman ditutup atau dibuka dari perangkat lain.
 */
type Baris = {
  id: string; kind: string; trigger: string; status: string;
  startedAt: string; finishedAt: string | null; durationMs: number | null;
  rows: number; message: string | null; bermasalah: boolean;
};

const JENIS: Record<string, string> = { COMPUTE: 'Hitung DOI', STOCK: 'Tarik stok', SALES: 'Tarik penjualan' };
const PEMICU: Record<string, string> = { manual: 'Tombol Refresh', cron: 'Terjadwal', cli: 'Terminal' };

const detik = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} dtk`);

const KOLOM: Column<Baris>[] = [
  { key: 'at', label: 'Waktu', get: (r) => r.startedAt, type: 'date', mono: true, width: 150,
    isTitle: true, render: (r) => fmtDateTime(r.startedAt) },
  { key: 'kind', label: 'Proses', get: (r) => JENIS[r.kind] ?? r.kind, width: 130 },
  { key: 'trigger', label: 'Pemicu', get: (r) => PEMICU[r.trigger] ?? r.trigger, width: 120, prio: 'p2' },
  { key: 'status', label: 'Hasil', get: (r) => (r.status === 'ok' && r.bermasalah ? 'ada catatan' : r.status), width: 140,
    render: (r) => {
      // "ok" yang di dalamnya ada langkah GAGAL/SEBAGIAN bukan hijau polos —
      // itulah yang dulu lolos tanpa kelihatan.
      const [k, t] = r.status === 'error' ? ['chip-bad', 'Gagal']
        : r.bermasalah ? ['chip-warn', 'Ada catatan']
        : r.status === 'ok' ? ['chip-ok', 'Berhasil']
        : ['chip-gray', r.status];
      return <span className={`chip ${k}`}>{t}</span>;
    } },
  { key: 'lama', label: 'Lama', get: (r) => r.durationMs ?? 0, type: 'number', mono: true, width: 90,
    render: (r) => detik(r.durationMs) },
  { key: 'rows', label: 'Baris', get: (r) => r.rows, type: 'number', mono: true, width: 90, prio: 'p2' },
  { key: 'msg', label: 'Rincian langkah', get: (r) => r.message, width: 420 },
];

export default function RiwayatPage() {
  const [jenis, setJenis] = useState('SEMUA');
  const [buka, setBuka] = useState<string | null>(null);
  const [hanyaMasalah, setHanyaMasalah] = useState(false);
  const { data, error, loading, reload } = useApi<{ rows: Baris[] }>(
    `/api/riwayat?limit=200${jenis === 'SEMUA' ? '' : `&kind=${jenis}`}`,
  );

  const semua = data?.rows ?? [];
  const baris = hanyaMasalah ? semua.filter((r) => r.bermasalah) : semua;
  const gagal = semua.filter((r) => r.status === 'error').length;
  const catatan = semua.filter((r) => r.bermasalah && r.status !== 'error').length;
  const terakhir = semua[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Riwayat Proses</h1>
          <div className="mt-1 text-[12px] text-label">
            Setiap penarikan dan perhitungan beserta rincian langkahnya. Notifikasi di layar hanya
            bertahan 10 detik — rinciannya ada di sini.
          </div>
        </div>
        <button className="btn" onClick={reload} disabled={loading}>{loading ? 'Memuat…' : 'Muat ulang'}</button>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="kpi-grid">
        <Kpi label="Proses tercatat" value={fmt(semua.length)} hint="200 terakhir" />
        <Kpi label="Gagal" value={fmt(gagal)} tone={gagal ? 'text-negative' : undefined}
          hint={gagal ? 'perlu dilihat' : 'tidak ada'} />
        <Kpi label="Ada catatan" value={fmt(catatan)} tone={catatan ? 'text-critical' : undefined}
          hint="selesai, tapi ada langkah yang GAGAL atau SEBAGIAN" />
        <Kpi label="Terakhir" value={terakhir ? detik(terakhir.durationMs) : '—'}
          hint={terakhir ? `${JENIS[terakhir.kind] ?? terakhir.kind} · ${fmtDateTime(terakhir.startedAt)}` : '—'} />
      </div>

      <DataGrid<Baris>
        id="riwayat"
        rows={baris}
        columns={KOLOM}
        rowKey={(r) => r.id}
        onRowClick={(r) => setBuka((k) => (k === r.id ? null : r.id))}
        expanded={buka}
        renderExpanded={(r) => (
          // Rincian utuh, dipecah per langkah. Di dalam sel tabel teksnya
          // dipotong "…"; di sinilah seluruhnya bisa dibaca.
          <div className="space-y-2 p-1">
            <div className="text-[12px] text-label">
              {JENIS[r.kind] ?? r.kind} · {PEMICU[r.trigger] ?? r.trigger} · mulai {fmtDateTime(r.startedAt)}
              {r.finishedAt ? ` · selesai ${fmtDateTime(r.finishedAt)}` : ' · belum selesai'} · {detik(r.durationMs)}
            </div>
            {r.message
              ? (
                <ul className="space-y-1">
                  {r.message.split(' · ').map((langkah, i) => (
                    <li key={i} className={`text-[13px] ${/GAGAL|SEBAGIAN/.test(langkah) ? 'font-semibold text-critical' : ''}`}>
                      {langkah}
                    </li>
                  ))}
                </ul>
              )
              : <div className="text-[13px] text-label">Tidak ada rincian tercatat.</div>}
          </div>
        )}
        emptyText="Belum ada proses tercatat."
        toolbarExtra={(
          <>
            <select className="input w-full sm:w-auto" value={jenis} onChange={(e) => setJenis(e.target.value)} aria-label="Jenis proses">
              <option value="SEMUA">Semua proses</option>
              <option value="COMPUTE">Hitung DOI</option>
              <option value="STOCK">Tarik stok</option>
              <option value="SALES">Tarik penjualan</option>
            </select>
            <label className="check">
              <input type="checkbox" checked={hanyaMasalah} onChange={(e) => setHanyaMasalah(e.target.checked)} />
              Hanya yang bermasalah
            </label>
          </>
        )}
      />
    </div>
  );
}
