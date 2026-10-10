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
  baris: HasilOpenPo[];
  ringkas: RingkasOpenPo;
  diagnosa: DiagnosaSugest;
};

/** Qty & DOI mana yang dipakai, mengikuti `doi_display` di Pengaturan. */
const opsiDipakai = (doiDisplay: string | undefined): 1 | 2 => (doiDisplay === 'OPSI2' ? 2 : 1);

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
  const cabang = (await muatArea().catch(() => []))
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
      baris: [], ringkas: ringkasKosong(),
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

  return {
    areaId: areaSaring,
    areas: cabang,
    snapshotDate,
    computedAt: ringkasan?.computedAt ? ringkasan.computedAt.toISOString() : null,
    opsi,
    baris: hasil,
    ringkas,
    diagnosa: {
      ...(await diagnosa(stokRows, gudang)),
      mapping: link.length,
      tanpaMapping: tanpaMapping.sort((a, b) => b.need - a.need).slice(0, 50),
    },
  };
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
