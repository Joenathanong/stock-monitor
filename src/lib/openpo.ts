/**
 * Saran Open PO — modul murni: tanpa jaringan, tanpa database.
 *
 * Kebutuhan tiap SKU sudah dihitung mesin DOI. Modul ini mengerjakan tiga hal
 * yang TIDAK dikerjakan mesin DOI:
 *
 *   1. membatasi saran dengan stok yang benar-benar ada di gudang pemasok
 *      (GBJD-nya EJI, kolom "Balance (With SQ)");
 *   2. membulatkan ke KARTON, karena barang dikirim per karton;
 *   3. membagi ke BEBERAPA kode SAP menurut prioritas.
 *
 * PERUBAHAN 2 Okt 2026 — dari dua slot jadi daftar berprioritas.
 * Versi sebelumnya mengunci tepat dua kode (`saldo122`/`saldo120`). Itu sah
 * selama satu produk hanya punya dua wadah dan keduanya bisa dikenali dari
 * prefiks kodenya. Dua hal membatalkannya: satu produk bisa punya lebih dari
 * dua kode SAP, dan ada produk yang 6 digit terakhirnya TIDAK lagi sama antar
 * wadah — jadi hubungan antar kode harus dipetakan (tabel `sku_link`), bukan
 * disimpulkan dari bentuk kode. Urutan 122-dulu-lalu-120 sekarang cuma kasus
 * khusus dari `priority`.
 *
 * Aturan pembulatan (permintaan 25 Sep 2026, dipertahankan kata per kata):
 *   - "semua sugest open PO full karton" → kebutuhan dibulatkan NAIK ke karton
 *   - "kode awal 122 dulu full karton" → ambil karton utuh dari prioritas teratas
 *   - "jika kurang … sisanya ke 120, jika receh maka roundup 1 karton" →
 *     sisanya dari prioritas berikutnya, pecahan karton dibulatkan naik
 *   - "jika kosong atau hanya ada 1 kode tapi jumlah kurang, maka round down" →
 *     tidak bisa dipenuhi penuh: ambil karton utuh yang ada, sisanya dilaporkan
 *   - "jika stock kurang dari 1 karton dan doi sudah tipis, proses saja
 *     walaupun kurang dari 1 karton" → DOI tipis = status CRITICAL atau LOW
 *   - "jika jumlah <0 maka tidak ada angka sugest PO, keterangan (Stock GBJD
 *     Kosong)"
 */

/** Status DOI yang dianggap "tipis" — boleh dikirim pecahan karton. */
export const STATUS_TIPIS = new Set(['CRITICAL', 'LOW']);

/**
 * Toleransi pembulatan karton — KEPUTUSAN USER 8 Okt 2026.
 *
 * Masalahnya: kebutuhan hampir tidak pernah pas sekelipatan karton, jadi
 * "full karton" selalu menabrak salah satu dari dua batas. Membulatkan TURUN
 * berarti barang dikirim kurang padahal gudang punya; membulatkan NAIK tanpa
 * batas pernah menyarankan 1000 pcs untuk kebutuhan 50 (Naturgo).
 *
 * Yang disetujui user:
 *   "boleh melebihi Aman maksimal 1 karton, DAN karton <= 2x kebutuhan"
 *
 * Dua syarat, keduanya harus terpenuhi:
 *   `ctn`    — berapa karton boleh melewati batas DOI max. 0 = batas keras.
 *   `lipat`  — toleransi hanya berlaku bila isi 1 karton <= lipat x kebutuhan.
 *              Inilah yang menahan kasus Naturgo: 1000 > 2 x 50, jadi tidak
 *              ditoleransi dan tetap dilaporkan untuk diputuskan orang.
 *
 * Bisa diubah dari halaman Pengaturan (`po_toleransi_ctn`, `po_lipat_maks`).
 */
export const TOLERANSI_BAWAAN = { ctn: 1, lipat: 2 } as const;

export type OpsiPo = {
  /** Berapa karton boleh melewati batas DOI max. Bawaan 1. */
  toleransiCtn?: number;
  /** Isi 1 karton maksimal N x kebutuhan agar boleh ditoleransi. Bawaan 2. 0 = tanpa syarat. */
  lipatMaks?: number;
};

