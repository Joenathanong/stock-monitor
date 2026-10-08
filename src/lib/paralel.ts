/**
 * Menjalankan pekerjaan beberapa sekaligus, dengan batas — modul MURNI.
 *
 * KENAPA ADA. Penarikan transit membaca isi dokumen DO satu per satu, dan satu
 * dokumen butuh 6–11 detik (diukur 8 Okt 2026). Di dalam fungsi Vercel yang
 * dibatasi 60 detik — dan jatah transit di `runCompute` hanya ±18 detik — itu
 * berarti SATU dokumen per penarikan. Log aplikasi sendiri merekamnya:
 *
 *   05:25  transit 0 baris SEBAGIAN (23 dari 23 dokumen belum terbaca)
 *   05:29  transit 1 baris SEBAGIAN (22 dari 23 dokumen belum terbaca)
 *
 * Dokumen baru datang tiap hari, jadi satu dokumen per penarikan TIDAK PERNAH
 * menyusul. Akibatnya nyata: 8 Okt 2026, OCS punya 62.096 pcs menuju Pusat
 * (3 DO, semuanya hari itu) sementara poster menulis 171 pcs.
 *
 * Dibaca berbarengan, 23 dokumen selesai ±30 detik di batas 6 — diukur lewat
 * browser dengan sesi login yang sama. Jadi masalahnya bukan OCS lambat,
 * tapi kita menunggu satu-satu.
 *
 * TIDAK memakai `Promise.all` langsung atas seluruh daftar: 23 permintaan
 * serentak ke OCS bisa membuat OCS sendiri yang melambat atau menolak, dan OCS
 * dipakai orang lain untuk bekerja. Batasnya ada supaya penarikan kita tidak
 * jadi beban di sana.
 */

/**
 * Peta berbarengan dengan batas jumlah yang jalan serentak.
 *
 * Urutan hasil SAMA dengan urutan masukan (bukan urutan selesai) — kalau tidak,
 * hasilnya berbeda tiap kali dijalankan dan pemanggil yang memasangkannya ke
 * daftar aslinya akan salah pasang tanpa ada yang tahu.
 *
 * `boleh()` diperiksa SEBELUM setiap pekerjaan dimulai, bukan sekali di awal:
 * itu cara anggaran waktu bisa menghentikan sisa pekerjaan di tengah jalan.
 * Pekerjaan yang tidak pernah dimulai mengembalikan `undefined`, dan itu
 * DIBEDAKAN dari pekerjaan yang selesai dengan nilai — lihat `HasilParalel`.
 */
export type Slot<R> = { ada: true; nilai: R } | { ada: false };

export type HasilParalel<R> = {
  /** Sejajar dengan masukan. `ada: false` = tidak pernah dijalankan. */
  hasil: Slot<R>[];
  /** Jumlah yang benar-benar dijalankan. */
  jalan: number;
  /** Jumlah yang dilewati karena `boleh()` menolak. */
  dilewati: number;
};

export async function petaParalel<T, R>(
  masukan: readonly T[],
  kerja: (item: T, index: number) => Promise<R>,
  opsi: {
    /** Berapa yang boleh jalan serentak. Minimal 1. */
    batas?: number;
    /** Dipanggil sebelum setiap pekerjaan. false = sisanya dilewati. */
    boleh?: () => boolean;
  } = {},
): Promise<HasilParalel<R>> {
  const batas = Math.max(1, Math.trunc(opsi.batas ?? 4));
  const boleh = opsi.boleh ?? (() => true);
  const hasil: Slot<R>[] = masukan.map(() => ({ ada: false }));
  let berikut = 0;
  let jalan = 0;
  let dilewati = 0;
  let berhenti = false;

  async function pekerja() {
    for (;;) {
      if (berhenti) return;
      const i = berikut++;
      if (i >= masukan.length) return;
      if (!boleh()) {
        // Sekali anggaran habis, pekerja LAIN pun berhenti: tanpa ini setiap
        // pekerja masih mengambil satu tugas lagi, dan batas 6 berarti 6
        // permintaan tambahan setelah waktunya lewat.
        berhenti = true;
        // `=` bukan `+=`: hanya SATU pekerja bisa sampai ke sini, karena
        // pemeriksaan `berhenti`, `berikut++`, `boleh()` dan penetapan ini
        // berjalan tanpa `await` di antaranya — jadi tidak ada pekerja lain
        // yang menyelip. Dengan `+=` angkanya akan terhitung berkali-kali
        // kalau asumsi itu suatu saat berubah; dengan `=` ia tetap benar.
        dilewati = masukan.length - i;
        return;
      }
      jalan++;
      hasil[i] = { ada: true, nilai: await kerja(masukan[i], i) };
    }
  }

  await Promise.all(Array.from({ length: Math.min(batas, masukan.length) }, pekerja));
  return { hasil, jalan, dilewati };
}
