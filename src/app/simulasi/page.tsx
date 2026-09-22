'use client';
import { useMemo, useState } from 'react';
import { AbcChip, Alert, Empty, StatusChip, fmt, fmtDoi, useApi } from '@/components/ui';
import { DataGrid, type Column } from '@/components/DataGrid';
import { ABC, type AbcClass, type SimPick, type SimResult } from '@/lib/simulate';

type Resp = {
  ok: boolean; snapshotDate: string | null; computedAt: string | null;
  settings: { doiDisplay: string; targetDoiDays: number; areaScope: string };
  params: { opsi: 1 | 2; targetDoi: number; classes: AbcClass[]; floorDays: Record<AbcClass, number>; excludePhaseOut: boolean; order: string };
  saranLantai: number | null;
  hasil: SimResult;
};

const ORDER_LABEL: Record<string, string> = {
  QTY: 'Kelebihan terbesar dulu — paling sedikit SKU disentuh',
  DOI: 'DOI tertinggi dulu — yang paling lama mengendap',
  PROPORSIONAL: 'Merata — semua SKU kena sedikit-sedikit',
};

export default function SimulasiPage() {
  const [target, setTarget] = useState(7);
  const [classes, setClasses] = useState<AbcClass[]>(['B', 'C']);
  const [floors, setFloors] = useState<Record<AbcClass, number>>({ A: 7, B: 7.5, C: 7.5 });
  const [withPhaseOut, setWithPhaseOut] = useState(false);
  const [order, setOrder] = useState<'QTY' | 'DOI' | 'PROPORSIONAL'>('QTY');
  const [opsi, setOpsi] = useState<1 | 2>(1);

  const qs = useMemo(() => new URLSearchParams({
    target: String(target),
    classes: classes.join(','),
    floorA: String(floors.A), floorB: String(floors.B), floorC: String(floors.C),
    phaseOut: withPhaseOut ? '1' : '0',
    order, opsi: String(opsi),
  }).toString(), [target, classes, floors, withPhaseOut, order, opsi]);

  const { data, error, loading } = useApi<Resp>(`/api/simulate?${qs}`);
  const h = data?.hasil;
  const saran = data?.saranLantai ?? null;

  const toggleClass = (c: AbcClass) =>
    setClasses((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c].sort()));

  const pakaiSaran = () => { if (saran !== null) setFloors({ A: saran, B: saran, C: saran }); };

  const columns = useMemo<Column<SimPick>[]>(() => [
    { key: 'sku', label: 'SKU', get: (r) => r.sku, mono: true, width: 250, sticky: true, isTitle: true,
      render: (r) => <span className="font-semibold" title={r.name ?? undefined}>{r.sku}</span> },
    { key: 'abc', label: 'ABC', get: (r) => r.abcClass, width: 64, render: (r) => <AbcChip cls={r.abcClass} /> },
    { key: 'status', label: 'Status', get: (r) => r.status, width: 130, render: (r) => <StatusChip status={r.status} /> },
    { key: 'stock', label: 'Stok sekarang', get: (r) => r.stock, type: 'number', mono: true, width: 130 },
    { key: 'ads', label: `ADS Opsi ${data?.params.opsi ?? 1}`, get: (r) => r.ads, type: 'number', mono: true, width: 120,
      render: (r) => fmt(r.ads, 1) },
    { key: 'doi', label: 'DOI sekarang', get: (r) => r.doi, type: 'number', mono: true, width: 125,
      render: (r) => fmtDoi(r.doi) },
    { key: 'cut', label: 'POTONG (pcs)', get: (r) => r.cut, type: 'number', mono: true, width: 140,
      title: 'Qty yang harus keluar dari gudang — jual, diskon, bundling, retur, atau write-off',
      render: (r) => <b className="text-negative">{fmt(r.cut)}</b> },
    { key: 'keep', label: 'Sisakan (pcs)', get: (r) => r.keep, type: 'number', mono: true, width: 130,
      title: 'Batas bawah menurut lantai kelasnya' },
    { key: 'after', label: 'Stok sesudah', get: (r) => r.stockAfter, type: 'number', mono: true, width: 125, prio: 'p2' },
    { key: 'doiafter', label: 'DOI sesudah', get: (r) => r.doiAfter, type: 'number', mono: true, width: 120, prio: 'p2',
      render: (r) => fmtDoi(r.doiAfter) },
    { key: 'floor', label: 'Sisakan (hari)', get: (r) => r.floorDays, type: 'number', mono: true, width: 130, prio: 'p3' },
    { key: 'sap', label: 'SAP', get: (r) => r.sapCode, mono: true, width: 110, prio: 'p3' },
    { key: 'name', label: 'Nama', get: (r) => r.name, width: 280, prio: 'p3' },
  ], [data]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Simulasi Target DOI</h1>
        <div className="mt-1 text-[12.5px] text-label">
          Tentukan target DOI total, lalu lihat SKU mana yang stoknya harus dikurangi dan berapa banyak.
          Mengurangi stok tidak mengubah ADS, jadi target stok = target hari × ADS total.
        </div>
      </div>

      <section className="card card-pad space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="label" htmlFor="f-target">Target DOI total (hari)</label>
            <input id="f-target" className="input" style={{ width: 150 }} type="number" min={0} step={0.5} value={target}
              onChange={(e) => setTarget(Math.max(0, Number(e.target.value) || 0))} />
          </div>
          <div>
            <span className="label">Kelas yang boleh dikurangi</span>
            <div className="flex items-center gap-3 pt-1">
              {ABC.map((c) => (
                <label key={c} className="flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" checked={classes.includes(c)} onChange={() => toggleClass(c)} /> {c}
                </label>
              ))}
            </div>
          </div>
          {data?.settings.doiDisplay === 'BOTH' ? (
            <div>
              <label className="label" htmlFor="f-opsi">Basis ADS</label>
              <select id="f-opsi" className="input" style={{ width: 130 }} value={opsi}
                onChange={(e) => setOpsi(Number(e.target.value) === 2 ? 2 : 1)}>
                <option value={1}>Opsi 1</option>
                <option value={2}>Opsi 2</option>
              </select>
            </div>
          ) : null}
          <div>
            <label className="label" htmlFor="f-order">Urutan pemotongan</label>
            <select id="f-order" className="input" style={{ width: 340 }} value={order}
              onChange={(e) => setOrder(e.target.value as 'QTY' | 'DOI' | 'PROPORSIONAL')}>
              {Object.entries(ORDER_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-[13px]" title="Kalau dicentang, stok & penjualan phase out ikut dihitung di DOI total">
            <input type="checkbox" checked={withPhaseOut} onChange={(e) => setWithPhaseOut(e.target.checked)} />
            Ikutkan Phase Out
          </label>
        </div>

        <div className="flex flex-wrap items-end gap-4 border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
          <span className="label mb-0 self-center">Sisakan minimal (hari) per kelas</span>
          {ABC.map((c) => (
            <div key={c}>
              <label className="label" htmlFor={`f-floor-${c}`}>Kelas {c}</label>
              <input id={`f-floor-${c}`} className="input" style={{ width: 110 }} type="number" min={0} step={0.5}
                disabled={!classes.includes(c)} value={floors[c]}
                onChange={(e) => setFloors((p) => ({ ...p, [c]: Math.max(0, Number(e.target.value) || 0) }))} />
            </div>
          ))}
          {saran !== null ? (
            <button className="btn btn-sm" onClick={pakaiSaran}>
              Pakai saran: {fmt(saran, 1)} hari
            </button>
          ) : null}
          <span className="text-[12px] text-label">
            SKU yang stoknya sudah di bawah batas ini tidak akan disentuh.
          </span>
        </div>
      </section>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {loading && !data ? <Empty>Menghitung…</Empty> : null}

      {h ? (
        <>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(12rem,1fr))' }}>
            <Tile k="DOI sekarang" v={`${fmtDoi(h.doiBefore)} hari`} h={`${fmt(h.stockBefore)} pcs · ${fmt(h.skuCount)} SKU`} />
            <Tile k="DOI sesudah" v={`${fmtDoi(h.doiAfter)} hari`} h={`target ${fmt(data?.params.targetDoi, 1)} hari`}
              tone={h.feasible ? 'text-positive' : 'text-negative'} />
            <Tile k="Harus dikeluarkan" v={fmt(h.need)} h="pcs, supaya target tercapai" />
            <Tile k="Dipotong simulasi ini" v={fmt(h.cutTotal)} h={`${fmt(h.picks.length)} SKU disentuh`} tone="text-negative" />
            <Tile k="Bisa dipotong maksimal" v={fmt(h.cuttable)} h="pcs, tanpa menembus batas bawah" />
            <Tile k="Phase Out" v={fmt(h.phaseOut.stock)} h={`${fmt(h.phaseOut.count)} SKU · ${data?.params.excludePhaseOut ? 'tidak dihitung' : 'ikut dihitung'}`} />
          </div>

          {!h.feasible ? (
            <Alert tone="warn">
              <b>Target {fmt(data?.params.targetDoi, 1)} hari belum tercapai.</b> Seluruh kelebihan di kelas {classes.join(' & ')} sudah
              dipotong sampai batas bawah, tapi masih kurang <b>{fmt(h.shortfall)} pcs</b> — DOI berhenti di {fmtDoi(h.doiAfter)} hari.
              Pilihannya: turunkan angka <i>sisakan minimal</i>, ikutkan kelas lain, atau naikkan targetnya.
            </Alert>
          ) : h.need === 0 ? (
            <Alert tone="ok">DOI sekarang sudah di bawah target — tidak ada stok yang perlu dikurangi.</Alert>
          ) : null}

          <section className="card card-pad">
            <div className="card-title mb-3">Rincian per kelas</div>
            <div className="table-scroll">
              <table className="dgrid dgrid-auto">
                <thead><tr>
                  <th>Kelas</th><th className="num">SKU</th><th className="num">Stok</th><th className="num">ADS</th>
                  <th className="num">DOI</th><th className="num">Dipotong</th><th className="num">SKU disentuh</th><th className="num">Sisa stok</th>
                </tr></thead>
                <tbody>
                  {ABC.map((c) => {
                    const k = h.byClass[c];
                    if (!k.skuCount) return null;
                    return (
                      <tr key={c}>
                        <td>
                          <AbcChip cls={c} />
                          {!classes.includes(c)
                            ? <span className="ml-2 text-[11px] text-label" title="Kelas ini tidak dicentang, jadi stoknya tidak ikut dipotong">dikunci</span>
                            : null}
                        </td>
                        <td className="num">{fmt(k.skuCount)}</td>
                        <td className="num">{fmt(k.stock)}</td>
                        <td className="num">{fmt(k.ads, 1)}</td>
                        <td className="num">{fmtDoi(k.doi)}</td>
                        <td className="num">{k.cut ? <b className="text-negative">{fmt(k.cut)}</b> : <span className="empty">—</span>}</td>
                        <td className="num">{k.touched ? fmt(k.touched) : <span className="empty">—</span>}</td>
                        <td className="num">{fmt(k.stock - k.cut)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <DataGrid<SimPick>
            id="simulasi"
            rows={h.picks}
            columns={columns}
            rowKey={(r) => r.sku}
            loading={loading}
            emptyText="Tidak ada SKU yang perlu dipotong dengan parameter ini."
            footerNote={`snapshot ${data?.snapshotDate ?? '—'} · area ${data?.settings.areaScope ?? '—'} · klik ganda sel = salin`}
            toolbarExtra={<a className="btn btn-primary btn-sm" href={`/api/simulate/export?${qs}`}>Export XLSX</a>}
          />

          <div className="text-[12px] text-label">
            Cara baca: target stok = {fmt(data?.params.targetDoi, 1)} hari × ADS total {fmt(h.adsTotal, 1)} = {fmt(h.targetStock)} pcs.
            Stok sekarang {fmt(h.stockBefore)} pcs, jadi {fmt(h.need)} pcs harus keluar. Tiap SKU hanya boleh dipotong sebatas
            kelebihannya di atas <i>sisakan minimal</i>, sehingga simulasi tidak pernah menyarankan memotong SKU yang stoknya sudah tipis.
            Kolom POTONG adalah qty yang harus keluar dari gudang — lewat penjualan, diskon, bundling, retur ke principal, atau write-off;
            aplikasi ini tidak mengubah stok apa pun.
          </div>
        </>
      ) : null}
    </div>
  );
}

function Tile({ k, v, h, tone }: { k: string; v: React.ReactNode; h?: React.ReactNode; tone?: string }) {
  return (
    <div className="stat-tile">
      <div className="k">{k}</div>
      <div className={`v ${tone ?? ''}`}>{v}</div>
      {h ? <div className="h">{h}</div> : null}
    </div>
  );
}
