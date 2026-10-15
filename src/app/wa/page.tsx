'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Poster } from './poster';
import type { AreaWa, DataWa } from './types';
import { persenTeks as persenAtp, type RincianArea, type GrupRincian } from '@/lib/atp';
import { KANVAS, tinggiKanvas, WARNA, adsTeks, angkaRingkas, hari, labelDoi, rupiahRingkas, segmenStatus, segmenLain, kunciTampil, labelPita, tampil1, tampil2, type DoiDisplay } from '@/lib/wa-poster';

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

/**
 * Rincian ATP satu cabang — "angka ini dari mana".
 *
 * Permintaan user 12 Okt 2026: angka ATP di poster bisa diklik dan memperlihatkan
 * mana yang ikut hitungan, mana yang tidak, DAN kenapa yang tidak itu tidak
 * dihitung. Sebelum ini persennya benar tapi tidak bisa diperiksa dari layar;
 * satu-satunya cara membuktikannya adalah membaca kode.
 *
 * Ditarik SAAT DIBUKA, bukan ikut data poster: daftarnya ribuan baris sementara
 * poster harus tetap ringan — ia juga dipakai bot WhatsApp yang cuma memotret
 * gambar.
 */
function RincianAtp({ area, ambang, autoBuka }: { area: string; ambang: number; autoBuka: boolean }) {
  const [buka, setBuka] = useState(autoBuka);
  const kotak = useRef<HTMLDivElement>(null);

  /*
    DIGULIRKAN KE TAMPILAN. Tanpa ini fiturnya ADA tapi tidak terlihat.
    Diukur di produksi 12 Okt 2026, beberapa menit setelah terbit: kartu ini
    duduk 770px dari atas isi dialog yang tingginya 647px, dan dialognya selalu
    terbuka di scrollTop 0. Jadi orang yang menekan angka ATP melihat "Sebaran
    status" dan menyimpulkan tombolnya tidak berfungsi — persis yang user
    laporkan ("kenapa menu untuk klik atp muncul listnya belum ada?").

    Yang digeser HANYA isi dialog, bukan halaman: `scrollIntoView` ikut
    menggulirkan jendela di belakangnya, dan poster di belakang dialog akan
    ikut melompat.
  */
  useEffect(() => {
    if (!autoBuka) return;
    const t = setTimeout(() => {
      const el = kotak.current;
      const box = el?.closest('.wa-sheet-body');
      if (!el || !box) return;
      box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - 8;
    }, 0);
    return () => clearTimeout(t);
  }, [autoBuka]);
  const [data, setData] = useState<RincianArea | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [lebar, setLebar] = useState<string | null>(null);
  const [cari, setCari] = useState('');

  useEffect(() => {
    if (!buka || data || sibuk) return;
    setSibuk(true);
    // `batas` dinaikkan ke 2.000 (permintaan user 12 Okt 2026: daftarnya jangan
    // terpotong). Kelompok terbesar hari ini 1.095 baris di Pusat, dan satu
    // cabang seluruhnya 1.671 baris — jadi 2.000 memuat semuanya dengan
    // kelonggaran, dalam SATU permintaan.
    //
    // Pemotongannya TETAP ADA di server dan tidak dibuang: tanpa batas sama
    // sekali, satu cabang yang suatu hari punya puluhan ribu baris akan
    // mengirim berkas puluhan MB ke telepon orang tanpa ada yang memilih itu.
    // Kalau batas ini suatu saat tersentuh lagi, barisnya akan mengatakannya.
    fetch(`/api/atp/rincian?area=${encodeURIComponent(area)}&ambang=${ambang}&batas=2000`, { credentials: 'include' })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.ok) {
          // 401 disebut apa adanya: /wa bisa dibuka dengan token poster tanpa
          // login, dan rincian per SKU sengaja TIDAK ikut token itu.
          throw new Error(r.status === 401
            ? 'Rincian ATP hanya untuk pengguna yang login. Buka /atp setelah masuk.'
            : String(j?.error ?? `Gagal memuat (${r.status})`));
        }
        setData(j as RincianArea);
      })
      .catch((e) => setGalat(e instanceof Error ? e.message : String(e)))
      .finally(() => setSibuk(false));
  }, [buka, data, sibuk, area, ambang]);

  const pembagi = data ? data.grup.filter((g) => g.masukPembagi) : [];
  const keluar = data ? data.grup.filter((g) => !g.masukPembagi) : [];

  return (
    <div className="card card-pad" ref={kotak}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="card-title">Rincian ATP</div>
        <button className="btn btn-sm" onClick={() => setBuka((v) => !v)}>
          {buka ? 'Sembunyikan' : 'Tampilkan rincian'}
        </button>
      </div>
      <div className="text-[12px] text-label">
        ATP = SKU yang <b>siap</b> (available &gt; {ambang} pcs) dibagi SKU yang <b>ikut pembagi</b>.
        Yang di luar pembagi tidak menaikkan maupun menurunkan persennya — daftar di bawah
        menyebut satu per satu beserta sebabnya.
      </div>

      {!buka ? null : galat ? (
        <div className="mt-2 text-[12px]" style={{ color: 'var(--critical)' }}>{galat}</div>
      ) : !data ? (
        <div className="mt-2 text-[12px] text-label">Memuat rincian…</div>
      ) : (
        <>
          <div className="mt-3 text-[13px]">
            <b className="font-mono">{persenAtp(data.persen)}</b>
            {' = '}<span className="font-mono">{fmt(data.siap)}</span> siap ÷{' '}
            <span className="font-mono">{fmt(data.dihitung)}</span> ikut pembagi
          </div>

          {[['Ikut pembagi', pembagi], ['Di luar pembagi', keluar]].map(([judul, daftar]) => (
            <div key={String(judul)} className="mt-3">
              <div className="text-[12px] font-semibold text-label">{String(judul)}</div>
              {(daftar as GrupRincian[]).map((g) => (
                <div key={g.kunci} className="mt-1.5">
                  <button
                    className="flex w-full items-center gap-2 text-left"
                    onClick={() => { setCari(''); setLebar((v) => (v === g.kunci ? null : g.kunci)); }}
                    title={g.masukPembagi ? 'Ikut menentukan persen ATP' : 'Keluar dari pembagi — tidak mempengaruhi persen'}
                  >
                    <span className="text-[12px]" style={{ minWidth: 190 }}>{g.label}</span>
                    <span className="h-2 flex-1 rounded-full" style={{ background: 'var(--border-subtle)' }}>
                      <span
                        className="block h-2 rounded-full"
                        style={{
                          width: `${(g.n / Math.max(1, data.grup.reduce((t, x) => t + x.n, 0))) * 100}%`,
                          background: g.masukPembagi ? 'var(--c1)' : 'var(--border)',
                        }}
                      />
                    </span>
                    <span className="w-[56px] text-right text-[12px] font-semibold tabular-nums">{fmt(g.n)}</span>
                    <span className="w-[14px] text-[11px] text-label">{lebar === g.kunci ? '−' : '+'}</span>
                  </button>
                  {lebar === g.kunci ? (
                    <div className="mt-1 rounded border p-2" style={{ borderColor: 'var(--border-subtle)' }}>
                      {/* Penyaring, bukan hiasan: kelompok "Dihitung & siap" di
                          Pusat 1.095 baris, dan menggulir 1.095 baris untuk
                          mencari satu SKU bukan transparansi, cuma tumpukan. */}
                      {g.sku.length > 20 ? (
                        <input
                          className="input mb-2 w-full"
                          placeholder={`Saring ${fmt(g.sku.length)} baris — ketik SKU atau namanya`}
                          value={cari}
                          onChange={(e) => setCari(e.target.value)}
                        />
                      ) : null}
                      <div className="max-h-[320px] overflow-auto">
                      {g.sku
                        .filter((r) => {
                          const q = cari.trim().toLowerCase();
                          return !q || r.sku.toLowerCase().includes(q) || (r.name ?? '').toLowerCase().includes(q);
                        })
                        .map((r) => (
                        <div key={r.sku} className="flex gap-2 py-0.5 text-[11px]">
                          <span className="font-mono" style={{ minWidth: 230 }}>{r.sku}</span>
                          <span className="tabular-nums" style={{ minWidth: 60, textAlign: 'right' }}>{fmt(r.qty)}</span>
                          <span className="text-label">{r.ket || r.name}</span>
                        </div>
                      ))}
                      </div>
                      {g.lebih > 0 ? (
                        <div className="mt-1 text-[11px]" style={{ color: 'var(--critical)' }}>
                          … {fmt(g.lebih)} baris lagi tidak ditampilkan — melebihi batas 2.000 baris per kelompok.
                          Buka <b>/atp</b> untuk daftar lengkap yang bisa difilter dan diunduh.
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function Rincian({ a, disp, tampil, fokus, onTutup }: {
  a: AreaWa; disp: DoiDisplay;
  /** Status yang ditampilkan — dihitung lintas area, sama dengan posternya. */
  tampil: ReturnType<typeof kunciTampil>;
  /** 'atp' = dibuka dari angka ATP, jadi rinciannya langsung terbuka. */
  fokus?: 'atp';
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
            <div className="card-title mb-2">{`Tren ${labelDoi(tampil1(disp) ? 1 : 2, disp)}`}</div>
            {a.tren.length ? (
              <div className="text-[12px] text-label">
                {a.tren.length} hari tercatat · terlama {a.tren[0]?.date} ({hari(tampil1(disp) ? a.tren[0]?.doi1 : a.tren[0]?.doi2)}) · terbaru {a.tren[a.tren.length - 1]?.date} ({hari(tampil1(disp) ? a.tren[a.tren.length - 1]?.doi1 : a.tren[a.tren.length - 1]?.doi2)})
              </div>
            ) : <div className="text-[12px] text-label">Riwayat belum cukup.</div>}
          </div>

          <RincianAtp area={a.area} ambang={a.stok?.ambang ?? 5} autoBuka={fokus === 'atp'} />

          <div className="card card-pad">
            <div className="card-title mb-2">Tren ATP</div>
            {(a.trenAtp ?? []).length ? (
              <div className="text-[12px] text-label">
                {(a.trenAtp ?? []).length} hari tercatat · terlama {a.trenAtp![0]?.date} ({persenAtp(a.trenAtp![0]?.persen ?? null)})
                {' · '}terbaru {a.trenAtp![a.trenAtp!.length - 1]?.date} ({persenAtp(a.trenAtp![a.trenAtp!.length - 1]?.persen ?? null)})
              </div>
            ) : (
              <div className="text-[12px] text-label">
                Belum ada potret ATP harian. Terisi sendiri tiap perhitungan 07.30 WIB.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function WaPage() {
  const [data, setData] = useState<DataWa | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Dua medan, bukan satu string: angka ATP punya sasaran kliknya sendiri, dan
  // yang membedakannya dari klik kartu HANYA fokusnya.
  const [pilih, setPilih] = useState<{ area: string; fokus?: 'atp' } | null>(null);
  const [unduh, setUnduh] = useState<'idle' | 'proses' | 'gagal'>('idle');

  const kunci = useMemo(() => (typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('k') ?? ''), []);
  /**
   * `?bare=1` — mode untuk bot penangkap layar.
   *
   * Halaman jadi PERSIS seukuran poster: tanpa padding, tanpa baris tombol di
   * bawah, tanpa popup. Bot cukup `setViewport` seukuran kanvas lalu
   * `page.screenshot()` — tidak perlu mencari elemen, tidak perlu memotong, dan
   * ukurannya tidak berubah kalau tata letak halaman diubah nanti.
   *
   * UKURANNYA DARI `KANVAS`, jangan ditulis mati di skrip bot: 8 Okt 2026
   * tingginya berubah 900 → 1000 saat ATP masuk, lalu 1000 → 1032 pada 15 Okt
   * saat strip kepala jadi kartu bersparkline dan tiap kartu area dapat sumbu
   * waktu. Bot yang memakai angka lama akan MEMOTONG kaki poster tanpa galat
   * apa pun — gambarnya terkirim, cuma kurang, dan tidak ada yang memeriksanya.
   *
   * Sejak 15 Okt 2026 TINGGINYA TIDAK TETAP: mulai cabang ke-6 kartu turun ke
   * baris kedua dan kanvas memanjang (5 cabang 1032, 6–10 cabang 1800). Jadi
   * menambah cabang MENGUBAH ukuran gambar — dan bot yang memakai tinggi tetap
   * akan memotongnya diam-diam.
   *
   * Karena itu mode ini menulis ukurannya di DOM: `data-lebar` dan
   * `data-tinggi` pada elemen yang sama dengan `data-siap`. Bot sebaiknya
   * membaca keduanya (atau memakai `fullPage`) daripada memegang
   * `DOI_IMAGE_HEIGHT` di telegram-wa-bridge, yang harus diubah manual setiap
   * kali cabang bertambah.
   */
  const bare = useMemo(() => (typeof window === 'undefined' ? false : new URLSearchParams(window.location.search).get('bare') === '1'), []);

  useEffect(() => {
    let alive = true;
    // `?k=` hanya disertakan kalau memang ADA di URL. Pengguna yang membuka
    // lewat menu sidebar tidak punya token — sesinya yang dipakai, dan
    // mengirim `k=` kosong hanya membuat log server penuh "kunci salah" untuk
    // permintaan yang sebenarnya sah.
    fetch(kunci ? `/api/public/wa?k=${encodeURIComponent(kunci)}` : '/api/public/wa')
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
      // Tinggi dari POSTERNYA SENDIRI (viewBox), bukan konstanta: sejak grid
      // multi-baris, tingginya bergantung pada jumlah cabang. Konstanta di sini
      // akan memotong baris kedua pada JPG yang diunduh — tanpa galat apa pun.
      const vb = (svg as unknown as SVGSVGElement).viewBox?.baseVal;
      const wPx = vb?.width || KANVAS.w;
      const hPx = vb?.height || KANVAS.h;
      c.width = wPx; c.height = hPx;
      const ctx = c.getContext('2d');
      if (!ctx) { setUnduh('gagal'); return; }
      // JPG tidak mengenal transparan — tanpa alas ini bagian kosong jadi hitam.
      ctx.fillStyle = WARNA.kanvas;
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, wPx, hPx);
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

  const areaTerpilih = data.areas.find((a) => a.area === pilih?.area) ?? null;
  // Tinggi poster IKUT jumlah cabang: sejak cabang ke-6 kartu turun ke baris
  // kedua dan kanvasnya memanjang. Dihitung dari fungsi yang sama dengan yang
  // menggambar, jangan pernah ditulis mati di sini — lihat `tinggiKanvas`.
  const tinggiGambar = tinggiKanvas(data.areas.length);

  if (bare) {
    // `data-siap` adalah tanda bagi bot: tunggu selector ini, bukan timer.
    // networkidle saja tidak cukup — datanya diambil setelah halaman siap.
    return (
      // `data-tinggi` supaya bot bisa MEMBACA tinggi yang sebenarnya, bukan
      // menebaknya dari setelan yang mungkin sudah basi. Lihat catatan di
      // `?bare=1` di atas.
      <div className="wa-root is-bare" data-siap="1" data-lebar={KANVAS.w} data-tinggi={tinggiGambar}>
        <div className="wa-canvas"><Poster data={data} /></div>
      </div>
    );
  }

  return (
    <div className="wa-root" data-siap="1">
      <div className="wa-canvas">
        <Poster data={data} onPilihArea={(area, fokus) => setPilih({ area, fokus })} />
      </div>
      <div className="wa-bar">
        <span className="text-[12px] text-label">
          Klik kartu area untuk rincian, atau <b>angka ATP</b> untuk melihat SKU mana yang dihitung
          dan mana yang tidak · gambar {KANVAS.w}×{tinggiGambar}
        </span>
        <button className="btn btn-sm btn-primary" onClick={unduhJpg} disabled={unduh === 'proses'}>
          {unduh === 'proses' ? 'Menyiapkan…' : unduh === 'gagal' ? 'Gagal — coba lagi' : 'Unduh JPG'}
        </button>
      </div>
      {areaTerpilih ? (
        <Rincian
          a={areaTerpilih}
          disp={data.doiDisplay ?? 'BOTH'}
          tampil={kunciTampil(data.areas.map((x) => x.byStatus))}
          fokus={pilih?.fokus}
          onTutup={() => setPilih(null)}
        />
      ) : null}
    </div>
  );
}
