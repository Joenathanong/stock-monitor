// SENGAJA tanpa 'use client': komponen ini murni penggambaran, tanpa hook.
// Dengan begitu ia bisa dipakai DUA kali — oleh halaman /wa di browser, dan oleh
// route handler /api/public/wa/svg yang merendernya jadi teks SVG di server.
// Bot WhatsApp jadi punya jalur tanpa browser sama sekali: cukup curl lalu ubah
// SVG ke JPG dengan sharp/ImageMagick. Satu sumber gambar, tidak ada dua versi
// yang bisa berbeda.
import {
  FONT, FONT_MONO, KANVAS, WARNA, adsTeks, angkaRingkas, deretTren, hari, jalurSpark, labelDoi, lebarKartu,
  rupiahRingkas, segmenStatus, segmenLain, kunciTampil, tataLetakStatus, BIAYA_BLOK, TINGGI_SPARK, lebarTeksKira, potongTeks, JEDA_LABEL, labelPitaPisah, tataLabelStatus, tampil1, tampil2,
  KARTU, tinggiKartuTersedia, ukuranAtpMuat, UKURAN_DOI,
} from '@/lib/wa-poster';
// Dipakai dari atp.ts, TIDAK ditulis ulang di sini: angka di poster dan angka di
// halaman /atp harus sama ejaannya ("71,0%"), dan dua fungsi dengan satu tugas
// akan berbeda pada kasus null-nya.
import { persenTeks as persenAtp } from '@/lib/atp';
import type { DataWa, AreaWa } from './types';

