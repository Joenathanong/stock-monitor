import { sessionFromRequest } from './auth';

/**
 * Siapa yang boleh membaca data poster WhatsApp.
 *
 * DUA jalan masuk, dan keduanya perlu:
 *
 *   1. `?k=<WA_PAGE_TOKEN>` — untuk BOT. Bot berjalan di server lain dan tidak
 *      punya sesi, jadi token adalah satu-satunya cara ia bisa menarik datanya.
 *   2. Sesi login yang sah — untuk ORANG. Pengguna yang sudah login berhak
 *      melihat angka ini; ia sudah melihat angka yang sama di Dashboard.
 *
 * KENAPA JALAN KEDUA DITAMBAHKAN (8 Okt 2026). User minta poster masuk menu
 * sidebar. Memasang URL ber-token di sidebar berarti menyalin `WA_PAGE_TOKEN`
 * ke dalam bundel JavaScript yang diunduh SETIAP pengguna — termasuk peran
 * "Lihat saja" — dan siapa pun yang membuka source bisa membacanya lalu
 * memakainya dari luar tanpa login. Token yang ada di sidebar bukan token lagi.
 *
 * Dengan sesi sebagai jalan kedua, menu sidebar cukup menunjuk `/wa` tanpa
 * parameter apa pun, dan tokennya tetap hanya dipegang bot.
 *
 * Mengembalikan `null` kalau boleh, atau alasan penolakan.
 */
export async function tolakAksesPoster(req: Request): Promise<string | null> {
  const token = process.env.WA_PAGE_TOKEN;
  const k = new URL(req.url).searchParams.get('k');

  // Token diperiksa lebih dulu supaya bot tidak terpengaruh cookie nyasar.
  if (token && k === token) return null;
  if (await sessionFromRequest(req)) return null;

  // Token belum diset DAN tidak ada sesi: endpoint ini ditolak sepenuhnya,
  // bukan dibiarkan terbuka. Angka stok dan nilai rupiah seluruh area tidak
  // boleh jadi publik hanya karena seseorang lupa mengisi environment variable.
  if (!token) {
    return 'WA_PAGE_TOKEN belum diset di environment. Poster WhatsApp dimatikan sampai token diisi.';
  }
  return 'Kunci salah, dan Anda belum login. Buka lewat menu di aplikasi, atau sertakan ?k=<token> kalau Anda bot.';
}
