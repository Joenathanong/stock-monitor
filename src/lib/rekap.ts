/**
 * Rekap harian stok & penjualan — modul MURNI (tanpa Prisma, tanpa jaringan).
 *
 * Menjawab permintaan user 8 Okt 2026: "menu untuk menampilkan data stock dan
 * penjualan harian, bisa back date ke tanggal yang kita tentukan."
 *
 * KENAPA BISA BACK DATE SAMA SEKALI. Angka yang dipakai BUKAN `stock_current`
 * (tabel itu memang "sekarang" — ditimpa tiap Refresh dan barisnya dihapus
 * kalau SKU-nya hilang dari OCS, jadi ia tidak punya masa lalu), melainkan dua
 * tabel yang kuncinya memuat TANGGAL:
 *
 *   stock_daily  (snapshotDate, sku, areaId)  — potret stok tiap hari
 *   sales_daily  (salesDate,    sku, areaId)  — penjualan tiap hari
 *
 * Keduanya ditulis `ON DUPLICATE KEY UPDATE`, jadi menarik ulang hari yang sama
 * memperbarui baris hari itu — bukan menambah baris, dan bukan menyentuh hari
 * lain. Hari kemarin tidak bisa berubah karena Refresh hari ini.
 *
 * SATU BATAS YANG HARUS DIINGAT SAAT MEMBACA ANGKANYA: `stock_daily` hanya
 * merekam `category = 'Sku'` (lihat syncStock). Jadi rekap stok back-date tidak
 * memuat Bundle & Gimmick, sementara ATP memuat ketiganya. Itu dilaporkan di
 * halamannya, tidak dibiarkan jadi selisih yang membingungkan.
 */

export type BarisStokHarian = {
  sku: string;
  areaId: string;
  availableQty: number;
  qtyOnHand: number;
  qtyOnOrder: number;
};

export type BarisJualHarian = {
  sku: string;
  areaId: string;
  qty: number;
  qtyCancel: number;
  qtyShopee: number;
  qtyTiktok: number;
  qtyTokped: number;
  qtyLazada: number;
  qtyOther: number;
};

/** Satu baris gabungan stok+penjualan untuk satu SKU di satu area pada satu hari. */
export type BarisRekap = {
  sku: string;
  areaId: string;
  name: string;
  /** Stok tercatat hari itu. null = tidak ada barisnya di potret hari itu. */
  stok: number | null;
  onHand: number | null;
  onOrder: number | null;
  terjual: number;
  batal: number;
  shopee: number;
  tiktok: number;
  tokped: number;
  lazada: number;
  lain: number;
};

export type RekapArea = {
  areaId: string;
  /** SKU yang punya baris stok hari itu. */
  skuStok: number;
  /** SKU yang terjual hari itu (qty > 0). */
  skuJual: number;
  stok: number;
  terjual: number;
  batal: number;
  shopee: number;
  tiktok: number;
  tokped: number;
  lazada: number;
  lain: number;
  /** SKU bersaldo 0 hari itu. */
  stokKosong: number;
};

const kunci = (sku: string, areaId: string) => `${areaId}\u0000${sku}`;

/**
 * Gabungkan potret stok dan penjualan satu hari menjadi satu daftar.
 *
 * GABUNGAN LUAR DI KEDUA ARAH, bukan hanya dari sisi stok. Alasannya konkret:
 *
 *   - SKU yang terjual hari itu tapi stoknya sudah nol dan barisnya hilang dari
 *     potret akan LENYAP dari rekap kalau digabung dari sisi stok saja — dan
 *     justru itu baris yang paling ingin dilihat orang ("terjual padahal
 *     kosong");
 *   - SKU yang ada stoknya tapi tidak terjual tetap harus muncul dengan 0,
 *     bukan hilang, supaya "tidak ada penjualan" bisa dibedakan dari "tidak
 *     ada datanya".
 *
 * `stok: null` sengaja dibedakan dari `stok: 0`: null berarti tidak ada
 * barisnya di potret hari itu (tidak diketahui), 0 berarti tercatat kosong.
 */
