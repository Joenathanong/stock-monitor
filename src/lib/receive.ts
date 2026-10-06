/**
 * Barang dalam perjalanan (SIT) dari OCS — modul murni, tanpa jaringan & database.
 *
 * Sumbernya dua endpoint yang dipakai halaman /stocks/receive-stock:
 *   GET /api/receive-stock/docs            → daftar DO yang belum diterima
 *   GET /api/receive-stock/lines?docNum=N  → barisnya, satu per batch
 *
 * Tiga temuan dari pembongkaran 25 Sep 2026 yang menentukan bentuk modul ini:
 *
 * 1. `DoQty` SUDAH total dalam pcs. Tampilan "39 ctn 32 pcs" di layar OCS cuma
 *    format dari satu angka: floor(DoQty / PerCtnQty) ctn, sisanya pcs. Contoh
 *    nyata: Lipstick Cinnamon, PerCtnQty 72, DoQty 2840 → 72 × 39 + 32 = 2840.
 *    Jadi qty TIDAK boleh dikalikan lagi dengan isi karton.
 *
 * 2. `BatchQuantity` bukan angka yang sama. Dari 683 baris DO, 665 nilainya
 *    identik dengan DoQty; 18 sisanya jauh lebih besar (DoQty 72 vs 3.744) dan
 *    berbentuk stok batch penuh, bukan jumlah yang dikirim. DoQty tidak pernah
 *    melampaui BatchQuantity di seluruh 727 baris. Yang dipakai DOI: DoQty.
 *    BatchQuantity tetap disimpan sebagai pembanding.
 *
 * 3. Baris receive TIDAK punya kolom SKU, cuma `ItemCode` (kode SAP). Prefiksnya
 *    beda dari kode di stok (1201/1208 vs 1222/1228) tapi 6 digit terakhirnya
 *    sama — cara pencocokan yang sudah dipakai modul Phase Out.
 */
import { sapKey } from './phase-out';
import { namaAreaDari } from './area-master';

export type OcsReceiveDoc = {
  DoDocNum: number;
  LineCount?: number;
  TotalQty?: number;
  MinDoDocDate?: string;
  AddressCodes?: string;
};

export type OcsReceiveLine = {
  DoDocNum?: number;
  DoLineNum?: number;
  DoDocDate?: string;
  ItemCode?: string;
  ItemName?: string;
  PerCtnQty?: number;
  BatchNum?: string;
  DoQty?: number;
  BatchQuantity?: number;
  ExpDate?: string;
  AddressCode?: string;
};

// Daftar kode gudang TIDAK lagi ada di sini. Dulu konstanta `KODE_AREA` di
// berkas ini yang memutuskan kode mana milik area mana, jadi menambah cabang
// berarti mengubah kode dan deploy. Sekarang sumbernya tabel `area` (lihat
// `area-master.ts`), dan `mapReceive` menerima petanya sebagai argumen - sama
// pola dengan `sapKeIndex`, supaya modul ini tetap murni dan bisa diuji.

/**
 * Isi karton dari nama produk: angka setelah " x " yang TERAKHIR.
 *
 * Tidak harus di ujung nama. Master SAP memakai akhiran di belakang angkanya —
 * "… 15gr x 48 MP", "… 20ml x 100 - IEG", "… - Without Dus" — dan versi yang
 * mengharuskan angka di ujung gagal membaca 62 dari 713 baris GBJD (28 Sep 2026).
 * Yang tersisa cuma satu: "Tester0.06grx864", tanpa spasi sama sekali; itu
 * sengaja dibiarkan null karena pemisahnya memang " x " (spasi x spasi).
 */
