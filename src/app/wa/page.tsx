'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Poster } from './poster';
import type { AreaWa, DataWa } from './types';
import { KANVAS, WARNA, adsTeks, angkaRingkas, hari, labelDoi, rupiahRingkas, segmenStatus, segmenLain, kunciTampil, labelPita, tampil1, tampil2, type DoiDisplay } from '@/lib/wa-poster';

/**
 * Halaman poster WhatsApp.
 *
 * Jalur untuk bot ada dua, dan keduanya tidak butuh login:
 *   1. GET /api/public/wa/svg?k=…  → berkas SVG, ubah sendiri ke JPG (tanpa browser)
 *   2. buka /wa?k=… lalu tekan tombol "Unduh JPG" (bot berbasis browser)
 *
 * Halaman ini juga untuk manusia: klik kartu area membuka rincian yang tidak
 * muat di gambar.
 */
const fmt = (n: number) => n.toLocaleString('id-ID');

function Rincian({ a, disp, tampil, onTutup }: {
  a: AreaWa; disp: DoiDisplay;
  /** Status yang ditampilkan — dihitung lintas area, sama dengan posternya. */
  tampil: ReturnType<typeof kunciTampil>;
  onTutup: () => void;
}) {
  const seg = segmenStatus(a.byStatus, tampil);
  const lain = segmenLain(a.byStatus, tampil);
  // Pembaginya SELURUH SKU, bukan hanya empat pita — kalau tidak, "Aman"
  // terlihat hampir 100% padahal masih ada SKU di kelompok keterangan.
  const total = [...seg, ...lain].reduce((t, s) => t + s.n, 0) || 1;

  // ESC menutup — dialog tanpa ini memerangkap orang yang memakai papan ketik.
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') onTutup(); };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [onTutup]);

  return (
    <div className="wa-backdrop" role="dialog" aria-modal="true" aria-label={`Rincian ${a.area}`} onClick={onTutup}>
      <div className="wa-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="wa-sheet-head">
          <div>
            <div className="text-[20px] font-bold text-ink">{a.area}</div>
            <div className="text-[12px] text-label">Snapshot {a.snapshotDate ?? '—'} · {fmt(a.sku)} SKU dihitung</div>
          </div>
          <button className="btn btn-sm" onClick={onTutup} aria-label="Tutup rincian">Tutup</button>
        </div>

        <div className="wa-sheet-body">
          <div className="kpi-grid">
            {tampil1(disp) ? <div className="card card-pad"><div className="kpi-label">{labelDoi(1, disp)}</div><div className="kpi-value">{hari(a.doi1)}<span className="ml-1 text-[13px] font-medium text-label">hari</span></div></div> : null}
            {tampil2(disp) ? <div className="card card-pad"><div className="kpi-label">{labelDoi(2, disp)}</div><div className="kpi-value">{hari(a.doi2)}<span className="ml-1 text-[13px] font-medium text-label">hari</span></div></div> : null}
            <div className="card card-pad"><div className="kpi-label">{`ADS ${tampil1(disp) ? 'Opsi 1' : 'Opsi 2'}`}</div><div className="kpi-value">{adsTeks(tampil1(disp) ? a.ads1 : a.ads2).replace('/hari', '')}<span className="ml-1 text-[13px] font-medium text-label">/hari</span></div></div>
            <div className="card card-pad"><div className="kpi-label">Dalam perjalanan</div><div className="kpi-value">{angkaRingkas(a.transit)}</div><div className="kpi-hint">tidak menambah DOI total</div></div>
            <div className="card card-pad"><div className="kpi-label">Nilai stok</div><div className="kpi-value">{rupiahRingkas(a.value)}</div><div className="kpi-hint">stok di tangan saja{a.noPrice ? ` · ${a.noPrice} SKU belum ada harganya` : ''}</div></div>
            <div className="card card-pad"><div className="kpi-label">Nilai + Nilai SIT</div><div className="kpi-value">{rupiahRingkas(a.value + a.valueTransit)}</div><div className="kpi-hint">termasuk {rupiahRingkas(a.valueTransit)} dalam perjalanan</div></div>
          </div>

          <div className="card card-pad">
            <div className="card-title mb-2">Sebaran status</div>
            {seg.map((s) => (
              <div key={s.key} className="mb-1.5 flex items-center gap-2">
                <span className="w-[96px] text-[12px]" title={s.label}>{labelPita(s.key, a.ambang)}</span>
                <span className="h-2 flex-1 rounded-full" style={{ background: 'var(--border-subtle)' }}>
                  <span className="block h-2 rounded-full" style={{ width: `${(s.n / total) * 100}%`, background: s.warna }} />
                </span>
                <span className="w-[52px] text-right text-[12px] font-semibold tabular-nums">{fmt(s.n)}</span>
              </div>
            ))}
            {/* Enam keterangan: batang yang SAMA. Batangnya porsi dari total SKU,
                dan setiap SKU punya tepat satu status — jadi kesepuluhnya potongan
                dari satu keseluruhan yang sama. Dipisah garis, bukan dibedakan
                bentuknya. (Di layar tidak ada batas tinggi seperti di poster.) */}
            <div
              className={lain.length && seg.length ? 'mt-2 border-t pt-2' : ''}
              style={lain.length && seg.length ? { borderColor: 'var(--border-subtle)' } : undefined}
            >
              {lain.map((s) => (
                <div key={s.key} className="mb-1.5 flex items-center gap-2">
                  <span className="w-[76px] text-[12px]">{s.label}</span>
                  <span className="h-2 flex-1 rounded-full" style={{ background: 'var(--border-subtle)' }}>
                    <span className="block h-2 rounded-full" style={{ width: `${(s.n / total) * 100}%`, background: s.warna }} />
                  </span>
                  <span className="w-[52px] text-right text-[12px] font-semibold tabular-nums">{fmt(s.n)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card card-pad">
            <div className="card-title mb-2">SKU paling mendesak</div>
            {a.kritis.length ? (
              <ul className="space-y-2">
                {a.kritis.map((r) => (
                  <li key={r.sku} className="flex items-start gap-2">
                    <span className="mt-1 h-3 w-[3px] flex-none rounded-sm" style={{ background: r.status === 'CRITICAL' ? WARNA.kritisSolid : WARNA.lowSolid }} />
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold">{r.sku}</div>
                      <div className="text-[12px] text-label">{r.name}</div>
                      <div className="text-[12px]" style={{ color: r.status === 'CRITICAL' ? WARNA.kritisFg : WARNA.lowFg }}>
                        DOI {hari(r.doi)} hari{r.sug > 0 ? ` · saran PO ${fmt(r.sug)} pcs` : ''}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <div className="text-[13px] text-label">Tidak ada SKU kritis di area ini.</div>}
          </div>

          <div className="card card-pad">
            <div className="card-title mb-2">{`Tren ${labelDoi(tampil1(disp) ? 1 : 2, disp)}`}</div>
            {a.tren.length ? (
              <div className="text-[12px] text-label">
                {a.tren.length} hari tercatat · terlama {a.tren[0]?.date} ({hari(tampil1(disp) ? a.tren[0]?.doi1 : a.tren[0]?.doi2)}) · terbaru {a.tren[a.tren.length - 1]?.date} ({hari(tampil1(disp) ? a.tren[a.tren.length - 1]?.doi1 : a.tren[a.tren.length - 1]?.doi2)})
              </div>
            ) : <div className="text-[12px] text-label">Riwayat belum cukup.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function WaPage() {
  const [data, setData] = useState<DataWa | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pilih, setPilih] = useState<string | null>(null);
  const [unduh, setUnduh] = useState<'idle' | 'proses' | 'gagal'>('idle');

  const kunci = useMemo(() => (typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('k') ?? ''), []);
  /**
   * `?bare=1` — mode untuk bot penangkap layar.
   *
   * Halaman jadi PERSIS 1600×900: tanpa padding, tanpa baris tombol di bawah,
   * tanpa popup. Bot cukup `setViewport({width:1600,height:900})` lalu
   * `page.screenshot()` — tidak perlu mencari elemen, tidak perlu memotong, dan
   * ukurannya tidak berubah kalau tata letak halaman diubah nanti.
   */
  const bare = useMemo(() => (typeof window === 'undefined' ? false : new URLSearchParams(window.location.search).get('bare') === '1'), []);

  useEffect(() => {
    let alive = true;
    fetch(`/api/public/wa?k=${encodeURIComponent(kunci)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!alive) return;
        if (!r.ok || j.ok === false) setError(j.error || `HTTP ${r.status}`);
        else setData(j as DataWa);
      })
      .catch((e) => alive && setError(String(e)));
    return () => { alive = false; };
  }, [kunci]);

  /**
   * SVG → canvas → JPG, tanpa pustaka.
   *
   * SVG-nya diserialkan dari DOM apa adanya, jadi berkas yang diunduh persis
   * sama dengan yang terlihat. Canvas TIDAK ternoda karena data URL-nya tidak
   * memuat sumber luar sama sekali — tidak ada gambar, tidak ada webfont.
   */
  const unduhJpg = useCallback(() => {
    const svg = document.getElementById('wa-poster');
    if (!svg) return;
    setUnduh('proses');
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = KANVAS.w; c.height = KANVAS.h;
      const ctx = c.getContext('2d');
      if (!ctx) { setUnduh('gagal'); return; }
      // JPG tidak mengenal transparan — tanpa alas ini bagian kosong jadi hitam.
      ctx.fillStyle = WARNA.kanvas;
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, KANVAS.w, KANVAS.h);
      c.toBlob((b) => {
        if (!b) { setUnduh('gagal'); return; }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = `doi-${data?.snapshotDate ?? 'harian'}.jpg`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5_000);
        setUnduh('idle');
      }, 'image/jpeg', 0.92);
    };
    img.onerror = () => setUnduh('gagal');
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  }, [data]);

  if (error) {
    return (
      <div className="wa-pesan">
        <div className="card card-pad" style={{ maxWidth: 520 }}>
          <div className="card-title">Poster tidak bisa dibuka</div>
          <p className="mt-2 text-[13px] text-label">{error}</p>
          <p className="mt-2 text-[12px] text-label">
            Halaman ini dibuka dengan <code>?k=&lt;token&gt;</code>. Tokennya diatur lewat environment
            variable <code>WA_PAGE_TOKEN</code> di server dan di Vercel.
          </p>
        </div>
      </div>
    );
  }
  if (!data) return <div className="wa-pesan"><div className="text-[13px] text-label">Memuat…</div></div>;

  const areaTerpilih = data.areas.find((a) => a.area === pilih) ?? null;

  if (bare) {
    // `data-siap` adalah tanda bagi bot: tunggu selector ini, bukan timer.
    // networkidle saja tidak cukup — datanya diambil setelah halaman siap.
    return (
      <div className="wa-root is-bare" data-siap="1">
        <div className="wa-canvas"><Poster data={data} /></div>
      </div>
    );
  }

  return (
    <div className="wa-root" data-siap="1">
      <div className="wa-canvas">
        <Poster data={data} onPilihArea={setPilih} />
      </div>
      <div className="wa-bar">
        <span className="text-[12px] text-label">Klik kartu area untuk rincian · gambar {KANVAS.w}×{KANVAS.h}</span>
        <button className="btn btn-sm btn-primary" onClick={unduhJpg} disabled={unduh === 'proses'}>
          {unduh === 'proses' ? 'Menyiapkan…' : unduh === 'gagal' ? 'Gagal — coba lagi' : 'Unduh JPG'}
        </button>
      </div>
      {areaTerpilih ? (
        <Rincian
          a={areaTerpilih}
          disp={data.doiDisplay ?? 'BOTH'}
          tampil={kunciTampil(data.areas.map((x) => x.byStatus))}
          onTutup={() => setPilih(null)}
        />
      ) : null}
    </div>
  );
}
