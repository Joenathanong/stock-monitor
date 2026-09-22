/**
 * Simulasi Target DOI — "kalau DOI total mau jadi N hari, SKU mana yang stoknya
 * harus dikurangi dan berapa banyak?"
 *
 * Aturan mainnya:
 *  - DOI total = Σ stok ÷ Σ ADS. Mengurangi stok TIDAK mengubah ADS, jadi target
 *    stok = target hari × ADS total. Itu satu-satunya persamaan yang dipakai.
 *  - Tiap SKU punya lantai: coverage minimum yang tetap disisakan (per kelas).
 *    Yang boleh dipotong hanya kelebihan DI ATAS lantai itu — supaya simulasi
 *    tidak pernah menyarankan memotong SKU yang stoknya memang sudah tipis.
 *  - Kelas yang tidak dicentang sama sekali tidak disentuh, tapi stoknya tetap
 *    ikut dihitung di DOI total. Itu sebabnya target bisa saja tidak tercapai
 *    walau seluruh kelas yang dipilih sudah dipotong habis sampai lantainya —
 *    dan kalau begitu, hasilnya dilaporkan apa adanya, bukan dipaksa tercapai.
 */
import type { DateKey } from './dates';

export type AbcClass = 'A' | 'B' | 'C';
export const ABC: AbcClass[] = ['A', 'B', 'C'];

export type SimRow = {
  sku: string;
  name: string | null;
  sapCode: string | null;
  abcClass: string;
  status: string;
  availableQty: number;
  transitQty: number;
  ads: number;
  doi: number | null;
  isPhaseOut: boolean;
  runOutDate?: DateKey | null;
};

export type SimOptions = {
  targetDoi: number;
  /** Kelas yang boleh dikurangi stoknya. */
  classes: AbcClass[];
  /** Coverage minimum yang disisakan per kelas (hari). */
  floorDays: Record<AbcClass, number>;
  /**
   * true = stok phase out dianggap sudah habis terjual, jadi tidak ikut dihitung
   * di DOI total (ADS-nya pun ikut hilang). false = ikut dihitung apa adanya.
   */
  excludePhaseOut: boolean;
  /** Urutan pemotongan: qty kelebihan terbesar, DOI tertinggi, atau merata. */
  order: 'QTY' | 'DOI' | 'PROPORSIONAL';
};

export type SimPick = {
  sku: string; name: string | null; sapCode: string | null;
  abcClass: string; status: string;
  stock: number; ads: number; doi: number | null;
  floorDays: number;
  /** Batas bawah stok menurut lantai kelasnya. */
  keep: number;
  /** Kelebihan di atas lantai — batas atas yang boleh dipotong. */
  cuttable: number;
  /** Yang benar-benar dipotong pada simulasi ini. */
  cut: number;
  stockAfter: number;
  doiAfter: number | null;
};

export type SimResult = {
  feasible: boolean;
  /** Basis populasi yang dihitung. */
  skuCount: number;
  adsTotal: number;
  stockBefore: number;
  doiBefore: number | null;
  targetStock: number;
  /** Selisih yang harus dikeluarkan supaya target tercapai (0 bila sudah di bawah target). */
  need: number;
  /** Total yang bisa dipotong dari kelas terpilih tanpa menembus lantai. */
  cuttable: number;
  cutTotal: number;
  stockAfter: number;
  doiAfter: number | null;
  /** Kekurangan bila seluruh kelebihan sudah dipotong tapi target belum tercapai. */
  shortfall: number;
  byClass: Record<AbcClass, { skuCount: number; stock: number; ads: number; doi: number | null; cut: number; touched: number }>;
  phaseOut: { count: number; stock: number; ads: number };
  picks: SimPick[];
};

const r0 = (n: number) => Math.round(n);
const doiOf = (stock: number, ads: number) => (ads > 0 ? Math.round((stock / ads) * 100) / 100 : null);

