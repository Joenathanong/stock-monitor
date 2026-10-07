// SENGAJA tanpa 'use client': komponen ini murni penggambaran, tanpa hook.
// Dengan begitu ia bisa dipakai DUA kali — oleh halaman /wa di browser, dan oleh
// route handler /api/public/wa/svg yang merendernya jadi teks SVG di server.
// Bot WhatsApp jadi punya jalur tanpa browser sama sekali: cukup curl lalu ubah
// SVG ke JPG dengan sharp/ImageMagick. Satu sumber gambar, tidak ada dua versi
// yang bisa berbeda.
import {
  FONT, FONT_MONO, KANVAS, WARNA, adsTeks, angkaRingkas, deretTren, hari, jalurSpark, labelDoi, lebarKartu,
  rupiahRingkas, segmenStatus, segmenLain, kunciTampil, tataLetakStatus, BIAYA_BLOK, gutterLabel, lebarTeksKira, potongTeks, JEDA_LABEL, tampil1, tampil2,
} from '@/lib/wa-poster';
import type { DataWa, AreaWa } from './types';

/**
 * Poster 1600×900 — SATU elemen <svg>, bukan HTML.
 *
 * Alasannya unduhan JPG: SVG bisa diserialkan lalu digambar ke <canvas> tanpa
 * pustaka apa pun, dan hasilnya PERSIS sama dengan yang di layar. html2canvas
 * (jalur HTML) harus menafsirkan ulang CSS, dan design system ini memakai
 * `color-mix()` yang tidak dipahaminya — warnanya akan meleset.
 *
 * Konsekuensinya: seluruh warna ditulis hex apa adanya (lihat wa-poster.ts),
 * dan tidak ada satu pun kelas Tailwind di dalam <svg> ini.
 */
const M = 32;
const JARAK = 16;

type Props = {
  data: DataWa;
  /** Dipanggil saat kartu area diklik — halaman yang membuka popupnya. */
  onPilihArea?: (area: string) => void;
};

const Teks = ({
  x, y, size = 12, weight = 400, fill = WARNA.tinta, anchor = 'start', mono = false, children,
}: {
  x: number; y: number; size?: number; weight?: number; fill?: string;
  anchor?: 'start' | 'middle' | 'end'; mono?: boolean; children: React.ReactNode;
}) => (
  <text
    x={x} y={y} fontSize={size} fontWeight={weight} fill={fill} textAnchor={anchor}
    fontFamily={mono ? FONT_MONO : FONT}
    style={{ fontVariantNumeric: 'tabular-nums' }}
  >
    {children}
  </text>
);

