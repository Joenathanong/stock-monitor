/**
 * Nama area khusus untuk "seluruh kota dijumlahkan jadi satu angka".
 *
 * Dipisah ke berkasnya sendiri supaya modul klien (komponen React) bisa
 * memakainya tanpa ikut menarik Prisma.
 *
 * Bukan string 'All': 'All' adalah nilai lama `area_scope` dan juga parameter
 * OCS yang justru DILARANG dipakai untuk penarikan. Nama yang berbeda membuat
 * dua hal itu tidak mungkin tertukar — termasuk oleh saya nanti.
 */
export const AREA_GABUNGAN = 'GABUNGAN';

/**
 * Kode baris GABUNGAN di tabel `area`.
 *
 * Sejak 10 Okt 2026 laporan gabungan punya BARISNYA SENDIRI di tabel Cabang/Area,
 * bukan lagi memakai tiga pengaturan global yang dicabut. Alasannya satu: ambang
 * harus bisa diatur di SATU tempat. Selama gabungan diatur di tempat lain, selalu
 * ada angka di layar yang tidak cocok dengan tabel yang orang buka untuk
 * memeriksanya.
 *
 * Kodenya sengaja sama dengan namanya: tidak ada gudang OCS berkode "GABUNGAN",
 * jadi baris ini tidak mungkin tertukar dengan cabang sungguhan saat mencocokkan
 * SIT lewat AddressCode.
 */
export const KODE_GABUNGAN = AREA_GABUNGAN;

export const labelArea = (area: string) => (area === AREA_GABUNGAN ? 'Semua area' : area);