/**
 * Satu SUMBER barang = satu kode SAP di satu gudang pemasok.
 *
 * Sejak 2 Okt 2026 ada dua gudang (GBJD2 dan GBJD), jadi satu kode SAP bisa
 * punya saldo di dua tempat sekaligus. Masing-masing jadi sumber sendiri dengan
 * saldonya sendiri — menjumlahkan keduanya akan menjanjikan karton dari gudang
 * yang sebenarnya tidak memilikinya, dan baris PO tidak bisa menyebut barangnya
 * diambil dari mana.
 */
export type KodeSumber = {
  sapCode: string;
  /** Kecil = diambil lebih dulu. Dari `sku_link.priority`. */
  priority: number;
  /** Gudang pemasok asal saldo ini (mis. GBJD2). Kosong = tanpa pembedaan gudang. */
  supplierWhs?: string;
  /**
   * Urutan gudang; kecil = diperiksa lebih dulu. Dari urutan `EJI_WHS`.
   *
   * KEPUTUSAN USER 2 Okt 2026: GUDANG yang menentukan lebih dulu, kode kedua.
   * Jadi GBJD2 dihabiskan dulu apa pun kodenya, baru pindah ke GBJD. Akibatnya
   * kode 120 dari GBJD2 bisa terkirim walau 122 masih ada di GBJD — aturan
   * "122 dulu" berlaku DI DALAM satu gudang, tidak lintas gudang. Ini disengaja.
   */
  whsPriority?: number;
  /**
   * Isi satu karton (pcs) untuk kode INI. 0 = tidak diketahui.
   *
   * Sengaja per kode: dari 51 pasangan kode di GBJD (28 Sep 2026), 35 pasangan
   * isi kartonnya TIDAK sama — mis. "Power Bright Expert Serum 20ml x 64 - IEG"
   * (122) vs "… 20ml x 48" (120). Satu angka untuk semuanya membuat jumlah
   * kiriman salah tanpa ada yang kelihatan keliru.
   */
  perCtn: number;
  /** Balance (With SQ) di gudang pemasok. */
  saldo: number;
};

export type BarisOpenPo = {
  /** Kunci produk logis — beberapa kode SAP bisa menunjuk produk yang sama. */
  groupKey: string;
  /** SKU OCS yang DOI-nya dihitung. */
  sku: string;
  name: string;
  areaId: string;
  /** Kebutuhan dalam pcs, dari saran mesin DOI. */
  need: number;
  status: string;
  /** DOI acuan — dipakai mengurutkan kemendesakan saat saldo terbatas. */
  doi: number | null;
  /**
   * Kelas ABC dari mesin DOI (`assignAbc`): 'A' | 'B' | 'C'. Kosong = belum ada.
   *
   * KEPUTUSAN USER 8 Okt 2026: ABC jadi PEMECAH SERI, bukan penentu utama.
   * Kemendesakan tetap di depan — SKU kelas C yang sudah CRITICAL tidak boleh
   * kehilangan kartonnya ke SKU kelas A yang masih aman. Di dalam status yang
   * sama, kelas A dilayani lebih dulu.
   *
   * Angkanya dihitung ulang tiap kali mesin DOI jalan, dari penjualan jendela
   * Opsi 1 — jadi kelas sebuah SKU ikut berubah sendiri kalau penjualannya
   * berubah. Tidak ada yang perlu dipelihara tangan.
   */
  abc?: string;
  /** Kode sumber, urutan bebas: modul ini yang mengurutkannya menurut priority. */
  kode: KodeSumber[];
  /**
   * Batas atas qty (pcs) supaya posisi stok tidak melewati DOI max area.
   *
   * DITAMBAHKAN 5 Okt 2026 setelah data GBJD nyata terbaca. Isi karton di
   * lapangan bukan 48–144 seperti contoh awal: Naturgo Peel Off Mask isinya
   * **1000 pcs/karton**. Tanpa batas atas, `Math.ceil(sisa / perCtn)` pada
   * kebutuhan 50 pcs menyarankan 1 karton = 1000 pcs — 20x kebutuhan, dan DOI
   * langsung melesat jauh di atas max. Jadi "full box" HARUS dibandingkan
   * dengan DOI max, bukan hanya DOI min.
   *
   * Dihitung PEMANGGIL (mesin DOI yang tahu ADS & stok sekarang), bukan di
   * sini: modul ini tidak boleh tahu soal ADS.
   *
   * undefined / <= 0 = tanpa batas (perilaku lama dipertahankan).
   */
  maxQty?: number;
};

