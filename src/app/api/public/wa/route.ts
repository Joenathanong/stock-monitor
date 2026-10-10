import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { latestSnapshot, summaryHistory } from '@/lib/query';
import { getSettingsMap } from '@/lib/compute';
import { AREA_GABUNGAN } from '@/lib/areas';
import { ambangDoi } from '@/lib/area-master';
import { muatArea } from '@/lib/area-store';
import { toDateKeyUtc } from '@/lib/dates';
import { tolakAksesPoster } from '@/lib/wa-akses';
import { persenAtpPerArea, trenAtp } from '@/lib/atp-store';
import { AMBANG_ATP_BAWAAN } from '@/lib/atp';
import { doiPlusSit } from '@/lib/wa-poster';

export const dynamic = 'force-dynamic';

/**
 * Data untuk poster WhatsApp (/wa) — TANPA login, dijaga token.
 *
 * Bot WhatsApp berjalan di server lain, jadi ia tidak punya sesi. Token di
 * `WA_PAGE_TOKEN` yang menjaga: tanpa `?k=<token>` permintaan ditolak 401.
 * Kalau token TIDAK diset, endpoint ini ditolak sepenuhnya — bukan dibiarkan
 * terbuka. Angka stok dan nilai rupiah seluruh area tidak boleh jadi publik
 * hanya karena seseorang lupa mengisi environment variable.
 */
const TREN_HARI = 30;

/** Nilai barang dalam perjalanan: qty transit × harga satuan saat snapshot. */
const nilaiTransit = (rows: { transitQty: number; unitPrice: number }[]) =>
  rows.reduce((t, r) => t + r.transitQty * r.unitPrice, 0);

