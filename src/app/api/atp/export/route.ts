import { writeWorkbook, type Lembar } from '@/lib/xlsx';
import { muatAtp } from '@/lib/atp-store';
import { persenTeks, AMBANG_ATP_BAWAAN, type SebabTolak } from '@/lib/atp';
import { toDateKeyUtc } from '@/lib/dates';

export const dynamic = 'force-dynamic';
// Vercel Hobby membunuh satu fungsi di detik ke-60. Menulis angka lebih besar
// TIDAK menaikkannya — prosesnya tetap dibunuh, dan menuliskan 120 hanya membuat
// kita mengira punya waktu yang tidak kita punya.
export const maxDuration = 60;

/**
 * Unduh ATP sebagai XLSX — tiga lembar.
 *
 * KENAPA TIGA, bukan satu. Matriks centang dan daftar stok menjawab dua
 * pertanyaan berbeda dan bentuknya bertentangan: matriks enak dibaca orang
 * (satu baris per SKU, satu kolom per cabang) tapi tidak bisa di-pivot; bentuk
 * panjang bisa di-pivot tapi 2.250 baris tidak enak dibaca. Memaksa keduanya ke
 * satu lembar menghasilkan lembar yang buruk untuk kedua gunanya.
 *
 *   Ringkasan  — persen ATP per area. Satu angka per cabang, untuk dilihat atasan.
 *   Sebaran    — matriks SKU x cabang: "Ya" / "Tidak" / kosong(belum diputuskan).
 *   Stok       — bentuk panjang: satu baris per SKU per cabang, siap di-pivot.
 *
 * FILTER YANG BERLAKU DITULIS DI DALAM BERKAS. Berkas ini akan beredar lewat
 * WhatsApp tanpa URL-nya, jadi "ATP 71%" di lembar Ringkasan harus menyebutkan
 * sendiri bahwa ia cuma brand Hanasui kalau memang begitu — kalau tidak, angka
 * sebagian akan dibaca sebagai angka keseluruhan.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const ambangRaw = Number(u.searchParams.get('ambang'));
  const ambang = Number.isFinite(ambangRaw)
    ? Math.min(10_000, Math.max(0, Math.trunc(ambangRaw)))
    : AMBANG_ATP_BAWAAN;
  const brand = (u.searchParams.get('brand') || 'ALL').trim();
  const kategori = (u.searchParams.get('kategori') || 'ALL').trim();
  const q = (u.searchParams.get('q') || '').trim().toLowerCase();
  const sRaw = String(u.searchParams.get('saring') ?? '').toUpperCase();
  const saring = sRaw === 'NONAKTIF' || sRaw === 'SEMUA' ? sRaw : 'AKTIF';

  const data = await muatAtp(ambang, saring);

  // Baris disaring, TAPI `data.hasil` (persen per area) TIDAK dihitung ulang
  // dari baris yang tersaring: persen ATP adalah angka seluruh produk, dan
  // menghitungnya ulang per brand akan memberi dua angka berbeda bernama sama.
  // Lembar Ringkasan menyebutkan ini supaya tidak jadi teka-teki.
  const baris = data.sku.filter((s) => {
    if (kategori !== 'ALL' && s.kategori !== kategori) return false;
    if (brand !== 'ALL' && (s.brand || '(tanpa brand)') !== brand) return false;
    if (q && !s.sku.toLowerCase().includes(q) && !s.name.toLowerCase().includes(q)) return false;
    return true;
  });

  const filterTeks = [
    `Status di OCS: ${saring === 'AKTIF' ? 'aktif saja' : saring === 'NONAKTIF' ? 'non-aktif saja' : 'aktif + non-aktif'}`,
    kategori === 'ALL' ? 'Kategori: semua (Sku, Bundle, Gimmick)' : `Kategori: ${kategori}`,
    brand === 'ALL' ? 'Brand: semua' : `Brand: ${brand}`,
    q ? `Pencarian: "${q}"` : null,
    `Ambang available: lebih dari ${ambang} pcs`,
    `${baris.length} dari ${data.sku.length} SKU`,
  ].filter(Boolean) as string[];

  const tgl = toDateKeyUtc(new Date());
  const SEBAB: Record<SebabTolak, string> = {
    TIDAK_AKTIF: 'Status tidak cocok filter',
    BUKAN_KATEGORI_SKU: 'Kategori di luar ATP',
  };

  const lembar: Lembar[] = [
    {
      nama: 'Ringkasan',
      catatan: [
        `ATP per area — ${tgl}. Ambang available: lebih dari ${ambang} pcs.`,
        'Angka di lembar ini SELURUH produk, tidak mengikuti filter brand di lembar lain.',
        'Pembagi = SKU yang DIBAGIKAN ke area itu dan layak ATP. SKU yang tidak disebar '
          + 'dan yang belum diputuskan TIDAK ikut pembagi.',
      ],
      columns: [
        { header: 'Area', key: 'area', width: 16 },
        { header: 'ATP %', key: 'persen', width: 10 },
        { header: 'Siap', key: 'siap', width: 9 },
        { header: 'Pembagi (dibagikan & layak)', key: 'dihitung', width: 27 },
        { header: 'Tidak disebar', key: 'takDisebar', width: 15 },
        { header: 'Belum diputuskan', key: 'belum', width: 18 },
        { header: 'Nonaktif di OCS', key: 'nonaktif', width: 16 },
        { header: 'Bukan kategori Sku', key: 'bukanSku', width: 19 },
        { header: 'SKU penulisan kotor', key: 'kotor', width: 20 },
      ],
      rows: [
        ...data.hasil.map((h) => ({
          area: h.areaId,
          persen: persenTeks(h.persen),
          siap: h.siap,
          dihitung: h.dihitung,
          takDisebar: h.takDisebar,
          belum: h.belumDiputus,
          nonaktif: h.ditolak.TIDAK_AKTIF,
          bukanSku: h.ditolak.BUKAN_KATEGORI_SKU,
          kotor: h.kotor,
        })),
        {
          area: 'KESELURUHAN',
          persen: persenTeks(data.keseluruhan.persen),
          siap: data.keseluruhan.siap,
          dihitung: data.keseluruhan.dihitung,
          takDisebar: '', belum: '', nonaktif: '', bukanSku: '', kotor: '',
        },
      ],
    },
    {
      nama: 'Sebaran',
      catatan: [
        `Checklist sebaran SKU ke cabang — ${tgl}.`,
        ...filterTeks,
        'Kosong = BELUM DIPUTUSKAN (bukan "tidak"). Keduanya di luar pembagi, '
          + 'tapi hanya yang kosong masih menunggu orang memutuskan.',
        'Kolom "Stok <cabang>", "Stok total" dan "Turunan" hanya keterangan — isinya '
          + 'diabaikan saat berkas ini diunggah lagi. Yang dibaca hanya kolom bernama cabang.',
      ],
      columns: [
        // Urutan disamakan dengan layar (permintaan user 9 Okt 2026):
        // SKU, Turunan, Stok total, lalu cabang & stoknya BERDAMPINGAN, dan
        // Nama/Kategori/Brand di belakang. Berkas ini dan layar harus terbaca
        // sama; dua urutan berbeda untuk data yang sama bikin salah kolom.
        { header: 'SKU', key: 'sku', width: 34 },
        { header: 'Turunan', key: 'turunan', width: 9 },
        { header: 'Stok total', key: 'stok', width: 11 },
        // Kolom "Stok ..." hanya untuk DIBACA — importer melewatinya, jadi
        // mengubahnya di Excel tidak mengubah apa pun. Ada supaya sebaran bisa
        // ditentukan sambil melihat stok cabangnya, bukan menebak.
        ...data.areas.flatMap((a) => [
          { header: a, key: `a_${a}`, width: 13 },
          { header: `Stok ${a}`, key: `s_${a}`, width: 11 },
        ]),
        { header: 'Nama', key: 'name', width: 46 },
        { header: 'Kategori', key: 'kat', width: 11 },
        { header: 'Brand', key: 'brand', width: 12 },
      ],
      rows: baris.map((s) => {
        const r: Record<string, unknown> = {
          sku: s.sku,
          turunan: s.turunan.n || '',
          name: s.name,
          kat: s.kategori,
          brand: s.brand || '(tanpa brand)',
          stok: s.stokTotal,
        };
        for (const a of data.areas) {
          const x = s.area[a];
          r[`a_${a}`] = !x ? '' : x.dibagikan === null ? '' : x.dibagikan ? 'Ya' : 'Tidak';
          r[`s_${a}`] = x ? x.availableQty : '';
        }
        return r;
      }),
    },
    {
      nama: 'Stok',
      catatan: [
        `Stok per SKU per cabang — ${tgl}.`,
        ...filterTeks,
        'Satu baris per SKU per cabang, siap dibuat pivot table.',
      ],
      columns: [
        { header: 'SKU', key: 'sku', width: 34 },
        { header: 'Nama', key: 'name', width: 46 },
        { header: 'Kategori', key: 'kat', width: 11 },
        { header: 'Brand', key: 'brand', width: 12 },
        { header: 'Area', key: 'area', width: 14 },
        { header: 'Available Qty', key: 'qty', width: 14 },
        { header: `Siap (lebih dari ${ambang})`, key: 'siap', width: 20 },
        { header: 'Dibagikan', key: 'bagi', width: 16 },
        { header: 'Ikut pembagi ATP', key: 'ikut', width: 18 },
        { header: 'Alasan tidak layak', key: 'tolak', width: 20 },
        { header: 'Catatan', key: 'note', width: 30 },
      ],
      rows: baris.flatMap((s) => data.areas.map((a) => {
        const x = s.area[a];
        if (!x) return null;
        const bagi = x.dibagikan === null ? 'Belum diputuskan' : x.dibagikan ? 'Ya' : 'Tidak';
        return {
          sku: s.sku,
          name: s.name,
          kat: s.kategori,
          brand: s.brand || '(tanpa brand)',
          area: a,
          qty: x.availableQty,
          siap: x.siap ? 'Ya' : 'Tidak',
          bagi,
          ikut: x.tolak === null && x.dibagikan === true ? 'Ya' : 'Tidak',
          tolak: x.tolak ? SEBAB[x.tolak] : '',
          note: x.note,
        };
      }).filter(Boolean) as Record<string, unknown>[]),
    },
  ];

  // Lembar keempat: komposisi bundling, bentuk PANJANG (satu baris per
  // komponen per cabang). Sengaja bukan matriks: terukur 9 Okt 2026 sebuah
  // bundle bisa punya 14 komponen, jadi matriks komponen x cabang akan
  // melebar tak terkendali dan tidak bisa di-pivot.
  //
  // Hanya SKU yang punya turunan yang masuk — kalau tidak, 73% barisnya bundle
  // tanpa komposisi dan lembar ini jadi daftar baris kosong.
  const barisTurunan = baris.filter((s) => s.turunan.n > 0);
  if (barisTurunan.length) {
    lembar.push({
      nama: 'Turunan',
      catatan: [
        `Komposisi bundling — ${tgl}. Dari OCS /master/bundle; HANYA keterangan, tidak bisa diunggah balik.`,
        ...filterTeks,
        '"Bisa dibentuk" = floor(stok komponen / qty per bundle), dan angka bundle-nya '
          + 'adalah yang TERKECIL antar komponen — satu komponen habis berarti bundle tidak bisa dijanjikan.',
        'Angka itu HITUNGAN KAMI, bukan angka OCS. Kolom "Stok bundle (OCS)" adalah angka '
          + 'yang dipakai menghitung ATP. Kalau keduanya beda, itu informasi — bukan salah satunya salah.',
      ],
      columns: [
        { header: 'Bundle SKU', key: 'bsku', width: 34 },
        { header: 'Nama bundle', key: 'bname', width: 46 },
        { header: 'Komponen SKU', key: 'isku', width: 34 },
        { header: 'Nama komponen', key: 'iname', width: 40 },
        { header: 'Qty per bundle', key: 'qty', width: 14 },
        { header: 'Cabang', key: 'area', width: 14 },
        { header: 'Stok komponen', key: 'istok', width: 14 },
        { header: 'Status komponen', key: 'status', width: 16 },
        { header: 'Bisa dibentuk', key: 'muat', width: 13 },
        { header: 'Pembatas cabang ini', key: 'pembatas', width: 22 },
        { header: 'Bundle bisa dibentuk', key: 'bmuat', width: 20 },
        { header: 'Stok bundle (OCS)', key: 'bstok', width: 18 },
      ],
      rows: barisTurunan.flatMap((s) => s.turunan.turunan.flatMap((k) => data.areas.map((a) => {
        const x = k.area[a];
        return {
          bsku: s.sku,
          bname: s.name,
          isku: k.itemSku,
          iname: k.name,
          qty: k.qty,
          area: a,
          istok: x?.stok === null || x?.stok === undefined ? 'tidak terdaftar' : x.stok,
          status: x?.aktif === null || x?.aktif === undefined ? 'tidak terdaftar' : x.aktif ? 'aktif' : 'NONAKTIF',
          muat: x?.muat === null || x?.muat === undefined ? '' : x.muat,
          pembatas: s.turunan.pembatas[a] === k.itemSku ? 'YA' : '',
          bmuat: s.turunan.muat[a] === null || s.turunan.muat[a] === undefined ? 'tidak diketahui' : s.turunan.muat[a],
          bstok: s.area[a] ? s.area[a].availableQty : '',
        };
      }))),
    });
  }

  const buffer = await writeWorkbook(lembar);
  const tandaBrand = brand === 'ALL' ? '' : `-${brand.replace(/[^A-Za-z0-9]+/g, '')}`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="atp-${tgl}${tandaBrand}.xlsx"`,
    },
  });
}