export function isiBoxDariNama(nama: string | null | undefined): number | null {
  const m = [...String(nama ?? '').matchAll(/\sx\s*(\d+)\b/gi)];
  if (!m.length) return null;
  const n = Number(m[m.length - 1][1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export type BarisBox = {
  sku: string;
  name: string;
  fromOcs: number;
  fromName: number;
  perCtn: number;
  /** OCS dan nama produk sama-sama menyebut isi karton, tapi angkanya beda. */
  mismatch: boolean;
};

export type BarisTransit = {
  sku: string;
  areaId: string;
  /** Jumlah SIT yang dipakai DOI — dari DoQty. */
  qty: number;
  /** Versi BatchQuantity, hanya pembanding. */
  qtyBatch: number;
  eta: string | null;
  docNums: string;
  name: string;
  sapCode: string;
};

export type HasilReceive = {
  transit: BarisTransit[];
  box: BarisBox[];
  /** ItemCode yang tidak ketemu SKU-nya — dilaporkan, bukan dibuang diam-diam. */
  takCocok: { sapCode: string; name: string; areaId: string; qty: number }[];
  /**
   * Kode gudang yang TIDAK terdaftar di tabel area.
   *
   * Dulu kode semacam ini diam-diam dihitung sebagai "Pusat", jadi cabang baru
   * yang belum didaftarkan menambah SIT Pusat tanpa ada yang tahu. Sekarang
   * dikumpulkan di sini supaya bisa ditampilkan sebagai peringatan.
   */
  kodeAsing: { kode: string; baris: number; qty: number }[];
  totalDoQty: number;
  totalBatchQty: number;
};

/**
 * Ubah baris mentah OCS jadi baris transit per (SKU, area).
 *
 * `sapKeIndex` memetakan 6 digit terakhir kode SAP → { sku, name }. Dibangun
 * pemanggil dari stock_current supaya modul ini tetap murni dan bisa diuji.
 */
export function mapReceive(
  lines: OcsReceiveLine[],
  sapKeIndex: Map<string, { sku: string; name: string }>,
  /** Kode gudang → nama area, dari tabel `area`. Dibangun pemanggil. */
  petaArea: Map<string, string>,
): HasilReceive {
  const transit = new Map<string, BarisTransit>();
  const box = new Map<string, BarisBox>();
  const takCocok = new Map<string, { sapCode: string; name: string; areaId: string; qty: number }>();
  const kodeAsing = new Map<string, { kode: string; baris: number; qty: number }>();
  let totalDoQty = 0, totalBatchQty = 0;

  for (const l of lines) {
    const kode = String(l.ItemCode ?? '').trim();
    const qty = Math.max(0, Math.trunc(Number(l.DoQty) || 0));
    const qtyBatch = Math.max(0, Math.trunc(Number(l.BatchQuantity) || 0));
    if (!kode || qty <= 0) continue;
    const area = namaAreaDari(l.AddressCode, petaArea);
    const areaId = area.name;
    if (area.asing) {
      const a = kodeAsing.get(areaId) ?? { kode: areaId, baris: 0, qty: 0 };
      a.baris += 1; a.qty += qty;
      kodeAsing.set(areaId, a);
    }
    const nama = String(l.ItemName ?? '').slice(0, 500);
    totalDoQty += qty; totalBatchQty += qtyBatch;

    const kunciSap = sapKey(kode);
    const cocok = kunciSap ? sapKeIndex.get(kunciSap) : undefined;
    if (!cocok) {
      const k = `${kode}\u0000${areaId}`;
      const prev = takCocok.get(k);
      if (prev) prev.qty += qty;
      else takCocok.set(k, { sapCode: kode, name: nama, areaId, qty });
      continue;
    }

    // --- transit per (SKU, area); satu SKU bisa datang dari beberapa batch/DO ---
    const k = `${cocok.sku}\u0000${areaId}`;
    const prev = transit.get(k);
    const eta = typeof l.DoDocDate === 'string' ? l.DoDocDate.slice(0, 10) : null;
    const doc = l.DoDocNum ? String(l.DoDocNum) : '';
    if (prev) {
      prev.qty += qty; prev.qtyBatch += qtyBatch;
      // ETA paling awal yang dipakai — itu barang yang tiba duluan.
      if (eta && (!prev.eta || eta < prev.eta)) prev.eta = eta;
      if (doc && !prev.docNums.split(', ').includes(doc)) prev.docNums += `, ${doc}`;
    } else {
      transit.set(k, { sku: cocok.sku, areaId, qty, qtyBatch, eta, docNums: doc, name: cocok.name || nama, sapCode: kode });
    }

    // --- isi karton per SKU (lintas area; isinya sama di mana pun) ---
    const fromOcs = Math.max(0, Math.trunc(Number(l.PerCtnQty) || 0));
    const fromName = isiBoxDariNama(nama) ?? 0;
    const b = box.get(cocok.sku);
    if (b) {
      if (!b.fromOcs && fromOcs) b.fromOcs = fromOcs;
      if (!b.fromName && fromName) b.fromName = fromName;
    } else {
      box.set(cocok.sku, { sku: cocok.sku, name: nama, fromOcs, fromName, perCtn: 0, mismatch: false });
    }
  }

  // OCS menang kalau ada; nama produk dipakai sebagai cadangan — PerCtnQty
  // sering 0 (531 dari 727 baris terisi, sisanya kosong).
  for (const b of box.values()) {
    b.perCtn = b.fromOcs || b.fromName || 0;
    b.mismatch = b.fromOcs > 0 && b.fromName > 0 && b.fromOcs !== b.fromName;
  }

  return {
    transit: [...transit.values()].sort((a, b) => a.areaId.localeCompare(b.areaId) || b.qty - a.qty),
    box: [...box.values()],
    takCocok: [...takCocok.values()].sort((a, b) => b.qty - a.qty),
    kodeAsing: [...kodeAsing.values()].sort((a, b) => b.qty - a.qty),
    totalDoQty, totalBatchQty,
  };
}

/** "2840" + isi karton 72 → "39 ctn 32 pcs". Tanpa isi karton → pcs saja. */
export function formatCtnPcs(qty: number, perCtn: number): string {
  const n = Math.max(0, Math.trunc(qty));
  if (!perCtn || perCtn <= 0) return `${n.toLocaleString('id-ID')} pcs`;
  const ctn = Math.floor(n / perCtn);
  const sisa = n % perCtn;
  if (!ctn) return `${sisa.toLocaleString('id-ID')} pcs`;
  return sisa ? `${ctn.toLocaleString('id-ID')} ctn ${sisa} pcs` : `${ctn.toLocaleString('id-ID')} ctn`;
}
