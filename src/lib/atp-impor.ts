/**
 * Baca kembali lembar "Sebaran" hasil unduhan ATP — modul MURNI.
 *
 * Alurnya: unduh Excel → tentukan sebaran di Excel → unggah lagi → perubahannya
 * mengikuti Excel.
 *
 * JEBAKAN TERBESARNYA ADA DI SEL KOSONG, dan itu yang membentuk seluruh modul
 * ini. Di lembar unduhan, sel kosong berarti "BELUM DIPUTUSKAN". Supaya
 * bolak-baliknya setia, sel kosong saat diunggah harus berarti "kosongkan
 * keputusannya". Tapi artinya: siapa pun yang mengunggah berkas yang hanya
 * diisi sebagian akan MENGHAPUS seluruh keputusan di baris lain — ribuan
 * sekaligus, tanpa satu pun peringatan.
 *
 * Dua pengaman, dan keduanya perlu:
 *
 *   1. `abaikanKosong` — mode "hanya ubah yang terisi". Dipakai kalau user
 *      memang menyusun berkas sebagian.
 *   2. Hasilnya SELALU diringkas dulu (berapa jadi Ya, Tidak, dikosongkan)
 *      sebelum ditulis. Penulisannya butuh persetujuan terpisah.
 *
 * Modul ini tidak menyentuh database dan tidak membaca berkas; ia hanya
 * menerjemahkan baris yang sudah dibaca. Itu yang membuatnya bisa diuji.
 */

/** Nilai satu sel sebaran, sesudah dinormalkan. */
export type NilaiSel = 'YA' | 'TIDAK' | 'KOSONG' | 'ASING';

/**
 * Terjemahkan isi sel jadi keputusan.
 *
 * Ejaannya sengaja longgar — orang mengetik sendiri di Excel, dan menolak
 * "ya " atau "YA" hanya menghasilkan keluhan. Tapi yang TIDAK dikenali
 * dikembalikan sebagai `ASING`, bukan diam-diam dianggap kosong: sel berisi
 * "mungkin" atau "cek dulu" harus dilaporkan, bukan menghapus keputusan.
 */
export function bacaSel(v: unknown): NilaiSel {
  const t = String(v ?? '').trim().toLowerCase();
  if (!t) return 'KOSONG';
  if (['ya', 'y', 'yes', 'true', '1', 'v', 'x', 'ok', 'sebar', 'disebar'].includes(t)) return 'YA';
  if (['tidak', 't', 'no', 'n', 'false', '0', '-', 'tdk'].includes(t)) return 'TIDAK';
  return 'ASING';
}

export type PutusanImpor = { sku: string; areaId: string; dibagikan: boolean | null };

export type MasalahImpor = {
  baris: number;
  sku: string;
  areaId?: string;
  pesan: string;
};

export type HasilImpor = {
  /** Keputusan yang BERBEDA dari keadaan sekarang — hanya ini yang perlu ditulis. */
  putusan: PutusanImpor[];
  ringkas: { jadiYa: number; jadiTidak: number; dikosongkan: number; takBerubah: number };
  masalah: MasalahImpor[];
  /** Kolom di berkas yang bukan nama area mana pun — diabaikan, tapi disebut. */
  kolomAsing: string[];
};

/** Nama kolom dinormalkan sama seperti di xlsx.ts, supaya "Pusat " cocok. */
const normal = (s: string) => s.toLowerCase().replace(/[\s_\-.]/g, '');

/** Kolom keterangan di lembar unduhan — bukan keputusan, bukan kolom asing. */
const KOLOM_KETERANGAN = new Set(['sku', 'nama', 'brand', 'kategori', 'turunan']);

/**
 * Kolom stok ("Stok Pusat", "Stok total") — dibaca manusia, diabaikan mesin.
 *
 * Dicocokkan dengan nama yang SUDAH dinormalkan (`stokpusat`, `stoktotal`),
 * sesuai cara `readSheet` membentuk kuncinya. `petaArea` diperiksa LEBIH DULU,
 * jadi cabang yang namanya kebetulan diawali "Stok" tetap terbaca sebagai
 * cabang — penjaga ini hanya mengenai kolom yang bukan cabang mana pun.
 */
