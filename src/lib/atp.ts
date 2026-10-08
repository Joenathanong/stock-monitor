/**
 * ATP (Available to Promise) — modul MURNI: tanpa jaringan, tanpa database.
 *
 * Pertanyaan yang dijawab halaman ATP: dari SKU yang MEMANG DISEBAR ke sebuah
 * cabang, berapa persen yang stoknya cukup untuk dijanjikan?
 *
 * Keputusan user 7-8 Okt 2026, semuanya terkunci:
 *   - available  = `availableQty > 5` (LEBIH DARI 5), ambang GLOBAL
 *   - Reserve    = TIDAK dikurangkan
 *   - cakupan    = hanya SKU aktif di OCS, lalu difilter lagi
 *   - pembagi    = SKU yang tidak disebar KELUAR dari pembagi
 *   - bawaan     = tidak ada yang tercentang sampai diisi manual
 *   - brand      = dari OCS, tidak diterka dari nama; bentrok -> urutan prioritas
 *
 * KENAPA PEMBAGINYA PENTING. Di ATP lama, EOMMA tercatat 0/29 di Yogyakarta,
 * Makassar, dan Medan — padahal EOMMA memang tidak disebar ke cabang. 29 SKU itu
 * tetap jadi pembagi dan menarik ATP cabang turun, jadi Yogyakarta 68,6% itu
 * sebagian hukuman untuk barang yang tidak pernah dimaksudkan ada di sana.
 * Modul ini mengeluarkannya dari pembagi, dan MELAPORKAN berapa yang dikeluarkan
 * supaya pengecualian tidak jadi tempat sembunyi.
 */

/** Ambang bawaan: available bila availableQty LEBIH DARI angka ini. */
export const AMBANG_ATP_BAWAAN = 5;

/**
 * Urutan prioritas brand untuk SKU yang punya lebih dari satu.
 *
 * Diukur 8 Okt 2026: 16 SKU punya dua brand, semuanya pasangan Hanasui/NCO
 * (BBS-CHEERFUL-BLISS, BBS-JOYFULL-DAYS, BBS-SUNSHINE-GLOW, BBS-HAPPY-VIBES,
 * NCO-EDP-VANILLA-ORCHID, NCO-EDP-SUGAR-CREME, dan 10 lainnya).
 *
 * Harus deterministik: tanpa urutan tetap, brand BBS-CHEERFUL-BLISS bisa
 * Hanasui hari ini dan NCO besok hanya karena urutan baris OCS bergeser — dan
 * filter brand jadi tidak stabil tanpa ada yang sadar.
 */
export const PRIORITAS_BRAND = ['Hanasui', 'NCO', 'FYNE', 'EOMMA'] as const;

/** Brand yang menang dari beberapa kandidat. Kosong = belum diketahui. */
export function brandMenang(
  kandidat: (string | null | undefined)[],
  prioritas: readonly string[] = PRIORITAS_BRAND,
): string {
  const ada = [...new Set(kandidat.map((b) => String(b ?? '').trim()).filter(Boolean))];
  if (!ada.length) return '';
  // Cocokkan tanpa peduli besar-kecil huruf, tapi KEMBALIKAN ejaan prioritasnya
  // supaya "hanasui" dan "Hanasui" tidak jadi dua brand berbeda di layar.
  for (const p of prioritas) {
    const k = ada.find((b) => b.toLowerCase() === p.toLowerCase());
    if (k) return p;
  }
  // Di luar daftar prioritas: urut abjad, supaya tetap sama di setiap penarikan.
  return [...ada].sort((a, b) => a.localeCompare(b))[0];
}

export type BarisStokAtp = {
  sku: string;
  areaId: string;
  availableQty: number;
  isActive: boolean;
  category?: string | null;
  sapCode?: string | null;
};

export type SebabTolak =
  | 'TIDAK_AKTIF'
  | 'BUKAN_KATEGORI_SKU'
  | 'BUNDLE';

export type Kelayakan = { layak: boolean; sebab?: SebabTolak; kotor: boolean };