export async function GET(req: Request) {
  // Token (bot) ATAU sesi login (orang) — aturannya satu tempat, lihat wa-akses.ts.
  const tolak = await tolakAksesPoster(req);
  if (tolak) {
    const status = tolak.startsWith('WA_PAGE_TOKEN') ? 503 : 401;
    return NextResponse.json({ ok: false, error: tolak }, { status });
  }

  const raw = await getSettingsMap();
  const blok = {
    angka: raw.wa_blok_angka !== '0',
    status: raw.wa_blok_status !== '0',
    tren: raw.wa_blok_tren !== '0',
    trenAtp: raw.wa_blok_tren_atp !== '0',
    po: raw.wa_blok_po !== '0',
  };
  // Daftar "SKU paling mendesak" DIHAPUS dari poster 10 Okt 2026 atas
  // permintaan user; `wa_blok_po` sekarang hanya menyalakan angka "Perlu open
  // PO" di blok angka. `kritisMaks` tetap dibaca supaya pengaturan lama tidak
  // menimbulkan galat, tapi tidak lagi menggambar apa pun.
  const kritisMaks = 0;
  // Opsi DOI yang ditampilkan ikut Pengaturan yang sama dengan seluruh layar lain
  // (`doi_display`), bukan setelan sendiri — supaya poster dan dashboard tidak
  // pernah menyebut angka yang berbeda.
  const dispRaw = String(raw.doi_display ?? 'BOTH').toUpperCase();
  const doiDisplay = dispRaw === 'OPSI1' || dispRaw === 'OPSI2' ? dispRaw : 'BOTH';
  const judul = raw.wa_judul || 'Ringkasan DOI Harian — IEG';

  // Kota saja; GABUNGAN dihitung terpisah dan ditampilkan sebagai ringkasan atas,
  // bukan sebagai kartu ke-6 yang bisa disalahbaca sebagai cabang.
  const kota = (
    await prisma.$queryRawUnsafe<{ areaId: string }[]>(
      "SELECT DISTINCT areaId FROM doi_snapshot WHERE areaId <> ? ORDER BY areaId",
      AREA_GABUNGAN,
    )
  ).map((r) => r.areaId);

  // Ambang DOI per area, untuk ditulis di label sebaran ("Kritis ≤4D").
  // Dicocokkan lewat NAMA, karena itulah kunci yang dipakai doi_snapshot.
  // Bawaannya disusun sama dengan perilaku lama di doi.ts, supaya area yang
  // ambangnya belum diisi tetap menampilkan angka yang BENAR-BENAR dipakai.
  const bawaanAmbang = {
    kritis: Number(raw.default_lead_time_days ?? 7),
    min: Number(raw.default_lead_time_days ?? 7) + Number(raw.safety_days ?? 3),
    max: Number(raw.target_doi_days ?? 14),
  };
  const barisArea = await muatArea().catch(() => []);
  const ambangPerNama = new Map(
    barisArea.map((a) => [a.name, ambangDoi(a, bawaanAmbang)]),
  );

  /**
   * ATP per area — hanya PERSENNYA (keputusan user 8 Okt 2026: checklist
   * sebarannya tidak masuk poster).
   *
   * Dibungkus try/catch dan boleh kosong. ATP adalah lapisan BARU di atas DOI
   * Monitor, dan poster DOI harian sudah dikirim bot tiap hari sebelum ATP ada.
   * Kalau `atp_share` belum di-push, atau penarikannya gagal, poster harus tetap
   * terkirim dengan kotak ATP bertanda "—". Fitur baru tidak boleh memadamkan
   * laporan yang sudah jalan.
   */
  const atpHasil = await persenAtpPerArea().catch(() => null);
  const atpPerArea = new Map((atpHasil?.hasil ?? []).map((h) => [h.areaId, h]));
  const atpStok = atpHasil?.stok ?? new Map();

  const perArea = await Promise.all(
    kota.map(async (area) => {
      const snap = await latestSnapshot(area);
      const s = snap.summary;
      const tren = blok.tren ? (await summaryHistory(TREN_HARI, area)).reverse() : [];
      // Dari `atp_daily` — potret harian, bukan hitung ulang: ATP% hari lalu
      // tidak bisa dibuat ulang hari ini karena checklist dan stoknya sudah
      // berubah. Gagal baca = daftar kosong, poster tetap terkirim.
      const trAtp = blok.trenAtp ? await trenAtp(TREN_HARI, area).catch(() => []) : [];
      // Baris kritis: yang statusnya CRITICAL dulu, lalu LOW, masing-masing
      // diurut dari DOI terkecil — itu urutan yang benar-benar mendesak.
      const kritis = blok.po
        ? snap.rows
            .filter((r) => r.status === 'CRITICAL' || r.status === 'LOW')
            .sort((a, b) =>
              (a.status === 'CRITICAL' ? 0 : 1) - (b.status === 'CRITICAL' ? 0 : 1)
              || (a.refDoi ?? Infinity) - (b.refDoi ?? Infinity))
            .slice(0, kritisMaks)
            .map((r) => ({ sku: r.sku, name: r.name, doi: r.refDoi, status: r.status, sug: Math.max(r.suggested1, r.suggested2) }))
        : [];
      return {
        area,
        snapshotDate: snap.snapshotDate,
        sku: s?.totalSku ?? 0,
        doi1: s?.total.doi1 ?? null,
        doi2: s?.total.doi2 ?? null,
        ads1: s?.total.ads1 ?? 0,
        ads2: s?.total.ads2 ?? 0,
        stock: s?.total.stock ?? 0,
        transit: s?.total.transit ?? 0,
        value: s?.total.value ?? 0,
        // `value` di ringkasan HANYA stok di tangan — `stockValue` per SKU itu
        // unitPrice × availableQty, transit tidak ikut. Nilai barang dalam
        // perjalanan karena itu dihitung di sini dari baris snapshot.
        valueTransit: nilaiTransit(snap.rows),
        noPrice: s?.total.noPrice ?? 0,
        byStatus: s?.byStatus ?? null,
        ambang: ambangPerNama.get(area) ?? bawaanAmbang,
        perluPo: blok.po ? snap.rows.filter((r) => Math.max(r.suggested1, r.suggested2) > 0).length : 0,
        // Dicocokkan lewat NAMA area, kunci yang sama dengan `stock_current` —
        // bukan kode gudang. Area yang tidak punya baris ATP dikirim `undefined`,
        // bukan nol, supaya posternya menulis "—" dan tidak mengarang 0%.
        // Ketersediaan dihitung dari BARIS SNAPSHOT yang sama dengan `sku`
        // (`totalSku` memang `rows.length`, diperiksa di doi.ts), jadi
        // available + kosong tidak pernah melebihi angka yang tertulis di
        // "SEBARAN STATUS" pada kartu yang sama.
        // Pembaginya KUMPULAN ATP (ketiga kategori), bukan kumpulan DOI —
        // keputusan user 8 Okt 2026. Jadi kotak ini dan ATP% di sebelahnya
        // berbicara tentang katalog yang sama, TAPI pembaginya tidak lagi sama
        // dengan "SEBARAN STATUS · 349 SKU" di kartu yang sama. Itu disadari
        // dan diterima: sebaran status memang hanya tentang produk satuan.
        //
        // Jatuh balik ke kumpulan DOI kalau ATP tidak terbaca, supaya poster
        // tidak kehilangan kotaknya saat tabel ATP belum ada.
        // Pembaginya SKU yang DICENTANG disebar — sama persis dengan pembagi
        // ATP% di sebelahnya, jadi kedua angka tidak bisa berselisih.
        //
        // Jatuh balik ke kumpulan DOI kalau ATP tidak terbaca sama sekali,
        // supaya poster tidak kehilangan kotaknya saat tabel ATP belum ada.
        stok: atpStok.has(area)
          ? {
              available: atpStok.get(area)!.available,
              dasar: atpStok.get(area)!.layak,
              ambang: AMBANG_ATP_BAWAAN,
            }
          : {
              available: snap.rows.filter((r) => r.availableQty > AMBANG_ATP_BAWAAN).length,
              dasar: snap.rows.length,
              ambang: AMBANG_ATP_BAWAAN,
            },
        // Dari ringkasan yang sama dengan doi1/doi2 di atas, jadi selisihnya
        // murni SIT. Pusat 8 Okt 2026: (216.752 + 62.024) / 31.725 = 8,8 hari,
        // berbanding DOI 6,8 hari tanpa SIT.
        doiSit: {
          doi1: doiPlusSit(s?.total.stock ?? 0, s?.total.transit ?? 0, s?.total.ads1),
          doi2: doiPlusSit(s?.total.stock ?? 0, s?.total.transit ?? 0, s?.total.ads2),
        },
        atp: atpPerArea.has(area)
          ? {
              persen: atpPerArea.get(area)!.persen,
              siap: atpPerArea.get(area)!.siap,
              dihitung: atpPerArea.get(area)!.dihitung,
            }
          : undefined,
        tren: tren.map((t) => ({ date: t.date, doi1: t.doi1, doi2: t.doi2 })),
        trenAtp: trAtp.map((t) => ({ date: t.date, persen: t.persen })),
        kritis,
      };
    }),
  );

  const gab = await latestSnapshot(AREA_GABUNGAN);

  return NextResponse.json({
    ok: true,
    judul,
    blok,
    doiDisplay,
    dibuatPada: new Date().toISOString(),
    snapshotDate: gab.snapshotDate ?? perArea[0]?.snapshotDate ?? null,
    computedAt: gab.computedAt,
    total: gab.summary
      ? {
          sku: gab.summary.totalSku,
          doi1: gab.summary.total.doi1,
          doi2: gab.summary.total.doi2,
          ads1: gab.summary.total.ads1,
          ads2: gab.summary.total.ads2,
          stock: gab.summary.total.stock,
          transit: gab.summary.total.transit,
          value: gab.summary.total.value,
          valueTransit: nilaiTransit(gab.rows),
          kritis: gab.summary.byStatus.CRITICAL,
          low: gab.summary.byStatus.LOW,
          // ATP keseluruhan dari hasil yang SAMA dengan ATP per kartu —
          // dijumlahkan lintas area, bukan dirata-rata persennya. Lihat
          // `atpKeseluruhan()`.
          atp: atpHasil
            ? {
                persen: atpHasil.keseluruhan.persen,
                siap: atpHasil.keseluruhan.siap,
                dihitung: atpHasil.keseluruhan.dihitung,
              }
            : undefined,
        }
      : null,
    // Target ATP (%) — GLOBAL, satu angka untuk semua kartu. 0 atau kosong di
    // Pengaturan berarti "tidak diatur": barisnya tidak digambar sama sekali,
    // bukan digambar sebagai "Target 0%" yang akan membuat semua kartu lulus.
    atpTarget: Number(raw.atp_target_persen ?? 0) > 0 ? Number(raw.atp_target_persen) : null,
    areas: perArea,
    // Tanggal tren dipakai sebagai label sumbu; dikirim sekali, bukan per area.
    trenLabel: perArea[0]?.tren.map((t) => t.date) ?? [],
    hariIni: toDateKeyUtc(new Date()),
  });
}
