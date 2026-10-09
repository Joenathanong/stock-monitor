'use client';
import { useMemo, useState } from 'react';
import { Alert, Kpi, fmt, useApi } from '@/components/ui';
import { DataGrid, type Column } from '@/components/DataGrid';

type Baris = {
  sku: string; areaId: string; name: string;
  stok: number | null; onHand: number | null; onOrder: number | null;
  terjual: number; batal: number;
  shopee: number; tiktok: number; tokped: number; lazada: number; lain: number;
};
type RekapArea = {
  areaId: string; skuStok: number; skuJual: number; stok: number; terjual: number; batal: number;
  shopee: number; tiktok: number; tokped: number; lazada: number; lain: number; stokKosong: number;
};
type Rentang = { awal: string | null; akhir: string | null; hari: number } | null;
type Resp = {
  ok: boolean; tanggal: string; hariIni: string;
  rentang: { stok: Rentang; jual: Rentang };
  perArea: RekapArea[]; total: RekapArea; baris: Baris[];
  terjualTanpaStok: Baris[]; terjualTanpaStokTotal: number;
  pesan: string;
};

/** Geser tanggal N hari tanpa menyentuh zona waktu lokal browser. */
function geser(key: string, hari: number): string {
  const d = new Date(`${key}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + hari);
  return d.toISOString().slice(0, 10);
}

const angka = (v: number | null) => (v === null ? '—' : fmt(v));

export default function RekapPage() {
  // Tanggal kosong = server pakai hari ini. Dibiarkan kosong di awal supaya
  // halaman tidak menebak tanggal dari jam browser, yang bisa beda dari WIB.
  const [tanggal, setTanggal] = useState('');
  const { data, error } = useApi<Resp>(`/api/rekap${tanggal ? `?tanggal=${tanggal}` : ''}`);
  const [hanyaTanpaStok, setHanyaTanpaStok] = useState(false);

  const aktif = data?.tanggal ?? tanggal;
  const baris = data?.baris ?? [];
  const setTanpaStok = useMemo(
    () => new Set((data?.terjualTanpaStok ?? []).map((r) => `${r.sku}|${r.areaId}`)),
    [data],
  );

  const columns = useMemo<Column<Baris>[]>(() => [
    { key: 'sku', label: 'SKU', get: (r) => r.sku, mono: true, width: 230, sticky: true, isTitle: true },
    { key: 'name', label: 'Nama', get: (r) => r.name, width: 260, prio: 'p2' },
    { key: 'area', label: 'Cabang', get: (r) => r.areaId, width: 110 },
    {
      key: 'stok', label: 'Stok', get: (r) => r.stok, type: 'number', align: 'right', mono: true, width: 96,
      title: 'Available pada tanggal itu, dari potret stock_daily. "—" = tidak ada barisnya di potret hari itu.',
      render: (r) => <span className={`mono ${r.stok === 0 ? 'text-negative' : ''}`}>{angka(r.stok)}</span>,
    },
    { key: 'terjual', label: 'Terjual', get: (r) => r.terjual, type: 'number', align: 'right', mono: true, width: 96 },
    {
      key: 'batal', label: 'Batal', get: (r) => r.batal, type: 'number', align: 'right', mono: true, width: 90, prio: 'p3',
      title: 'Qty order batal/belum bayar. Disimpan terpisah dan TIDAK masuk angka terjual.',
    },
    { key: 'shopee', label: 'Shopee', get: (r) => r.shopee, type: 'number', align: 'right', mono: true, width: 92, prio: 'p3' },
    { key: 'tiktok', label: 'TikTok', get: (r) => r.tiktok, type: 'number', align: 'right', mono: true, width: 92, prio: 'p3' },
    { key: 'tokped', label: 'Tokopedia', get: (r) => r.tokped, type: 'number', align: 'right', mono: true, width: 96, prio: 'p3' },
    { key: 'lazada', label: 'Lazada', get: (r) => r.lazada, type: 'number', align: 'right', mono: true, width: 92, prio: 'p3' },
    { key: 'lain', label: 'Lain', get: (r) => r.lain, type: 'number', align: 'right', mono: true, width: 84, prio: 'p3' },
    {
      key: 'onorder', label: 'On order', get: (r) => r.onOrder, type: 'number', align: 'right', mono: true, width: 96, prio: 'p3',
      render: (r) => <span className="mono">{angka(r.onOrder)}</span>,
    },
  ], []);

  const t = data?.total;
  const rStok = data?.rentang.stok;
  const rJual = data?.rentang.jual;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Rekap Harian — Stok & Penjualan</h1>
          <div className="mt-1 text-[12px] text-label">
            Data yang ditarik dari OCS, <b>per hari</b>. Bisa dipilih tanggal ke belakang:
            angkanya dibaca dari potret harian (<span className="mono">stock_daily</span>,{' '}
            <span className="mono">sales_daily</span>), bukan dari stok sekarang — jadi
            <b> hari kemarin tidak berubah</b> ketika Refresh hari ini dijalankan.
          </div>
        </div>
        <div className="flex items-end gap-2">
          <button className="btn btn-sm" onClick={() => setTanggal(geser(aktif || data?.hariIni || '', -1))} disabled={!aktif}>
            ← Hari sebelumnya
          </button>
          <div>
            <label className="label" htmlFor="tgl">Tanggal</label>
            <input
              id="tgl" type="date" className="input mono" value={aktif}
              max={data?.hariIni}
              min={rStok?.awal ?? rJual?.awal ?? undefined}
              onChange={(e) => setTanggal(e.target.value)}
            />
          </div>
          <button
            className="btn btn-sm"
            onClick={() => setTanggal(geser(aktif, 1))}
            disabled={!aktif || aktif >= (data?.hariIni ?? aktif)}
          >
            Hari berikutnya →
          </button>
          <button className="btn btn-sm" onClick={() => setTanggal('')} disabled={!tanggal}>Hari ini</button>
        </div>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {data?.pesan ? <Alert tone="warn">{data.pesan}</Alert> : null}

      {/*
        Batas yang harus disebut, bukan dibiarkan jadi selisih yang
        membingungkan: potret harian hanya merekam kategori 'Sku', sementara ATP
        menghitung Sku + Bundle + Gimmick. Tanpa catatan ini, "1.662 SKU" di
        /atp dan "375 SKU" di sini terlihat seperti salah satunya rusak.
      */}
      <Alert tone="info">
        Potret stok harian hanya merekam kategori <b>Sku</b> — Bundle & Gimmick tidak ikut,
        jadi jumlah SKU di sini lebih kecil daripada di ATP Monitoring (yang menghitung
        ketiganya dari stok <i>sekarang</i>). Penjualan tidak dibatasi kategori.
        {rStok?.awal ? (
          <> Riwayat stok tersimpan {fmt(rStok.hari)} hari ({rStok.awal} … {rStok.akhir});{' '}</>
        ) : null}
        {rJual?.awal ? <>penjualan {fmt(rJual.hari)} hari ({rJual.awal} … {rJual.akhir}).</> : null}
      </Alert>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Stok tercatat" value={t ? `${fmt(t.stok)} pcs` : '—'}
          hint={t ? `${fmt(t.skuStok)} SKU unik, ${fmt(t.stokKosong)} baris bersaldo 0` : ''} />
        <Kpi label="Terjual hari itu" value={t ? `${fmt(t.terjual)} pcs` : '—'}
          hint={t ? `${fmt(t.skuJual)} SKU unik terjual` : ''} />
        <Kpi label="Qty order batal" value={t ? `${fmt(t.batal)} pcs` : '—'}
          hint="Tidak memakan stok; tidak masuk angka terjual" />
        <Kpi label="Terjual padahal kosong" value={data ? fmt(data.terjualTanpaStokTotal) : '—'}
          hint="Baris yang penjualannya hilang dari perhitungan rata-rata" />
      </div>

      {data && data.terjualTanpaStokTotal > 0 ? (
        <Alert tone="warn">
          <b>{fmt(data.terjualTanpaStokTotal)} baris terjual padahal stoknya tercatat 0</b> (atau
          tidak ada di potret hari itu). Hari seperti ini <b>menurunkan ADS</b> dan membuat DOI
          terlihat lebih aman daripada kenyataannya — kecuali pengaturan “keluarkan hari stok
          kosong dari pembagi” dinyalakan.{' '}
          <button className="underline" onClick={() => setHanyaTanpaStok((v) => !v)}>
            {hanyaTanpaStok ? 'Tampilkan semua baris' : 'Tampilkan hanya baris ini'}
          </button>
        </Alert>
      ) : null}

      <div className="card card-pad">
        <div className="card-title mb-2">Per cabang — {aktif || '…'}</div>
        <div className="overflow-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-muted">
                <th className="px-2 py-1">Cabang</th>
                <th className="px-2 py-1 text-right">SKU bestok</th>
                <th className="px-2 py-1 text-right">Stok (pcs)</th>
                <th className="px-2 py-1 text-right">Saldo 0</th>
                <th className="px-2 py-1 text-right">SKU terjual</th>
                <th className="px-2 py-1 text-right">Terjual</th>
                <th className="px-2 py-1 text-right">Batal</th>
                <th className="px-2 py-1 text-right">Shopee</th>
                <th className="px-2 py-1 text-right">TikTok</th>
                <th className="px-2 py-1 text-right">Tokped</th>
                <th className="px-2 py-1 text-right">Lazada</th>
                <th className="px-2 py-1 text-right">Lain</th>
              </tr>
            </thead>
            <tbody>
              {(data?.perArea ?? []).map((a) => (
                <tr key={a.areaId} className="border-t">
                  <td className="px-2 py-1 font-medium">{a.areaId}</td>
                  <td className="px-2 py-1 text-right mono">{fmt(a.skuStok)}</td>
                  <td className="px-2 py-1 text-right mono">{fmt(a.stok)}</td>
                  <td className="px-2 py-1 text-right mono">{fmt(a.stokKosong)}</td>
                  <td className="px-2 py-1 text-right mono">{fmt(a.skuJual)}</td>
                  <td className="px-2 py-1 text-right mono">{fmt(a.terjual)}</td>
                  <td className="px-2 py-1 text-right mono text-muted">{fmt(a.batal)}</td>
                  <td className="px-2 py-1 text-right mono">{fmt(a.shopee)}</td>
                  <td className="px-2 py-1 text-right mono">{fmt(a.tiktok)}</td>
                  <td className="px-2 py-1 text-right mono">{fmt(a.tokped)}</td>
                  <td className="px-2 py-1 text-right mono">{fmt(a.lazada)}</td>
                  <td className="px-2 py-1 text-right mono">{fmt(a.lain)}</td>
                </tr>
              ))}
              {t ? (
                <tr className="border-t-2 font-semibold">
                  {/* SKU unik lintas cabang — SENGAJA bukan jumlah kolom di atasnya. */}
                  <td className="px-2 py-1">KESELURUHAN</td>
                  <td className="px-2 py-1 text-right mono" title="SKU unik lintas cabang, bukan jumlah kolom di atas">{fmt(t.skuStok)}</td>
                  <td className="px-2 py-1 text-right mono">{fmt(t.stok)}</td>
                  <td className="px-2 py-1 text-right mono">{fmt(t.stokKosong)}</td>
                  <td className="px-2 py-1 text-right mono" title="SKU unik lintas cabang">{fmt(t.skuJual)}</td>
                  <td className="px-2 py-1 text-right mono">{fmt(t.terjual)}</td>
                  <td className="px-2 py-1 text-right mono">{fmt(t.batal)}</td>
                  <td className="px-2 py-1 text-right mono">{fmt(t.shopee)}</td>
                  <td className="px-2 py-1 text-right mono">{fmt(t.tiktok)}</td>
                  <td className="px-2 py-1 text-right mono">{fmt(t.tokped)}</td>
                  <td className="px-2 py-1 text-right mono">{fmt(t.lazada)}</td>
                  <td className="px-2 py-1 text-right mono">{fmt(t.lain)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <DataGrid<Baris>
        id="rekap-harian"
        rows={baris}
        columns={columns}
        rowKey={(r) => `${r.sku}|${r.areaId}`}
        preFilter={hanyaTanpaStok ? (r) => setTanpaStok.has(`${r.sku}|${r.areaId}`) : undefined}
        emptyText={`Tidak ada baris untuk ${aktif || 'tanggal ini'}.`}
        toolbarExtra={<span className="text-[12px] text-label">{fmt(baris.length)} baris (SKU × cabang)</span>}
        footerNote={'Kolom Stok "—" berarti SKU itu tidak ada di potret stok hari itu — berbeda dari 0 (tercatat kosong).'}
      />
    </div>
  );
}