/**
 * Apakah SKU ini bundle?
 *
 * `Category` TIDAK bisa dipakai: terbukti 8 Okt 2026 ada baris
 * `Category: "Sku"` dengan SKU `"- BDL-HANASUI-0000001615"` dan `SapCode`
 * kosong. Jadi prefiks `BDL-` diperiksa di mana pun ia muncul, bukan hanya di
 * awal — karena SKU di OCS kotor dan bisa berawalan `"- "` atau `"90 "`.
 */
export const adalahBundle = (sku: string) => /(^|[^A-Za-z0-9])BDL-/i.test(String(sku ?? ''));

/**
 * SKU "kotor": ada spasi/karakter aneh di awal, atau spasi di dalamnya.
 *
 * Contoh nyata: `"- BDL-HANASUI-0000001615"`, `"90 FYNE-BRIGHT-BARRIER-MOIST"`.
 *
 * Kotor TIDAK membuat barisnya dikeluarkan — `"90 FYNE-BRIGHT-BARRIER-MOIST"`
 * kemungkinan produk nyata dengan prefiks salah tulis, dan membuangnya berarti
 * kehilangan produk. Ditandai supaya bisa dibereskan, bukan disembunyikan.
 */
export const skuKotor = (sku: string) => {
  const s = String(sku ?? '');
  return s !== s.trim() || /^[^A-Za-z]/.test(s.trim()) || /\s/.test(s.trim());
};

/** Layak masuk hitungan ATP? Menolak dengan SEBAB, bukan diam-diam. */
export function kelayakan(r: BarisStokAtp): Kelayakan {
  const kotor = skuKotor(r.sku);
  if (!r.isActive) return { layak: false, sebab: 'TIDAK_AKTIF', kotor };
  if (adalahBundle(r.sku)) return { layak: false, sebab: 'BUNDLE', kotor };
  if (String(r.category ?? '') !== 'Sku') return { layak: false, sebab: 'BUKAN_KATEGORI_SKU', kotor };
  return { layak: true, kotor };
}

/** Keputusan sebaran. Tidak ada baris = belum diputuskan. */
export type Sebaran = Map<string, boolean>;

/** Kunci peta sebaran. Satu SKU di dua area adalah DUA keputusan. */
export const kunciSebaran = (sku: string, areaId: string) => `${areaId}\u0000${sku}`;

export type HasilArea = {
  areaId: string;
  /** Pembagi: layak ATP DAN dibagikan ke area ini. */
  dihitung: number;
  /** Dari `dihitung`, yang availableQty > ambang. */
  siap: number;
  /** Persen siap dari `dihitung`. null bila pembaginya 0 — BUKAN 0%. */
  persen: number | null;
  /** Layak ATP tapi sengaja TIDAK disebar — keluar dari pembagi. */
  takDisebar: number;
  /** Layak ATP tapi belum ada keputusannya — keluar dari pembagi. */
  belumDiputus: number;
  /** Tidak layak ATP, dirinci sebabnya. */
  ditolak: Record<SebabTolak, number>;
  /** SKU dengan penulisan kotor — peringatan, bukan pengecualian. */
  kotor: number;
};

/**
 * Hitung ATP per area.
 *
 * `persen` sengaja `null` saat pembaginya 0, bukan 0%. Cabang baru yang belum
 * diisi checklist-nya punya pembagi 0; menampilkannya sebagai "0%" akan terbaca
 * seperti bencana stok, padahal artinya "belum ada yang diputuskan".
 */
export function hitungAtp(
  rows: BarisStokAtp[],
  sebaran: Sebaran,
  ambang: number = AMBANG_ATP_BAWAAN,
): HasilArea[] {
  const per = new Map<string, HasilArea>();
  const ambil = (areaId: string): HasilArea => {
    let h = per.get(areaId);
    if (!h) {
      h = {
        areaId, dihitung: 0, siap: 0, persen: null, takDisebar: 0, belumDiputus: 0,
        ditolak: { TIDAK_AKTIF: 0, BUKAN_KATEGORI_SKU: 0, BUNDLE: 0 },
        kotor: 0,
      };
      per.set(areaId, h);
    }
    return h;
  };

  for (const r of rows) {
    const h = ambil(r.areaId);
    const k = kelayakan(r);
    if (k.kotor) h.kotor++;
    if (!k.layak) { h.ditolak[k.sebab!]++; continue; }

    const putusan = sebaran.get(kunciSebaran(r.sku, r.areaId));
    if (putusan === undefined) { h.belumDiputus++; continue; }
    if (putusan === false) { h.takDisebar++; continue; }

    h.dihitung++;
    if (Number(r.availableQty) > ambang) h.siap++;
  }

  for (const h of per.values()) {
    h.persen = h.dihitung > 0 ? (h.siap / h.dihitung) * 100 : null;
  }
  return [...per.values()].sort((a, b) => a.areaId.localeCompare(b.areaId));
}

