'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { DataGrid, type Column } from '@/components/DataGrid';
import { AreaPicker, useArea, labelArea } from '@/components/AreaPicker';
import { AbcChip, Alert, Empty, Kpi, StatusChip, fmt, useApi } from '@/components/ui';
import type { HasilSugestPo } from '@/lib/sugest-po-store';
import type { BarisSugest } from '@/lib/sugest-po-store';

type Resp = HasilSugestPo & { ok: boolean };

/**
 * Keterangan tiap alasan, dalam bahasa orang gudang.
 *
 * Ditulis lengkap, bukan kode mentah seperti `KARTON_LEBIH_DARI_MAX`. Baris PO
 * yang qty-nya 0 TANPA alasan yang terbaca akan dikira kesalahan aplikasi, dan
 * yang terjadi berikutnya selalu sama: orang memesan di luar sistem.
 */
const ALASAN: Record<BarisSugest['alasan'], { teks: string; chip: string }> = {
  OK: { teks: 'Terpenuhi penuh, karton utuh', chip: 'chip-ok' },
  KURANG: { teks: 'Saldo pemasok tidak cukup', chip: 'chip-warn' },
  PECAHAN_TIPIS: { teks: 'Kurang dari 1 karton, tapi stok tipis', chip: 'chip-warn' },
  KOSONG: { teks: 'Saldo pemasok kosong — tetap di-PO', chip: 'chip-bad' },
  TANPA_MAPPING: { teks: 'Belum ada kode SAP — isi sumbernya manual', chip: 'chip-bad' },
  TIDAK_PERLU: { teks: 'Belum perlu dipesan', chip: 'chip-info' },
  TANPA_ISI_KARTON: { teks: 'Isi karton tidak diketahui - dikirim pcs', chip: 'chip-warn' },
  DIBATASI_DOI_MAX: { teks: 'Dibulatkan turun agar tidak lewat batas Aman', chip: 'chip-info' },
  TOLERANSI_DOI_MAX: { teks: 'Lewat batas Aman dalam toleransi karton', chip: 'chip-info' },
  KARTON_LEBIH_DARI_MAX: { teks: 'Karton jauh di atas kebutuhan — tetap dikirim', chip: 'chip-warn' },
};

const kunci = (b: { areaId: string; sku: string }) => `${b.areaId}\u0000${b.sku}`;

const sumberTeks = (b: BarisSugest) =>
  b.ambil.map((a) => `${a.supplierWhs ? `${a.supplierWhs}/` : ''}${a.sapCode} ${a.ctn}x${a.perCtn}`).join(' · ');

