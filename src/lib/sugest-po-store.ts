/**
 * Sugest PO — penyatu data. Batch 4 dari SPEC-SUGEST-PO-CAMPAIGN.md.
 *
 * Tiga sumber bertemu di sini, dan masing-masing sudah punya modul murninya
 * sendiri. Berkas ini TIDAK menghitung apa pun; ia hanya membaca database dan
 * menyerahkannya ke `openpo.hitungSemua`:
 *
 *   doi_snapshot    -> siapa yang perlu dipesan & berapa (hasil mesin DOI)
 *   sku_link        -> SKU OCS itu kode SAP yang mana, isi kartonnya berapa
 *   supplier_stock  -> saldo tiap kode di tiap gudang pemasok EJI
 *
 * Pemisahan ini disengaja: aturan pemecahan karton, perebutan saldo antar
 * cabang, dan toleransi pembulatan semuanya diuji tanpa database di
 * `openpo.test.ts`. Kalau logika itu ikut pindah ke sini, ia hanya bisa diuji
 * lewat data nyata — dan baris PO yang salah baru ketahuan setelah barangnya
 * terlanjur dikirim.
 */
import { prisma } from './prisma';
import { AREA_GABUNGAN, KODE_GABUNGAN } from './areas';
import { muatArea } from './area-store';
import { toDateKeyUtc, type DateKey } from './dates';
import { getSettingsMap } from './compute';
import { whsPemasok } from './eji';
import { groupPerSku, sapPerGroup, kunciSaldo, type BarisSkuLink, type SaldoPemasok } from './sku-link';
import { hitungSemua, type HasilOpenPo, type RingkasOpenPo } from './openpo';
import { susunBarisPo, STATUS_PO, type BarisSnapshotPo } from './sugest-po';
import { setelanArea } from './area-master';
import { type DoiDisplay } from './wa-poster';

type BarisSnapshot = BarisSnapshotPo & {
  sapCode: string | null;
  refDoi: number | null;
  availableQty: number; transitQty: number;
  ads1: number; ads2: number;
};

export type DiagnosaSugest = {
  /** Baris `sku_link`. 0 = mapping belum diisi -> halaman tidak bisa menyarankan apa pun. */
  mapping: number;
  /** Baris `supplier_stock`. 0 = saldo pemasok belum pernah ditarik. */
  saldo: number;
  /** Kapan saldo terakhir ditarik; null = belum pernah. */
  saldoPada: string | null;
  /** Gudang pemasok urut prioritas, dari Pengaturan. */
  gudang: string[];
  /** SKU yang perlu PO tapi TIDAK punya mapping — tidak bisa dipesan, dan harus kelihatan. */
  tanpaMapping: { sku: string; name: string; areaId: string; need: number }[];
};

/**
 * Satu baris PO, ditambah DOI SESUDAH barangnya masuk.
 *
 * Diminta user 12 Okt 2026: "tambahkan doi after open po pada tabelnya, jadi
 * akan terdeteksi setelah open PO ... agar target doi bisa tetap terjaga
 * melalui pantauan datanya."
 *
 * Gunanya bukan sekadar informasi. Saran PO mengisi sampai (batas Aman + lead
 * time), dan pembulatan ke karton utuh bisa melewatinya — kolom ini yang
 * memperlihatkan BERAPA lewatnya, per baris, sebelum PO-nya ditekan.
 */
export type BarisSugest = HasilOpenPo & {
  /** Stok + SIT saat ini (pcs). */
  posisi: number;
  /** ADS opsi yang dipakai (pcs/hari). */
  ads: number;
  /** (posisi + qty PO) / ADS. null kalau ADS 0 — "berapa hari" tak punya jawaban. */
  doiSesudah: number | null;
  /**
   * Target untuk `doiSesudah`: **batas Aman + lead time cabang**, BUKAN batas
   * Aman saja.
   *
   * KEJADIAN NYATA 12 Okt 2026, ditanyakan user: "DOI setelah open PO Pusat
   * rata-rata 8, padahal batas aman Pusat 7?" Memang 8, dan memang benar —
   * kebutuhan PO dihitung `(aman + lead time) x ADS - posisi`, jadi dengan lead
   * time Pusat 1 hari titik pendaratannya 8. Angka 7 itu untuk saat barang
   * SAMPAI; selama 1 hari menunggu, jualan tetap jalan.
   *
   * Dibuktikan di data produksi hari itu: dari 178 baris Pusat, 3 baris yang
   * qty-nya kebetulan pas karton membaca 8,00 PERSIS (min 8,00 maks 8,01).
   *
   * Dibandingkan dengan 7, kolom itu TIDAK AKAN PERNAH bisa hijau di Pusat
   * walau semuanya berjalan tepat seperti rancangan — dan alarm yang menyala
   * permanen adalah alarm yang akhirnya diabaikan. Jadi targetnya yang
   * diperbaiki, bukan hitungannya.
   */
  targetSesudah: number | null;
};

