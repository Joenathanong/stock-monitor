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
import { AREA_GABUNGAN, KODE_GABUNGAN } from './areas';

export type BarisArea = {
  code: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  /** Ambang masuk Sugest PO (hari). */
  doiCritical: number | null;
  doiMin: number | null;
  /** PO dipesan sampai penuh ke sini (hari). */
  doiMax: number | null;
  /**
   * Lead time cabang (hari) — berapa lama barang sampai setelah PO ditekan.
   * Menggantikan `default_lead_time_days` yang dicabut. null = belum diisi.
   */
  leadTimeDays: number | null;
  /** Target ketersediaan (ATP) cabang ini, persen. null = belum diisi. */
  atpTarget: number | null;
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
  for (const r of cabangSaja(rows)) {
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
/** Baris ambang laporan gabungan, kalau sudah ada. */
export const barisGabungan = (rows: BarisArea[]): BarisArea | null =>
  rows.find((r) => normalKode(r.code) === KODE_GABUNGAN) ?? null;

/**
 * Cabang SUNGGUHAN saja — baris GABUNGAN dibuang.
 *
 * Baris GABUNGAN hanya menyimpan ambang laporan gabungan. Ia tidak punya gudang
 * OCS, jadi ikut disertakan ke penarikan stok/penjualan atau ke peta kode→area
 * akan membuat aplikasi mencari gudang bernama "GABUNGAN" yang tidak pernah ada.
 */
export const cabangSaja = (rows: BarisArea[]): BarisArea[] =>
  rows.filter((r) => normalKode(r.code) !== KODE_GABUNGAN);

/**
 * Baris GABUNGAN TIDAK ikut: ia bukan gudang, cuma pemegang ambang laporan
 * gabungan. Ikut di sini berarti `syncStock` dan `syncSales` akan memanggil OCS
 * untuk area bernama "GABUNGAN" yang tidak pernah ada.
 */
export const areaAktif = (rows: BarisArea[]) =>
  cabangSaja(rows).filter((r) => r.isActive).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

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
 * Ambang DOI sebuah area, dari BARISNYA SENDIRI.
 *
 * PERUBAHAN 10 Okt 2026 atas permintaan user: "saya mau semua mengikuti cabang
 * area saja." Sebelumnya fungsi ini menerima `bawaan` dari tiga pengaturan
 * global (lead time / safety / target DOI) dan memakainya untuk kolom yang
 * kosong. Itu yang membuat ada DUA tempat mengatur ambang — dan akibatnya
 * angka global 14 hari tetap terpajang di Dashboard, /tv, halaman SKU dan
 * /simulasi sebagai "Target DOI", padahal tidak benar untuk satu cabang pun
 * (yang benar 7 / 21 / 20 / 45 / 35).
 *
 * Sekarang satu sumber: tabel Cabang/Area. Baris yang belum lengkap
 * mengembalikan `null` — BUKAN angka tebakan. Pemanggillah yang memutuskan apa
 * yang terjadi pada area belum tersetel, dan itu keputusan yang harus kelihatan,
 * bukan tersembunyi di dalam fungsi ini.
 *
 * Urutan naik tetap DIPAKSA di sini, bukan hanya divalidasi di form: baris yang
 * tersimpan sebelum aturan ini ada, atau yang masuk lewat jalur lain, tidak
 * boleh membuat pita saling menelan. `kritis` dipotong di bawah `min`, dan `max`
 * diangkat ke `min` — kalau tidak, "pesan sampai penuh ke max" malah mengurangi
 * stok.
 */
export function ambangDoi(area: BarisArea | null | undefined): AmbangDoi | null {
  if (!area) return null;
  const { doiCritical, doiMin, doiMax } = area;
  if (doiCritical === null || doiMin === null || doiMax === null) return null;
  const min = doiMin;
  const max = Math.max(doiMax, min);
  // Kritis harus BENAR-BENAR di bawah min, kalau tidak pita LOW hilang.
  const kritis = Math.min(doiCritical, Math.max(0, min - 1));
  return { kritis, min, max };
}

/** Apakah baris ini sudah punya ketiga ambangnya. */
export const ambangLengkap = (a: BarisArea | null | undefined): boolean => ambangDoi(a) !== null;

/**
 * Kolom tabel `area` yang bisa diubah lewat form — SEMUANYA, tanpa `code`.
 *
 * KEJADIAN NYATA 10 Okt 2026, dilaporkan user beberapa jam setelah kolom lead
 * time dipasang: "seting leadtime pusat sudah di set 1, kenapa data tabel masih
 * menampilkan 2?" Jawabannya ternyata angkanya TIDAK PERNAH TERSIMPAN — di
 * database nilainya masih null.
 *
 * Sebabnya: route PUT menyusun objek `data` untuk Prisma dengan MENGETIK ULANG
 * nama kolomnya satu per satu. Dua kolom baru lolos validasi, diterima API, dan
 * dijatuhkan diam-diam di langkah terakhir. User melihat pesan hijau
 * "tersimpan" untuk perubahan yang tidak terjadi — bentuk kegagalan yang paling
 * mahal, karena tidak ada yang bisa mencurigainya dari layar.
 *
 * Maka daftarnya tidak ditulis ulang lagi di route. Fungsi ini MENURUNKAN
 * kolomnya dari barisnya sendiri, jadi kolom baru ikut tersimpan tanpa ada yang
 * perlu ingat menambahkannya. Dijaga `area-master.test.ts`.
 */
export function kolomTersimpan(b: BarisArea): Omit<BarisArea, 'code' | 'startDate'> & { startDate: Date | null } {
  const { code: _code, startDate, ...kolom } = b;
  void _code;
  return { ...kolom, startDate: startDate ? new Date(`${startDate}T00:00:00.000Z`) : null };
}

export type SetelanArea = {
  ambang: AmbangDoi | null;
  /** Lead time cabang (hari) — cadangan untuk SKU tanpa lead time sendiri. */
  leadTimeDays: number | null;
  /** Target ketersediaan (ATP) cabang, persen. */
  atpTarget: number | null;
};

/**
 * Setelan yang berlaku untuk sebuah area — SATU-SATUNYA tempat aturan cadangan ditulis.
 *
 * Ada empat pemanggil: perhitungan status (`compute.ts`), layar (`query.ts`),
 * poster WhatsApp, dan Sugest PO. Sebelum fungsi ini ada, masing-masing menyusun
 * cadangannya sendiri — dan dua di antaranya sudah sempat berbeda: `compute.ts`
 * hanya memakai ambang area kalau kolomnya terisi, sementara route poster SELALU
 * menyusunnya dari angka global. Akibatnya laten tapi parah: begitu ada satu
 * cabang berkolom kosong, poster menulis "Aman <=14D" untuk cabang yang statusnya
 * sebenarnya dihitung dengan batas lain. Label yang berbohong, tanpa ada yang
 * gagal dan tanpa ada yang bisa melihatnya dari layar.
 *
 * Jadi aturannya tidak boleh ada di empat tempat, cukup di sini: ambang cabang
 * kalau lengkap, kalau tidak ambang baris GABUNGAN. Dijaga `satu-ambang.test.ts`.
 */
export function setelanArea(rows: BarisArea[], area: string | null | undefined): SetelanArea {
  const baris = area ? rows.find((r) => r.name === area) ?? null : null;
  const gab = barisGabungan(rows);
  return {
    ambang: ambangDoi(baris) ?? ambangDoi(gab),
    leadTimeDays: baris?.leadTimeDays ?? gab?.leadTimeDays ?? null,
    atpTarget: baris?.atpTarget ?? gab?.atpTarget ?? null,
  };
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
  // nama kota nyata, laporan gabungan dan satu kota akan tertukar.
  //
  // Sejak 10 Okt 2026 ada SATU baris yang memang bernama GABUNGAN: baris ambang
  // laporan gabungan. Ia dikenali dari KODE-nya, bukan namanya — supaya tidak
  // ada dua baris yang sama-sama mengaku gabungan.
  else if (name.toUpperCase() === AREA_GABUNGAN && code !== KODE_GABUNGAN) {
    g.push({ field: 'name', pesan: `"${AREA_GABUNGAN}" adalah nama khusus, hanya boleh dipakai baris berkode ${KODE_GABUNGAN}` });
  }
  else if (code === KODE_GABUNGAN && name.toUpperCase() !== AREA_GABUNGAN) {
    g.push({ field: 'name', pesan: `Baris berkode ${KODE_GABUNGAN} adalah ambang laporan gabungan; namanya harus ${AREA_GABUNGAN}` });
  }

  const kritis = x.doiCritical ?? null;
  const min = x.doiMin ?? null;
  const max = x.doiMax ?? null;
  const angkaSah = (v: number | null) => v === null || (Number.isFinite(v) && v >= 0);
  if (!angkaSah(kritis)) g.push({ field: 'doiCritical', pesan: 'Batas kritis tidak boleh negatif' });
  if (!angkaSah(min)) g.push({ field: 'doiMin', pesan: 'Batas low tidak boleh negatif' });
  if (!angkaSah(max)) g.push({ field: 'doiMax', pesan: 'Batas aman tidak boleh negatif' });

  // WAJIB sejak 10 Okt 2026. Dulu boleh kosong dan jatuh ke pengaturan global,
  // dan justru itu sumber kebingungannya: dua jalur perhitungan yang berbeda
  // hidup berdampingan, dan dari layar tidak ada cara tahu cabang ini pakai
  // yang mana. Dengan wajib diisi, hanya ada satu jalur — ambang mutlak — dan
  // tidak ada lagi area yang diam-diam dihitung relatif terhadap lead time.
  const wajib: [number | null, string, string][] = [
    [kritis, 'doiCritical', 'Batas kritis'],
    [min, 'doiMin', 'Batas low'],
    [max, 'doiMax', 'Batas aman'],
  ];
  for (const [v, field, label] of wajib) {
    if (v === null) g.push({ field, pesan: `${label} wajib diisi — tidak ada lagi angka global yang bisa dipakai sebagai cadangan.` });
  }

  const lead = x.leadTimeDays ?? null;
  if (lead !== null && (!Number.isFinite(lead) || lead < 0)) {
    g.push({ field: 'leadTimeDays', pesan: 'Lead time tidak boleh negatif' });
  }
  const atp = x.atpTarget ?? null;
  if (atp !== null && (!Number.isFinite(atp) || atp < 1 || atp > 100)) {
    g.push({ field: 'atpTarget', pesan: 'Target ATP harus antara 1 dan 100 persen' });
  }

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
 * Peringatan — hal yang MENCURIGAKAN tapi tidak salah, jadi tidak memblokir simpan.
 *
 * Dipisah dari `validasiArea` dengan sengaja: galat menghentikan penyimpanan,
 * peringatan tidak. Mencampurnya berarti memilih antara memblokir orang karena
 * hal yang mungkin memang disengaja, atau diam soal hal yang hampir pasti
 * keliru. Keduanya buruk.
 */
export function peringatanArea(x: Partial<BarisArea>): GalatArea[] {
  const p: GalatArea[] = [];
  const kritis = x.doiCritical ?? null;
  const lead = x.leadTimeDays ?? null;

  // LUBANG OPERASIONAL. Kalau ambang kritis lebih pendek daripada lead time,
  // sebuah SKU baru berstatus CRITICAL ketika stoknya tinggal `kritis` hari —
  // padahal barang pengganti baru sampai `lead` hari lagi. Artinya saat alarm
  // berbunyi, kehabisan stok SUDAH tidak bisa dihindari; selisihnya adalah
  // jumlah hari gudang itu dipastikan kosong.
  //
  // Contoh nyata hari ini: Pusat kritis <=4 hari, lead time 7 hari -> 3 hari
  // kosong, setiap kali, dan tidak ada satu pun layar yang menyebutkannya.
  if (kritis !== null && lead !== null && lead > kritis) {
    p.push({
      field: 'doiCritical',
      pesan: `Lead time ${lead} hari LEBIH LAMA daripada ambang kritis ${kritis} hari. `
        + `SKU baru ditandai kritis saat stok tinggal ${kritis} hari, padahal barang baru sampai `
        + `${lead} hari lagi — jadi gudang ini dipastikan kosong ${lead - kritis} hari. `
        + `Naikkan ambang kritis ke minimal ${lead}, atau percepat lead time-nya.`,
    });
  }
  if (lead === null) {
    p.push({ field: 'leadTimeDays', pesan: 'Lead time belum diisi — saran qty PO belum bisa memperhitungkan waktu tunggu cabang ini.' });
  }
  if ((x.atpTarget ?? null) === null) {
    p.push({ field: 'atpTarget', pesan: 'Target ATP belum diisi — poster /wa tidak menandai ketersediaan cabang ini.' });
  }
  return p;
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