export default function SugestPoPage() {
  const { area, setArea, withArea, siap } = useArea();
  const { data, error, loading, reload } = useApi<Resp>(siap ? withArea('/api/sugest-po') : null);
  const [buka, setBuka] = useState<string | null>(null);
  // Rekap per kode sumber disembunyikan secara bawaan (permintaan user 12 Okt
  // 2026). Dengan 229 kode ia jadi dinding chip yang mendorong tabelnya turun.
  const [rekap, setRekap] = useState(false);
  const opsi = data?.opsi ?? 1;
  const fmtDoi = (v: number | null | undefined) =>
    (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(1).replace('.', ','));

  const columns = useMemo<Column<BarisSugest>[]>(() => [
    { key: 'area', label: 'Area', get: (r) => r.areaId, width: 110, isTitle: true },
    { key: 'sku', label: 'SKU', get: (r) => r.sku, mono: true, width: 230,
      render: (r) => <Link className="link" href={`/sku/${encodeURIComponent(r.sku)}`}>{r.sku}</Link> },
    { key: 'name', label: 'Nama', get: (r) => r.name, width: 300, prio: 'p2',
      render: (r) => <span className="text-label" title={r.name}>{r.name}</span> },
    { key: 'abc', label: 'ABC', get: (r) => r.abc ?? '', width: 60,
      render: (r) => <AbcChip cls={(r.abc ?? 'C') as 'A' | 'B' | 'C'} /> },
    { key: 'status', label: 'Status', get: (r) => r.status, width: 110,
      render: (r) => <StatusChip status={r.status} /> },
    // Hanya opsi yang dipilih di Pengaturan, dan nomornya ditulis di judul —
    // tanpa itu, dua orang bisa membandingkan angka dari opsi yang berbeda.
    { key: 'doi', label: `DOI Opsi ${opsi}`, get: (r) => r.doi, type: 'number', mono: true, width: 110,
      title: 'DOI sekarang (stok + SIT) ÷ ADS',
      render: (r) => <span className="mono">{fmtDoi(r.doi)}</span> },
    { key: 'need', label: 'Kebutuhan', get: (r) => r.need, type: 'number', mono: true, width: 110 },
    { key: 'qty', label: 'Qty PO', get: (r) => r.qtyTotal, type: 'number', mono: true, width: 100,
      render: (r) => <b>{fmt(r.qtyTotal)}</b> },
    { key: 'ctn', label: 'Karton', get: (r) => r.ctnTotal, type: 'number', mono: true, width: 90 },
    // DOI SESUDAH barang PO ini masuk.
    //
    // Dibandingkan dengan **batas Aman + lead time**, bukan batas Aman saja.
    // Kebutuhan PO memang dihitung sampai titik itu — Pusat 7 + 1 = 8 — karena
    // angka 7 berlaku saat barang SAMPAI, sementara kolom ini mengukur saat PO
    // DITEKAN. Dibandingkan 7, kolomnya tidak akan pernah bisa hijau walau
    // semuanya tepat (ditanyakan user 12 Okt 2026).
    //
    // Yang benar-benar dijaga di sini: kelebihan DI ATAS titik itu, yang datang
    // dari pembulatan ke karton utuh.
    { key: 'doiAfter', label: 'DOI stlh PO', get: (r) => r.doiSesudah, type: 'number', mono: true, width: 120,
      title: '(stok + SIT + qty PO) ÷ ADS, diukur saat PO ditekan.\n'
        + 'Targetnya batas Aman + lead time cabang — barang belum sampai, jadi hari tunggunya ikut dihitung.\n'
        + 'Merah = melewati target itu, hampir selalu karena pembulatan ke karton utuh.',
      render: (r) => {
        const t = r.targetSesudah;
        const lewat = r.doiSesudah !== null && t !== null && r.doiSesudah > t + 0.05;
        return (
          <span
            className="mono"
            style={lewat ? { color: 'var(--critical)', fontWeight: 600 } : undefined}
            title={r.doiSesudah === null || t === null ? undefined
              : lewat ? `Target ${t} hari (Aman + lead time) — lewat ${fmtDoi(r.doiSesudah - t)} hari`
                : `Target ${t} hari (Aman + lead time) — masih di dalam`}
          >
            {fmtDoi(r.doiSesudah)}
          </span>
        );
      } },
    // KARTON RAKSASA — permintaan user 12 Okt 2026, kolom sendiri bukan cuma
    // keterangan. Terukur di Pusat hari itu: BODY-SERUM-ALOE-VERA butuh 1 pcs
    // tapi karton terkecilnya 24, jadi DOI-nya melonjak ke 21 hari. Tanpa kolom
    // ini lonjakan itu terbaca seperti salah hitung, padahal akibat keputusan
    // "jangan sampai ada barang kosong" (11 Okt 2026).
    { key: 'lipat', label: 'Lipat karton', get: (r) => (r.need > 0 && r.qtyTotal > 0 ? r.qtyTotal / r.need : null),
      type: 'number', mono: true, width: 120, prio: 'p2',
      title: 'Qty PO ÷ kebutuhan. 1x = pas. Lebih dari itu berarti karton terkecilnya memaksa mengirim '
        + 'lebih banyak daripada yang dibutuhkan — tetap dikirim supaya tidak kosong, dan inilah sebab '
        + 'DOI stlh PO bisa jauh di atas target.',
      render: (r) => {
        if (!(r.need > 0) || !(r.qtyTotal > 0)) return <span className="text-muted">-</span>;
        const x = r.qtyTotal / r.need;
        if (x <= 1.05) return <span className="text-muted">1×</span>;
        return (
          <span
            className={`chip ${x >= 2 ? 'chip-bad' : ''}`}
            title={`Kebutuhan ${fmt(r.need)} pcs, dikirim ${fmt(r.qtyTotal)} pcs (${fmt(r.ctnTotal)} karton)`
              + `${x >= 2 ? ' — karton terkecilnya jauh lebih besar dari kebutuhan.' : '.'}`
              + ' Tetap dikirim supaya tidak sampai kosong.'}
          >
            {x >= 10 ? `${Math.round(x)}×` : `${x.toFixed(1).replace('.', ',')}×`}
          </span>
        );
      } },
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
      {d && d.tanpaMapping.length ? (
        <Alert tone="warn">
          <b>{d.tanpaMapping.length} baris belum punya kode SAP</b> ({new Set(d.tanpaMapping.map((x) => x.sku)).size} SKU,{' '}
          {fmt(d.tanpaMapping.reduce((a, x) => a + x.need, 0))} pcs). Barisnya TETAP ada di tabel dan di Excel dengan
          kebutuhannya, hanya kolom gudang &amp; kode SAP-nya kosong — isi manual saat membuat PO, atau lengkapi di{' '}
          <Link className="link" href="/settings">Pengaturan &rarr; Mapping SKU</Link> supaya terisi sendiri lain kali.
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
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="card-title">Rekap per kode sumber ({r.perKode.length} kode)</div>
            <button className="btn btn-sm" onClick={() => setRekap((v) => !v)} aria-expanded={rekap}>
              {rekap ? 'Sembunyikan' : 'Tampilkan'}
            </button>
          </div>
          <div className="text-[12px] text-label">
            Inilah daftar pesanan yang benar-benar dikirim ke gudang pemasok. Tabel di bawah disusun per
            SKU per cabang, tapi PO ke EJI ditulis per <b>kode SAP</b> — satu kode melayani beberapa cabang
            sekaligus, jadi baris-baris di tabel digabung jadi satu angka pesanan di sini.
          </div>
          {!rekap ? null : (
          <div className="mt-2 flex flex-wrap gap-2 text-[12px]">
            {r.perKode.map((k) => (
              <span key={`${k.supplierWhs ?? ''}-${k.sapCode}`} className="chip chip-info mono">
                {k.supplierWhs ? `${k.supplierWhs}/` : ''}{k.sapCode}: {fmt(k.qty)} pcs · {fmt(k.ctn)} ctn
              </span>
            ))}
          </div>
          )}
          {!rekap ? null : (
            <div className="mt-2 text-[12px] text-label">
              Saldo dipakai BERSAMA antar cabang: satu karton tidak pernah dijanjikan ke dua cabang sekaligus.
              Urutan pelayanan saat saldo diperebutkan - Kritis dulu, lalu kelas ABC, lalu DOI terkecil.
            </div>
          )}
        </section>
      ) : null}

      {/* DOI cabang: sekarang vs sesudah SELURUH PO cabang itu masuk, melawan
          targetnya. Angka cabangnya dari ringkasan DOI yang sama dengan
          Dashboard — menjumlahkannya dari baris PO akan salah, karena daftar PO
          cuma memuat SKU Kritis & Low sedangkan DOI cabang dihitung dari
          SELURUH SKU-nya. */}
      {data?.perArea?.length ? (
        <section className="card card-pad">
          <div className="card-title mb-2">DOI cabang setelah open PO</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead><tr className="text-label">
                <th className="py-1 text-left">Cabang</th>
                <th className="num">Baris PO</th>
                <th className="num">Qty PO</th>
                <th className="num">DOI sekarang</th>
                <th className="num">DOI stlh PO</th>
                <th className="num" title="Batas Aman cabang — target untuk DOI SEKARANG">Target</th>
                <th className="num" title="Batas Aman + lead time — target untuk DOI SETELAH PO, karena barangnya belum sampai">+ lead time</th>
                <th className="py-1 text-left">Hasil</th>
              </tr></thead>
              <tbody>
                {data.perArea.map((a) => {
                  // Dibandingkan `targetSesudah` (Aman + lead time), bukan `target`:
                  // alasan panjangnya di `BarisSugest.targetSesudah`.
                  const tS = a.targetSesudah;
                  const lewat = a.doiSesudah !== null && tS !== null && a.doiSesudah > tS + 0.05;
                  return (
                    <tr key={a.areaId}>
                      <td className="py-1"><b>{a.areaId}</b></td>
                      <td className="num mono">{fmt(a.baris)}</td>
                      <td className="num mono">{fmt(a.qtyPo)}</td>
                      <td className="num mono">{fmtDoi(a.doiSekarang)}</td>
                      <td className="num mono"><b>{fmtDoi(a.doiSesudah)}</b></td>
                      <td className="num mono">{a.target ?? '—'}</td>
                      <td className="num mono" title={a.leadTime ? `${a.target} + lead time ${a.leadTime} hari` : 'lead time cabang 0 hari'}>
                        {tS ?? '—'}
                      </td>
                      <td className="py-1">
                        {a.doiSesudah === null || tS === null
                          ? <span className="text-muted">—</span>
                          : <span className={`chip ${lewat ? 'chip-bad' : 'chip-ok'}`}>
                              {lewat ? `lewat ${fmtDoi(a.doiSesudah - tS)} hari` : 'masih dalam target'}
                            </span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-[12px] text-label">
            DOI cabang memakai <b>Opsi {opsi}</b>, sama dengan kolom DOI di tabel. Angka &quot;sesudah&quot;
            menganggap SELURUH qty PO cabang itu sudah masuk gudang — jadi ia batas atas, bukan ramalan
            tanggal.
          </div>
        </section>
      ) : null}

      <section className="card">
        <div className="p-3">
          <DataGrid<BarisSugest>
            id="sugest-po"
            rows={data?.baris ?? []}
            columns={columns}
            rowKey={kunci}
            loading={loading}
            expanded={buka}
            onRowClick={(x) => setBuka(buka === kunci(x) ? null : kunci(x))}
            renderExpanded={(x) => <Rincian b={x} />}
            emptyText="Tidak ada SKU yang menyentuh batas Low di cabang ini."
            footerNote="klik baris = rincian pemecahan per kode sumber"
          />
        </div>
      </section>

      {!loading && !error && !data?.baris.length && d && d.mapping > 0 ? (
        <Empty>Tidak ada saran PO untuk {labelArea(data?.areaId ?? area ?? '')} pada snapshot ini.</Empty>
      ) : null}
    </div>
  );
}

/** Rincian satu baris: pemecahan ke tiap kode sumber, apa adanya. */
function Rincian({ b }: { b: BarisSugest }) {
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