export type AlasanPo =
  | 'OK'                 // kebutuhan terpenuhi penuh, karton utuh
  | 'KURANG'             // saldo tidak cukup; diambil karton utuh yang ada
  | 'PECAHAN_TIPIS'      // < 1 karton, tapi DOI tipis → tetap diproses
  | 'KOSONG'             // saldo ≤ 0, kodenya ada
  | 'TANPA_MAPPING'      // belum ada kode SAP sama sekali — kebutuhan tetap dicatat
  | 'TIDAK_PERLU'        // kebutuhan ≤ 0
  | 'TANPA_ISI_KARTON'   // isi karton tidak diketahui → dikirim apa adanya
  | 'DIBATASI_DOI_MAX'   // dibulatkan TURUN supaya tidak melewati DOI max
  | 'TOLERANSI_DOI_MAX'  // dibulatkan NAIK dan melewati batas, masih dalam toleransi
  | 'KARTON_LEBIH_DARI_MAX'; // 1 karton saja sudah melewati DOI max

/** Berapa yang diambil dari satu kode. */
export type AmbilKode = {
  sapCode: string;
  /** Gudang asal barang ini — tanpa ini baris PO tidak bisa dieksekusi orang gudang. */
  supplierWhs?: string;
  perCtn: number;
  ctn: number;
  qty: number;
};

export type HasilOpenPo = BarisOpenPo & {
  /** Hanya kode yang benar-benar dipakai (qty > 0), berurut priority. */
  ambil: AmbilKode[];
  qtyTotal: number;
  /** Jumlah karton utuh dalam qtyTotal; pecahan tidak dihitung di sini. */
  ctnTotal: number;
  /** Kebutuhan yang TIDAK terpenuhi (pcs) — 0 bila cukup. */
  kurang: number;
  alasan: AlasanPo;
  keterangan: string;
};

const bulat = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0);

/**
 * Urutan pengambilan: GUDANG dulu (`whsPriority`), lalu kode (`priority`),
 * lalu urutan aslinya sebagai penentu terakhir supaya hasilnya selalu sama.
 */
const urutKode = (kode: KodeSumber[]) =>
  [...kode].map((k, i) => ({ k, i }))
    .sort((a, b) =>
      ((a.k.whsPriority ?? 0) - (b.k.whsPriority ?? 0))
      || (a.k.priority - b.k.priority)
      || (a.i - b.i))
    .map(({ k }) => ({
      sapCode: k.sapCode,
      priority: k.priority,
      supplierWhs: k.supplierWhs,
      whsPriority: k.whsPriority,
      perCtn: bulat(k.perCtn),
      saldo: bulat(k.saldo),
    }));

/** Kunci saldo: satu kode di dua gudang adalah DUA saldo, bukan satu. */
const kunciSaldo = (k: { sapCode: string; supplierWhs?: string }) =>
  `${k.supplierWhs ?? ''}\u0000${k.sapCode}`;

/** Label sumber untuk keterangan: "GBJD2/1222…" kalau gudangnya diketahui. */
const labelSumber = (k: { sapCode: string; supplierWhs?: string }) =>
  (k.supplierWhs ? `${k.supplierWhs}/${k.sapCode}` : k.sapCode);