export function susunRekap(
  stok: BarisStokHarian[],
  jual: BarisJualHarian[],
  nama: Map<string, string> = new Map(),
): BarisRekap[] {
  const per = new Map<string, BarisRekap>();

  const ambil = (sku: string, areaId: string): BarisRekap => {
    const k = kunci(sku, areaId);
    let b = per.get(k);
    if (!b) {
      b = {
        sku, areaId, name: nama.get(sku) ?? '',
        stok: null, onHand: null, onOrder: null,
        terjual: 0, batal: 0, shopee: 0, tiktok: 0, tokped: 0, lazada: 0, lain: 0,
      };
      per.set(k, b);
    }
    return b;
  };

  for (const r of stok) {
    const b = ambil(r.sku, r.areaId);
    b.stok = (b.stok ?? 0) + Number(r.availableQty ?? 0);
    b.onHand = (b.onHand ?? 0) + Number(r.qtyOnHand ?? 0);
    b.onOrder = (b.onOrder ?? 0) + Number(r.qtyOnOrder ?? 0);
  }
  for (const r of jual) {
    const b = ambil(r.sku, r.areaId);
    b.terjual += Number(r.qty ?? 0);
    b.batal += Number(r.qtyCancel ?? 0);
    b.shopee += Number(r.qtyShopee ?? 0);
    b.tiktok += Number(r.qtyTiktok ?? 0);
    b.tokped += Number(r.qtyTokped ?? 0);
    b.lazada += Number(r.qtyLazada ?? 0);
    b.lain += Number(r.qtyOther ?? 0);
  }

  return [...per.values()].sort(
    (a, b) => b.terjual - a.terjual || a.sku.localeCompare(b.sku) || a.areaId.localeCompare(b.areaId),
  );
}

/** Ringkas per area. Baris gabungan TIDAK dibuat di sini — lihat `rekapTotal`. */
export function rekapPerArea(baris: BarisRekap[]): RekapArea[] {
  const per = new Map<string, RekapArea>();
  for (const r of baris) {
    let a = per.get(r.areaId);
    if (!a) {
      a = {
        areaId: r.areaId, skuStok: 0, skuJual: 0, stok: 0, terjual: 0, batal: 0,
        shopee: 0, tiktok: 0, tokped: 0, lazada: 0, lain: 0, stokKosong: 0,
      };
      per.set(r.areaId, a);
    }
    if (r.stok !== null) { a.skuStok++; a.stok += r.stok; if (r.stok === 0) a.stokKosong++; }
    if (r.terjual > 0) a.skuJual++;
    a.terjual += r.terjual; a.batal += r.batal;
    a.shopee += r.shopee; a.tiktok += r.tiktok; a.tokped += r.tokped;
    a.lazada += r.lazada; a.lain += r.lain;
  }
  return [...per.values()].sort((a, b) => b.terjual - a.terjual || a.areaId.localeCompare(b.areaId));
}

/**
 * Baris KESELURUHAN.
 *
 * `skuStok`/`skuJual` dihitung sebagai SKU UNIK lintas area, bukan jumlah dari
 * kolom per area: satu SKU yang ada di lima cabang akan terhitung lima kali
 * kalau kolomnya sekadar dijumlahkan, dan "1.662 SKU" berubah jadi "8.310 SKU"
 * tanpa ada yang salah secara aritmetika.
 */
export function rekapTotal(baris: BarisRekap[]): RekapArea {
  const t: RekapArea = {
    areaId: 'KESELURUHAN', skuStok: 0, skuJual: 0, stok: 0, terjual: 0, batal: 0,
    shopee: 0, tiktok: 0, tokped: 0, lazada: 0, lain: 0, stokKosong: 0,
  };
  const skuStok = new Set<string>();
  const skuJual = new Set<string>();
  for (const r of baris) {
    if (r.stok !== null) { skuStok.add(r.sku); t.stok += r.stok; if (r.stok === 0) t.stokKosong++; }
    if (r.terjual > 0) skuJual.add(r.sku);
    t.terjual += r.terjual; t.batal += r.batal;
    t.shopee += r.shopee; t.tiktok += r.tiktok; t.tokped += r.tokped;
    t.lazada += r.lazada; t.lain += r.lain;
  }
  t.skuStok = skuStok.size;
  t.skuJual = skuJual.size;
  return t;
}

/**
 * Baris yang paling pantas dilihat lebih dulu: TERJUAL padahal stok tercatat 0.
 *
 * Bukan hiasan — inilah bentuk kehilangan penjualan yang tidak muncul di angka
 * mana pun yang lain. DOI memakai rata-rata, jadi hari-hari seperti ini justru
 * MENURUNKAN ADS dan membuat DOI terlihat lebih aman daripada kenyataannya.
 */
export function terjualTanpaStok(baris: BarisRekap[]): BarisRekap[] {
  return baris.filter((r) => r.terjual > 0 && (r.stok === 0 || r.stok === null));
}