/**
 * Ringkasan per cabang: DOI sekarang, DOI sesudah seluruh PO cabang itu masuk,
 * dan target cabangnya.
 *
 * Angka cabang diambil dari `doi_summary` — ringkasan yang SAMA dengan yang
 * dipakai Dashboard dan poster. Dijumlahkan sendiri dari baris PO akan salah:
 * daftar PO hanya memuat SKU Kritis & Low, sedangkan DOI cabang dihitung dari
 * SELURUH SKU-nya.
 */
export type RingkasArea = {
  areaId: string;
  baris: number;
  qtyPo: number;
  stok: number;
  transit: number;
  ads: number;
  doiSekarang: number | null;
  doiSesudah: number | null;
  /** Batas Aman cabang — target untuk DOI SEKARANG. */
  target: number | null;
  /** Lead time cabang (hari). 0 = barang dianggap sampai hari itu juga. */
  leadTime: number;
  /** Batas Aman + lead time — target untuk DOI SESUDAH PO. Lihat `BarisSugest`. */
  targetSesudah: number | null;
};

export type HasilSugestPo = {
  /** Cabang yang sedang disaring; null = semua cabang. */
  areaId: string | null;
  /**
   * Cabang yang bisa dipilih — dari tabel Cabang/Area, BUKAN dari baris PO.
   *
   * Kalau diambil dari baris PO, cabang yang kebetulan sedang tidak punya SKU
   * menyentuh batas Low akan HILANG dari pemilih — dan orang yang mencarinya
   * mengira cabangnya belum terdaftar, padahal keadaannya justru sehat.
   */
  areas: string[];
  snapshotDate: DateKey | null;
  computedAt: string | null;
  opsi: 1 | 2;
  /**
   * Setelan `doi_display`. Dibawa ke layar supaya judul kolom bisa menghilangkan
   * nomor opsi ketika memang cuma satu yang ditampilkan — lihat `satuOpsi`.
   */
  doiDisplay: DoiDisplay;
  baris: BarisSugest[];
  ringkas: RingkasOpenPo;
  /** Per cabang — hanya cabang yang punya baris PO. */
  perArea: RingkasArea[];
  diagnosa: DiagnosaSugest;
};

/** Qty & DOI mana yang dipakai, mengikuti `doi_display` di Pengaturan. */
const opsiDipakai = (doiDisplay: string | undefined): 1 | 2 => (doiDisplay === 'OPSI2' ? 2 : 1);

/** `doi_display` mentah -> bentuk bertipe. Nilai asing jatuh ke BOTH, sama dengan `toDoiSettings`. */
const displayDipakai = (v: string | undefined): DoiDisplay =>
  (v === 'OPSI1' || v === 'OPSI2' ? v : 'BOTH');