/**
 * Poster 1600×1000 — SATU elemen <svg>, bukan HTML.
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

function KartuArea({ a, x, y, w, h, blok, disp, kritisMaks, tampil, atpSize, onKlik }: {
  a: AreaWa; x: number; y: number; w: number; h: number;
  blok: DataWa['blok']; disp: DataWa['doiDisplay']; kritisMaks: number;
  /** Ukuran angka ATP — dihitung SEKALI untuk seluruh poster, lihat ukuranAtpMuat. */
  atpSize: number;
  /** Status yang ditampilkan — SAMA untuk semua kartu, lihat `kunciTampil`. */
  tampil: ReturnType<typeof kunciTampil>;
  onKlik?: () => void;
}) {
  const pad = KARTU.pad;
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
  const spark = jalurSpark(deretTren(a.tren, disp), isi, TINGGI_SPARK);
  // Deret ATP: persennya apa adanya. null (pembagi 0 hari itu) MEMUTUS garis,
  // tidak disambung lurus — menyambungnya mengarang tren yang tidak pernah ada.
  const sparkAtp = jalurSpark((a.trenAtp ?? []).map((t) => t.persen), isi, TINGGI_SPARK);
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
    // Slot kanan: OPSI 2 kalau dua opsi DOI ditampilkan, kalau tidak ATP.
    //
    // Pengaturan `doi_display` saat ini OPSI1, jadi slot ini kosong dan itulah
    // tempat yang user minta untuk ATP. Kalau nanti diubah ke BOTH, OPSI 2
    // tetap memegang slot besar dan ATP turun jadi baris kecil di bawahnya —
    // ATP tidak boleh MENGGANTIKAN angka DOI kedua, karena itu menghilangkan
    // angka yang memang diminta tampil.
    bagian.push(
      <Teks key="l2" x={x + w - pad} y={cy} size={11} weight={600} fill={WARNA.tintaLabel} anchor="end">
        {keduanya ? 'OPSI 2' : 'ATP'}
      </Teks>,
    );
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
    // ATP setebal dan sebesar angka DOI (permintaan user 8 Okt 2026). Ukurannya
    // dari `atpSize`, yang dihitung sekali untuk SELURUH poster supaya kelima
    // kartu seragam — bukan menyusut sendiri-sendiri.
    bagian.push(
      <Teks
        key="v2" x={x + w - pad} y={cy}
        size={keduanya ? 22 : atpSize}
        weight={700}
        fill={keduanya ? WARNA.tintaLabel : WARNA.tinta}
        anchor="end" mono
      >
        {keduanya ? hari(a.doi2) : (a.atp ? persenAtp(a.atp.persen) : '—')}
      </Teks>,
    );
    // Mode dua opsi: ATP jadi baris kecil di 26px jeda yang sudah ada sebelum
    // grid kotak, jadi tidak ada tinggi tambahan dan BIAYA_BLOK tidak berubah.
    if (keduanya) {
      bagian.push(
        <Teks key="atp2" x={x + w - pad} y={cy + 16} size={11} fill={WARNA.tintaLabel} anchor="end">
          {`ATP ${a.atp ? persenAtp(a.atp.persen) : '—'}`}
        </Teks>,
      );
    }

    cy += 26;
    // Berpasangan menurut satuannya: rupiah dengan rupiah, pcs dengan pcs.
    // "Nilai stok" HANYA barang di tangan; "Nilai + Nilai SIT" menambahkan barang
    // dalam perjalanan — dua angka itu sengaja bersebelahan supaya selisihnya
    // langsung terbaca, bukan harus dihitung sendiri.
    // Urutan dikunci user 8 Okt 2026. Pasangannya tetap masuk akal per baris:
    // rupiah dengan rupiah, pcs dengan pcs, hari dengan per-hari, SKU dengan SKU.
    const doiSitNilai = utama === 1 ? a.doiSit?.doi1 : a.doiSit?.doi2;
    const kotak = [
      { l: 'Nilai stok', v: rupiahRingkas(a.value) },
      { l: 'Nilai + Nilai SIT', v: rupiahRingkas(a.value + a.valueTransit) },
      { l: 'Stok', v: `${angkaRingkas(a.stock)} pcs` },
      // "SIT" menggantikan "Dalam perjalanan": sejalan dengan "Nilai + Nilai SIT"
      // di atasnya, dan menyisakan ruang untuk angkanya.
      { l: 'SIT', v: `${angkaRingkas(a.transit)} pcs` },
      // DOI besar di kepala kartu TIDAK memuat SIT (doi1 = stok ÷ ADS). Kotak ini
      // yang memuatnya, jadi selisih keduanya langsung terbaca sebagai sumbangan
      // barang yang sedang jalan.
      { l: 'Aktual DOI + SIT', v: doiSitNilai === undefined ? '—' : `${hari(doiSitNilai)} hari` },
      { l: `ADS ${labelDoi(utama as 1 | 2, disp) === 'DOI' ? '' : `Opsi ${utama}`}`.trim(), v: adsTeks(utama === 1 ? a.ads1 : a.ads2) },
      { l: 'Perlu open PO', v: `${a.perluPo} SKU` },
      // Ketersediaan, DENGAN PEMBAGINYA — bukan persen sendirian.
      //
      // Pembaginya `a.sku`, angka yang sudah tertulis di "SEBARAN STATUS" pada
      // kartu yang sama, jadi pembacanya bisa memeriksanya sendiri tanpa
      // bertanya. Ambangnya ikut ditulis di label: "Available" tanpa ambang
      // berarti berbeda-beda di kepala tiap orang.
      {
        l: `Available >${a.stok?.ambang ?? 5} pcs`,
        // Pembagi dari `stok.dasar` (kumpulan ATP), BUKAN `a.sku` (kumpulan DOI).
        // Dua angka itu memang beda sekarang — 1.662 vs 349 — dan yang benar di
        // kotak ini adalah pembagi yang dipakai menghitung pembilangnya.
        v: a.stok ? `${angkaRingkas(a.stok.available)} / ${angkaRingkas(a.stok.dasar)}` : '—',
      },
    ];
    const kw = (isi - 8) / 2;
    kotak.forEach((k, i) => {
      const kx = x + pad + (i % 2) * (kw + 8);
      const ky = cy + Math.floor(i / 2) * 46;
      bagian.push(<rect key={`kb${i}`} x={kx} y={ky} width={kw} height={40} rx={8} fill={WARNA.permukaanAlt} stroke={WARNA.garisHalus} />);
      bagian.push(<Teks key={`kl${i}`} x={kx + 8} y={ky + 15} size={11} fill={WARNA.tintaLabel}>{k.l}</Teks>);
      bagian.push(<Teks key={`kv${i}`} x={kx + 8} y={ky + 32} size={14} weight={700} mono>{k.v}</Teks>);
    });
    // 4 baris kotak. HARUS sama dengan `BIAYA_BLOK.angka` di wa-poster.ts —
    // tesnya mengunci kesamaan itu, karena SVG tidak memotong luberan dan
    // selisih di sini tergambar menimpa kaki poster tanpa ada yang gagal.
    cy += 4 * 46 - 6 + 8;
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
    // Label pita DOI memuat ambang harinya ("Kritis ≤4D") — ambangnya BEDA per
    // kota, jadi tanpa itu "Kritis 34" di dua kartu sebelahan mengukur hal yang
    // berbeda tanpa ada yang menyebutkannya.
    //
    // Nama dan ambang digambar sebagai DUA teks, bukan satu: supaya ≤4D, ≤5D,
    // ≤7D berdiri di kolom yang sama alih-alih bergeser mengikuti panjang
    // namanya. Angka itulah yang dibandingkan antar baris.
    const labelSeg = semuaSeg.map((x) => labelPitaPisah(x.key, a.ambang));
    const tataLbl = tataLabelStatus(labelSeg, fs);
    const gLabel = tataLbl.gutter;
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
      // Nama dipotong pada batas kolom ambang (atau pada gutter kalau baris ini
      // tidak punya ambang) — bukan pada seluruh gutter, kalau tidak nama yang
      // kepanjangan akan menimpa angka harinya.
      const batasNama = labelSeg[i].ambang ? tataLbl.xAmbang - 2 : gLabel - JEDA_LABEL;
      bagian.push(
        <Teks key={`sl${i}`} x={x + pad} y={sy + fs} size={fs}>
          {potongTeks(labelSeg[i].nama, batasNama, fs)}
        </Teks>,
      );
      if (labelSeg[i].ambang) {
        bagian.push(
          <Teks key={`sa${i}`} x={x + pad + tataLbl.xAmbang} y={sy + fs} size={fs} fill={WARNA.tintaLabel}>
            {labelSeg[i].ambang}
          </Teks>,
        );
      }
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
      bagian.push(<Teks key="smin" x={x + pad} y={cy + TINGGI_SPARK + 13} size={11} fill={WARNA.tintaLabel}>{`terendah ${hari(spark.min)}`}</Teks>);
      bagian.push(<Teks key="smax" x={x + w - pad} y={cy + TINGGI_SPARK + 13} size={11} fill={WARNA.tintaLabel} anchor="end">{`tertinggi ${hari(spark.max)}`}</Teks>);
    } else {
      bagian.push(<Teks key="sp0" x={x + pad} y={cy + TINGGI_SPARK / 2 + 4} size={11} fill={WARNA.tintaLabel}>Riwayat belum cukup</Teks>);
    }
    cy += TINGGI_SPARK + 20;
  }

  // --- tren ATP ---
  //
  // SPARKLINE TERPISAH, bukan garis kedua di grafik DOI. DOI satuannya HARI dan
  // ATP satuannya PERSEN; menaruh keduanya di satu sumbu berarti salah satu
  // skalanya berbohong — kesalahan grafik yang paling sering dibuat. Dua grafik
  // kecil, masing-masing berjudul dan bersatuan sendiri.
  //
  // Warnanya SAMA dengan tren DOI dengan sengaja. Keduanya satu deret di
  // bingkainya masing-masing, jadi warnanya tidak memikul arti apa pun —
  // memberi warna berbeda justru menyiratkan dua kategori yang bisa
  // dibandingkan, padahal tidak. Yang membedakan: judul dan satuan labelnya.
  if (blok.trenAtp) {
    cy += 16;
    bagian.push(<Teks key="ta" x={x + pad} y={cy} size={11} weight={600} fill={WARNA.tintaLabel}>TREN ATP — 30 HARI</Teks>);
    cy += 6;
    if (sparkAtp.d) {
      bagian.push(<path key="tap" d={sparkAtp.d} fill="none" stroke={WARNA.primary} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" transform={`translate(${x + pad} ${cy})`} />);
      if (sparkAtp.titikAkhir) {
        bagian.push(<circle key="tad" cx={x + pad + sparkAtp.titikAkhir.x} cy={cy + sparkAtp.titikAkhir.y} r={4} fill={WARNA.primary} stroke={WARNA.permukaan} strokeWidth={2} />);
      }
      // Label hanya di dua ujung rentang — bukan angka di tiap titik.
      bagian.push(<Teks key="tamin" x={x + pad} y={cy + TINGGI_SPARK + 13} size={11} fill={WARNA.tintaLabel}>{`terendah ${persenAtp(sparkAtp.min)}`}</Teks>);
      bagian.push(<Teks key="tamax" x={x + w - pad} y={cy + TINGGI_SPARK + 13} size={11} fill={WARNA.tintaLabel} anchor="end">{`tertinggi ${persenAtp(sparkAtp.max)}`}</Teks>);
    } else {
      // Dibedakan dari "tidak ada datanya": satu titik berarti perekaman
      // hariannya baru mulai, dan itu berbeda dari tabelnya kosong.
      const n = (a.trenAtp ?? []).filter((t) => t.persen !== null).length;
      bagian.push(
        <Teks key="tap0" x={x + pad} y={cy + TINGGI_SPARK / 2 + 4} size={11} fill={WARNA.tintaLabel}>
          {n === 1 ? 'Baru 1 hari tercatat' : 'Riwayat ATP belum cukup'}
        </Teks>,
      );
    }
    cy += TINGGI_SPARK + 20;
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
  const kartuY = KARTU.y;
  const kartuH = tinggiKartuTersedia();
  const t = data.total;

  const disp = data.doiDisplay ?? 'BOTH';
  // Satu keputusan untuk seluruh poster: baris yang 0 di SEMUA area dibuang,
  // sisanya tampil di setiap kartu supaya barisnya sejajar antar kolom.
  const tampil = kunciTampil(area.map((a) => a.byStatus));

  // Ukuran ATP: SATU untuk seluruh poster, yaitu terbesar yang masih muat di
  // kartu tersempit. Diukur dari teks yang BENAR-BENAR akan digambar, bukan dari
  // contoh — panjang "105,3" dan "100,0%" yang menentukan, dan itu baru
  // diketahui setelah datanya ada.
  const atpSize = ukuranAtpMuat(
    area.map((a) => ({
      doi: hari(tampil1(disp) ? a.doi1 : a.doi2),
      atp: a.atp ? persenAtp(a.atp.persen) : '—',
    })),
    w - 2 * KARTU.pad,
  );
  const ringkas = [
    { l: 'SKU dihitung', v: t ? angkaRingkas(t.sku) : '—' },
    ...(tampil1(disp) ? [{ l: labelDoi(1, disp), v: t ? `${hari(t.doi1)} hari` : '—' }] : []),
    ...(tampil2(disp) ? [{ l: labelDoi(2, disp), v: t ? `${hari(t.doi2)} hari` : '—' }] : []),
    { l: 'ADS', v: t ? adsTeks(tampil1(disp) ? t.ads1 : t.ads2) : '—' },
    { l: 'Total stok', v: t ? `${angkaRingkas(t.stock)} pcs` : '—' },
    { l: 'Dalam perjalanan', v: t ? `${angkaRingkas(t.transit)} pcs` : '—' },
    { l: 'Nilai stok', v: t ? rupiahRingkas(t.value) : '—' },
    { l: 'Nilai + Nilai SIT', v: t ? rupiahRingkas(t.value + t.valueTransit) : '—' },
    { l: 'Kritis + Low', v: t ? `${t.kritis + t.low} SKU` : '—', tone: t && t.kritis > 0 ? WARNA.kritisFg : undefined },
    // ATP keseluruhan di kepala (permintaan user 10 Okt 2026). Sebelumnya
    // kepala hanya meringkas DOI, padahal tiap kartu sudah memuat ATP-nya —
    // jadi tidak ada satu pun angka ATP untuk SELURUH perusahaan.
    //
    // "—" saat pembaginya 0 BUKAN 0%: artinya belum ada SKU yang diputuskan
    // sebarannya di mana pun. Menggambarnya 0% akan terbaca seperti bencana.
    { l: 'ATP keseluruhan', v: t?.atp ? persenAtp(t.atp.persen) : '—' },
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
          atpSize={atpSize}
          disp={disp}
          kritisMaks={0}
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
