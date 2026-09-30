/**
 * Saran Open PO — modul murni: tanpa jaringan, tanpa database.
 *
 * Kebutuhan tiap SKU sudah dihitung mesin DOI (`suggested1/2` =
 * ceil(target DOI × ADS − stok − transit)). Modul ini mengerjakan tiga hal yang
 * TIDAK dikerjakan mesin DOI:
 *
 *   1. membatasi saran dengan stok yang benar-benar ada di GBJD (Gudang Pusat
 *      EJI), kolom "Balance (With SQ)";
 *   2. membulatkan ke KARTON, karena barang dikirim per karton;
 *   3. membagi ke dua kode SAP: prefiks 122 dulu, sisanya 120.
 *
 * Aturan pembulatan (dari permintaan 25 Sep 2026, dipertahankan kata per kata):
 *   - "semua sugest open PO full karton" → kebutuhan dibulatkan NAIK ke karton
 *   - "kode awal 122 dulu full karton" → ambil karton utuh dari 122 lebih dulu
 *   - "jika kurang … sisanya ke 120, jika receh maka roundup 1 karton" →
 *     sisanya dari 120, pecahan karton dibulatkan naik
 *   - "jika kosong atau hanya ada 1 kode tapi jumlah kurang, maka round down" →
 *     tidak bisa dipenuhi penuh: ambil karton utuh yang ada, sisanya dilaporkan
 *   - "jika stock kurang dari 1 karton dan doi sudah tipis, proses saja
 *     walaupun kurang dari 1 karton" → DOI tipis = status CRITICAL atau LOW
 *   - "jika jumlah <0 maka tidak ada angka sugest PO, keterangan (Stock GBJD
 *     Kosong)"
 */

/** Status DOI yang dianggap "tipis" — boleh dikirim pecahan karton. */
export const STATUS_TIPIS = new Set(['CRITICAL', 'LOW']);

export type BarisOpenPo = {
  sku: string;
  name: string;
  areaId: string;
  /** Kebutuhan dalam pcs, dari saran mesin DOI. */
  need: number;
  status: string;
  /** DOI acuan — dipakai mengurutkan kemendesakan saat stok GBJD terbatas. */
  doi: number | null;
  /**
   * Isi satu karton (pcs) untuk MASING-MASING kode. 0 = tidak diketahui.
   *
   * Dipisah karena memang berbeda: dari 51 pasangan kode di GBJD (28 Sep 2026),
   * 35 pasangan isi kartonnya tidak sama — mis. "Power Bright Expert Serum
   * 20ml x 64 - IEG" (122) vs "… 20ml x 48" (120). Memakai satu angka untuk
   * keduanya membuat jumlah kiriman salah tanpa ada yang kelihatan keliru.
   */
  perCtn122: number;
  perCtn120: number;
  /** Balance (With SQ) di GBJD untuk kode berprefiks 122. */
  saldo122: number;
  /** Balance (With SQ) di GBJD untuk kode berprefiks 120. */
  saldo120: number;
  sap122?: string | null;
  sap120?: string | null;
};

export type AlasanPo =
  | 'OK'                 // kebutuhan terpenuhi penuh, karton utuh
  | 'KURANG'             // stok GBJD tidak cukup; diambil karton utuh yang ada
  | 'PECAHAN_TIPIS'      // < 1 karton, tapi DOI tipis → tetap diproses
  | 'KOSONG'             // saldo GBJD ≤ 0
  | 'TIDAK_PERLU'        // kebutuhan ≤ 0
  | 'TANPA_ISI_KARTON';  // isi karton tidak diketahui → dikirim apa adanya

export type HasilOpenPo = BarisOpenPo & {
  /** Karton dari tiap kode — isi kartonnya bisa berbeda, jadi dilaporkan terpisah. */
  ctn122: number;
  ctn120: number;
  /** Qty yang disarankan dari kode 122 (pcs). */
  qty122: number;
  /** Qty yang disarankan dari kode 120 (pcs). */
  qty120: number;
  qtyTotal: number;
  /** Jumlah karton utuh dalam qtyTotal; pecahan tidak dihitung di sini. */
  ctnTotal: number;
  /** Kebutuhan yang TIDAK terpenuhi (pcs) — 0 bila cukup. */
  kurang: number;
  alasan: AlasanPo;
  keterangan: string;
};

const bulat = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0);