function KartuArea({ a, x, y, w, h, blok, disp, kritisMaks, tampil, onKlik }: {
  a: AreaWa; x: number; y: number; w: number; h: number;
  blok: DataWa['blok']; disp: DataWa['doiDisplay']; kritisMaks: number;
  /** Status yang ditampilkan — SAMA untuk semua kartu, lihat `kunciTampil`. */
  tampil: ReturnType<typeof kunciTampil>;
  onKlik?: () => void;
}) {
  const pad = 16;
  const isi = w - 2 * pad;
  // Kursor vertikal: blok yang dimatikan tidak meninggalkan lubang — sisa ruang
  // jatuh ke blok berikutnya.
  let cy = y;

  const seg = segmenStatus(a.byStatus, tampil);
  const lain = segmenLain(a.byStatus, tampil);
  // Batang dibandingkan terhadap total SELURUH SKU, bukan hanya empat pita:
  // kalau pembaginya hanya pita, "Aman 180 dari 281" terlihat seperti 100%
  // padahal masih ada 35 SKU di kelompok keterangan.
  const semuaSeg = [...seg, ...lain];
  const totalSeg = semuaSeg.reduce((t, s) => t + s.n, 0) || 1;
  // Jarak baris DAN panjang daftar mendesak dipilih dari ruang yang benar-benar
  // ada, supaya sepuluh baris berbatang tetap muat tanpa meluber.
  const tata = tataLetakStatus({
    tinggiKartu: h, blok, nBaris: semuaSeg.length, diminta: kritisMaks,
  });
  const spark = jalurSpark(deretTren(a.tren, disp), isi, 56);
  const nKritis = a.byStatus?.CRITICAL ?? 0;

  const bagian: React.ReactNode[] = [];

  // --- kepala ---
  cy += 30;
  bagian.push(<Teks key="nm" x={x + pad} y={cy} size={19} weight={700}>{a.area}</Teks>);
  if (nKritis > 0) {
    const bw = 74;
    bagian.push(<rect key="bg" x={x + w - pad - bw} y={cy - 14} width={bw} height={19} rx={9.5} fill={WARNA.kritisBg} stroke={WARNA.kritisSolid} />);
    bagian.push(<circle key="bd" cx={x + w - pad - bw + 11} cy={cy - 4.5} r={3} fill={WARNA.kritisSolid} />);
    bagian.push(<Teks key="bt" x={x + w - pad - bw + 19} y={cy - 1} size={11} weight={700} fill={WARNA.kritisFg}>{`${nKritis} kritis`}</Teks>);
  } else {
    bagian.push(<Teks key="bt" x={x + w - pad} y={cy - 1} size={11} weight={700} fill={WARNA.amanFg} anchor="end">Tidak ada kritis</Teks>);
  }
  cy += 12;
  bagian.push(<line key="ln" x1={x + pad} y1={cy} x2={x + w - pad} y2={cy} stroke={WARNA.garisHalus} strokeWidth={1} />);

  // --- angka inti ---
  if (blok.angka) {
    cy += 26;
    // Hanya opsi yang dipilih di Pengaturan. Saat cuma satu, angka besarnya
    // memakai opsi itu dan kolom kanan dikosongkan — bukan diisi opsi lain.
    const utama = tampil1(disp) ? 1 : 2;
    const nilaiUtama = utama === 1 ? a.doi1 : a.doi2;
    const keduanya = tampil1(disp) && tampil2(disp);
    bagian.push(<Teks key="l1" x={x + pad} y={cy} size={11} weight={600} fill={WARNA.tintaLabel}>{labelDoi(utama as 1 | 2, disp)}</Teks>);
    if (keduanya) {
      bagian.push(<Teks key="l2" x={x + w - pad} y={cy} size={11} weight={600} fill={WARNA.tintaLabel} anchor="end">OPSI 2</Teks>);
    }
    cy += 34;
    // Satuannya di dalam <text> yang sama sebagai <tspan>, bukan elemen terpisah
    // dengan x tetap: lebar angka 38px tidak bisa ditebak, dan "hari" pernah
    // menimpa angkanya ("41,2ari").
    bagian.push(
      <text
        key="v1" x={x + pad} y={cy} fontFamily={FONT_MONO} fontSize={38} fontWeight={700}
        fill={WARNA.tinta} style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {hari(nilaiUtama)}
        <tspan fontFamily={FONT} fontSize={13} fontWeight={400} fill={WARNA.tintaLabel} dx={6}>hari</tspan>
      </text>,
    );
    if (keduanya) {
      bagian.push(<Teks key="v2" x={x + w - pad} y={cy} size={22} weight={700} fill={WARNA.tintaLabel} anchor="end" mono>{hari(a.doi2)}</Teks>);
    }

    cy += 26;
    // Berpasangan menurut satuannya: rupiah dengan rupiah, pcs dengan pcs.
    // "Nilai stok" HANYA barang di tangan; "Nilai + SIT" menambahkan barang
    // dalam perjalanan — dua angka itu sengaja bersebelahan supaya selisihnya
    // langsung terbaca, bukan harus dihitung sendiri.
    const kotak = [
      { l: 'Nilai stok', v: rupiahRingkas(a.value) },
      { l: 'Nilai + SIT', v: rupiahRingkas(a.value + a.valueTransit) },
      { l: 'Stok', v: `${angkaRingkas(a.stock)} pcs` },
      { l: 'Dalam perjalanan', v: `${angkaRingkas(a.transit)} pcs` },
      { l: `ADS ${labelDoi(tampil1(disp) ? 1 : 2, disp) === 'DOI' ? '' : `Opsi ${tampil1(disp) ? 1 : 2}`}`.trim(), v: adsTeks(tampil1(disp) ? a.ads1 : a.ads2) },
      { l: 'Perlu open PO', v: `${a.perluPo} SKU` },
    ];
    const kw = (isi - 8) / 2;
    kotak.forEach((k, i) => {
      const kx = x + pad + (i % 2) * (kw + 8);
      const ky = cy + Math.floor(i / 2) * 46;
      bagian.push(<rect key={`kb${i}`} x={kx} y={ky} width={kw} height={40} rx={8} fill={WARNA.permukaanAlt} stroke={WARNA.garisHalus} />);
      bagian.push(<Teks key={`kl${i}`} x={kx + 8} y={ky + 15} size={11} fill={WARNA.tintaLabel}>{k.l}</Teks>);
      bagian.push(<Teks key={`kv${i}`} x={kx + 8} y={ky + 32} size={14} weight={700} mono>{k.v}</Teks>);
    });
    cy += 3 * 46 - 6 + 8;
  }

  // --- sebaran status ---
  if (blok.status) {
    cy += 16;
    bagian.push(<Teks key="st" x={x + pad} y={cy} size={11} weight={600} fill={WARNA.tintaLabel}>{`SEBARAN STATUS · ${angkaRingkas(a.sku)} SKU`}</Teks>);
    cy += 8;
    // --- SEPULUH baris status, SEMUANYA berbatang ---
    //
    // Batangnya menggambar porsi dari TOTAL SKU (`n / totalSeg`). Setiap SKU
    // punya tepat satu status, jadi kesepuluhnya potongan dari satu keseluruhan
    // yang sama — porsinya sama-sama berarti, termasuk Dead Stock dan SIT.
    //
    // Sempat saya buat enam keterangan TANPA batang dengan alasan "bukan satu
    // skala". Itu salah, dan user yang menunjukkannya. Yang sebenarnya menekan
    // itu ruang vertikal, dan saya mendandaninya sebagai prinsip. Sekarang
    // ruangnya yang mengalah: jarak baris dipilih adaptif oleh tataLetakStatus.
    //
    // Garis pemisah setelah baris ke-4 tetap ada supaya dua kelompok itu masih
    // terbaca terpisah — tanpa mencabut batangnya.
    // Kolom label dihitung dari label yang BENAR-BENAR tampil, bukan dipatok.
    // Angka di kanan dipesan selebar angka terpanjang + jeda, supaya batang
    // tidak pernah menabrak keduanya (SVG tidak punya ellipsis maupun wrap).
    const fs = tata.pitch <= 14 ? 10 : 11;
    const bh = tata.pitch <= 14 ? 6 : 8;
    const gLabel = gutterLabel(semuaSeg.map((x) => x.label), fs);
    const gAngka = Math.ceil(
      semuaSeg.reduce((m, x) => Math.max(m, lebarTeksKira(String(x.n), fs, true)), 0),
    ) + 8;
    const barW = Math.max(24, isi - gLabel - gAngka);
    let sy = cy;
    semuaSeg.forEach((s, i) => {
      // Pemisah hanya kalau KEDUA kelompok ada isinya — kalau salah satunya
      // tersembunyi seluruhnya, garis menggantung tanpa memisahkan apa pun.
      if (i === seg.length && seg.length > 0 && lain.length > 0) {
        bagian.push(
          <line
            key="lnx" x1={x + pad} y1={sy + BIAYA_BLOK.pemisah / 2} x2={x + w - pad} y2={sy + BIAYA_BLOK.pemisah / 2}
            stroke={WARNA.garisHalus} strokeWidth={1}
          />,
        );
        sy += BIAYA_BLOK.pemisah;
      }
      const ytop = sy + (tata.pitch - bh) / 2;
      const bx = x + pad + gLabel;
      bagian.push(
        <Teks key={`sl${i}`} x={x + pad} y={sy + fs} size={fs}>
          {potongTeks(s.label, gLabel - JEDA_LABEL, fs)}
        </Teks>,
      );
      bagian.push(<rect key={`sbg${i}`} x={bx} y={ytop} width={barW} height={bh} rx={bh / 2} fill={WARNA.garisHalus} />);
      {/* Batang tipis, ujung membulat, ditambatkan ke garis dasar kiri. */}
      {s.n > 0 && bagian.push(
        <rect
          key={`sb${i}`} x={bx} y={ytop}
          width={Math.max(4, (s.n / totalSeg) * barW)} height={bh} rx={bh / 2} fill={s.warna}
        />,
      )}
      bagian.push(<Teks key={`sn${i}`} x={x + w - pad} y={sy + fs} size={fs} weight={700} anchor="end" mono>{s.n}</Teks>);
      sy += tata.pitch;
    });
    cy = sy + 8;
  }

  // --- tren DOI ---
  if (blok.tren) {
    cy += 16;
    bagian.push(<Teks key="tr" x={x + pad} y={cy} size={11} weight={600} fill={WARNA.tintaLabel}>{`TREN ${labelDoi(tampil1(disp) ? 1 : 2, disp)} — 30 HARI`}</Teks>);
    cy += 6;
    if (spark.d) {
      bagian.push(<path key="sp" d={spark.d} fill="none" stroke={WARNA.primary} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" transform={`translate(${x + pad} ${cy})`} />);
      if (spark.titikAkhir) {
        bagian.push(<circle key="spd" cx={x + pad + spark.titikAkhir.x} cy={cy + spark.titikAkhir.y} r={4} fill={WARNA.primary} stroke={WARNA.permukaan} strokeWidth={2} />);
      }
      // Satu deret, jadi tidak perlu legenda — judul di atas sudah menyebutnya.
      // Label langsung hanya di dua ujung rentang, bukan di tiap titik.
      bagian.push(<Teks key="smin" x={x + pad} y={cy + 56 + 13} size={11} fill={WARNA.tintaLabel}>{`terendah ${hari(spark.min)}`}</Teks>);
      bagian.push(<Teks key="smax" x={x + w - pad} y={cy + 56 + 13} size={11} fill={WARNA.tintaLabel} anchor="end">{`tertinggi ${hari(spark.max)}`}</Teks>);
    } else {
      bagian.push(<Teks key="sp0" x={x + pad} y={cy + 32} size={11} fill={WARNA.tintaLabel}>Riwayat belum cukup</Teks>);
    }
    cy += 56 + 20;
  }

  // --- SKU paling mendesak ---
  // Berapa SKU yang MUAT, bukan berapa yang diminta. Daftar ini satu-satunya
  // blok yang boleh dipendekkan tanpa kehilangan arti, jadi kalau ruangnya
  // kurang, inilah yang mengalah — bukan kartunya yang meluber.
  const poMuat = tata.poMuat;
  if (blok.po && poMuat > 0) {
    cy += 16;
    bagian.push(<Teks key="kr" x={x + pad} y={cy} size={11} weight={600} fill={WARNA.tintaLabel}>PALING MENDESAK</Teks>);
    cy += 6;
    if (a.kritis.length) {
      a.kritis.slice(0, poMuat).forEach((r, i) => {
        const ky = cy + i * 30;
        const w0 = r.status === 'CRITICAL';
        bagian.push(<rect key={`kd${i}`} x={x + pad} y={ky} width={3} height={22} rx={1.5} fill={w0 ? WARNA.kritisSolid : WARNA.lowSolid} />);
        bagian.push(
          <Teks key={`kn${i}`} x={x + pad + 10} y={ky + 10} size={11} weight={600}>
            {r.sku.length > 22 ? `${r.sku.slice(0, 21)}…` : r.sku}
          </Teks>,
        );
        bagian.push(
          <Teks key={`kv${i}`} x={x + pad + 10} y={ky + 22} size={11} fill={w0 ? WARNA.kritisFg : WARNA.lowFg}>
            {`DOI ${hari(r.doi)} hari${r.sug > 0 ? ` · PO ${angkaRingkas(r.sug)} pcs` : ''}`}
          </Teks>,
        );
      });
    } else {
      bagian.push(<Teks key="kr0" x={x + pad} y={cy + 16} size={11} fill={WARNA.amanFg}>Tidak ada SKU kritis</Teks>);
    }
    // Dipotong karena ruang TIDAK boleh terjadi tanpa diberitahu: pembaca harus
    // tahu daftarnya tidak lengkap, kalau tidak ia menyangka sisanya tidak ada.
    const sisa = a.kritis.length - poMuat;
    if (sisa > 0) {
      bagian.push(
        <Teks key="krs" x={x + pad} y={cy + poMuat * 30 + 10} size={10} fill={WARNA.tintaLabel}>
          {`+${sisa} SKU lagi — buka dashboard`}
        </Teks>,
      );
    }
  }

  return (
    <g onClick={onKlik} style={onKlik ? { cursor: 'pointer' } : undefined}>
      <rect x={x} y={y} width={w} height={h} rx={12} fill={WARNA.permukaan} stroke={WARNA.garis} strokeWidth={1} />
      <rect x={x} y={y} width={w} height={3} rx={1.5} fill={nKritis > 0 ? WARNA.kritisSolid : WARNA.amanSolid} />
      {bagian}
    </g>
  );
}

export function Poster({ data, onPilihArea }: Props) {
  const area = data.areas;
  const w = lebarKartu(area.length || 1, KANVAS.w, M, JARAK);
  const kartuY = 216;
  const kartuH = KANVAS.h - kartuY - 56;
  const t = data.total;

  const disp = data.doiDisplay ?? 'BOTH';
  // Satu keputusan untuk seluruh poster: baris yang 0 di SEMUA area dibuang,
  // sisanya tampil di setiap kartu supaya barisnya sejajar antar kolom.
  const tampil = kunciTampil(area.map((a) => a.byStatus));
  const ringkas = [
    { l: 'SKU dihitung', v: t ? angkaRingkas(t.sku) : '—' },
    ...(tampil1(disp) ? [{ l: labelDoi(1, disp), v: t ? `${hari(t.doi1)} hari` : '—' }] : []),
    ...(tampil2(disp) ? [{ l: labelDoi(2, disp), v: t ? `${hari(t.doi2)} hari` : '—' }] : []),
    { l: 'ADS', v: t ? adsTeks(tampil1(disp) ? t.ads1 : t.ads2) : '—' },
    { l: 'Total stok', v: t ? `${angkaRingkas(t.stock)} pcs` : '—' },
    { l: 'Dalam perjalanan', v: t ? `${angkaRingkas(t.transit)} pcs` : '—' },
    { l: 'Nilai stok', v: t ? rupiahRingkas(t.value) : '—' },
    { l: 'Nilai + SIT', v: t ? rupiahRingkas(t.value + t.valueTransit) : '—' },
    { l: 'Kritis + Low', v: t ? `${t.kritis + t.low} SKU` : '—', tone: t && t.kritis > 0 ? WARNA.kritisFg : undefined },
  ] as { l: string; v: string; tone?: string }[];
  const rw = (KANVAS.w - 2 * M) / ringkas.length;
  // Angka strip mengecil saat kolomnya bertambah. Tanpa ini "105 rb pcs" di 26px
  // (±156px) tidak muat di kolom 170px saat kedua opsi DOI ikut tampil.
  const rFs = ringkas.length <= 7 ? 26 : ringkas.length === 8 ? 22 : 20;

  return (
    <svg
      id="wa-poster"
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${KANVAS.w} ${KANVAS.h}`}
      width={KANVAS.w}
      height={KANVAS.h}
      style={{ display: 'block', width: '100%', height: 'auto' }}
    >
      <rect width={KANVAS.w} height={KANVAS.h} fill={WARNA.kanvas} />

      {/* kepala */}
      <rect x={M} y={24} width={5} height={30} rx={2.5} fill={WARNA.primary} />
      <Teks x={M + 16} y={48} size={26} weight={700}>{data.judul}</Teks>
      <Teks x={M + 16} y={70} size={13} fill={WARNA.tintaLabel}>
        {`Snapshot ${data.snapshotDate ?? '—'} · ${area.length} area · DOI total memakai stok di tangan saja`}
      </Teks>
      <Teks x={KANVAS.w - M} y={48} size={13} fill={WARNA.tintaLabel} anchor="end">
        {`Dibuat ${new Date(data.dibuatPada).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })} WIB`}
      </Teks>
      <Teks x={KANVAS.w - M} y={70} size={13} weight={700} fill={WARNA.primary} anchor="end">IEG · DOI Monitor</Teks>

      {/* ringkasan seluruh area */}
      <rect x={M} y={96} width={KANVAS.w - 2 * M} height={96} rx={12} fill={WARNA.permukaan} stroke={WARNA.garis} />
      {ringkas.map((r, i) => (
        <g key={r.l}>
          {i > 0 ? <line x1={M + i * rw} y1={116} x2={M + i * rw} y2={172} stroke={WARNA.garisHalus} /> : null}
          <Teks x={M + i * rw + 20} y={126} size={11} weight={600} fill={WARNA.tintaLabel}>{r.l.toUpperCase()}</Teks>
          <Teks x={M + i * rw + 20} y={162} size={rFs} weight={700} fill={r.tone ?? WARNA.tinta} mono>{r.v}</Teks>
        </g>
      ))}

      {/* kartu per area */}
      {area.map((a, i) => (
        <KartuArea
          key={a.area}
          a={a}
          x={M + i * (w + JARAK)}
          y={kartuY}
          w={w}
          h={kartuH}
          blok={data.blok}
          disp={disp}
          kritisMaks={6}
          tampil={tampil}
          onKlik={onPilihArea ? () => onPilihArea(a.area) : undefined}
        />
      ))}

      {/* kaki */}
      <Teks x={M} y={KANVAS.h - 22} size={12} fill={WARNA.tintaLabel}>
        Barang dalam perjalanan menambah kolom SIT dan “DOI + transit”, tapi tidak menambah Total stok maupun DOI total.
      </Teks>
      <Teks x={KANVAS.w - M} y={KANVAS.h - 22} size={12} fill={WARNA.tintaLabel} anchor="end">
        {`Sumber: OCS · dihitung ${data.computedAt ? new Date(data.computedAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}`}
      </Teks>
    </svg>
  );
}