export function simulate(rows: SimRow[], opt: SimOptions): SimResult {
  const phaseOut = rows.filter((r) => r.isPhaseOut);
  const pool = rows.filter((r) => r.status !== 'EXCLUDED' && (!opt.excludePhaseOut || !r.isPhaseOut));

  const adsTotal = pool.reduce((a, r) => a + r.ads, 0);
  const stockBefore = pool.reduce((a, r) => a + r.availableQty, 0);
  const targetStock = opt.targetDoi * adsTotal;
  const need = Math.max(0, stockBefore - targetStock);

  const boleh = new Set(opt.classes);
  const picks: SimPick[] = pool
    .filter((r) => boleh.has(r.abcClass as AbcClass))
    .map((r) => {
      const floorDays = opt.floorDays[r.abcClass as AbcClass] ?? opt.targetDoi;
      const keep = r0(floorDays * r.ads);
      const cuttable = Math.max(0, r.availableQty - keep);
      return {
        sku: r.sku, name: r.name, sapCode: r.sapCode, abcClass: r.abcClass, status: r.status,
        stock: r.availableQty, ads: r.ads, doi: r.doi,
        floorDays, keep, cuttable, cut: 0,
        stockAfter: r.availableQty, doiAfter: r.doi,
      };
    })
    .filter((p) => p.cuttable > 0);

  const cuttable = picks.reduce((a, p) => a + p.cuttable, 0);

  // ---- alokasi
  if (need > 0 && cuttable > 0) {
    if (opt.order === 'PROPORSIONAL') {
      // Rasio yang sama untuk semua — beban merata, tapi menyentuh SEMUA SKU.
      // Dibulatkan ke BAWAH dulu supaya tidak pernah kelebihan potong, lalu
      // sisanya dibagikan ke yang pecahannya paling besar. Totalnya jadi persis.
      const ratio = Math.min(1, need / cuttable);
      const pecahan: { p: SimPick; frac: number }[] = [];
      let sisa = Math.ceil(need);
      for (const p of picks) {
        const tepat = Math.min(p.cuttable, p.cuttable * ratio);
        p.cut = Math.floor(tepat);
        sisa -= p.cut;
        pecahan.push({ p, frac: tepat - p.cut });
      }
      for (const { p } of pecahan.sort((a, b) => b.frac - a.frac || (b.p.cuttable - b.p.cut) - (a.p.cuttable - a.p.cut))) {
        if (sisa <= 0) break;
        const tambah = Math.min(sisa, p.cuttable - p.cut);
        p.cut += tambah; sisa -= tambah;
      }
    } else {
      // Ambil habis dari yang paling gemuk dulu → paling sedikit SKU yang disentuh.
      const urut = [...picks].sort(
        opt.order === 'DOI'
          ? (a, b) => (b.doi ?? 0) - (a.doi ?? 0) || b.cuttable - a.cuttable
          : (a, b) => b.cuttable - a.cuttable || (b.doi ?? 0) - (a.doi ?? 0),
      );
      let sisa = need;
      for (const p of urut) {
        if (sisa <= 0) break;
        p.cut = Math.min(p.cuttable, Math.ceil(sisa));
        sisa -= p.cut;
      }
    }
  }

  for (const p of picks) {
    p.stockAfter = p.stock - p.cut;
    p.doiAfter = doiOf(p.stockAfter, p.ads);
  }

  const cutTotal = picks.reduce((a, p) => a + p.cut, 0);
  const stockAfter = stockBefore - cutTotal;

  const byClass = Object.fromEntries(ABC.map((c) => {
    const kelas = pool.filter((r) => r.abcClass === c);
    const stock = kelas.reduce((a, r) => a + r.availableQty, 0);
    const ads = kelas.reduce((a, r) => a + r.ads, 0);
    const p = picks.filter((x) => x.abcClass === c);
    return [c, {
      skuCount: kelas.length, stock, ads, doi: doiOf(stock, ads),
      cut: p.reduce((a, x) => a + x.cut, 0),
      touched: p.filter((x) => x.cut > 0).length,
    }];
  })) as SimResult['byClass'];

  return {
    feasible: need <= cuttable,
    skuCount: pool.length,
    adsTotal: Math.round(adsTotal * 100) / 100,
    stockBefore,
    doiBefore: doiOf(stockBefore, adsTotal),
    targetStock: r0(targetStock),
    need: r0(need),
    cuttable,
    cutTotal,
    stockAfter,
    doiAfter: doiOf(stockAfter, adsTotal),
    shortfall: Math.max(0, r0(need - cuttable)),
    byClass,
    phaseOut: {
      count: phaseOut.length,
      stock: phaseOut.reduce((a, r) => a + r.availableQty, 0),
      ads: Math.round(phaseOut.reduce((a, r) => a + r.ads, 0) * 100) / 100,
    },
    // Hanya SKU yang benar-benar dipotong yang dilaporkan — sisanya bukan pekerjaan.
    picks: picks.filter((p) => p.cut > 0).sort((a, b) => b.cut - a.cut),
  };
}

/**
 * Lantai berapa hari yang membuat target tercapai, kalau SEMUA kelas terpilih
 * dipotong ke lantai yang sama. Dicari dengan bagi dua karena sisa stok tidak
 * linear terhadap lantai (SKU yang sudah di bawah lantai tidak ikut berubah).
 */
export function solveFloor(rows: SimRow[], opt: Omit<SimOptions, 'floorDays' | 'order'>): number | null {
  const sama = (d: number) => ({ A: d, B: d, C: d });
  const hasil = (d: number) => simulate(rows, { ...opt, floorDays: sama(d), order: 'QTY' });
  if (hasil(0).doiAfter === null) return null;
  if ((hasil(0).doiAfter ?? 0) > opt.targetDoi) return null; // mustahil walau dikosongkan
  let lo = 0, hi = 3650;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const d = hasil(mid).doiAfter;
    if (d !== null && d <= opt.targetDoi) lo = mid; else hi = mid;
  }
  return Math.round(lo * 10) / 10;
}