/**
 * ATP keseluruhan dari hasil per area.
 *
 * Dijumlahkan dari pembagi dan pembilangnya, BUKAN dirata-rata dari persen per
 * area: rata-rata persen memberi bobot sama ke cabang yang punya 356 SKU dan
 * cabang baru yang punya 3, sehingga angka keseluruhan bisa bergerak tajam
 * hanya karena satu cabang kecil.
 */
export function atpKeseluruhan(hasil: HasilArea[]): {
  dihitung: number; siap: number; persen: number | null; terlemah: HasilArea | null;
} {
  const dihitung = hasil.reduce((t, h) => t + h.dihitung, 0);
  const siap = hasil.reduce((t, h) => t + h.siap, 0);
  const berisi = hasil.filter((h) => h.persen !== null);
  const terlemah = berisi.length
    ? berisi.reduce((m, h) => (h.persen! < m.persen! ? h : m))
    : null;
  return { dihitung, siap, persen: dihitung > 0 ? (siap / dihitung) * 100 : null, terlemah };
}

/** "71,0%" — satu desimal, koma, sesuai lokal yang dipakai seluruh aplikasi. */
export const persenTeks = (p: number | null) =>
  (p === null ? '—' : `${p.toFixed(1).replace('.', ',')}%`);

/** Satu baris mentah pencarian brand dari OCS (hanya medan yang dipakai). */
export type BarisBrandOcs = { SellerSku?: string; ShopCode?: string; ShopName?: string };

export type HasilPetaBrand = {
  /** SKU -> brand yang menang. */
  brand: Map<string, string>;
  /** SKU -> semua brand yang OCS sebut, dipisah ", " — untuk audit. */
  asal: Map<string, string>;
  /** SKU yang OCS sebut dengan LEBIH DARI satu brand. */
  bentrok: { sku: string; brand: string[]; menang: string }[];
};

/**
 * Bangun peta SKU -> brand dari baris mentah OCS.
 *
 * Dipisah dari penariknya supaya bisa diuji tanpa jaringan. `ShopCode` dipakai
 * lebih dulu; `ShopName` hanya cadangan kalau `ShopCode` kosong.
 *
 * Bentrokan DIKEMBALIKAN, bukan diselesaikan diam-diam: 16 SKU punya dua brand,
 * dan orang yang membaca filter brand berhak tahu mana saja yang dipaksa pilih.
 */
export function petaBrand(
  rows: BarisBrandOcs[],
  prioritas: readonly string[] = PRIORITAS_BRAND,
): HasilPetaBrand {
  const kumpul = new Map<string, Set<string>>();
  for (const r of rows) {
    const sku = String(r.SellerSku ?? '').trim();
    if (!sku) continue;
    const b = String(r.ShopCode ?? '').trim() || String(r.ShopName ?? '').trim();
    if (!b) continue;
    (kumpul.get(sku) ?? kumpul.set(sku, new Set()).get(sku)!).add(b);
  }

  const brand = new Map<string, string>();
  const asal = new Map<string, string>();
  const bentrok: { sku: string; brand: string[]; menang: string }[] = [];
  for (const [sku, set] of kumpul) {
    const daftar = [...set].sort((a, b) => a.localeCompare(b));
    const menang = brandMenang(daftar, prioritas);
    brand.set(sku, menang);
    asal.set(sku, daftar.join(', '));
    if (daftar.length > 1) bentrok.push({ sku, brand: daftar, menang });
  }
  bentrok.sort((a, b) => a.sku.localeCompare(b.sku));
  return { brand, asal, bentrok };
}
