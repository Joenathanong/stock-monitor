/**
 * Daftar cabang / gudang — modul murni, tanpa Prisma & tanpa jaringan.
 *
 * Sebelum ini daftar area hidup di DUA tempat yang tidak saling tahu: konstanta
 * `KODE_AREA` di `receive.ts` (kode gudang → nama area) dan apa pun yang
 * kebetulan ada di `stock_current`. Menambah cabang berarti mengubah kode dan
 * deploy. Sekarang sumbernya satu: tabel `area`, diisi dari Pengaturan.
 *
 * Modul ini sengaja murni supaya komponen klien bisa memakainya tanpa menarik
 * Prisma, dan supaya aturannya bisa diuji tanpa database.
 *
 * JANGAN dipakai untuk gudang pemasok EJI (web.eji.co.id/sap_whs/stock) yang
 * kebetulan juga bernama "GBJD". Itu dunia lain: lihat `supplierWhs`.
 */
import { AREA_GABUNGAN } from './areas';

export type BarisArea = {
  code: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  /** Ambang masuk Sugest PO (hari). null = pakai pengaturan global. */
  doiCritical: number | null;
  doiMin: number | null;
  /** PO dipesan sampai penuh ke sini (hari). null = pakai pengaturan global. */
  doiMax: number | null;
  /** "YYYY-MM-DD" atau null. */
  startDate: string | null;
  note: string | null;
};

/**
 * Isi awal tabel `area` — lima kode yang dulu ditulis di `receive.ts`.
 *
 * HANYA untuk pengisian pertama. Sesudah tabelnya terisi, tidak ada satu pun
 * jalur kode yang boleh membaca konstanta ini: kalau masih dibaca, cabang baru
 * yang ditambahkan user lewat Pengaturan akan diabaikan diam-diam.
 */
export const KODE_AREA_BAWAAN: Record<string, string> = {
  GBJD: 'Pusat',
  GJSB: 'Surabaya',
  GJYG: 'Yogyakarta',
  GJMK: 'Makassar',
  GJMD: 'Medan',
};

/** Label untuk baris receive yang tidak menyebut kode gudang sama sekali. */
export const TANPA_KODE = '(tanpa kode gudang)';

export const normalKode = (k: string | null | undefined) => String(k ?? '').trim().toUpperCase();

/** Peta kode gudang → nama area. Area nonaktif IKUT, supaya data lamanya tetap terbaca. */
export function petaKodeArea(rows: BarisArea[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) {
    const k = normalKode(r.code);
    if (k && r.name) m.set(k, r.name);
  }
  return m;
}

export type HasilNamaArea = {
  name: string;
  /** true = kode ini tidak ada di tabel area; harus kelihatan di layar, bukan disembunyikan. */
  asing: boolean;
};

/**
 * Terjemahkan kode gudang jadi nama area.
 *
 * Perilaku LAMA yang sengaja dibuang: kode tak dikenal dan kode kosong
 * dikembalikan sebagai "Pusat". Itu membuat cabang baru yang belum didaftarkan
 * menyamar jadi Pusat dan menambah SIT-nya tanpa ada yang tahu. Sekarang
 * keduanya ditandai `asing`, dan nama yang dikembalikan bukan nama area nyata.
 */
export function namaAreaDari(kode: string | null | undefined, peta: Map<string, string>): HasilNamaArea {
  const k = normalKode(kode);
  if (!k) return { name: TANPA_KODE, asing: true };
  const nama = peta.get(k);
  if (nama) return { name: nama, asing: false };
  return { name: k, asing: true };
}

/** Area yang ikut ditarik & dihitung, berurut. */
export const areaAktif = (rows: BarisArea[]) =>
  rows.filter((r) => r.isActive).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

/**
 * Tiga batas yang mendefinisikan EMPAT pita stok, semuanya MUTLAK dalam hari.
 *
 *   DOI <= kritis  -> CRITICAL
 *   DOI <= min     -> LOW        (masuk Sugest PO)
 *   DOI <= max     -> HEALTHY
 *   DOI >  max     -> OVERSTOCK
 *
 * Tiga angka, bukan enam, supaya celah antar pita mustahil. Data yang user
 * kirim 5 Okt 2026 justru memperlihatkan bahayanya: ditulis sebagai pasangan
 * batas ("kritis <14, low 15-21"), hari ke-14 tidak masuk pita mana pun di 4
 * dari 5 kota.
 */
export type AmbangDoi = { kritis: number; min: number; max: number };

/**
 * Ambang DOI yang berlaku untuk sebuah area.
 *
 * Per-area menang; yang kosong jatuh ke pengaturan global. Urutan naik
 * DIPAKSA di sini, bukan hanya divalidasi di form: baris yang sudah tersimpan
 * sebelum aturan ini ada, atau yang masuk lewat jalur lain, tidak boleh membuat
 * pita saling menelan. `kritis` dipotong di bawah `min`, dan `max` diangkat ke
 * `min` — kalau tidak, "pesan sampai penuh ke max" malah mengurangi stok.
 */
