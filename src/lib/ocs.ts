/**
 * Klien OCS. Nol dependensi — cukup `fetch` bawaan Node 18+.
 *
 * Pola login diambil dari aplikasi ocs-replenish-monitor yang sudah berjalan:
 * POST /Auth/Login mengembalikan JWT berumur 24 jam, dipakai sebagai Bearer token
 * dan di-cache di memori proses.
 */
import { wibDayStartIso, addDays, type DateKey } from './dates';

const BASE = (process.env.OCS_BASE_URL || 'https://ocs.iegsystem.id').replace(/\/+$/, '');
const USERNAME = process.env.OCS_USERNAME || 'ADMIN';
const PASSWORD = process.env.OCS_PASSWORD || 'ADMIN';
const COMPANY_DB = process.env.OCS_COMPANY_DB || 'EJI_WMS';

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
      body: JSON.stringify({ username: USERNAME, password: PASSWORD, companydb: COMPANY_DB }),
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
    await sleep(Math.round(2000 * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5)));
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
export async function fetchStock(): Promise<OcsStockRow[]> {
  const data = await authedGet<OcsStockRow[] | { value: OcsStockRow[] }>('/odata/DTO_WmsItemStockLiteV2', 90_000, 3);
  const rows = Array.isArray(data) ? data : data?.value;
  if (!Array.isArray(rows)) throw new Error('Format respons OData tidak dikenali');
  return rows;
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
 * Penjualan per SKU untuk SATU tanggal WIB.
 *
 * OCS mengembalikan tanggal `from` DAN tanggal `to` sekaligus — satu hari yang
 * diminta menghasilkan dua hari data. Karena itu hasilnya disaring ulang di sini
 * berdasarkan kolom `Date` pada barisnya, bukan dipercaya dari rentangnya.
 *
 * Rentang panjang membuat OCS menjawab 504, jadi penarikan memang harus per hari.
 */
export async function fetchSalesForDate(day: DateKey, area = 'Pusat', statusCodes: number[] = DEMAND_CORE): Promise<OcsSalesRow[]> {
  const from = wibDayStartIso(day);
  const to = wibDayStartIso(addDays(day, 1));
  const qs = new URLSearchParams({ from, to, platform: 'All', shop: 'All' });
  for (const c of statusCodes) qs.append('status', String(c));
  qs.append('area', area);
  const rows = await authedGet<OcsSalesRow[]>(`/Report/OrderPerSkuReport?${qs}`, 90_000, 3);
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