export async function muatSugestPo(areaPilihan?: string | null): Promise<HasilSugestPo> {
  // GABUNGAN di pemilih area berarti "semua cabang", bukan nama area yang
  // dicari — tidak ada baris doi_snapshot bernama GABUNGAN di daftar PO,
  // jadi menyaringnya apa adanya akan selalu menghasilkan tabel kosong.
  const areaSaring = !areaPilihan || areaPilihan === AREA_GABUNGAN ? null : areaPilihan;
  const raw = await getSettingsMap();
  const opsi = opsiDipakai(raw.doi_display);

  // Tanggal snapshot TERBARU, dari baris cabang saja. GABUNGAN sengaja tidak
  // ikut: PO dikirim ke gudang cabang, dan baris gabungan akan menghitung
  // kebutuhan yang sama untuk kedua kalinya — saldo pemasok yang sama lalu
  // dijanjikan dua kali.
  // Dipakai dua kali: daftar pilihan cabang, dan target per cabang di
  // ringkasan DOI sesudah PO. Dimuat SEKALI.
  const barisArea = await muatArea().catch(() => []);
  const cabang = barisArea
    .filter((a) => a.isActive)
    .filter((a) => a.code !== KODE_GABUNGAN)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((a) => a.name);

  const tanggal = await prisma.$queryRawUnsafe<{ d: Date | null }[]>(
    'SELECT MAX(snapshotDate) AS d FROM doi_snapshot WHERE areaId <> ?',
    AREA_GABUNGAN,
  );
  const snapshotDate = tanggal[0]?.d ? toDateKeyUtc(tanggal[0].d) : null;
  if (!snapshotDate) {
    return {
      areaId: areaSaring, areas: cabang,
      snapshotDate: null, computedAt: null, opsi,
      doiDisplay: displayDipakai(raw.doi_display),
      baris: [], ringkas: ringkasKosong(), perArea: [],
      diagnosa: await diagnosa([], whsPemasok(raw.po_whs_order)),
    };
  }

  const kolomSuggest = opsi === 1 ? 'suggested1' : 'suggested2';
  const rows = await prisma.$queryRawUnsafe<BarisSnapshot[]>(
    `SELECT areaId, sku, name, sapCode, status, abcClass, doi1, doi2, refDoi,
            suggested1, suggested2, availableQty, transitQty, ads1, ads2
       FROM doi_snapshot
      WHERE snapshotDate = ? AND areaId <> ?
        AND status IN (?, ?)
        AND ${kolomSuggest} > 0
        ${areaSaring ? 'AND areaId = ?' : ''}`,
    ...[snapshotDate, AREA_GABUNGAN, ...STATUS_PO, ...(areaSaring ? [areaSaring] : [])],
  );

  const [linkRows, stokRows, ringkasan] = await Promise.all([
    prisma.skuLink.findMany().catch(() => []),
    prisma.supplierStock.findMany().catch(() => []),
    prisma.doiSummary.findFirst({
      where: { snapshotDate: new Date(`${snapshotDate}T00:00:00.000Z`) },
      orderBy: { computedAt: 'desc' },
      select: { computedAt: true },
    }).catch(() => null),
  ]);

  const link: BarisSkuLink[] = linkRows.map((r) => ({
    groupKey: r.groupKey, system: r.system as BarisSkuLink['system'],
    code: r.code, priority: r.priority, perCtn: r.perCtn, note: r.note,
  }));
  const grup = groupPerSku(link);
  const perGrup = sapPerGroup(link);

  const gudang = whsPemasok(raw.po_whs_order);
  const saldo = new Map<string, SaldoPemasok>();
  for (const s of stokRows) {
    saldo.set(kunciSaldo(s.sapCode, s.supplierWhs), {
      balance: s.bal, perCtn: s.perCtn, supplierWhs: s.supplierWhs,
    });
  }

  // Penyusunan barisnya MURNI, di `sugest-po.ts`: siapa yang masuk daftar,
  // berapa kebutuhannya, dan apa batas atasnya — tiga keputusan yang kalau
  // salah tidak memunculkan error, cuma angka pemesanan yang keliru.
  const { baris: barisPo, tanpaMapping } = susunBarisPo(rows, {
    opsi, grup, perGrup, saldo, gudang,
  });

  const { hasil, ringkas } = hitungSemua(barisPo, {
    toleransiCtn: Number(raw.po_toleransi_ctn ?? 1),
    lipatMaks: Number(raw.po_lipat_maks ?? 2),
  });

  // Posisi & ADS per (cabang, SKU) — dari baris snapshot yang sama, bukan
  // ditarik ulang.
  const posisiPerBaris = new Map(rows.map((r) => [
    `${r.areaId}\u0000${r.sku}`,
    { posisi: Number(r.availableQty ?? 0) + Number(r.transitQty ?? 0), ads: Number(opsi === 1 ? r.ads1 : r.ads2) || 0 },
  ]));
  // Target "setelah PO" per cabang, dihitung SEKALI: batas Aman + lead time.
  // Dari `setelanArea` supaya tidak ada dua tempat yang menentukan target.
  const targetSesudahPerArea = new Map<string, number | null>();
  for (const areaId of new Set(hasil.map((h) => h.areaId))) {
    const st = setelanArea(barisArea, areaId);
    const max = st.ambang?.max ?? null;
    targetSesudahPerArea.set(areaId, max === null ? null : max + Math.max(0, st.leadTimeDays ?? 0));
  }

  const baris: BarisSugest[] = hasil.map((h) => {
    const p = posisiPerBaris.get(`${h.areaId}\u0000${h.sku}`) ?? { posisi: 0, ads: 0 };
    return {
      ...h,
      posisi: p.posisi,
      ads: p.ads,
      // ADS 0 -> null, BUKAN 0 atau tak hingga. "Berapa hari stok ini bertahan"
      // tidak punya jawaban kalau barangnya tidak terjual.
      doiSesudah: p.ads > 0 ? (p.posisi + h.qtyTotal) / p.ads : null,
      targetSesudah: targetSesudahPerArea.get(h.areaId) ?? null,
    };
  });

  const perArea = await ringkasPerArea(baris, snapshotDate, barisArea, opsi);

  return {
    areaId: areaSaring,
    areas: cabang,
    snapshotDate,
    computedAt: ringkasan?.computedAt ? ringkasan.computedAt.toISOString() : null,
    opsi,
    doiDisplay: displayDipakai(raw.doi_display),
    baris,
    ringkas,
    perArea,
    diagnosa: {
      ...(await diagnosa(stokRows, gudang)),
      mapping: link.length,
      tanpaMapping: tanpaMapping.sort((a, b) => b.need - a.need).slice(0, 50),
    },
  };
}