/** Hitung saran untuk SATU baris. Murni, tidak menyentuh apa pun di luar. */
export function hitungBaris(b: BarisOpenPo, opsi: OpsiPo = {}): HasilOpenPo {
  const need = bulat(b.need);
  const kode = urutKode(b.kode ?? []);
  const totalSaldo = kode.reduce((a, k) => a + k.saldo, 0);
  const dasar = { ...b, ambil: [] as AmbilKode[], qtyTotal: 0, ctnTotal: 0, kurang: 0 };

  if (need <= 0) return { ...dasar, alasan: 'TIDAK_PERLU', keterangan: '' };

  // BELUM ADA KODE SAP sama sekali — beda dari "kodenya ada tapi saldonya nol",
  // dan bedanya menentukan tindakan: yang ini diperbaiki di Mapping SKU, yang
  // itu ditunggu barangnya masuk gudang pemasok.
  //
  // Keputusan user 11 Okt 2026: barisnya TETAP muncul di Sugest PO dan template
  // open PO, dengan kolom sumber kosong tapi kebutuhannya tertulis. Sebelumnya
  // baris begini dibuang dari daftar, dan 28.840 pcs kebutuhan (16% dari total)
  // lenyap tanpa jejak — terbaca orang gudang sebagai "memang belum perlu
  // dipesan", kebalikan dari keadaannya.
  if (!kode.length) {
    return {
      ...dasar, kurang: need, alasan: 'TANPA_MAPPING',
      keterangan: 'Belum ada kode SAP di Mapping SKU — kebutuhan tetap dicatat, sumbernya diisi manual',
    };
  }

  // "jika jumlah <0 maka tidak ada angka sugest PO" — saldo nol pun sama saja:
  // tidak ada yang bisa diambil. Barisnya TETAP ditampilkan (keputusan user
  // 11 Okt 2026): open PO tetap perlu dibuat walau GBJD/GBJD2 sedang kosong.
  if (totalSaldo <= 0) {
    return { ...dasar, kurang: need, alasan: 'KOSONG', keterangan: 'Stock GBJD Kosong' };
  }

  /** Ambil apa adanya dalam pcs, berurut prioritas — tanpa pembulatan karton. */
  const ambilPcs = (): AmbilKode[] => {
    let sisa = need;
    const out: AmbilKode[] = [];
    for (const k of kode) {
      if (sisa <= 0) break;
      const qty = Math.min(sisa, k.saldo);
      if (qty > 0) { out.push({ sapCode: k.sapCode, supplierWhs: k.supplierWhs, perCtn: k.perCtn, ctn: 0, qty }); sisa -= qty; }
    }
    return out;
  };
  const jumlah = (a: AmbilKode[]) => a.reduce((x, k) => x + k.qty, 0);

  // Tanpa isi karton di SEMUA kode, pembulatan karton mustahil. Dikirim apa
  // adanya dan ditandai, bukan ditebak — menebak isi karton berarti menebak
  // jumlah kiriman.
  if (!kode.some((k) => k.perCtn > 0)) {
    const ambil = ambilPcs();
    const total = jumlah(ambil);
    return {
      ...dasar, ambil, qtyTotal: total, kurang: Math.max(0, need - total),
      alasan: 'TANPA_ISI_KARTON',
      keterangan: 'Isi karton tidak diketahui — qty dalam pcs',
    };
  }

  // Jalur utama: karton utuh, sumber teratas dulu (gudang lalu kode), sisanya
  // ke sumber berikutnya.
  // Contoh user 2 Okt 2026: need 96, kode A isi 48 saldo 50, kode B isi 12 →
  // A: min(ceil(96/48), floor(50/48)) = min(2,1) = 1 ctn = 48 pcs; sisa 48 →
  // B: ceil(48/12) = 4 ctn = 48 pcs. Total 96, semuanya full box.
  //
  // Batas atas DOI max (lihat BarisOpenPo.maxQty). Tanpa batas kalau <= 0.
  const maxQty = bulat(b.maxQty ?? 0);
  const adaBatas = maxQty > 0;
  // Kalau batasnya lebih kecil dari kebutuhan, kebutuhanlah yang menang: DOI
  // min dan DOI max tidak boleh saling mengunci sampai tidak ada yang dikirim.
  const plafon = adaBatas ? Math.max(maxQty, need) : Infinity;

  // Toleransi pembulatan (lihat TOLERANSI_BAWAAN). Jatahnya PER BARIS, bukan
  // per kode: "melebihi maksimal 1 karton" berarti satu karton untuk seluruh
  // baris, bukan satu karton untuk setiap kode yang ikut dipakai.
  const toleransiCtn = Math.max(0, Math.trunc(opsi.toleransiCtn ?? TOLERANSI_BAWAAN.ctn));
  const lipatMaks = Math.max(0, Number(opsi.lipatMaks ?? TOLERANSI_BAWAAN.lipat));
  let jatahToleransi = adaBatas ? toleransiCtn : 0;

  const ambil: AmbilKode[] = [];
  let sisa = need;
  let dibatasi = false;    // pernah dibulatkan TURUN karena plafon
  let ditoleransi = 0;     // karton yang sengaja dibiarkan melewati plafon
  for (const k of kode) {
    if (sisa <= 0 || k.perCtn <= 0) continue;
    const sudah = ambil.reduce((a, x) => a + x.qty, 0);
    const naik = Math.ceil(sisa / k.perCtn);               // "full box", bulat naik
    const adaStok = Math.floor(k.saldo / k.perCtn);        // yang benar-benar ada
    const inginkan = Math.min(naik, adaStok);              // tanpa plafon, sebanyak ini
    // Karton yang masih masuk plafon. Kalau bulat-naik melewatinya, pakai yang
    // masih masuk — itulah "bulat TURUN" yang dimaksud.
    const masukPlafon = plafon === Infinity
      ? naik
      : Math.floor(Math.max(0, plafon - sudah) / k.perCtn);
    let ctn = Math.min(inginkan, masukPlafon);
    // Kurang dari yang dibutuhkan HANYA karena plafon? Pakai jatah toleransi —
    // tapi cuma kalau kartonnya tidak jauh lebih besar dari kebutuhan.
    if (ctn < inginkan && jatahToleransi > 0) {
      const bolehLipat = lipatMaks <= 0 || k.perCtn <= lipatMaks * need;
      const tambah = bolehLipat ? Math.min(jatahToleransi, inginkan - ctn) : 0;
      if (tambah > 0) { ctn += tambah; jatahToleransi -= tambah; ditoleransi += tambah; }
    }
    if (ctn < inginkan) dibatasi = true;
    if (ctn <= 0) continue;
    const qty = ctn * k.perCtn;
    ambil.push({ sapCode: k.sapCode, supplierWhs: k.supplierWhs, perCtn: k.perCtn, ctn, qty });
    sisa -= qty;
  }

  const ctnTotal = ambil.reduce((a, k) => a + k.ctn, 0);
  if (ctnTotal > 0) {
    const total = jumlah(ambil);
    const cukup = total >= need;
    const rinci = ambil.map((k) => `${labelSumber(k)}: ${k.ctn} ctn×${k.perCtn}`).join(', ');
    if (!cukup && dibatasi) {
      // Sebut batas yang BENAR-BENAR mengikat. Kalau plafon berasal dari
      // `need` (karena maxQty lebih kecil dari kebutuhan), menyebut "DOI max
      // 400" padahal yang dikirim 432 adalah pesan yang berbohong — ketemu
      // lewat tes 5 Okt 2026.
      const dariMax = plafon === maxQty;
      return {
        ...dasar, ambil, qtyTotal: total, ctnTotal, kurang: need - total,
        alasan: 'DIBATASI_DOI_MAX',
        keterangan: dariMax
          ? `Dibulatkan turun agar tidak melewati DOI max (batas ${maxQty} pcs) — ${rinci}`
          : `Dibulatkan turun agar tidak melebihi kebutuhan ${need} pcs sebanyak 1 karton `
            + `(DOI max ${maxQty} pcs lebih kecil dari kebutuhan, jadi kebutuhan yang dipakai) — ${rinci}`,
      };
    }
    // Dibulatkan NAIK melewati batas, tapi masih dalam toleransi yang
    // disetujui user. Dilaporkan terang-terangan — angka yang melewati DOI max
    // tidak boleh muncul tanpa alasan yang tertulis.
    if (cukup && ditoleransi > 0) {
      const lewat = adaBatas ? Math.max(0, total - maxQty) : 0;
      return {
        ...dasar, ambil, qtyTotal: total, ctnTotal, kurang: 0,
        alasan: 'TOLERANSI_DOI_MAX',
        keterangan: `Dibulatkan naik ${ditoleransi} karton melewati DOI max`
          + (lewat > 0 ? ` (lebih ${lewat} pcs dari batas ${maxQty})` : '')
          + ` — masih dalam toleransi ${toleransiCtn} karton — ${rinci}`,
      };
    }
    return {
      ...dasar, ambil, qtyTotal: total, ctnTotal,
      kurang: cukup ? 0 : need - total,
      alasan: cukup ? 'OK' : 'KURANG',
      keterangan: cukup ? rinci : `Stok GBJD kurang — ${rinci || '0 ctn'}, kurang ${need - total} pcs`,
    };
  }

  // Tidak ada karton utuh YANG MASUK PLAFON, padahal stoknya ada dan kartonnya
  // diketahui. Artinya satu karton terkecil pun sudah melewati DOI max —
  // kasus Naturgo: karton 1000 pcs, kebutuhan 50.
  //
  // Dua-duanya merugikan, jadi dipilih berdasarkan kemendesakan dan DILAPORKAN,
  // tidak diputuskan diam-diam:
  //   DOI tipis (CRITICAL/LOW) -> kirim 1 karton terkecil. Kehabisan barang
  //     lebih mahal daripada kelebihan stok.
  //   DOI tidak tipis          -> JANGAN kirim. Ditandai supaya orangnya yang
  //     memutuskan, bukan sistem.
  if (adaBatas && kode.some((k) => k.perCtn > 0 && k.saldo >= k.perCtn)) {
    const muat = kode.filter((k) => k.perCtn > 0 && k.saldo >= k.perCtn)
      .sort((x, y) => x.perCtn - y.perCtn)[0];
    const lipat = Math.round((muat.perCtn / Math.max(1, need)) * 10) / 10;
    if (STATUS_TIPIS.has(b.status)) {
      const qty = muat.perCtn;
      return {
        ...dasar,
        ambil: [{ sapCode: muat.sapCode, supplierWhs: muat.supplierWhs, perCtn: muat.perCtn, ctn: 1, qty }],
        qtyTotal: qty, ctnTotal: 1, kurang: 0,
        alasan: 'KARTON_LEBIH_DARI_MAX',
        keterangan: `Karton terkecil ${muat.perCtn} pcs = ${lipat}x kebutuhan ${need} pcs dan melewati `
          + `batas Aman — TETAP dikirim supaya tidak sampai kosong (status ${b.status})`,
      };
    }
    return {
      ...dasar, kurang: need,
      alasan: 'KARTON_LEBIH_DARI_MAX',
      keterangan: `TIDAK dikirim: karton terkecil ${muat.perCtn} pcs = ${lipat}x kebutuhan `
        + `${need} pcs dan melewati DOI max (${maxQty} pcs)`
        + (lipatMaks > 0 ? `, di luar toleransi ${lipatMaks}x` : '')
        + '. Putuskan manual.',
    };
  }

  // Sampai sini: tidak ada satu pun kode yang punya karton utuh, tapi saldonya
  // tidak nol. "jika stock kurang dari 1 karton dan doi sudah tipis proses saja".
  if (STATUS_TIPIS.has(b.status)) {
    const pecah = ambilPcs();
    const total = jumlah(pecah);
    return {
      ...dasar, ambil: pecah, qtyTotal: total, kurang: Math.max(0, need - total),
      alasan: 'PECAHAN_TIPIS',
      keterangan: `Kurang dari 1 karton, tapi DOI tipis (${b.status}) — tetap diproses`,
    };
  }
  return {
    ...dasar, kurang: need, alasan: 'KURANG',
    keterangan: `Stok GBJD kurang dari 1 karton (${totalSaldo} pcs) dan DOI belum tipis`,
  };
}

