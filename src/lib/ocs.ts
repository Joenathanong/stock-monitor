/**
 * Klien OCS. Nol dependensi — cukup `fetch` bawaan Node 18+.
 *
 * Pola login diambil dari aplikasi ocs-replenish-monitor yang sudah berjalan:
 * POST /Auth/Login mengembalikan JWT berumur 24 jam, dipakai sebagai Bearer token
 * dan di-cache di memori proses.
 */
import { wibDayStartIso, addDays, type DateKey } from './dates';
import type { OcsReceiveDoc, OcsReceiveLine } from './receive';

const BASE = (process.env.OCS_BASE_URL || 'https://ocs.iegsystem.id').replace(/\/+$/, '');
const COMPANY_DB = process.env.OCS_COMPANY_DB || 'EJI_WMS';

/**
 * Kredensial OCS TIDAK punya nilai bawaan — sengaja.
 *
 * Akun menentukan AREA MANA yang boleh dilihat: akun ADMIN hanya mengembalikan
 * Pusat, walaupun diminta `area=All`. Dulu berkas ini jatuh ke 'ADMIN'/'ADMIN'
 * kalau variabel lingkungan lupa diisi — hasilnya bukan galat, melainkan data
 * yang diam-diam menyusut jadi satu area saja. Lebih baik gagal keras.
 */
function wajib(nama: 'OCS_USERNAME' | 'OCS_PASSWORD'): string {
  const v = process.env[nama];
  if (!v) {
    throw new Error(
      `${nama} belum diisi. Kredensial OCS menentukan area mana yang terlihat — ` +
      'tanpa ini penarikan bisa menyusut diam-diam ke satu area. ' +
      'Isi OCS_USERNAME & OCS_PASSWORD di .env (lokal) dan di Environment Variables Vercel (produksi).',
    );
  }
  return v;
}

/** Akun OCS yang dipakai — ikut dicatat di sync_log supaya perubahan cakupan area terlihat. */
export const ocsUser = () => process.env.OCS_USERNAME ?? '(belum diisi)';

let cachedToken: string | null = null;
let tokenExpiresAt = 0;
let inFlight: Promise<string> | null = null;

function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

async function requestJson(url: string, init: RequestInit, timeoutMs: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { Accept: 'application/json', Origin: BASE, ...(init.headers as Record<string, string>) },
    });
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        // URL yang tidak dikenal dijawab dengan shell HTML SPA, bukan JSON.
        throw new Error(
          text.trimStart().startsWith('<')
            ? `Endpoint tidak mengembalikan JSON (kemungkinan URL salah): ${url}`
            : `Respons bukan JSON yang valid dari ${url}`,
        );
      }
    }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function doLogin(): Promise<string> {
  const { ok, status, data } = await requestJson(
    `${BASE}/Auth/Login`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: wajib('OCS_USERNAME'), password: wajib('OCS_PASSWORD'), companydb: COMPANY_DB }),
    },
    30_000,
  );
  const token = (data as { Token?: string } | null)?.Token;
  if (!ok || !token) {
    throw new Error(
      status === 401
        ? 'Login OCS gagal — periksa OCS_USERNAME / OCS_PASSWORD / OCS_COMPANY_DB'
        : `Login OCS gagal (HTTP ${status})`,
    );
  }
  cachedToken = token;
  const exp = decodeJwt(token)?.exp;
  tokenExpiresAt = typeof exp === 'number' ? exp * 1000 - 10 * 60_000 : Date.now() + 12 * 3600_000;
  return token;
}

