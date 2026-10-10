/**
 * Sugest PO — aturan penyusunan baris, MURNI (tanpa Prisma, tanpa jaringan).
 *
 * Dipisah dari `sugest-po-store.ts` dengan sengaja. Yang ada di sini adalah
 * keputusan-keputusan yang kalau salah TIDAK BERGEJALA: siapa yang masuk daftar
 * PO, berapa kebutuhannya, dan apa batas atasnya. Kesalahan di situ tidak
 * memunculkan error — ia memunculkan angka pemesanan yang keliru, dan baru
 * ketahuan setelah barangnya terlanjur dikirim atau terlanjur tidak dikirim.
 *
 * Pemecahan ke kode SAP dan perebutan saldo antar cabang TIDAK di sini; itu
 * milik `openpo.ts` yang sudah punya tesnya sendiri.
 */
import type { BarisOpenPo } from './openpo';
import { kodeSumber, type BarisSkuLink, type SaldoPemasok } from './sku-link';

/**
 * Status yang masuk daftar PO.
 *
 * Spec menulis pemicunya `DOI <= area.doiMin`. CRITICAL dan LOW adalah PERSIS
 * dua pita di bawah doiMin (lihat `pitaDoi`), jadi memakai status berarti
 * memakai ambang cabang yang sama dengan yang dipakai layar — bukan menuliskan
 * perbandingan kedua yang bisa melenceng sendiri.
 *
 * HEALTHY sengaja TIDAK ikut, dan ini pernah salah sekali. Sampai 7 Okt 2026
 * syaratnya "bukan salah satu dari lima status mati", sehingga SKU AMAN pun
 * disarankan PO — karena AMAN berarti DOI ada DI ANTARA min dan max, jadi
 * `max*ads - posisi` selalu positif. Akibatnya di poster: Medan perluPo 121
 * (= Kritis 58 + Low 14 + Aman 48 + SIT 1) padahal yang benar 72. Itu
 * melebih-lebihkan beban PO 68% dan menyuruh orang memesan barang yang belum
 * perlu. SIT juga tidak ikut: stoknya memang tipis, tapi kiriman yang sedang
 * jalan sudah menutupinya — memesan lagi berarti pesan dua kali.
 */
export const STATUS_PO: readonly string[] = ['CRITICAL', 'LOW'];

export const masukPo = (status: string): boolean => STATUS_PO.includes(status);

/** Satu baris doi_snapshot, sebatas yang dibutuhkan Sugest PO. */
export type BarisSnapshotPo = {
  areaId: string;
  sku: string;
  name: string;
  status: string;
  abcClass: string;
  doi1: number | null;
  doi2: number | null;
  suggested1: number;
  suggested2: number;
};

export type SusunOpsi = {
  /** Opsi DOI yang dipakai, mengikuti `doi_display`. */
  opsi: 1 | 2;
  /** SKU OCS → groupKey, dari `sku_link`. */
  grup: Map<string, string>;
  /** groupKey → baris kode SAP, dari `sku_link`. */
  perGrup: Map<string, BarisSkuLink[]>;
  /** Saldo pemasok per (kode, gudang). */
  saldo: Map<string, SaldoPemasok>;
  /** Gudang pemasok urut prioritas. */
  gudang: string[];
};

export type TanpaMapping = { sku: string; name: string; areaId: string; need: number };

export type SusunHasil = {
  baris: BarisOpenPo[];
  /**
   * SKU yang perlu dipesan tapi belum punya mapping.
   *
   * Sejak 11 Okt 2026 mereka JUGA jadi baris PO biasa (dengan `kode: []`), jadi
   * daftar ini bukan lagi "yang dibuang" melainkan ringkasan untuk mengarahkan
   * perbaikan di Mapping SKU. Terukur saat keputusan itu diambil: 7 SKU, 22
   * baris, 28.840 pcs — 16% dari seluruh kebutuhan PO hari itu.
   */
  tanpaMapping: TanpaMapping[];
};

export function susunBarisPo(rows: BarisSnapshotPo[], o: SusunOpsi): SusunHasil {
  const baris: BarisOpenPo[] = [];
  const tanpaMapping: TanpaMapping[] = [];

  for (const r of rows) {
    if (!masukPo(r.status)) continue;
    const need = Math.max(0, Math.trunc(Number(o.opsi === 1 ? r.suggested1 : r.suggested2) || 0));
    if (need <= 0) continue;

    const groupKey = o.grup.get(r.sku);
    if (!groupKey) tanpaMapping.push({ sku: r.sku, name: r.name, areaId: r.areaId, need });

    baris.push({
      // Tanpa mapping, produknya diwakili SKU OCS-nya sendiri. Barisnya tetap
      // masuk daftar dengan kode sumber kosong — lihat `TANPA_MAPPING` di
      // openpo.ts untuk alasannya.
      groupKey: groupKey ?? r.sku,
      sku: r.sku,
      name: r.name,
      areaId: r.areaId,
      need,
      status: r.status,
      doi: o.opsi === 1 ? r.doi1 : r.doi2,
      abc: r.abcClass,
      kode: groupKey ? kodeSumber(groupKey, o.perGrup, o.saldo, o.gudang) : [],
      /**
       * Batas atas = kebutuhan itu sendiri.
       *
       * `suggested` dari mesin DOI SUDAH berarti "isi sampai penuh ke batas
       * Aman" (`ambang.max * ads - posisi`), jadi melewatinya berarti melewati
       * batas Aman. Tanpa batas ini, `Math.ceil(sisa / perCtn)` pada kebutuhan
       * 50 pcs dengan karton 1000 pcs (Naturgo Peel Off Mask, angka nyata dari
       * GBJD) menyarankan 1 karton = 20x kebutuhan, dan DOI melesat jauh di
       * atas Aman tanpa ada yang memperingatkan.
       */
      maxQty: need,
    });
  }

  tanpaMapping.sort((a, b) => b.need - a.need);
  return { baris, tanpaMapping };
}