/**
 * Urutan pelayanan saat saldo pemasok diperebutkan beberapa kota.
 *
 * Paling mendesak didahulukan: CRITICAL, lalu LOW, lalu KELAS ABC, lalu DOI
 * terkecil, lalu kebutuhan terbesar. Tanpa urutan yang tegas, kota yang
 * kebetulan diproses duluan akan memborong stok dan kota yang hampir kosong
 * tidak kebagian.
 *
 * ABC disisipkan 8 Okt 2026 atas permintaan user — SESUDAH status, bukan
 * sebelumnya. Urutan itu yang membuat "dahulukan barang laris" tidak berubah
 * jadi "biarkan barang pelan kosong di cabang": kelas C yang sudah CRITICAL
 * tetap dilayani sebelum kelas A yang masih aman.
 */
const PRIORITAS: Record<string, number> = { CRITICAL: 0, LOW: 1 };

/** Urutan kelas ABC; kelas yang belum ada ditaruh paling akhir, bukan dianggap A. */
const PRIORITAS_ABC: Record<string, number> = { A: 0, B: 1, C: 2 };
export const urutanAbc = (abc?: string) =>
  PRIORITAS_ABC[String(abc ?? '').trim().toUpperCase()] ?? 9;

export const urutKemendesakan = (a: BarisOpenPo, b: BarisOpenPo) =>
  (PRIORITAS[a.status] ?? 9) - (PRIORITAS[b.status] ?? 9)
  || urutanAbc(a.abc) - urutanAbc(b.abc)
  || (a.doi ?? Infinity) - (b.doi ?? Infinity)
  || b.need - a.need;