/** Hitung saran untuk SATU baris. Murni, tidak menyentuh apa pun di luar. */
export function hitungBaris(b: BarisOpenPo): HasilOpenPo {
  const need = bulat(b.need);
  const c122 = bulat(b.perCtn122);
  const c120 = bulat(b.perCtn120);
  const s122 = bulat(b.saldo122);
  const s120 = bulat(b.saldo120);
  const dasar = { ...b, qty122: 0, qty120: 0, qtyTotal: 0, ctn122: 0, ctn120: 0, ctnTotal: 0, kurang: 0 };

  if (need <= 0) {
    return { ...dasar, alasan: 'TIDAK_PERLU', keterangan: '' };
  }
  // "jika jumlah <0 maka tidak ada angka sugest PO" — saldo nol pun sama saja:
  // tidak ada yang bisa diambil.
  if (s122 + s120 <= 0) {
    return { ...dasar, kurang: need, alasan: 'KOSONG', keterangan: 'Stock GBJD Kosong' };
  }
  // Tanpa isi karton di KEDUA kode, pembulatan karton mustahil. Dikirim apa
  // adanya dan ditandai, bukan ditebak — menebak isi karton berarti menebak
  // jumlah kiriman.
  if (c122 <= 0 && c120 <= 0) {
    const a = Math.min(need, s122);
    const c = Math.min(need - a, s120);
    return {
      ...dasar, qty122: a, qty120: c, qtyTotal: a + c,
      kurang: Math.max(0, need - a - c),
      alasan: 'TANPA_ISI_KARTON',
      keterangan: 'Isi karton tidak diketahui — qty dalam pcs',
    };
  }

  // "kode awal 122 dulu full karton" — dengan isi karton milik 122 sendiri.
  const ctn122 = c122 > 0 ? Math.min(Math.ceil(need / c122), Math.floor(s122 / c122)) : 0;
  const qty122 = ctn122 * c122;

  // "sisanya ke 120, jika receh maka roundup 1 karton" — ceil() inilah roundup-nya,
  // dan isi kartonnya milik 120, yang sering berbeda dari 122.
  const sisa = Math.max(0, need - qty122);
  const ctn120 = sisa > 0 && c120 > 0 ? Math.min(Math.ceil(sisa / c120), Math.floor(s120 / c120)) : 0;
  const qty120 = ctn120 * c120;

  const ctnTotal = ctn122 + ctn120;
  if (ctnTotal > 0) {
    const total = qty122 + qty120;
    const cukup = total >= need;
    const rinci = [ctn122 ? `122: ${ctn122} ctn×${c122}` : '', ctn120 ? `120: ${ctn120} ctn×${c120}` : '']
      .filter(Boolean).join(', ');
    return {
      ...dasar, qty122, qty120, qtyTotal: total, ctn122, ctn120, ctnTotal,
      kurang: cukup ? 0 : need - total,
      alasan: cukup ? 'OK' : 'KURANG',
      keterangan: cukup ? rinci : `Stok GBJD kurang — ${rinci || '0 ctn'}, kurang ${need - total} pcs`,
    };
  }

  // Sampai sini: dua-duanya kurang dari satu karton, tapi saldonya tidak nol.
  // "jika stock kurang dari 1 karton dan doi sudah tipis proses saja".
  if (STATUS_TIPIS.has(b.status)) {
    const a = Math.min(need, s122);
    const c = Math.min(need - a, s120);
    return {
      ...dasar, qty122: a, qty120: c, qtyTotal: a + c,
      kurang: Math.max(0, need - a - c),
      alasan: 'PECAHAN_TIPIS',
      keterangan: `Kurang dari 1 karton, tapi DOI tipis (${b.status}) — tetap diproses`,
    };
  }
  return {
    ...dasar, kurang: need, alasan: 'KURANG',
    keterangan: `Stok GBJD kurang dari 1 karton (${s122 + s120} pcs) dan DOI belum tipis`,
  };
}

/**
 * Urutan pelayanan saat stok GBJD diperebutkan beberapa kota.
 *
 * Paling mendesak didahulukan: CRITICAL, lalu LOW, lalu DOI terkecil. Tanpa
 * urutan yang tegas, kota yang kebetulan diproses duluan akan memborong stok
 * dan kota yang hampir kosong tidak kebagian.
 */
const PRIORITAS: Record<string, number> = { CRITICAL: 0, LOW: 1 };
export const urutKemendesakan = (a: BarisOpenPo, b: BarisOpenPo) =>
  (PRIORITAS[a.status] ?? 9) - (PRIORITAS[b.status] ?? 9)
  || (a.doi ?? Infinity) - (b.doi ?? Infinity)
  || b.need - a.need;

export type RingkasOpenPo = {
  baris: number;
  sku: number;
  qtyTotal: number;
  qty122: number;
  qty120: number;
  ctn122: number;
  ctn120: number;
  ctnTotal: number;
  kurang: number;
  kosong: number;
  pecahan: number;
};

/**
 * Hitung seluruh baris dengan stok GBJD yang DIPAKAI BERSAMA antar kota.
 *
 * Saldo dikurangi setiap kali dipakai, jadi satu karton tidak pernah
 * dijanjikan ke dua kota sekaligus — kesalahan yang baru ketahuan saat barang
 * tidak cukup di gudang.
 */
export function hitungSemua(rows: BarisOpenPo[]): { hasil: HasilOpenPo[]; ringkas: RingkasOpenPo } {
  const sisa = new Map<string, { s122: number; s120: number }>();
  for (const r of rows) {
    // Saldo GBJD milik SKU, bukan milik kota — jadi dikunci per SKU.
    if (!sisa.has(r.sku)) sisa.set(r.sku, { s122: bulat(r.saldo122), s120: bulat(r.saldo120) });
  }

  const hasil: HasilOpenPo[] = [];
  for (const r of [...rows].sort(urutKemendesakan)) {
    const s = sisa.get(r.sku)!;
    const h = hitungBaris({ ...r, saldo122: s.s122, saldo120: s.s120 });
    s.s122 -= h.qty122;
    s.s120 -= h.qty120;
    hasil.push(h);
  }

  const ringkas: RingkasOpenPo = {
    baris: hasil.length,
    sku: new Set(hasil.filter((h) => h.qtyTotal > 0).map((h) => h.sku)).size,
    qtyTotal: hasil.reduce((a, h) => a + h.qtyTotal, 0),
    qty122: hasil.reduce((a, h) => a + h.qty122, 0),
    qty120: hasil.reduce((a, h) => a + h.qty120, 0),
    ctn122: hasil.reduce((a, h) => a + h.ctn122, 0),
    ctn120: hasil.reduce((a, h) => a + h.ctn120, 0),
    ctnTotal: hasil.reduce((a, h) => a + h.ctnTotal, 0),
    kurang: hasil.reduce((a, h) => a + h.kurang, 0),
    kosong: hasil.filter((h) => h.alasan === 'KOSONG').length,
    pecahan: hasil.filter((h) => h.alasan === 'PECAHAN_TIPIS').length,
  };
  return { hasil, ringkas };
}
