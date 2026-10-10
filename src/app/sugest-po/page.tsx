'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { DataGrid, type Column } from '@/components/DataGrid';
import { AreaPicker, useArea, labelArea } from '@/components/AreaPicker';
import { AbcChip, Alert, Empty, Kpi, StatusChip, fmt, useApi } from '@/components/ui';
import type { HasilSugestPo } from '@/lib/sugest-po-store';
import type { HasilOpenPo } from '@/lib/openpo';

type Resp = HasilSugestPo & { ok: boolean };

/**
 * Keterangan tiap alasan, dalam bahasa orang gudang.
 *
 * Ditulis lengkap, bukan kode mentah seperti `KARTON_LEBIH_DARI_MAX`. Baris PO
 * yang qty-nya 0 TANPA alasan yang terbaca akan dikira kesalahan aplikasi, dan
 * yang terjadi berikutnya selalu sama: orang memesan di luar sistem.
 */
const ALASAN: Record<HasilOpenPo['alasan'], { teks: string; chip: string }> = {
  OK: { teks: 'Terpenuhi penuh, karton utuh', chip: 'chip-ok' },
  KURANG: { teks: 'Saldo pemasok tidak cukup', chip: 'chip-warn' },
  PECAHAN_TIPIS: { teks: 'Kurang dari 1 karton, tapi stok tipis', chip: 'chip-warn' },
  KOSONG: { teks: 'Saldo pemasok kosong', chip: 'chip-bad' },
  TIDAK_PERLU: { teks: 'Belum perlu dipesan', chip: 'chip-info' },
  TANPA_ISI_KARTON: { teks: 'Isi karton tidak diketahui - dikirim pcs', chip: 'chip-warn' },
  DIBATASI_DOI_MAX: { teks: 'Dibulatkan turun agar tidak lewat batas Aman', chip: 'chip-info' },
  TOLERANSI_DOI_MAX: { teks: 'Lewat batas Aman dalam toleransi karton', chip: 'chip-info' },
  KARTON_LEBIH_DARI_MAX: { teks: '1 karton saja sudah jauh di atas kebutuhan', chip: 'chip-warn' },
};

const kunci = (b: { areaId: string; sku: string }) => `${b.areaId}\u0000${b.sku}`;

const sumberTeks = (b: HasilOpenPo) =>
  b.ambil.map((a) => `${a.supplierWhs ? `${a.supplierWhs}/` : ''}${a.sapCode} ${a.ctn}x${a.perCtn}`).join(' · ');

