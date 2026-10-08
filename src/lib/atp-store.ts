/**
 * Pembaca & penulis ATP — lapisan yang menyentuh database.
 *
 * Aturannya ada di `atp.ts` dan MURNI (tanpa Prisma, tanpa jaringan) supaya
 * bisa diuji tanpa database. Pemisahan yang sama seperti `area-master.ts` vs
 * `area-store.ts`. Jangan pindahkan aturan ke sini: begitu `hitungAtp` butuh
 * koneksi, ia tidak bisa diuji lagi, dan 24 tes yang menjaga pembaginya hilang.
 *
 * ATP adalah LAPISAN DI ATAS doi-monitor, bukan perubahan padanya. Ia hanya
 * MEMBACA `stock_current`, dan hanya MENULIS ke tiga tabelnya sendiri
 * (`sku_brand`, `atp_share`, `atp_daily`). Tidak ada satu pun tulisan ke tabel
 * DOI/stock di berkas ini — itu syarat yang user tetapkan 7 Okt 2026.
 */
import { prisma } from './prisma';
import { toDateKeyUtc } from './dates';
import {
  AMBANG_ATP_BAWAAN, adalahBundle, kelayakan, kunciSebaran, hitungAtp, atpKeseluruhan,
  type BarisStokAtp, type Sebaran, type HasilArea, type SebabTolak,
} from './atp';

/** Benar kalau tabel ATP-nya belum dibuat (db:push belum dijalankan). */
function tabelBelumAda(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  // Apostrof dihindari di regex — lihat catatan sama di sku-link-store.ts.
  return /atp_share|atp_daily|sku_brand/i.test(m)
    && /doesn.t exist|does not exist|Unknown table|P2021/i.test(m);
}

/** Satu baris stok + nama + brand, siap dipakai halaman dan Excel. */
export type BarisAtp = BarisStokAtp & {
  name: string;
  brand: string;
  /** true = brand diisi orang, bukan dari OCS. */
  brandManual: boolean;
};

/**
 * Stok semua area untuk ATP.
 *
 * Bundle dibuang DI SINI, sedekat mungkin dengan sumbernya, supaya tidak ada
 * jalur lain yang kelewat: `category = 'Sku'` TIDAK bisa memisahkan bundle —
 * OCS menandai `- BDL-HANASUI-0000001615` dengan `category: "Sku"` (dibuktikan
 * 8 Okt 2026). Jadi SQL menyaring dua syarat, `adalahBundle()` menyaring yang
 * ketiga, dan keduanya memakai fungsi yang sama dengan `kelayakan()`.
 *
 * Baris yang TIDAK layak tetap dibawa (tidak di-WHERE habis) kecuali bundle,
 * karena `hitungAtp` perlu melaporkan jumlah yang ditolak per sebab. Laporan
 * yang menyembunyikan penolakannya membuat pembagi bisa salah tanpa ada yang
 * tahu. Bundle dikecualikan dari aturan itu karena jumlahnya tidak informatif:
 * ia bukan produk yang "gagal masuk", ia bukan produk ATP sama sekali.
 */
export async function muatStokAtp(): Promise<BarisAtp[]> {
  const rows = await prisma.$queryRawUnsafe<{
    sku: string; areaId: string; name: string; availableQty: number;
    isActive: number | boolean; category: string | null; sapCode: string | null;
    brand: string | null; brandManual: number | boolean | null;
  }[]>(
    'SELECT s.sku, s.areaId, s.name, s.availableQty, s.isActive, s.category, s.sapCode, '
    + 'b.brand AS brand, b.manual AS brandManual '
    + 'FROM stock_current s LEFT JOIN sku_brand b ON b.sku = s.sku '
    + 'ORDER BY s.sku, s.areaId',
  );
  return rows
    .filter((r) => !adalahBundle(r.sku))
    .map((r) => ({
      sku: r.sku,
      areaId: r.areaId,
      name: String(r.name ?? ''),
      availableQty: Number(r.availableQty ?? 0),
      isActive: Boolean(r.isActive),
      category: r.category,
      sapCode: r.sapCode,
      brand: String(r.brand ?? ''),
      brandManual: Boolean(r.brandManual),
    }));
}

/** Keputusan sebaran dari `atp_share`. Tidak ada baris = belum diputuskan. */
export async function muatSebaran(): Promise<{ sebaran: Sebaran; siap: boolean }> {
  try {
    const rows = await prisma.atpShare.findMany({ select: { sku: true, areaId: true, dibagikan: true } });
    const sebaran: Sebaran = new Map();
    for (const r of rows) sebaran.set(kunciSebaran(r.sku, r.areaId), r.dibagikan);
    return { sebaran, siap: true };
  } catch (e) {
    // Tabel belum ada BUKAN galat: halaman ATP harus tetap terbuka supaya user
    // bisa membaca "jalankan db:push". Melempar di sini membuat halamannya
    // kosong tanpa penjelasan. Pola yang sama dipakai `muatLink()`.
    if (tabelBelumAda(e)) return { sebaran: new Map(), siap: false };
    throw e;
  }
}

