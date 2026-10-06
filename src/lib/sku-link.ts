/**
 * Pemetaan satu produk ke beberapa kode — modul murni, tanpa Prisma.
 *
 * Latar: sampai 28 Sep 2026 hubungan antar wadah disimpulkan dari bentuk kode —
 * wadah IEG berprefiks 1222/122, wadah EJI 1201/120, dan 6 digit terakhirnya
 * sama (`sapKey` di `phase-out.ts`). Dua hal membatalkan aturan itu:
 *
 *   1. satu produk bisa punya LEBIH dari dua kode;
 *   2. ada produk yang 6 digit terakhirnya TIDAK lagi sama antar wadah.
 *
 * Jadi hubungannya dipetakan di tabel `sku_link`. Heuristik 6-digit masih
 * dipakai, tapi HANYA untuk mengusulkan isi awal tabel — sesudah itu tabelnya
 * yang berlaku, dan usulan yang salah bisa dibetulkan tanpa mengubah kode.
 */
import { sapKey } from './phase-out';
import type { KodeSumber } from './openpo';

export type SistemKode = 'OCS' | 'SAP';

export type BarisSkuLink = {
  id?: number;
  groupKey: string;
  system: SistemKode;
  code: string;
  priority: number;
  perCtn: number | null;
  note?: string | null;
};

export const normalKode = (v: string | null | undefined) => String(v ?? '').trim().toUpperCase();

/**
 * Prioritas usulan dari prefiks kode SAP.
 *
 * Hanya tebakan awal supaya tabel tidak perlu diisi satu-satu dari nol: 122
 * (wadah IEG) lebih dulu, lalu 120 (wadah EJI), sisanya paling belakang. Begitu
 * user mengubahnya, nilai di tabel yang menang.
 */
export function prioritasUsulan(sapCode: string): number {
  const k = normalKode(sapCode);
  if (k.startsWith('122')) return 1;
  if (k.startsWith('120')) return 2;
  return 9;
}

/** SKU OCS → groupKey. SKU yang tidak terdaftar tidak muncul di peta. */
export function groupPerSku(rows: BarisSkuLink[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) {
    if (r.system !== 'OCS') continue;
    const k = normalKode(r.code);
    if (k) m.set(k, r.groupKey);
  }
  return m;
}

/** groupKey → kode SAP-nya, berurut prioritas. */
export function sapPerGroup(rows: BarisSkuLink[]): Map<string, BarisSkuLink[]> {
  const m = new Map<string, BarisSkuLink[]>();
  for (const r of rows) {
    if (r.system !== 'SAP') continue;
    const arr = m.get(r.groupKey) ?? [];
    arr.push(r);
    m.set(r.groupKey, arr);
  }
  for (const arr of m.values()) arr.sort((a, b) => a.priority - b.priority || a.code.localeCompare(b.code));
  return m;
}

export type SaldoPemasok = {
  balance: number;
  perCtn?: number | null;
  /** Gudang pemasok asal saldo ini. */
  supplierWhs?: string;
  /** Urutan gudang; kecil = diperiksa dulu. */
  whsPriority?: number;
};

/**
 * Kunci peta saldo: satu kode SAP di DUA gudang adalah dua saldo berbeda.
 * Dipakai bersama oleh pembangun peta dan pembacanya supaya tidak pernah beda.
 */
export const kunciSaldo = (sapCode: string, supplierWhs?: string) =>
  `${String(supplierWhs ?? '').trim().toUpperCase()}\u0000${normalKode(sapCode)}`;

/**
 * Susun daftar kode sumber untuk satu produk, siap dipakai `openpo.hitungBaris`.
 *
 * Isi karton: `sku_link.perCtn` menang kalau terisi, karena itu yang dipegang
 * user. Angka dari gudang pemasok jadi cadangan. Kode yang tidak ada saldonya
 * sama sekali TETAP disertakan dengan saldo 0 — supaya "Stock GBJD Kosong"
 * terbedakan dari "kodenya tidak terdaftar".
 */
export function kodeSumber(
  groupKey: string,
  sapRows: Map<string, BarisSkuLink[]>,
  saldo: Map<string, SaldoPemasok>,
  /** Gudang pemasok urut prioritas. Kosong = tanpa pembedaan gudang (satu sumber per kode). */
  daftarWhs: string[] = [],
): KodeSumber[] {
  const rows = sapRows.get(groupKey) ?? [];
  if (!daftarWhs.length) {
    return rows.map((r) => {
      const s = saldo.get(kunciSaldo(r.code));
      return {
        sapCode: r.code,
        priority: r.priority,
        perCtn: Math.max(0, Math.trunc(r.perCtn ?? s?.perCtn ?? 0)),
        saldo: Math.max(0, Math.trunc(s?.balance ?? 0)),
      };
    });
  }
  // Satu baris per (kode × gudang). Gudang yang tidak punya barisnya pun tetap
  // disertakan dengan saldo 0, supaya "kosong di GBJD2" terbaca sebagai fakta -
  // bukan hilang dari daftar sehingga terlihat seolah kodenya tidak terdaftar.
  const out: KodeSumber[] = [];
  for (const r of rows) {
    daftarWhs.forEach((whs, i) => {
      const s = saldo.get(kunciSaldo(r.code, whs));
      out.push({
        sapCode: r.code,
        priority: r.priority,
        supplierWhs: whs,
        whsPriority: i,
        perCtn: Math.max(0, Math.trunc(r.perCtn ?? s?.perCtn ?? 0)),
        saldo: Math.max(0, Math.trunc(s?.balance ?? 0)),
      });
    });
  }
  return out;
}