export default function SugestPoPage() {
  const { area, setArea, withArea, siap } = useArea();
  const { data, error, loading, reload } = useApi<Resp>(siap ? withArea('/api/sugest-po') : null);
  const [buka, setBuka] = useState<string | null>(null);

  const columns = useMemo<Column<HasilOpenPo>[]>(() => [
    { key: 'area', label: 'Area', get: (r) => r.areaId, width: 110, isTitle: true },
    { key: 'sku', label: 'SKU', get: (r) => r.sku, mono: true, width: 230,
      render: (r) => <Link className="link" href={`/sku/${encodeURIComponent(r.sku)}`}>{r.sku}</Link> },
    { key: 'name', label: 'Nama', get: (r) => r.name, width: 300, prio: 'p2',
      render: (r) => <span className="text-label" title={r.name}>{r.name}</span> },
    { key: 'abc', label: 'ABC', get: (r) => r.abc ?? '', width: 60,
      render: (r) => <AbcChip cls={(r.abc ?? 'C') as 'A' | 'B' | 'C'} /> },
    { key: 'status', label: 'Status', get: (r) => r.status, width: 110,
      render: (r) => <StatusChip status={r.status} /> },
    { key: 'doi', label: 'DOI', get: (r) => r.doi, type: 'number', mono: true, width: 80 },
    { key: 'need', label: 'Kebutuhan', get: (r) => r.need, type: 'number', mono: true, width: 110 },
    { key: 'qty', label: 'Qty PO', get: (r) => r.qtyTotal, type: 'number', mono: true, width: 100,
      render: (r) => <b>{fmt(r.qtyTotal)}</b> },
    { key: 'ctn', label: 'Karton', get: (r) => r.ctnTotal, type: 'number', mono: true, width: 90 },
    { key: 'kurang', label: 'Kurang', get: (r) => r.kurang, type: 'number', mono: true, width: 100,
      render: (r) => (r.kurang > 0 ? <span style={{ color: 'var(--critical)' }}>{fmt(r.kurang)}</span> : <span className="text-muted">-</span>) },
    { key: 'sumber', label: 'Sumber', get: (r) => sumberTeks(r), width: 260, prio: 'p2',
      render: (r) => <span className="mono text-[11px]">{sumberTeks(r) || '-'}</span> },
    { key: 'alasan', label: 'Alasan', get: (r) => ALASAN[r.alasan].teks, width: 240, prio: 'p3',
      render: (r) => <span className={`chip ${ALASAN[r.alasan].chip}`}>{ALASAN[r.alasan].teks}</span> },
  ], []);

  const d = data?.diagnosa;
  const r = data?.ringkas;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Sugest PO</h1>
          <div className="mt-1 text-[12px] text-label">
            Saran open PO per cabang: SKU yang DOI-nya sudah menyentuh batas <b>Low</b>, diisi sampai penuh
            ke batas <b>Aman</b> cabangnya, lalu dipecah ke kode SAP dalam karton utuh menurut saldo gudang pemasok.
            {data?.snapshotDate ? <> Snapshot <b>{data.snapshotDate}</b>.</> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AreaPicker areas={data?.areas ?? []} value={data?.areaId ?? area} onChange={setArea} />
          <button className="btn btn-sm" onClick={reload} disabled={loading}>{loading ? 'Memuat...' : 'Muat ulang'}</button>
          <a className="btn btn-sm btn-primary" href={withArea('/api/sugest-po/export')}>Export Excel</a>
        </div>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {/* Dua keadaan yang membuat halaman ini TIDAK BISA menyarankan apa pun.
          Keduanya ditulis sebagai instruksi, bukan sebagai tabel kosong - tabel
          kosong terbaca sebagai "tidak ada yang perlu dipesan", yang artinya
          justru berlawanan. */}
      {d && d.mapping === 0 ? (
        <Alert tone="warn">
          <b>Mapping SKU masih kosong.</b> Sugest PO perlu tahu satu SKU OCS itu kode SAP yang mana dan isi
          kartonnya berapa - tanpa itu tidak ada baris yang bisa dipesan. Buka{' '}
          <Link className="link" href="/settings">Pengaturan &rarr; Mapping SKU</Link> lalu tekan{' '}
          <b>&quot;Lihat usulan dari 6 digit&quot;</b>, periksa usulannya, dan simpan.
        </Alert>
      ) : null}
      {d && d.mapping > 0 && d.saldo === 0 ? (
        <Alert tone="warn">
          <b>Saldo gudang pemasok belum pernah ditarik.</b> Tabel <span className="mono">supplier_stock</span> kosong,
          jadi setiap baris akan berbunyi &quot;Stock GBJD Kosong&quot; - itu bukan keadaan gudang yang sebenarnya.
          Jalankan <code>npm run sync:supplier</code> di server yang bisa menjangkau <span className="mono">web.eji.co.id</span>.
        </Alert>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Baris PO" value={fmt(r?.baris ?? 0)} unit="baris" hint={`${fmt(r?.sku ?? 0)} SKU kebagian barang`} />
        <Kpi label="Total qty" value={fmt(r?.qtyTotal ?? 0)} unit="pcs" hint={`${fmt(r?.ctnTotal ?? 0)} karton`} />
        <Kpi label="Kurang" value={fmt(r?.kurang ?? 0)} unit="pcs" tone={r && r.kurang > 0 ? 'var(--critical-solid)' : undefined}
          hint="kebutuhan yang tidak tertutup saldo" />
        <Kpi label="Saldo kosong" value={fmt(r?.kosong ?? 0)} unit="baris" hint="kodenya ada, saldonya 0" />
        <Kpi label="Gudang pemasok" value={(d?.gudang ?? []).join(' > ') || '-'}
          hint={d?.saldoPada ? `saldo ditarik ${new Date(d.saldoPada).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}` : 'belum pernah ditarik'} />
      </section>

      {r && r.perKode.length ? (
        <section className="card card-pad">
          <div className="card-title mb-2">Rekap per kode sumber</div>
          <div className="flex flex-wrap gap-2 text-[12px]">
            {r.perKode.map((k) => (
              <span key={`${k.supplierWhs ?? ''}-${k.sapCode}`} className="chip chip-info mono">
                {k.supplierWhs ? `${k.supplierWhs}/` : ''}{k.sapCode}: {fmt(k.qty)} pcs · {fmt(k.ctn)} ctn
              </span>
            ))}
          </div>
          <div className="mt-2 text-[12px] text-label">
            Saldo dipakai BERSAMA antar cabang: satu karton tidak pernah dijanjikan ke dua cabang sekaligus.
            Urutan pelayanan saat saldo diperebutkan - Kritis dulu, lalu kelas ABC, lalu DOI terkecil.
          </div>
        </section>
      ) : null}

      <section className="card">
        <div className="p-3">
          <DataGrid<HasilOpenPo>
            id="sugest-po"
            rows={data?.baris ?? []}
            columns={columns}
            rowKey={kunci}
            loading={loading}
            expanded={buka}
            onRowClick={(x) => setBuka(buka === kunci(x) ? null : kunci(x))}
            renderExpanded={(x) => <Rincian b={x} />}
            emptyText={d && d.mapping === 0
              ? 'Belum bisa menyarankan apa pun - mapping SKU masih kosong (lihat peringatan di atas).'
              : 'Tidak ada SKU yang menyentuh batas Low di cabang ini.'}
            footerNote="klik baris = rincian pemecahan per kode sumber"
          />
        </div>
      </section>

      {d && d.tanpaMapping.length ? (
        <section className="card card-pad">
          <div className="card-title mb-1">Perlu dipesan, tapi belum ada mapping ({d.tanpaMapping.length})</div>
          <div className="mb-2 text-[12px] text-label">
            SKU ini sudah menyentuh batas Low, tapi belum punya kode SAP di Mapping SKU - jadi tidak bisa
            masuk daftar PO. Sengaja ditampilkan di sini: kalau cuma dilewati, orang gudang akan mengira
            memang belum perlu dipesan.
          </div>
          <div className="flex flex-wrap gap-2 text-[12px]">
            {d.tanpaMapping.map((x) => (
              <span key={`${x.areaId}-${x.sku}`} className="chip chip-warn">
                <span className="mono">{x.sku}</span> · {x.areaId} · butuh {fmt(x.need)} pcs
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {!loading && !error && !data?.baris.length && d && d.mapping > 0 ? (
        <Empty>Tidak ada saran PO untuk {labelArea(data?.areaId ?? area ?? '')} pada snapshot ini.</Empty>
      ) : null}
    </div>
  );
}

/** Rincian satu baris: pemecahan ke tiap kode sumber, apa adanya. */
function Rincian({ b }: { b: HasilOpenPo }) {
  return (
    <div className="p-3 text-[12px]">
      <div className="mb-2">
        Kebutuhan <b>{fmt(b.need)} pcs</b> · terpenuhi <b>{fmt(b.qtyTotal)} pcs</b> ({fmt(b.ctnTotal)} karton)
        {b.kurang > 0 ? <> · kurang <b style={{ color: 'var(--critical)' }}>{fmt(b.kurang)} pcs</b></> : null}
      </div>
      {b.keterangan ? <div className="mb-2 text-label">{b.keterangan}</div> : null}
      {b.ambil.length ? (
        <table className="w-full">
          <thead><tr className="text-label">
            <th className="py-1 text-left">Gudang</th><th className="py-1 text-left">Kode SAP</th>
            <th className="num">Isi/karton</th><th className="num">Karton</th><th className="num">Qty</th>
          </tr></thead>
          <tbody>
            {b.ambil.map((a) => (
              <tr key={`${a.supplierWhs ?? ''}-${a.sapCode}`}>
                <td className="py-1 mono">{a.supplierWhs ?? '-'}</td>
                <td className="mono">{a.sapCode}</td>
                <td className="num mono">{fmt(a.perCtn)}</td>
                <td className="num mono">{fmt(a.ctn)}</td>
                <td className="num mono"><b>{fmt(a.qty)}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <div className="text-label">Tidak ada kode sumber yang bisa dipakai.</div>}
    </div>
  );
}
