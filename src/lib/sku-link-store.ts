/**
 * Pembaca & penulis tabel `sku_link` — pemetaan SKU OCS ↔ kode SAP.
 *
 * Dipisah dari `sku-link.ts` dengan alasan yang sama seperti `area-store.ts`:
 * aturannya tetap bisa diuji tanpa database. Yang ini menyentuh Prisma, yang itu
 * murni.
 *
 * Kenapa tabel ini ada sama sekali: dulu hubungan antar kode disimpulkan dari
 * bentuk kodenya (6 digit terakhir sama). Itu batal karena (a) ada produk yang
 * berbagi SKU dengan 6 digit BERBEDA, dan (b) satu produk bisa punya lebih dari
 * tiga kode. Heuristik yang kadang benar lebih berbahaya daripada tabel yang
 * harus diisi, karena salah petakan berarti salah kirim barang.
 */
import { prisma } from './prisma';
import {
  normalKode, prioritasUsulan, kodeBentrok, validasiLink,
  type BarisSkuLink, type SistemKode, type GalatLink,
} from './sku-link';

/** Benar kalau tabelnya belum dibuat (db:push belum dijalankan). */
function tabelBelumAda(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  // Apostrof SENGAJA dihindari di sini: penjaga sql-cadangan.test.ts memindai
  // literal berkutip dan tidak mengerti literal REGEX, jadi satu apostrof di
  // dalam regex menggeser paritas kutip seluruh berkas dan memunculkan
  // pelanggaran palsu (kena 5 Okt 2026). `doesn.t` sama saja maksudnya.
  return /sku_link/i.test(m) && /doesn.t exist|does not exist|Unknown table|P2021/i.test(m);
}

const bersih = (r: {
  id: number; groupKey: string; system: string; code: string;
  priority: number; perCtn: number | null;
}): BarisSkuLink => ({
  id: r.id,
  groupKey: r.groupKey,
  system: (r.system === 'OCS' ? 'OCS' : 'SAP') as SistemKode,
  code: r.code,
  priority: r.priority,
  perCtn: r.perCtn,
});

export type MuatLink = {
  rows: BarisSkuLink[];
  /** false = tabel `sku_link` belum ada; UI harus bilang "jalankan db:push". */
  siap: boolean;
  /** Kode yang dipakai di LEBIH DARI SATU groupKey — mapping-nya ambigu. */
  bentrok: { code: string; system: SistemKode; groups: string[] }[];
};

/**
 * Seluruh mapping.
 *
 * Tabel belum ada TIDAK dijadikan galat: halaman Pengaturan harus tetap terbuka
 * supaya user bisa membaca pesan "jalankan db:push". Melempar di sini membuat
 * seluruh halaman kosong tanpa penjelasan.
 */
export async function muatLink(): Promise<MuatLink> {
  try {
    const rows = (await prisma.skuLink.findMany({
      orderBy: [{ groupKey: 'asc' }, { priority: 'asc' }, { code: 'asc' }],
    })).map(bersih);
    return { rows, siap: true, bentrok: kodeBentrok(rows) };
  } catch (e) {
    if (tabelBelumAda(e)) return { rows: [], siap: false, bentrok: [] };
    throw e;
  }
}

/** Mapping untuk SATU produk. */
export async function muatGroup(groupKey: string): Promise<BarisSkuLink[]> {
  const rows = await prisma.skuLink.findMany({
    where: { groupKey: String(groupKey ?? '').trim() },
    orderBy: [{ priority: 'asc' }, { code: 'asc' }],
  });
  return rows.map(bersih);
}

export type HasilSimpan = { ok: true; baris: BarisSkuLink } | { ok: false; galat: GalatLink[] };

/**
 * Tambah atau ubah satu baris. Kuncinya (system, code) — satu kode hanya boleh
 * menunjuk satu produk.
 *
 * Kalau kodenya sudah terdaftar di groupKey LAIN, itu tidak ditolak diam-diam
 * dan tidak juga dipindahkan diam-diam: dikembalikan sebagai galat yang
 * menyebutkan groupKey lamanya, supaya user tahu apa yang akan ia ubah.
 */
export async function simpanLink(x: Partial<BarisSkuLink>, bolehPindah = false): Promise<HasilSimpan> {
  const galat = validasiLink(x);
  if (galat.length) return { ok: false, galat };

  const system = (x.system === 'OCS' ? 'OCS' : 'SAP') as SistemKode;
  const code = normalKode(x.code);
  const groupKey = String(x.groupKey ?? '').trim();
  // priority kosong → tebak dari prefiks kode; untuk OCS selalu 0 (sumbernya).
  const priority = Number.isFinite(x.priority as number)
    ? Math.trunc(x.priority as number)
    : (system === 'OCS' ? 0 : prioritasUsulan(code));
  const perCtn = x.perCtn === null || x.perCtn === undefined || !Number.isFinite(Number(x.perCtn))
    ? null
    : Math.max(0, Math.trunc(Number(x.perCtn))) || null;

  const lama = await prisma.skuLink.findUnique({ where: { sku_link_code: { system, code } } });
  if (lama && lama.groupKey !== groupKey && !bolehPindah) {
    return {
      ok: false,
      galat: [{
        field: 'code',
        pesan: `Kode ${code} sudah terdaftar di produk "${lama.groupKey}". `
          + 'Memindahkannya ke produk ini mengubah ke mana barang itu di-PO — '
          + 'kirim ulang dengan bolehPindah=true kalau memang itu yang dimaksud.',
      }],
    };
  }

  const baris = lama
    ? await prisma.skuLink.update({ where: { id: lama.id }, data: { groupKey, priority, perCtn } })
    : await prisma.skuLink.create({ data: { groupKey, system, code, priority, perCtn } });
  return { ok: true, baris: bersih(baris) };
}