export type RingkasOpenPo = {
  baris: number;
  sku: number;
  qtyTotal: number;
  ctnTotal: number;
  /** Qty & karton per (gudang, kode SAP) — menggantikan qty122/qty120 yang dulu dipatok dua. */
  perKode: { sapCode: string; supplierWhs?: string; qty: number; ctn: number }[];
  kurang: number;
  kosong: number;
  pecahan: number;
};

/**
 * Hitung seluruh baris dengan saldo pemasok yang DIPAKAI BERSAMA antar kota.
 *
 * Saldo dikurangi setiap kali dipakai, jadi satu karton tidak pernah dijanjikan
 * ke dua kota sekaligus — kesalahan yang baru ketahuan saat barang tidak cukup
 * di gudang. Kuncinya kode SAP, bukan kota: satu kode melayani semua kota.
 */
export function hitungSemua(rows: BarisOpenPo[], opsi: OpsiPo = {}): { hasil: HasilOpenPo[]; ringkas: RingkasOpenPo } {
  const sisa = new Map<string, number>();
  for (const r of rows) {
    for (const k of r.kode ?? []) {
      const kk = kunciSaldo(k);
      if (!sisa.has(kk)) sisa.set(kk, bulat(k.saldo));
    }
  }

  const hasil: HasilOpenPo[] = [];
  for (const r of [...rows].sort(urutKemendesakan)) {
    const kode = (r.kode ?? []).map((k) => ({ ...k, saldo: sisa.get(kunciSaldo(k)) ?? bulat(k.saldo) }));
    const h = hitungBaris({ ...r, kode }, opsi);
    for (const a of h.ambil) {
      const kk = kunciSaldo(a);
      sisa.set(kk, Math.max(0, (sisa.get(kk) ?? 0) - a.qty));
    }
    hasil.push(h);
  }

  const perKode = new Map<string, { sapCode: string; supplierWhs?: string; qty: number; ctn: number }>();
  for (const h of hasil) {
    for (const a of h.ambil) {
      const kk = kunciSaldo(a);
      const e = perKode.get(kk) ?? { sapCode: a.sapCode, supplierWhs: a.supplierWhs, qty: 0, ctn: 0 };
      e.qty += a.qty; e.ctn += a.ctn;
      perKode.set(kk, e);
    }
  }

  const ringkas: RingkasOpenPo = {
    baris: hasil.length,
    sku: new Set(hasil.filter((h) => h.qtyTotal > 0).map((h) => h.sku)).size,
    qtyTotal: hasil.reduce((a, h) => a + h.qtyTotal, 0),
    ctnTotal: hasil.reduce((a, h) => a + h.ctnTotal, 0),
    perKode: [...perKode.values()].sort((a, b) => b.qty - a.qty),
    kurang: hasil.reduce((a, h) => a + h.kurang, 0),
    kosong: hasil.filter((h) => h.alasan === 'KOSONG').length,
    pecahan: hasil.filter((h) => h.alasan === 'PECAHAN_TIPIS').length,
  };
  return { hasil, ringkas };
}