/** Catatan & penanggung jawab per keputusan — hanya untuk ditampilkan. */
export type CatatanSebaran = { note: string; updatedBy: string; updatedAt: string };

export async function muatCatatanSebaran(): Promise<Map<string, CatatanSebaran>> {
  try {
    const rows = await prisma.atpShare.findMany();
    const out = new Map<string, CatatanSebaran>();
    for (const r of rows) {
      out.set(kunciSebaran(r.sku, r.areaId), {
        note: r.note ?? '',
        updatedBy: r.updatedBy ?? '',
        updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : '',
      });
    }
    return out;
  } catch (e) {
    if (tabelBelumAda(e)) return new Map();
    throw e;
  }
}

export type SatuPutusan = {
  sku: string;
  areaId: string;
  /** null = HAPUS keputusannya, kembali ke "belum diputuskan". */
  dibagikan: boolean | null;
  note?: string | null;
};

/**
 * Simpan beberapa keputusan sebaran.
 *
 * `dibagikan: null` menghapus barisnya, bukan menyimpan `false`. Dua hal itu
 * beda arti dan beda akibat: `false` mengeluarkan SKU dari pembagi sebagai
 * KEPUTUSAN ("memang tidak disebar ke sini"), sedangkan tidak ada baris berarti
 * BELUM DIPUTUSKAN. Keduanya sama-sama di luar pembagi, jadi persennya sama —
 * tapi hanya yang kedua yang masih menunggu orang. Kalau "belum" disimpan
 * sebagai "tidak", daftar pekerjaan yang tersisa jadi kosong padahal belum
 * dikerjakan.
 *
 * Per baris, bukan satu transaksi: pengisian borongan bisa ratusan baris, dan
 * menggagalkan semuanya karena satu baris membuat user tidak tahu mana yang
 * sudah masuk. Pola yang sama dipakai `simpanBanyak()` di sku-link-store.
 */
export async function simpanSebaran(
  putusan: SatuPutusan[],
  oleh: string,
): Promise<{ tersimpan: number; dihapus: number; gagal: { sku: string; areaId: string; pesan: string }[] }> {
  let tersimpan = 0; let dihapus = 0;
  const gagal: { sku: string; areaId: string; pesan: string }[] = [];

  for (const p of putusan) {
    const sku = String(p.sku ?? '').trim();
    const areaId = String(p.areaId ?? '').trim();
    if (!sku || !areaId) { gagal.push({ sku, areaId, pesan: 'sku dan areaId wajib' }); continue; }

    try {
      if (p.dibagikan === null) {
        await prisma.atpShare.deleteMany({ where: { sku, areaId } });
        dihapus++;
        continue;
      }
      const note = p.note === null || p.note === undefined ? null : String(p.note).slice(0, 300) || null;
      await prisma.atpShare.upsert({
        // `sku_areaId`: nama bawaan Prisma untuk `@@id([sku, areaId])`. Tidak
        // diberi `name:` di schema, jadi JANGAN tulis nama karangan di sini —
        // kesalahan seperti itu hanya muncul saat dijalankan, bukan saat tsc.
        where: { sku_areaId: { sku, areaId } },
        create: { sku, areaId, dibagikan: p.dibagikan, note, updatedBy: oleh },
        update: { dibagikan: p.dibagikan, note, updatedBy: oleh },
      });
      tersimpan++;
    } catch (e) {
      gagal.push({ sku, areaId, pesan: e instanceof Error ? e.message : String(e) });
    }
  }
  return { tersimpan, dihapus, gagal };
}

/** Brand yang diisi orang. `manual: true` melindunginya dari `sync:brand`. */
export async function simpanBrandManual(sku: string, brand: string): Promise<boolean> {
  const s = String(sku ?? '').trim();
  const b = String(brand ?? '').trim().slice(0, 40);
  if (!s) return false;
  await prisma.skuBrand.upsert({
    where: { sku: s },
    create: { sku: s, brand: b, brandAsal: '', manual: true },
    update: { brand: b, manual: true },
  });
  return true;
}

export type MuatAtp = {
  /** Area yang punya stok, berurut — kolom checklist-nya. */
  areas: string[];
  /** Satu baris per SKU, dengan keadaan per area. */
  sku: {
    sku: string;
    name: string;
    brand: string;
    brandManual: boolean;
    /** Per area: keadaan SKU ini di sana. */
    area: Record<string, {
      /** true/false = sudah diputuskan; null = belum. */
      dibagikan: boolean | null;
      availableQty: number;
      /** true = availableQty > ambang. */
      siap: boolean;
      /** Tidak layak ATP? sebabnya; null = layak. */
      tolak: SebabTolak | null;
      note: string;
    }>;
  }[];
  hasil: HasilArea[];
  keseluruhan: ReturnType<typeof atpKeseluruhan>;
  ambang: number;
  /** false = tabel atp_share belum ada; UI harus bilang "jalankan db:push". */
  siap: boolean;
  /** SKU layak ATP yang brand-nya kosong — perlu diisi manual. */
  tanpaBrand: string[];
};