/** Hapus satu baris mapping. Hard delete — baris ini tidak punya riwayat. */
export async function hapusLink(id: number): Promise<boolean> {
  if (!Number.isFinite(id)) return false;
  try { await prisma.skuLink.delete({ where: { id: Math.trunc(id) } }); return true; }
  catch { return false; }
}

/**
 * Simpan beberapa baris sekaligus — dipakai tombol "terima usulan".
 *
 * Per baris, bukan satu transaksi besar: usulan 6-digit bisa ratusan baris dan
 * sebagian memang bentrok. Menggagalkan semuanya karena satu bentrok memaksa
 * user memperbaiki satu-satu tanpa tahu mana yang sudah masuk. Jadi yang
 * berhasil disimpan, yang gagal dilaporkan dengan alasannya.
 */
export async function simpanBanyak(
  baris: Partial<BarisSkuLink>[],
  bolehPindah = false,
): Promise<{ tersimpan: number; gagal: { code: string; pesan: string }[] }> {
  let tersimpan = 0;
  const gagal: { code: string; pesan: string }[] = [];
  for (const b of baris) {
    const r = await simpanLink(b, bolehPindah);
    if (r.ok) tersimpan++;
    else gagal.push({ code: normalKode(b.code), pesan: r.galat.map((g) => g.pesan).join('; ') });
  }
  return { tersimpan, gagal };
}

/**
 * Bahan untuk usulan: SKU OCS + kode SAP-nya, dan kode yang ada di gudang
 * pemasok beserta isi kartonnya.
 *
 * `supplier_stock` dipakai sebagai sumber daftar kode SAP karena itulah kode
 * yang benar-benar bisa di-PO. Kalau tabelnya belum terisi (`sync:supplier`
 * belum jalan), daftarnya kosong dan usulannya memang kosong — itu jujur, bukan
 * kegagalan.
 */
export async function bahanUsulan(): Promise<{
  skuOcs: { sku: string; sapCode: string | null; name: string | null }[];
  kodeSap: { sapCode: string; perCtn: number | null }[];
  supplierSiap: boolean;
}> {
  // SUMBER SKU OCS adalah `stock_current`, BUKAN `sku_master`.
  //
  // KEJADIAN NYATA 10 Okt 2026, dilaporkan user: tombol "Lihat usulan dari 6
  // digit" menjawab "Unexpected end of JSON input". Penyebabnya query ini dulu
  // berbunyi `SELECT sku, sapCode, name FROM sku_master` — dan `sku_master`
  // TIDAK PUNYA kolom `sapCode` maupun `name`; isinya cuma sku, leadTimeDays,
  // isExcluded, note. TiDB menolak dengan error 1054 (unknown column), lemparan
  // itu terjadi DI LUAR blok try di bawah sehingga tidak tertangkap, dan route
  // membalas 500 berbadan kosong. `res.json()` di layar lalu gagal mengurai
  // badan kosong — pesan errornya sama sekali tidak menyebut kolom.
  //
  // Dua kesalahan sekaligus, dan yang kedua tidak akan ketahuan dari pesan
  // error: `sku_master` adalah tabel TIMPAAN yang hanya berisi SKU yang pernah
  // diedit orang (6 baris saat ini). Daftar SKU OCS yang sebenarnya — lengkap
  // dengan kode SAP dan namanya — ada di `stock_current`. Memperbaiki nama
  // kolomnya saja akan membuat usulan dihitung dari 6 SKU, bukan 471.
  //
  // DISTINCT per SKU: `stock_current` berkunci (sku, areaId), jadi satu SKU
  // muncul sekali per cabang. Tanpa pengelompokan, usulan 6-digit dihitung
  // lima kali untuk produk yang sama.
  const skuOcs = await prisma.$queryRawUnsafe<{ sku: string; sapCode: string | null; name: string | null }[]>(
    'SELECT sku, MAX(sapCode) AS sapCode, MAX(name) AS name FROM stock_current GROUP BY sku ORDER BY sku',
  );
  try {
    // perCtn terbesar per kode: baris dari dua gudang bisa beda, dan 0 berarti
    // "tidak terbaca" — jadi MAX, bukan MIN, supaya angka yang terbaca menang.
    const kodeSap = await prisma.$queryRawUnsafe<{ sapCode: string; perCtn: number | null }[]>(
      'SELECT sapCode, MAX(perCtn) AS perCtn FROM supplier_stock GROUP BY sapCode ORDER BY sapCode',
    );
    return {
      skuOcs,
      kodeSap: kodeSap.map((r) => ({ sapCode: r.sapCode, perCtn: Number(r.perCtn ?? 0) || null })),
      // SIAP berarti ADA ISINYA, bukan sekadar tabelnya ada.
      //
      // Tabel kosong menghasilkan 0 kode SAP, jadi 0 usulan — dan pesan
      // "0 produk diusulkan dari 0 kode SAP" terbaca seperti kesimpulan
      // ("memang tidak ada yang cocok") padahal penyebabnya sederhana: saldo
      // pemasok belum pernah ditarik. Keadaan yang bisa diperbaiki tidak boleh
      // menyamar jadi keadaan yang sudah final.
      supplierSiap: kodeSap.length > 0,
    };
  } catch (e) {
    if (tabelBelumAda(e) || /supplier_stock/i.test(e instanceof Error ? e.message : '')) {
      return { skuOcs, kodeSap: [], supplierSiap: false };
    }
    throw e;
  }
}