export type UsulLink = {
  groupKey: string;
  baris: BarisSkuLink[];
  /** Kenapa dikelompokkan begini — ditampilkan ke user sebelum disimpan. */
  alasan: string;
};

/**
 * Usulkan isi awal tabel dari data yang sudah ada.
 *
 * Masukan: SKU OCS beserta kode SAP-nya (dari `stock_current`), dan daftar kode
 * SAP yang ada di gudang pemasok. Pengelompokan memakai 6 digit terakhir —
 * dengan catatan tegas bahwa itu TEBAKAN dan harus diperiksa user.
 *
 * Kode SAP pemasok yang 6 digitnya tidak cocok dengan SKU mana pun dikembalikan
 * terpisah (`takCocok`), bukan dipaksa masuk kelompok mana pun.
 */
export function usulkanDari6Digit(
  skuOcs: { sku: string; sapCode: string | null; name?: string | null }[],
  kodeSap: { sapCode: string; perCtn?: number | null }[],
): { usul: UsulLink[]; takCocok: string[] } {
  // 6 digit → SKU OCS. SKU pertama menang, sama seperti `sync.ts`.
  const per6 = new Map<string, string>();
  for (const s of skuOcs) {
    const k = sapKey(s.sapCode ?? '');
    if (k && !per6.has(k)) per6.set(k, s.sku);
  }

  const perGroup = new Map<string, BarisSkuLink[]>();
  const takCocok: string[] = [];

  // Baris OCS: satu per SKU, groupKey = SKU-nya sendiri (cukup & mudah dilacak).
  for (const s of skuOcs) {
    const k = sapKey(s.sapCode ?? '');
    if (!k || per6.get(k) !== s.sku) continue;
    const arr = perGroup.get(s.sku) ?? [];
    arr.push({ groupKey: s.sku, system: 'OCS', code: s.sku, priority: 0, perCtn: null });
    perGroup.set(s.sku, arr);
  }

  for (const c of kodeSap) {
    const kode = normalKode(c.sapCode);
    const k = sapKey(kode);
    const sku = k ? per6.get(k) : undefined;
    if (!sku) { takCocok.push(kode); continue; }
    const arr = perGroup.get(sku) ?? [];
    arr.push({
      groupKey: sku, system: 'SAP', code: kode,
      priority: prioritasUsulan(kode),
      perCtn: c.perCtn ?? null,
    });
    perGroup.set(sku, arr);
  }

  const usul: UsulLink[] = [...perGroup.entries()]
    .filter(([, baris]) => baris.some((b) => b.system === 'SAP'))
    .map(([groupKey, baris]) => {
      const sap = baris.filter((b) => b.system === 'SAP');
      return {
        groupKey,
        baris: baris.sort((a, b) => a.priority - b.priority || a.code.localeCompare(b.code)),
        alasan: `${sap.length} kode SAP dengan 6 digit terakhir sama (${sap.map((x) => x.code).join(', ')}) — PERIKSA, ini tebakan`,
      };
    })
    .sort((a, b) => a.groupKey.localeCompare(b.groupKey));

  return { usul, takCocok: [...new Set(takCocok)].sort() };
}

export type GalatLink = { field: string; pesan: string };

export function validasiLink(x: Partial<BarisSkuLink>): GalatLink[] {
  const g: GalatLink[] = [];
  if (!String(x.groupKey ?? '').trim()) g.push({ field: 'groupKey', pesan: 'Kunci produk wajib diisi' });
  if (x.system !== 'OCS' && x.system !== 'SAP') g.push({ field: 'system', pesan: 'Sistem harus OCS atau SAP' });
  if (!normalKode(x.code)) g.push({ field: 'code', pesan: 'Kode wajib diisi' });
  const p = x.priority;
  if (p !== undefined && p !== null && (!Number.isFinite(p) || p < 0)) {
    g.push({ field: 'priority', pesan: 'Prioritas tidak boleh negatif' });
  }
  const c = x.perCtn;
  if (c !== undefined && c !== null && (!Number.isFinite(c) || c < 0)) {
    g.push({ field: 'perCtn', pesan: 'Isi karton tidak boleh negatif' });
  }
  return g;
}

/**
 * Kode yang terdaftar di DUA produk sekaligus.
 *
 * Harus kosong. Kalau tidak, saldo gudang bisa dijanjikan ke dua produk — dan
 * yang kelihatan hanyalah barang kurang di gudang, bukan sebabnya.
 */
export function kodeBentrok(rows: BarisSkuLink[]): { code: string; system: SistemKode; groups: string[] }[] {
  const m = new Map<string, Set<string>>();
  for (const r of rows) {
    const k = `${r.system}\u0000${normalKode(r.code)}`;
    const set = m.get(k) ?? new Set<string>();
    set.add(r.groupKey);
    m.set(k, set);
  }
  return [...m.entries()]
    .filter(([, g]) => g.size > 1)
    .map(([k, g]) => {
      const [system, code] = k.split('\u0000');
      return { code, system: system as SistemKode, groups: [...g].sort() };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}