/**
 * Ringkasan per cabang. Angka cabangnya dari `doi_summary`, bukan dijumlahkan
 * dari baris PO — lihat alasannya di `RingkasArea`.
 */
async function ringkasPerArea(
  baris: BarisSugest[],
  snapshotDate: DateKey,
  areaRows: Awaited<ReturnType<typeof muatArea>>,
  opsi: 1 | 2,
): Promise<RingkasArea[]> {
  const po = new Map<string, { baris: number; qty: number }>();
  for (const b of baris) {
    const e = po.get(b.areaId) ?? { baris: 0, qty: 0 };
    e.baris++; e.qty += b.qtyTotal;
    po.set(b.areaId, e);
  }
  if (!po.size) return [];

  const ringkasan = await prisma.doiSummary.findMany({
    where: { snapshotDate: new Date(`${snapshotDate}T00:00:00.000Z`), areaId: { in: [...po.keys()] } },
  }).catch(() => []);
  const out: RingkasArea[] = [];
  for (const [areaId, p] of po) {
    // Dari `setelanArea`, satu-satunya tempat aturan cadangan cabang ditulis —
    // jadi target di sini tidak bisa berbeda dari yang dipakai mesin DOI.
    const setelan = setelanArea(areaRows, areaId);
    const max = setelan.ambang?.max ?? null;
    const lead = Math.max(0, setelan.leadTimeDays ?? 0);
    const r = ringkasan.find((x) => x.areaId === areaId);
    let stok = 0, transit = 0, ads = 0, doiSekarang: number | null = null;
    if (r) {
      try {
        const payload = JSON.parse(r.payload) as { summary?: { total?: Record<string, number | null> } };
        const t = payload.summary?.total ?? {};
        stok = Number(t.stock ?? 0);
        transit = Number(t.transit ?? 0);
        // Opsi yang DIPILIH, bukan selalu opsi 1 — sama dengan yang dipakai
        // kolom DOI di tabel, kalau tidak ringkasan cabang dan barisnya
        // mengukur hal yang berbeda.
        const kAds = opsi === 1 ? 'ads1' : 'ads2';
        const kDoi = opsi === 1 ? 'doi1' : 'doi2';
        ads = Number(t[kAds] ?? 0);
        doiSekarang = t[kDoi] === null || t[kDoi] === undefined ? null : Number(t[kDoi]);
      } catch {
        // Payload rusak diperlakukan seperti tidak ada ringkasannya.
      }
    }
    out.push({
      areaId,
      baris: p.baris,
      qtyPo: p.qty,
      stok, transit, ads,
      doiSekarang,
      doiSesudah: ads > 0 ? (stok + transit + p.qty) / ads : null,
      target: max,
      leadTime: lead,
      targetSesudah: max === null ? null : max + lead,
    });
  }
  out.sort((a, b) => a.areaId.localeCompare(b.areaId));
  return out;
}

const ringkasKosong = (): RingkasOpenPo => ({
  baris: 0, sku: 0, qtyTotal: 0, ctnTotal: 0, perKode: [], kurang: 0, kosong: 0, pecahan: 0,
});

async function diagnosa(
  stokRows: { pulledAt: Date }[],
  gudang: string[],
): Promise<DiagnosaSugest> {
  let paling: Date | null = null;
  for (const s of stokRows) if (!paling || s.pulledAt > paling) paling = s.pulledAt;
  return {
    mapping: 0,
    saldo: stokRows.length,
    saldoPada: paling ? paling.toISOString() : null,
    gudang,
    tanpaMapping: [],
  };
}