export async function getToken(force = false): Promise<string> {
  if (!force && cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  if (inFlight) return inFlight;
  inFlight = doLogin().finally(() => { inFlight = null; });
  return inFlight;
}

/** Status yang layak dicoba ulang: gangguan sesaat di server/gateway, bukan kesalahan kita. */
const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function authedGet<T>(path: string, timeoutMs = 60_000, attempts = 3): Promise<T> {
  let last = 'tidak diketahui';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let transient = false;
    try {
      let token = await getToken();
      let res = await requestJson(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } }, timeoutMs);
      if (res.status === 401) {
        token = await getToken(true);
        res = await requestJson(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } }, timeoutMs);
      }
      if (res.ok) return res.data as T;
      last = `HTTP ${res.status}`;
      transient = TRANSIENT.has(res.status);
      if (!transient) throw new Error(`GET ${path} gagal (${last})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!transient && !/HTTP \d+/.test(msg)) { last = msg; transient = true; }
      if (!transient) throw err;
    }
    if (attempt === attempts) break;
    await sleep(Math.min(3000, Math.round(2000 * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5))));
  }
  throw new Error(`GET ${path} gagal setelah ${attempts} percobaan (${last})`);
}

// ---------- Stok ----------

export type OcsStockRow = {
  Sku?: string;
  AreaId?: string;
  Name?: string;
  SapCode?: string;
  Category?: string;
  QtyGudangKecil?: number;
  QtyGudangBesar?: number;
  QtyOnHand?: number;
  QtyOnOrder?: number;
  AvailableQty?: number;
  ReserveQty?: number;
  IsActive?: boolean;
};

/** Snapshot penuh stok. ~12.000 baris untuk seluruh area; paging tidak diperlukan. */
/**
 * Stok OCS. `budgetMs` adalah TOTAL waktu yang boleh dipakai termasuk percobaan
 * ulang — bukan timeout per percobaan. Sebelumnya 90 dtk × 3 percobaan (±276
 * dtk) padahal batas satu fungsi cuma 60 dtk, jadi prosesnya selalu dibunuh
 * platform sebelum sempat menyerah, dan kuncinya ikut tertinggal.
 */
export async function fetchStock(budgetMs = 30_000): Promise<OcsStockRow[]> {
  const attempts = budgetMs >= 24_000 ? 2 : 1;
  const perAttempt = Math.max(8_000, Math.floor((budgetMs - (attempts - 1) * 2_000) / attempts));
  const data = await authedGet<OcsStockRow[] | { value: OcsStockRow[] }>('/odata/DTO_WmsItemStockLiteV2', perAttempt, attempts);
  const rows = Array.isArray(data) ? data : data?.value;
  if (!Array.isArray(rows)) throw new Error('Format respons OData tidak dikenali');
  return rows;
}

// ---------- Brand (= toko) per SKU ----------

/**
 * Satu baris `DTO_LookupStockDetailedData` — satu-satunya sumber brand di OCS.
 *
 * Dibongkar 8 Okt 2026 dengan akun JONATHAN (akses 5 area). Catatan penting:
 *
 *  - OCS TIDAK punya medan bernama "Brand". Yang ada `ShopCode`/`ShopName`,
 *    isinya Hanasui / NCO / FYNE / EOMMA — di OCS, brand = toko.
 *  - `DTO_WmsItems` juga punya `ShopCode`, TAPI ia per-bin (BinCode, Qty per
 *    rak) sehingga satu SKU punya banyak baris. Endpoint ini lebih ringkas.
 *  - Kuncinya `SellerSku`, bentuknya sama dengan `Sku` di
 *    DTO_WmsItemStockLiteV2 — terbukti 348 dari 375 SKU aktif cocok (92,8%).
 *  - 16 SKU punya DUA brand (semua pasangan Hanasui/NCO). Diselesaikan oleh
 *    `brandMenang` di atp.ts dengan urutan prioritas tetap, BUKAN di sini.
 */
export type OcsBrandRow = {
  SellerSku?: string;
  ItemCode?: string;
  ShopCode?: string;
  ShopName?: string;
  AreaId?: string;
};

/**
 * Tarik peta SKU -> brand.
 *
 * JEBAKAN YANG SUDAH TERBUKTI: `$filter` OData di OCS DIABAIKAN DIAM-DIAM —
 * `?$filter=AreaId eq 'Medan'` menjawab HTTP 200 dengan 0 baris, bukan error.
 * Jadi JANGAN pernah menyaring di URL; tarik semuanya lalu saring di sini.
 */
export async function fetchBrandLookup(budgetMs = 30_000): Promise<OcsBrandRow[]> {
  const attempts = budgetMs >= 24_000 ? 2 : 1;
  const perAttempt = Math.max(8_000, Math.floor((budgetMs - (attempts - 1) * 2_000) / attempts));
  const data = await authedGet<OcsBrandRow[] | { value: OcsBrandRow[] }>(
    '/odata/DTO_LookupStockDetailedData', perAttempt, attempts,
  );
  const rows = Array.isArray(data) ? data : data?.value;
  if (!Array.isArray(rows)) throw new Error('Format respons DTO_LookupStockDetailedData tidak dikenali');
  return rows;
}

// ---------- Harga produk ----------

/**
 * Satu baris SKU dari /Products/GetProductSkus.
 *
 * Catatan penting dari bundel OCS (dibongkar 22 Sep 2026):
 *  - `SalePrice` adalah ARRAY — satu harga per marketplace. Halaman Products
 *    menampilkannya sebagai rentang min–max, bukan satu angka.
 *  - `SellerSku` bisa berisi BEBERAPA sku dipisah ", " untuk satu produk.
 *    Halaman OCS sendiri melakukan `SellerSku.split(", ")`.
 *  - OCS tidak punya kolom HET; yang tersedia hanya harga jual marketplace.
 */
export type OcsProductSkuRow = {
  SellerSku?: string;
  Title?: string;
  SalePrice?: number[] | number | null;
};

export type HargaSku = { sku: string; name: string | null; price: number; min: number; max: number; sources: number };

/** Ambil harga per SKU. `pick` memilih angka mana dari array SalePrice. */
export async function fetchProductPrices(
  budgetMs = 25_000,
  pick: 'MIN' | 'MAX' | 'AVG' = 'MIN',
): Promise<HargaSku[]> {
  const attempts = budgetMs >= 20_000 ? 2 : 1;
  const perAttempt = Math.max(8_000, Math.floor((budgetMs - (attempts - 1) * 2_000) / attempts));
  const data = await authedGet<OcsProductSkuRow[] | { value: OcsProductSkuRow[] }>(
    '/Products/GetProductSkus', perAttempt, attempts,
  );
  const rows = Array.isArray(data) ? data : data?.value;
  if (!Array.isArray(rows)) throw new Error('Format respons GetProductSkus tidak dikenali');
  return mapProductPrices(rows, pick);
}

/** Bagian murni — dipisah supaya bisa diuji tanpa menyentuh jaringan. */
export function mapProductPrices(rows: OcsProductSkuRow[], pick: 'MIN' | 'MAX' | 'AVG' = 'MIN'): HargaSku[] {
  const out = new Map<string, HargaSku>();
  for (const r of rows) {
    const harga = (Array.isArray(r.SalePrice) ? r.SalePrice : r.SalePrice == null ? [] : [r.SalePrice])
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (!harga.length) continue;

    const min = Math.min(...harga);
    const max = Math.max(...harga);
    const price = Math.round(
      pick === 'MAX' ? max : pick === 'AVG' ? harga.reduce((a, b) => a + b, 0) / harga.length : min,
    );

    // Satu produk bisa membawa beberapa SKU sekaligus ("SKU-A, SKU-B").
    for (const raw of String(r.SellerSku ?? '').split(',')) {
      const sku = raw.trim();
      if (!sku) continue;
      const lama = out.get(sku);
      // Kalau satu SKU muncul dua kali, ambil yang harganya lebih rendah —
      // sejalan dengan pilihan "terendah" dan tidak pernah menggelembungkan nilai.
      if (!lama || (pick === 'MIN' ? price < lama.price : price > lama.price)) {
        out.set(sku, { sku, name: r.Title?.slice(0, 500) ?? null, price, min: Math.round(min), max: Math.round(max), sources: harga.length });
      }
    }
  }
  return [...out.values()];
}

// ---------- Komposisi bundling ----------

/** Satu baris komponen di dalam sebuah bundle. Nama medan apa adanya dari OCS. */
export type OcsBundleItemRow = {
  SellerSku?: string;
  SellerSkuQty?: number;
  TotalAvailableQty?: number;
  Stocks?: { AreaId?: string; AvailableQty?: number }[];
};

/** Satu bundle dari /MasterData/GetBundleStock. */
export type OcsBundleRow = {
  BundleSku?: string;
  BundleName?: string;
  /** Jumlah SELURUH qty komponen (mis. 2+1 = 3), bukan jumlah jenis komponen. */
  TotalQty?: number;
  TotalAvailableQty?: number;
  Stocks?: { AreaId?: string; AvailableQty?: number }[];
  Items?: OcsBundleItemRow[];
};

/**
 * Tarik komposisi seluruh bundling.
 *
 * DIBONGKAR LANGSUNG dari halaman /master/bundle 9 Okt 2026 — bukan ditebak:
 *
 *   endpoint  GET /MasterData/GetBundleStock   (BUKAN OData; array polos)
 *   bentuk    { BundleSku, BundleName, TotalQty, TotalAvailableQty,
 *               Stocks: [{AreaId, AvailableQty}],
 *               Items:  [{SellerSku, SellerSkuQty, TotalAvailableQty,
 *                         Stocks: [{AreaId, AvailableQty}]}] }
 *
 * Terukur saat itu: 2.029 bundle, 6.040 baris komponen, rata-rata 2,98 dan
 * PALING BANYAK 14 komponen, tidak ada bundle tanpa komponen, `SellerSkuQty`
 * sampai 10, area persis 5 cabang kita, payload 2,5 MB dalam 2,4 detik.
 *
 * Catatan: 2.028 dari 2.029 berawalan `BDL-`, satu berawalan `GIMMICK-`. Jadi
 * JANGAN menyaring daftar ini dengan `adalahBundle()` — satu baris akan hilang.
 *
 * Anggaran waktunya besar karena payloadnya besar; endpoint ini tidak dipanggil
 * tiap Refresh (lihat `bundle_refresh_hours`).
 */
export async function fetchBundleStock(budgetMs = 40_000): Promise<OcsBundleRow[]> {
  const attempts = budgetMs >= 30_000 ? 2 : 1;
  const perAttempt = Math.max(12_000, Math.floor((budgetMs - (attempts - 1) * 2_000) / attempts));
  const data = await authedGet<OcsBundleRow[] | { value: OcsBundleRow[] }>(
    '/MasterData/GetBundleStock', perAttempt, attempts,
  );
  const rows = Array.isArray(data) ? data : data?.value;
  if (!Array.isArray(rows)) throw new Error('Format respons GetBundleStock tidak dikenali');
  return rows;
}

/** Satu baris siap tulis ke `bundle_item`. */
export type KomponenBundle = { bundleSku: string; itemSku: string; qty: number; name: string };

/**
 * Bagian murni — dipisah supaya bisa diuji tanpa jaringan.
 *
 * Yang dibuang dan alasannya:
 *   - komponen tanpa `SellerSku`   -> tidak bisa dihubungkan ke apa pun;
 *   - qty <= 0 atau bukan angka    -> jadi 1, BUKAN dibuang: bundle yang
 *     komponennya hilang separuh lebih menyesatkan daripada qty yang dibulatkan,
 *     dan qty 0 untuk komponen yang terdaftar tidak punya arti;
 *   - komponen GANDA dalam satu bundle -> qty-nya DIJUMLAHKAN, bukan yang
 *     terakhir menang. Kunci tabelnya (bundleSku, itemSku), jadi tanpa ini satu
 *     baris akan menimpa yang lain diam-diam dan isi bundle jadi berkurang.
 *   - komponen yang menunjuk dirinya sendiri -> dibuang; itu akan membuat
 *     "pembatas" menghitung dirinya sendiri.
 */
export function mapBundleItems(rows: OcsBundleRow[]): KomponenBundle[] {
  const out = new Map<string, KomponenBundle>();
  for (const b of rows) {
    const bundleSku = String(b.BundleSku ?? '').trim();
    if (!bundleSku) continue;
    const name = String(b.BundleName ?? '').trim().slice(0, 500);
    for (const it of b.Items ?? []) {
      const itemSku = String(it.SellerSku ?? '').trim();
      if (!itemSku || itemSku === bundleSku) continue;
      const n = Number(it.SellerSkuQty);
      const qty = Number.isFinite(n) && n > 0 ? Math.trunc(n) : 1;
      const k = `${bundleSku}\u0000${itemSku}`;
      const ada = out.get(k);
      if (ada) ada.qty += qty;
      else out.set(k, { bundleSku, itemSku, qty, name });
    }
  }
  return [...out.values()];
}

// ---------- Penjualan ----------

export type OcsSalesRow = {
  Date: string;
  SellerSku: string;
  Area: string;
  Qty: number;
  Detail?: { CommercePlatform: string; Qty: number }[];
};

/**
 * Kode status order OCS (diverifikasi 15 Sep 2026 dari filter Status di halaman Report).
 * Parameter `status` bisa diulang: `status=20001&status=50000`.
 *
 * PENTING: yang disaring adalah status order SAAT INI, bukan riwayatnya. Satu
 * order hanya berada di satu status, jadi menjumlahkan beberapa status TIDAK
 * menggandakan. Sebaliknya, hanya memakai PROCESSED+COMPLETED justru
 * MENGHILANGKAN hampir seluruh order kemarin (masih PICKED/PACKED/MANIFESTED/
 * IN_TRANSIT/DELIVERED). Uji 14 Sep 2026: PROCESSED+COMPLETED = 414 pcs,
 * seluruh status = 29.729 pcs, di antaranya CANCELLED 2.606 & UNPAID 421.
 */
export const OCS_STATUS = {
  NA: 0,
  UNPAID: 10000,
  IN_CANCEL: 11000,
  CANCELLED: 90000,
  READY_TO_PROCESS: 20000,
  PROCESSED: 20001,
  SCHEDULED: 20002,
  PICKLIST_ASSIGNED: 20010,
  PICKING: 20011,
  PICKING_FAILED: 20012,
  PICKED: 20013,
  SORTING: 20014,
  SORTING_FAILED: 20015,
  SORTED: 20016,
  PACKING: 20020,
  PACKING_FAILED: 20021,
  PACKED: 20022,
  BYPASS: 20023,
  MANIFESTED: 20030,
  IN_TRANSIT: 30000,
  SHIPPING_LOST: 30200,
  SHIPPING_FAILED: 30300,
  RETRY_SHIP: 31000,
  DELIVERED_TOCONFIRM: 40000,
  DELIVERED_CONFIRMED: 41000,
  DELIVERED_RETURNED: 42000,
  COMPLETED: 50000,
  RETURN: 70000,
  RETURN_RETURNED: 71000,
  RETURN_CONFIRMED: 72000,
} as const;

/** Status yang sudah pasti mengonsumsi stok: PROCESSED sampai COMPLETED. */
const DEMAND_CORE: number[] = [
  20001, 20002, 20010, 20011, 20012, 20013, 20014, 20015, 20016,
  20020, 20021, 20022, 20023, 20030, 30000, 30200, 30300, 31000,
  40000, 41000, 42000, 50000,
];

/** Daftar status yang ditarik, mengikuti dua toggle di Pengaturan. */
export function demandStatusCodes(opts: { includeReady: boolean; includeReturn: boolean }): number[] {
  const codes = [...DEMAND_CORE];
  if (opts.includeReady) codes.unshift(OCS_STATUS.READY_TO_PROCESS);
  if (opts.includeReturn) codes.push(OCS_STATUS.RETURN, OCS_STATUS.RETURN_RETURNED, OCS_STATUS.RETURN_CONFIRMED);
  return codes;
}

/**
 * Status yang TIDAK memakan stok: belum bayar, sedang/sudah batal.
 * Qty-nya tetap ditarik supaya kelihatan, tapi disimpan di kolom sendiri.
 */
export const CANCEL_STATUS: number[] = [
  OCS_STATUS.NA, OCS_STATUS.UNPAID, OCS_STATUS.IN_CANCEL, OCS_STATUS.CANCELLED,
];

/** SELURUH status yang dikenal OCS — tanpa satu pun pengecualian. */
export const ALL_STATUS_CODES: number[] = [...new Set(Object.values(OCS_STATUS))].sort((a, b) => a - b);

/**
 * Penjualan per SKU untuk SATU tanggal WIB.
 *
 * OCS mengembalikan tanggal `from` DAN tanggal `to` sekaligus — satu hari yang
 * diminta menghasilkan dua hari data. Karena itu hasilnya disaring ulang di sini
 * berdasarkan kolom `Date` pada barisnya, bukan dipercaya dari rentangnya.
 *
 * Rentang panjang membuat OCS menjawab 504, jadi penarikan memang harus per hari.
 */
export async function fetchSalesForDate(
  day: DateKey,
  /**
   * Nama kota, WAJIB — tidak ada nilai bawaan. Sengaja: dulu bawaannya 'All',
   * dan karena cakupan area ikut akun OCS, satu pemanggil yang lupa mengisi
   * cukup untuk menyusutkan data jadi satu area tanpa galat apa pun.
   */
  area: string,
  statusCodes: number[] = DEMAND_CORE,
  timeoutMs = 25_000,
  attempts = 2,
): Promise<OcsSalesRow[]> {
  if (!area?.trim()) throw new Error('fetchSalesForDate: nama area wajib diisi (satu kota, bukan All).');
  const from = wibDayStartIso(day);
  const to = wibDayStartIso(addDays(day, 1));
  const qs = new URLSearchParams({ from, to, platform: 'All', shop: 'All' });
  for (const c of statusCodes) qs.append('status', String(c));
  qs.append('area', area);
  const rows = await authedGet<OcsSalesRow[]>(`/Report/OrderPerSkuReport?${qs}`, timeoutMs, attempts);
  if (!Array.isArray(rows)) throw new Error('Format respons OrderPerSkuReport tidak dikenali');
  return rows.filter((r) => typeof r?.Date === 'string' && r.Date.slice(0, 10) === day);
}

export async function testConnection() {
  const started = Date.now();
  const token = await getToken(true);
  const claims = (decodeJwt(token) ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    durationMs: Date.now() - started,
    user: claims.USER_CODE ?? null,
    companyDb: claims.COMPANY_DB ?? null,
    role: claims.ROLE_CODE ?? null,
    expiresAt: typeof claims.exp === 'number' ? new Date(claims.exp * 1000).toISOString() : null,
  };
}

// ---------- Barang dalam perjalanan (receive stock) ----------

/**
 * Dua endpoint yang dipakai halaman /stocks/receive-stock (dibongkar 25 Sep 2026).
 * Hanya dokumen yang BELUM selesai diterima yang dikembalikan `docs` — jadi apa
 * yang ada di situ memang barang yang masih dalam perjalanan.
 *
 * `/api/receive-stock/submit` TIDAK PERNAH dipanggil aplikasi ini. Dashboard
 * hanya membaca; penerimaan barang tetap dikerjakan orang lewat OCS.
 */
export async function fetchReceiveDocs(timeoutMs = 30_000, attempts = 2): Promise<OcsReceiveDoc[]> {
  const data = await authedGet<OcsReceiveDoc[] | { value: OcsReceiveDoc[] }>('/api/receive-stock/docs', timeoutMs, attempts);
  const rows = Array.isArray(data) ? data : data?.value;
  if (!Array.isArray(rows)) throw new Error('Format respons receive-stock/docs tidak dikenali');
  return rows;
}

export async function fetchReceiveLines(docNum: number, timeoutMs = 25_000, attempts = 2): Promise<OcsReceiveLine[]> {
  const data = await authedGet<OcsReceiveLine[] | { value: OcsReceiveLine[] }>(
    `/api/receive-stock/lines?docNum=${encodeURIComponent(String(docNum))}`, timeoutMs, attempts,
  );
  const rows = Array.isArray(data) ? data : data?.value;
  // Dokumen yang sudah keburu ditutup menjawab bukan-array; itu bukan galat fatal,
  // cukup dilewati supaya satu dokumen tidak menggagalkan seluruh penarikan.
  return Array.isArray(rows) ? rows : [];
}