/**
 * Seluruh bahan halaman ATP dalam satu bacaan.
 *
 * Satu fungsi, bukan beberapa endpoint, karena persen ATP dan checklist-nya
 * HARUS berasal dari potret yang sama. Kalau halaman menarik persen dan
 * checklist terpisah, keduanya bisa dari dua detik yang berbeda dan angkanya
 * tidak cocok dengan centangnya — dan yang akan dicurigai user adalah
 * perhitungannya, bukan dua panggilannya.
 */
export async function muatAtp(ambang: number = AMBANG_ATP_BAWAAN): Promise<MuatAtp> {
  const [rows, { sebaran, siap }, catatan] = await Promise.all([
    muatStokAtp(), muatSebaran(), muatCatatanSebaran(),
  ]);

  const areas = [...new Set(rows.map((r) => r.areaId))].filter(Boolean).sort((a, b) => a.localeCompare(b));
  const hasil = hitungAtp(rows, sebaran, ambang);
  const keseluruhan = atpKeseluruhan(hasil);

  const perSku = new Map<string, MuatAtp['sku'][number]>();
  for (const r of rows) {
    let b = perSku.get(r.sku);
    if (!b) {
      b = { sku: r.sku, name: r.name, brand: r.brand, brandManual: r.brandManual, area: {} };
      perSku.set(r.sku, b);
    }
    // Nama & brand dari baris mana pun yang punya isinya — tidak semua area
    // mengisi `name`, dan baris kosong tidak boleh menimpa yang terisi.
    if (!b.name && r.name) b.name = r.name;
    if (!b.brand && r.brand) { b.brand = r.brand; b.brandManual = r.brandManual; }

    const k = kelayakan(r);
    const putusan = sebaran.get(kunciSebaran(r.sku, r.areaId));
    b.area[r.areaId] = {
      dibagikan: putusan === undefined ? null : putusan,
      availableQty: r.availableQty,
      siap: r.availableQty > ambang,
      tolak: k.layak ? null : k.sebab!,
      note: catatan.get(kunciSebaran(r.sku, r.areaId))?.note ?? '',
    };
  }

  const sku = [...perSku.values()].sort((a, b) => a.sku.localeCompare(b.sku));

  // Hanya SKU yang LAYAK di suatu area yang perlu brand. Yang tidak layak di
  // mana pun tidak akan pernah muncul di filter brand, jadi memintanya diisi
  // adalah pekerjaan sia-sia — inilah kesalahan yang terjadi di sync:brand
  // (8 Okt 2026) saat bundle ikut masuk daftar "belum punya brand".
  const tanpaBrand = sku
    .filter((s) => !s.brand && Object.values(s.area).some((a) => a.tolak === null))
    .map((s) => s.sku);

  return { areas, sku, hasil, keseluruhan, ambang, siap, tanpaBrand };
}

/**
 * Rekam potret ATP hari ini ke `atp_daily`.
 *
 * `ambang` ikut direkam, bukan diasumsikan: kalau nanti ambangnya diubah dari 5,
 * tren masa lalu tetap menunjukkan angka yang memang berlaku saat itu. Tanpa
 * kolom itu, mengubah ambang akan menulis ulang sejarah secara diam-diam.
 */
export async function rekamAtpHarian(
  hasil: HasilArea[],
  ambang: number,
  tanggal: Date = new Date(),
): Promise<number> {
  const snapshotDate = new Date(`${toDateKeyUtc(tanggal)}T00:00:00.000Z`);
  let n = 0;
  for (const h of hasil) {
    await prisma.atpDaily.upsert({
      where: { snapshotDate_areaId: { snapshotDate, areaId: h.areaId } },
      create: {
        snapshotDate, areaId: h.areaId, ambang,
        dihitung: h.dihitung, siap: h.siap, takDisebar: h.takDisebar, belumDiputus: h.belumDiputus,
      },
      update: {
        ambang, dihitung: h.dihitung, siap: h.siap,
        takDisebar: h.takDisebar, belumDiputus: h.belumDiputus,
      },
    });
    n++;
  }
  return n;
}

/**
 * Persen ATP per area untuk poster WA — ringan, tanpa daftar SKU.
 *
 * Poster hanya memuat PERSENNYA (keputusan user 8 Okt 2026: checklist-nya tidak
 * masuk poster), jadi fungsi ini sengaja tidak membangun `sku[]` yang bisa
 * ribuan baris. Poster dirender dalam satu permintaan HTTP ber-timeout; memuat
 * seluruh matriks di sana membuat poster gagal karena pekerjaan yang tidak
 * ditampilkannya.
 */
export async function persenAtpPerArea(
  ambang: number = AMBANG_ATP_BAWAAN,
): Promise<{ hasil: HasilArea[]; keseluruhan: ReturnType<typeof atpKeseluruhan>; siap: boolean }> {
  const [rows, { sebaran, siap }] = await Promise.all([muatStokAtp(), muatSebaran()]);
  const hasil = hitungAtp(rows, sebaran, ambang);
  return { hasil, keseluruhan: atpKeseluruhan(hasil), siap };
}
