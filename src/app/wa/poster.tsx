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
  teksTarget, teksTargetAtp, ruangTarget, pilihKanan, nilaiDoi, nilaiAtp, warnaTarget, UKURAN_TARGET,
  ukuranStripMuat, STRIP, lebarStrip, IKON, jalurArea,
} from '@/lib/wa-poster';
// Dipakai dari atp.ts, TIDAK ditulis ulang di sini: angka di poster dan angka di
// halaman /atp harus sama ejaannya ("71,0%"), dan dua fungsi dengan satu tugas
// akan berbeda pada kasus null-nya.
import { persenTeks as persenAtp } from '@/lib/atp';
import type { DataWa, AreaWa, TitikTotal } from './types';

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
  /**
   * `fokus` menentukan rincian mana yang langsung dibuka. Angka ATP punya
   * sasaran kliknya SENDIRI (permintaan user 12 Okt 2026: "angka atp di klik
   * dapat menampilkan detail list") — tanpa itu seluruh kartu membuka rincian
   * umum, dan orang yang menekan persen ATP harus mencari lagi di dalamnya.
   */
  onPilihArea?: (area: string, fokus?: 'atp') => void;
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

function KartuArea({ a, x, y, w, h, blok, disp, kritisMaks, tampil, atpSize, onKlik, onKlikAtp }: {
  a: AreaWa; x: number; y: number; w: number; h: number;
  blok: DataWa['blok']; disp: DataWa['doiDisplay']; kritisMaks: number;
  /** Ukuran angka ATP — dihitung SEKALI untuk seluruh poster, lihat ukuranAtpMuat. */
  atpSize: number;
  /** Status yang ditampilkan — SAMA untuk semua kartu, lihat `kunciTampil`. */
  tampil: ReturnType<typeof kunciTampil>;
  onKlik?: () => void;
  /** Klik pada ANGKA ATP saja — membuka rincian yang langsung terbuka di ATP. */
  onKlikAtp?: () => void;
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
    const angkaKanan = (
      <Teks
        key="v2" x={x + w - pad} y={cy}
        size={keduanya ? 22 : atpSize}
        weight={700}
        fill={keduanya ? WARNA.tintaLabel : WARNA.tinta}
        anchor="end" mono
      >
        {keduanya ? hari(a.doi2) : (a.atp ? persenAtp(a.atp.persen) : '—')}
      </Teks>
    );
    // Angka ATP dibungkus sasaran klik sendiri — dengan <rect> transparan di
    // belakangnya, karena <text> hanya bisa diklik tepat pada goresan hurufnya
    // dan menekan celah antar angka akan terasa seperti tombol yang rusak.
    //
    // `stopPropagation` supaya rincian tidak dibuka DUA kali (kartu + angka),
    // dan supaya yang menang adalah fokus ATP, bukan rincian umum.
    //
    // Hanya saat ATP memegang slot ini. Di mode dua opsi DOI angka ini doi2,
    // dan memberinya klik ATP akan mengirim orang ke panel yang salah.
    bagian.push(
      !keduanya && onKlikAtp ? (
        <g key="v2g" onClick={(e) => { e.stopPropagation(); onKlikAtp(); }} style={{ cursor: 'pointer' }}>
          {/* SETENGAH KANAN kartu saja, bukan lebar tetap. Dengan 5 cabang satu
              kartu cuma ±220px, jadi kotak selebar 150px akan menutupi angka
              DOI di sebelah kiri — dan menekan angka DOI akan membuka panel
              ATP. Sasaran klik yang melebar ke tetangganya terasa seperti
              aplikasi yang salah tekan, bukan seperti fitur. */}
          <rect
            x={x + pad + (isi + 8) / 2} y={cy - atpSize}
            width={(isi - 8) / 2} height={atpSize + 12}
            fill="transparent"
          />
          {angkaKanan}
        </g>
      ) : angkaKanan,
    );
    // --- PITA 26px: TARGET DOI (kiri) dan TARGET ATP (kanan) ---
    //
    // Jeda 26px antara angka besar dan grid kotak sudah ada sejak dulu, jadi
    // kedua baris ini TIDAK menambah tinggi kartu dan BIAYA_BLOK tidak berubah.
    //
    // Keduanya duduk PERSIS di bawah angka yang mereka nilai: target DOI di
    // bawah angka DOI, target ATP di bawah angka ATP. Itu yang membuatnya
    // terbaca sebagai pembanding, bukan sebagai keterangan lepas.
    //
    // TARGET DOI (permintaan user 10 Okt 2026).
    //
    // Angkanya sebenarnya sudah ada di poster — sebagai label "Aman <=7D" di
    // baris sebaran. Tapi di sana ia terbaca sebagai batas pita, bukan sebagai
    // target, dan orang membaca angka 38px di kepala kartu, bukan label 11px di
    // baris ketiga.
    //
    // Kenapa ini penting dan bukan hiasan: targetnya BEDA 6,4x antar cabang
    // (Pusat 7 hari, Makassar 45 hari). Tanpa target di kartu, "9,4" di Pusat
    // dan "48,3" di Makassar terbaca seperti dua dunia yang berlawanan —
    // padahal keduanya sama-sama lewat target, dan Pusat justru yang paling
    // jauh secara relatif. Angka besar itu tidak bisa dibandingkan antar kartu
    // tanpa pembandingnya ikut tertulis.
    //
    // `ambang.max` = "Aman <= (hari)" di Pengaturan > Cabang/Area, yang juga
    // dipakai Sugest PO sebagai batas pengisian ("PO diisi sampai sini").
    // Hijau kalau targetnya terpenuhi, merah kalau tidak — dan arah "terpenuhi"
    // berlawanan di dua ukuran ini: DOI di BAWAH target itu baik, ATP di ATAS
    // target itu baik. Lihat `nilaiDoi`/`nilaiAtp`.
    /*
      Jarak baris target dari garis dasar angka besar: 17 -> 21 (permintaan user
      12 Okt 2026, "turunkan sedikit target, saat ini terlalu mepet").

      Sebabnya pembesaran teks tadi: pada ukuran 16 puncak huruf target naik ke
      ±5px di bawah garis dasar angka 38px, sementara ekor angka itu turun ±9px
      — jadi keduanya saling masuk ke ruang yang sama. Di 21 puncaknya turun ke
      ±9px dan ekor target berhenti di ±25px, masih di dalam pita 26px, jadi
      tinggi kartu TIDAK berubah dan grid kotak di bawahnya tidak tergeser.
    */
    const Y_TARGET = 21;
    const nD = nilaiDoi(nilaiUtama, a.ambang);
    // Target ATP CABANG INI, bukan satu angka untuk semua — sejalan dengan
    // ambang DOI yang juga per cabang.
    const atpTarget = a.atpTarget ?? null;
    const nA = nilaiAtp(a.atp?.persen, atpTarget);

    // Sisi KANAN pita. Di mode dua opsi DOI, ATP tidak memegang angka besar,
    // jadi persennya ikut ditulis di sini bersama targetnya — kalau tidak,
    // "Target 90%" akan berdiri tanpa angka yang dinilainya.
    //
    // Bentuknya dipilih menurut ruang yang ada, lihat `pilihKanan`: bentuk
    // terpanjang tidak muat berdampingan dengan target DOI di kartu 294px.
    // "72,0% / 90%" adalah bentuk aktual/target yang sudah dipakai poster ini
    // di kotak "Available >5 pcs" (1.158 / 1.663), jadi bukan notasi baru.
    const tTargetAtp = teksTargetAtp(atpTarget);
    const pAtp = a.atp ? persenAtp(a.atp.persen) : '—';
    const tDoi = a.ambang ? teksTarget(a.ambang.max) : '';
    const kandidatKanan = !tTargetAtp
      ? (keduanya ? [`ATP ${pAtp}`] : [])
      : keduanya
        ? [`ATP ${pAtp} · ${tTargetAtp}`, `ATP ${pAtp} / ${Math.round(atpTarget as number)}%`, `ATP ${pAtp}`]
        // DUA bentuk, bukan satu — ditambahkan 12 Okt 2026 bersama ukuran teks 16.
        //
        // Sejak penanda '(+)'/'(-)' dihapus (15 Okt 2026, digantikan simbol
        // ≤/≥ di dalam targetnya) baris ini jauh lebih longgar: di kartu 5
        // cabang "Target ≤999h" + "Target ≥95%" butuh 205px dari 262px. Bentuk
        // pendeknya TETAP ada sebagai cadangan untuk kartu yang lebih sempit —
        // 7 cabang ke atas — karena yang dipotong kalau ia hilang adalah target
        // DOI di kiri, dan "Target ≤99…" membalik artinya.
        //
        // Yang dipendekkan KATA-nya, bukan angkanya maupun simbolnya:
        // "Tgt ≥95%" masih menyebut berapa targetnya dan ke arah mana, untuk
        // yang tidak bisa membedakan warnanya.
        : [tTargetAtp, tTargetAtp.replace(/^Target /, 'Tgt ')];
    const kanan = pilihKanan(kandidatKanan, isi, tDoi);

    if (a.ambang) {
      // Dipotong pada ruang yang BENAR-BENAR tersisa setelah teks kanan. SVG
      // tidak punya ellipsis maupun wrap: teks yang kepanjangan menimpa
      // tetangganya tanpa ada yang gagal. Di 5 area tidak pernah terpotong —
      // lihat wa-target.test.ts, yang mengukur sampai 10 area.
      bagian.push(
        <Teks
          key="tgt" x={x + pad} y={cy + Y_TARGET} size={UKURAN_TARGET} weight={700}
          fill={nD ? warnaTarget(nD.baik) : WARNA.tintaLabel}
        >
          {potongTeks(tDoi, ruangTarget(isi, kanan), UKURAN_TARGET)}
        </Teks>,
      );
    }

    if (kanan) {
      bagian.push(
        <Teks
          key="atp2" x={x + w - pad} y={cy + Y_TARGET} size={UKURAN_TARGET} weight={700} anchor="end"
          // Diwarnai HANYA kalau isinya murni target ATP. Di mode dua opsi
          // teksnya memuat persen DAN target dalam satu baris; mewarnai merah
          // seluruhnya akan menyatakan persennya juga "salah", padahal yang
          // dinilai cuma hubungan keduanya.
          fill={!keduanya && nA ? warnaTarget(nA.baik) : WARNA.tintaLabel}
        >
          {potongTeks(kanan, isi, UKURAN_TARGET)}
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
      // Isian bergradasi di bawah garis (permintaan user 15 Okt 2026). Ia tidak
      // menambah keterangan baru — tugasnya menegaskan ARAH BACA: mana "dasar"
      // grafik, yang pada garis telanjang harus ditebak. Jalurnya kosong kalau
      // deretnya terputus; lihat `jalurArea`.
      {jalurArea(spark.d, TINGGI_SPARK) && bagian.push(
        <path key="spa" d={jalurArea(spark.d, TINGGI_SPARK)} fill="url(#gs-primary)" transform={`translate(${x + pad} ${cy})`} />,
      )}
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
      {jalurArea(sparkAtp.d, TINGGI_SPARK) && bagian.push(
        <path key="tapa" d={jalurArea(sparkAtp.d, TINGGI_SPARK)} fill="url(#gs-primary)" transform={`translate(${x + pad} ${cy})`} />,
      )}
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

  // --- sumbu waktu, SATU untuk kedua tren ---
  //
  // Kedua tren memakai rentang tanggal yang sama persis, jadi menyebutnya dua
  // kali hanya memakan tinggi kartu. Sumbunya tidak berlabel tanggal: di lebar
  // 294px, enam tanggal akan saling menimpa dan tidak ada yang bisa dibaca.
  // Yang perlu diketahui pembaca cuma SEBERAPA PANJANG rentangnya — itu yang
  // ditulis — sementara tanggal persisnya ada di halaman /monitoring.
  if (blok.tren || blok.trenAtp) {
    const sy = cy + 2;
    bagian.push(<line key="sx" x1={x + pad} y1={sy} x2={x + w - pad} y2={sy} stroke={WARNA.garisHalus} strokeWidth={1} />);
    for (let i = 0; i <= 3; i++) {
      const tx = x + pad + (isi * i) / 3;
      bagian.push(<line key={`sxt${i}`} x1={tx} y1={sy} x2={tx} y2={sy + 4} stroke={WARNA.garisHalus} strokeWidth={1} />);
    }
    bagian.push(<Teks key="sxl" x={x + w / 2} y={sy + 16} size={11} fill={WARNA.tintaLabel} anchor="middle">30 hari</Teks>);
    cy = sy + BIAYA_BLOK.sumbu;
  }

  return (
    <g onClick={onKlik} style={onKlik ? { cursor: 'pointer' } : undefined}>
      <rect x={x} y={y} width={w} height={h} rx={12} fill={WARNA.permukaan} stroke={WARNA.garis} strokeWidth={1} />
      <rect x={x} y={y} width={w} height={3} rx={1.5} fill={nKritis > 0 ? WARNA.kritisSolid : WARNA.amanSolid} />
      {bagian}
    </g>
  );
}

/** Nada kartu strip: netral (tanpa target), tercapai, atau meleset. */
type Nada = 'kritis' | 'aman';
type KartuRingkas = {
  l: string; v: string; ikon: string;
  seri?: (number | null)[];
  /** Teks target, mis. "Target \u2264 14h". Hanya ada pada angka yang punya target. */
  target?: string;
  /** Nilai targetnya, untuk garis putus-putus di sparkline. */
  targetNilai?: number;
  nada?: Nada;
};

const NADA_GARIS: Record<Nada, string> = { kritis: WARNA.kritisSolid, aman: WARNA.amanSolid };
const NADA_TINTA: Record<Nada, string> = { kritis: WARNA.kritisFg, aman: WARNA.amanFg };

/**
 * Satu kartu di strip kepala: label + ikon, angka, targetnya, lalu sparkline.
 *
 * Sparkline-nya DISKALAKAN IKUT TARGETNYA (`jalurSpark` menerima nilai target
 * sebagai anggota deret lewat `extra`), bukan hanya ikut rentang datanya. Tanpa
 * itu, target yang berada di luar rentang 30 hari — justru kasus yang paling
 * perlu dilihat, "tidak pernah tercapai" — akan tergambar di luar kotak atau
 * terpotong di tepinya.
 */
function KartuStrip({ r, x, y, w, fs }: { r: KartuRingkas; x: number; y: number; w: number; fs: number }) {
  const { pad, h } = STRIP;
  const isi = w - 2 * pad;
  const garis = r.nada ? NADA_GARIS[r.nada] : WARNA.primary;
  const tinta = r.nada ? NADA_TINTA[r.nada] : WARNA.tinta;
  const grad = r.nada ? `gs-${r.nada}` : 'gs-primary';
  // Label dipotong pada ruang yang TERSISA setelah ikon. SVG tidak membungkus
  // dan tidak punya elipsis: label kepanjangan akan tergambar menimpa ikonnya.
  const lab = potongTeks(r.l.toUpperCase(), isi - 22, 10);

  const SPARK_Y = 72;
  const SPARK_H = h - SPARK_Y - 8;
  const nilai = r.seri ?? [];
  const sp = nilai.length >= 2
    ? jalurSpark(nilai, isi, SPARK_H, 3, r.targetNilai)
    : null;
  const yTarget = sp && r.targetNilai !== undefined ? sp.yDari(r.targetNilai) : null;

  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={12} fill={WARNA.permukaan} stroke={WARNA.garis} strokeWidth={1} />
      <Teks x={x + pad} y={y + 20} size={10} weight={600} fill={WARNA.tintaLabel}>{lab}</Teks>
      <g
        transform={`translate(${x + w - pad - 16} ${y + 8})`}
        fill="none" stroke={WARNA.netralSolid} strokeWidth={1.3} strokeLinejoin="round" strokeLinecap="round" opacity={0.85}
      >
        <path d={IKON[r.ikon] ?? ''} />
      </g>
      <Teks x={x + pad} y={y + 50} size={fs} weight={700} fill={tinta} mono>{r.v}</Teks>
      {r.target ? (
        <Teks x={x + pad} y={y + 66} size={11} weight={700} fill={r.nada ? tinta : WARNA.tintaLabel}>{r.target}</Teks>
      ) : null}
      {sp?.d ? (
        <g transform={`translate(${x + pad} ${y + SPARK_Y})`}>
          {jalurArea(sp.d, SPARK_H) ? <path d={jalurArea(sp.d, SPARK_H)} fill={`url(#${grad})`} /> : null}
          {yTarget !== null ? (
            <line
              x1={0} y1={yTarget} x2={isi} y2={yTarget}
              stroke={garis} strokeWidth={2} strokeDasharray="7 5" strokeLinecap="round" opacity={0.95}
            />
          ) : null}
          <path d={sp.d} fill="none" stroke={garis} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {sp.titikAkhir ? <circle cx={sp.titikAkhir.x} cy={sp.titikAkhir.y} r={3} fill={garis} /> : null}
        </g>
      ) : null}
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
  // Angka DOI keseluruhan dinilai oleh ambang GABUNGAN, ATP oleh targetnya.
  // Satu aturan untuk seluruh strip: angka yang punya target memakai warna
  // untuk mengatakan terpenuhi atau tidak — kalau hanya salah satunya
  // berwarna, yang tidak berwarna terbaca seolah tidak punya target.
  const nadaDoi = (doi: number | null | undefined): Nada | undefined => {
    const n = nilaiDoi(doi, data.ambang);
    return n ? (n.baik ? 'aman' : 'kritis') : undefined;
  };
  const nadaAtp = (persen: number | null | undefined): Nada | undefined => {
    const n = nilaiAtp(persen, data.atpTarget);
    return n ? (n.baik ? 'aman' : 'kritis') : undefined;
  };
  // ---------------------------------------------------------------------
  // STRIP KEPALA — satu KARTU per angka (permintaan user 15 Okt 2026).
  //
  // Dulu satu kotak panjang dengan garis pemisah dan angka telanjang. Tiga hal
  // yang berubah, dan ketiganya menambah keterangan, bukan hiasan:
  //
  //   1. Tiap angka punya SPARKLINE 30 hari di bawahnya. "94,7%" tidak
  //      mengatakan apakah ia sedang naik dari 88% atau turun dari 99%; itu
  //      perbedaan antara kabar baik dan kabar buruk, dan selama ini hilang.
  //   2. Angka yang punya TARGET menulis targetnya di bawah angkanya DAN
  //      menggambarnya sebagai garis putus-putus di sparkline-nya. Jadi
  //      terbaca bukan cuma "hari ini meleset" tapi "30 hari tidak pernah
  //      menyentuhnya" — atau "baru memotongnya kemarin".
  //   3. Ikon kecil per kartu, sebagai penanda saja; labelnya tetap ditulis
  //      penuh, jadi ikon yang salah tafsir tidak menyesatkan.
  //
  // Dua kolom "Target DOI"/"Target ATP" yang sempat berdiri sendiri (pagi
  // 15 Okt) DIHAPUS: targetnya kini melebur ke kartu angkanya masing-masing,
  // dan kolom berisi angka mati yang tidak pernah berubah tiap hari hanya
  // mempersempit delapan kartu lainnya.
  // ---------------------------------------------------------------------
  const tt = data.trenTotal ?? [];
  // Perlu minimal dua titik: satu titik bukan tren, dan menggambarnya sebagai
  // garis datar akan menyatakan "tidak berubah" untuk sesuatu yang belum
  // pernah diukur dua kali.
  const seri = (f: (p: TitikTotal) => number | null): (number | null)[] | undefined =>
    (tt.length >= 2 ? tt.map(f) : undefined);
  const ringkas = [
    { l: 'SKU dihitung', v: t ? angkaRingkas(t.sku) : '\u2014', ikon: 'kalender', seri: seri((p) => p.sku) },
    ...(tampil1(disp) ? [{
      l: labelDoi(1, disp), v: t ? `${hari(t.doi1)} hari` : '\u2014', ikon: 'jam',
      seri: seri((p) => p.doi1), nada: nadaDoi(t?.doi1),
      target: data.ambang ? teksTarget(data.ambang.max) : undefined, targetNilai: data.ambang?.max,
    }] : []),
    ...(tampil2(disp) ? [{
      l: labelDoi(2, disp), v: t ? `${hari(t.doi2)} hari` : '\u2014', ikon: 'jam',
      seri: seri((p) => p.doi2), nada: nadaDoi(t?.doi2),
      target: data.ambang ? teksTarget(data.ambang.max) : undefined, targetNilai: data.ambang?.max,
    }] : []),
    { l: 'ADS', v: t ? adsTeks(tampil1(disp) ? t.ads1 : t.ads2) : '\u2014', ikon: 'batang', seri: seri((p) => (tampil1(disp) ? p.ads1 : p.ads2)) },
    { l: 'Total stok', v: t ? `${angkaRingkas(t.stock)} pcs` : '\u2014', ikon: 'kotak', seri: seri((p) => p.stock) },
    { l: 'Dalam perjalanan', v: t ? `${angkaRingkas(t.transit)} pcs` : '\u2014', ikon: 'truk', seri: seri((p) => p.transit) },
    { l: 'Nilai stok', v: t ? rupiahRingkas(t.value) : '\u2014', ikon: 'dompet', seri: seri((p) => p.value) },
    // SENGAJA TANPA SPARKLINE. Nilai barang dalam perjalanan dihitung ulang
    // dari baris snapshot hari ini (`nilaiTransit`) dan TIDAK ikut tersimpan di
    // ringkasan harian, jadi sejarah yang ada cuma nilai stok. Menggambarnya di
    // bawah angka "nilai + nilai SIT" berarti memasang kurva yang bukan milik
    // angka itu — lebih baik kosong daripada mirip-mirip.
    { l: 'Nilai + Nilai SIT', v: t ? rupiahRingkas(t.value + t.valueTransit) : '\u2014', ikon: 'koin' },
    {
      l: 'Kritis + Low', v: t ? `${t.kritis + t.low} SKU` : '\u2014', ikon: 'siaga',
      seri: seri((p) => p.kritisLow), nada: t && t.kritis > 0 ? ('kritis' as const) : undefined,
    },
    // ATP keseluruhan (permintaan user 10 Okt 2026). "\u2014" saat pembaginya 0
    // BUKAN 0%: artinya belum ada SKU yang diputuskan sebarannya di mana pun.
    {
      l: 'ATP keseluruhan', v: t?.atp ? persenAtp(t.atp.persen) : '\u2014', ikon: 'centang',
      seri: seri((p) => p.atp), nada: nadaAtp(t?.atp?.persen),
      target: teksTargetAtp(data.atpTarget) || undefined, targetNilai: data.atpTarget ?? undefined,
    },
  ] as KartuRingkas[];
  const rw = lebarStrip(ringkas.length);
  const rIsi = rw - 2 * STRIP.pad;
  // Ukuran angka DIUKUR dari teks yang benar-benar digambar, lihat
  // `ukuranStripMuat` — bukan tangga per jumlah kolom, yang tidak melihat
  // panjang teksnya sama sekali.
  const rFs = ukuranStripMuat(ringkas.map((r) => r.v), rIsi, 24);

  return (
    <svg
      id="wa-poster"
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${KANVAS.w} ${KANVAS.h}`}
      width={KANVAS.w}
      height={KANVAS.h}
      style={{ display: 'block', width: '100%', height: 'auto' }}
    >
      {/*
        Gradasi dideklarasikan SEKALI dan dipakai ulang semua sparkline.
        `objectBoundingBox` (bawaan) membuat satu definisi cocok untuk kotak
        ukuran apa pun, jadi tidak perlu satu defs per kartu — dan id yang
        beranak-pinak itulah yang biasanya tertukar saat poster diserialkan.
      */}
      <defs>
        {([['gs-primary', WARNA.primary], ['gs-kritis', WARNA.kritisSolid], ['gs-aman', WARNA.amanSolid]] as const).map(([id, c]) => (
          <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c} stopOpacity={c === WARNA.kritisSolid ? 0.20 : 0.28} />
            <stop offset="100%" stopColor={c} stopOpacity={0} />
          </linearGradient>
        ))}
      </defs>
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

      {/* ringkasan seluruh area — satu kartu per angka */}
      {ringkas.map((r, i) => (
        <KartuStrip key={r.l} r={r} x={M + i * (rw + STRIP.jarak)} y={STRIP.y} w={rw} fs={rFs} />
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
          onKlikAtp={onPilihArea ? () => onPilihArea(a.area, 'atp') : undefined}
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