export function ambangDoi(area: BarisArea | null | undefined, bawaan: AmbangDoi): AmbangDoi {
  const min = area?.doiMin ?? bawaan.min;
  const max = Math.max(area?.doiMax ?? bawaan.max, min);
  const kritisMentah = area?.doiCritical ?? bawaan.kritis;
  // Kritis harus BENAR-BENAR di bawah min, kalau tidak pita LOW hilang.
  const kritis = Math.min(kritisMentah, Math.max(0, min - 1));
  return { kritis, min, max };
}

/** Pita yang memuat sebuah nilai DOI. Satu-satunya tempat urutan ini ditulis. */
export function pitaDoi(doi: number, a: AmbangDoi): 'CRITICAL' | 'LOW' | 'HEALTHY' | 'OVERSTOCK' {
  if (doi <= a.kritis) return 'CRITICAL';
  if (doi <= a.min) return 'LOW';
  if (doi <= a.max) return 'HEALTHY';
  return 'OVERSTOCK';
}

/** Teks pita untuk ditampilkan: "≤4 / 5-6 / 7 / >7". Dipakai pratinjau di form. */
export function ringkasPita(a: AmbangDoi): string {
  const low = a.kritis + 1 === a.min ? `${a.min}` : `${a.kritis + 1}-${a.min}`;
  const aman = a.min + 1 === a.max ? `${a.max}` : (a.min >= a.max ? '(kosong)' : `${a.min + 1}-${a.max}`);
  return `kritis ≤${a.kritis} · low ${low} · aman ${aman} · over >${a.max}`;
}

export type GalatArea = { field: string; pesan: string };

/**
 * Periksa satu baris area sebelum disimpan. Mengembalikan daftar galat, bukan
 * melempar — supaya form bisa menandai medan yang salah satu per satu.
 */
export function validasiArea(x: Partial<BarisArea>): GalatArea[] {
  const g: GalatArea[] = [];
  const code = normalKode(x.code);
  if (!code) g.push({ field: 'code', pesan: 'Kode gudang wajib diisi' });
  else if (!/^[A-Z0-9]{2,20}$/.test(code)) g.push({ field: 'code', pesan: 'Kode gudang hanya huruf & angka, 2-20 karakter' });

  const name = String(x.name ?? '').trim();
  if (!name) g.push({ field: 'name', pesan: 'Nama area wajib diisi' });
  else if (name.length > 60) g.push({ field: 'name', pesan: 'Nama area maksimal 60 karakter' });
  // 'GABUNGAN' adalah nama khusus untuk "semua area dijumlahkan". Dipakai sebagai
  // nama area nyata, laporan gabungan dan satu kota akan tertukar.
  else if (name.toUpperCase() === AREA_GABUNGAN) g.push({ field: 'name', pesan: `"${AREA_GABUNGAN}" adalah nama khusus, tidak boleh dipakai sebagai nama area` });

  const kritis = x.doiCritical ?? null;
  const min = x.doiMin ?? null;
  const max = x.doiMax ?? null;
  const angkaSah = (v: number | null) => v === null || (Number.isFinite(v) && v >= 0);
  if (!angkaSah(kritis)) g.push({ field: 'doiCritical', pesan: 'Batas kritis tidak boleh negatif' });
  if (!angkaSah(min)) g.push({ field: 'doiMin', pesan: 'Batas low tidak boleh negatif' });
  if (!angkaSah(max)) g.push({ field: 'doiMax', pesan: 'Batas aman tidak boleh negatif' });

  // Urutan naik. Pesannya menyebut AKIBATNYA, bukan hanya "tidak valid":
  // batas yang salah urut membuat satu pita hilang, dan SKU di pita itu tidak
  // muncul di laporan mana pun.
  if (kritis !== null && min !== null && angkaSah(kritis) && angkaSah(min) && kritis >= min) {
    g.push({
      field: 'doiCritical',
      pesan: `Batas kritis (${kritis}) harus LEBIH KECIL dari batas low (${min}) — `
        + 'kalau sama atau lebih besar, pita LOW hilang dan tidak ada SKU yang pernah berstatus LOW.',
    });
  }
  if (min !== null && max !== null && angkaSah(min) && angkaSah(max) && max < min) {
    g.push({
      field: 'doiMax',
      pesan: `Batas aman (${max}) harus >= batas low (${min}) — kalau lebih kecil, `
        + 'pita AMAN hilang dan setiap SKU langsung lompat dari LOW ke OVERSTOCK.',
    });
  }

  if (x.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(x.startDate)) {
    g.push({ field: 'startDate', pesan: 'Tanggal mulai harus YYYY-MM-DD' });
  }
  return g;
}

/**
 * Nama area yang dipakai `stock_current` tapi TIDAK ada di tabel area.
 *
 * Dipakai halaman Pengaturan untuk menawarkan "daftarkan area ini" — tanpa itu,
 * area yang datang dari OCS tapi belum terdaftar hanya terlihat sebagai angka
 * yang tidak pernah muncul di mana pun.
 */
export function areaBelumTerdaftar(dariData: string[], rows: BarisArea[]): string[] {
  const nama = new Set(rows.map((r) => r.name));
  return [...new Set(dariData.map((x) => String(x ?? '').trim()).filter(Boolean))]
    .filter((x) => x !== AREA_GABUNGAN && !nama.has(x))
    .sort();
}
