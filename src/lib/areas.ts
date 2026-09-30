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

export const labelArea = (area: string) => (area === AREA_GABUNGAN ? 'Semua area' : area);