const kolomStok = (k: string) => /^stok/.test(k);

/**
 * Susun daftar perubahan dari baris Excel.
 *
 * `sekarang` dipakai untuk membuang yang TIDAK berubah. Tanpa itu, mengunggah
 * berkas yang baru saja diunduh tanpa diedit akan menulis ulang 8.000 baris dan
 * terlihat seperti perubahan besar padahal tidak ada yang berubah.
 */
export function susunImpor(
  rows: Record<string, unknown>[],
  areas: string[],
  /** SKU yang dikenal sistem. SKU asing dilaporkan, tidak ditulis. */
  skuDikenal: Set<string>,
  /** Keadaan sekarang: `${areaId}\u0000${sku}` -> boolean. Absen = belum diputuskan. */
  sekarang: Map<string, boolean>,
  opsi?: {
    abaikanKosong?: boolean;
    /**
     * Nomor baris Excel dari baris DATA pertama. Bawaan 2 (header di baris 1).
     *
     * Wajib diisi benar kalau berkasnya punya baris catatan di atas header —
     * dan lembar unduhan kita punya. Kena 8 Okt 2026: SKU bermasalah di baris 7
     * dilaporkan "baris 4", jadi user memeriksa baris yang salah dan menyimpulkan
     * laporannya ngawur.
     */
    barisPertama?: number;
  },
): HasilImpor {
  const awal = opsi?.barisPertama ?? 2;
  const petaArea = new Map(areas.map((a) => [normal(a), a]));
  const putusan: PutusanImpor[] = [];
  const masalah: MasalahImpor[] = [];
  const ringkas = { jadiYa: 0, jadiTidak: 0, dikosongkan: 0, takBerubah: 0 };
  const kolomAsing = new Set<string>();

  rows.forEach((row, i) => {
    // Nomor baris yang user LIHAT di Excel — bukan indeks array.
    const nomor = awal + i;
    const sku = String(row.sku ?? '').trim();
    if (!sku) return;                       // baris kosong di akhir lembar
    if (!skuDikenal.has(sku)) {
      masalah.push({ baris: nomor, sku, pesan: 'SKU tidak dikenal — dilewati' });
      return;
    }

    for (const [kolom, isi] of Object.entries(row)) {
      if (KOLOM_KETERANGAN.has(kolom)) continue;
      const areaId = petaArea.get(kolom);
      if (!areaId) {
        // Kolom stok ikut diunduh supaya sebaran bisa ditentukan sambil melihat
        // angkanya, tapi ia INFORMASI — bukan sesuatu yang bisa diubah dari
        // Excel. Dilewati diam-diam, bukan dilaporkan sebagai kolom asing:
        // kolom asing adalah tanda berkasnya salah, dan kolom yang kita sendiri
        // yang menulis tidak boleh memunculkan tanda itu.
        if (kolomStok(kolom)) continue;
        kolomAsing.add(kolom);
        continue;
      }

      const nilai = bacaSel(isi);
      if (nilai === 'ASING') {
        masalah.push({
          baris: nomor, sku, areaId,
          pesan: `Isi "${String(isi).slice(0, 20)}" tidak dikenali — dilewati (pakai Ya / Tidak / kosong)`,
        });
        continue;
      }
      if (nilai === 'KOSONG' && opsi?.abaikanKosong) continue;

      const baru = nilai === 'YA' ? true : nilai === 'TIDAK' ? false : null;
      const lama = sekarang.get(`${areaId}\u0000${sku}`) ?? null;
      if (baru === lama) { ringkas.takBerubah++; continue; }

      putusan.push({ sku, areaId, dibagikan: baru });
      if (baru === true) ringkas.jadiYa++;
      else if (baru === false) ringkas.jadiTidak++;
      else ringkas.dikosongkan++;
    }
  });

  return { putusan, ringkas, masalah, kolomAsing: [...kolomAsing].sort() };
}
