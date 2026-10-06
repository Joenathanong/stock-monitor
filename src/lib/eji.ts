/**
 * Klien stok gudang pemasok EJI — https://web.eji.co.id/sap_whs/stock
 *
 * Dibongkar langsung dari halamannya 2 Okt 2026 (tanpa menebak):
 *
 *   endpoint  GET https://web.eji.co.id/dt/report_iv_stok   (DataTables server-side)
 *   parameter whs[] itm[] cat[] nol   ← dari #txtWhs #txtItem #txtKat #txtZero
 *             ketiganya MULTI-SELECT, jadi dikirim sebagai array
 *   kolom     NO KODE NAMA WHS OH COM OP ODR BALNOSQ BAL
 *   arti      OH = On Hand, COM = Commited, OP = SQ (Open), ODR = Order,
 *             BALNOSQ = Balance (No SQ), BAL = Balance (With SQ)
 *   ekspor    sap_whs/stock/export/   (tidak dipakai modul ini)
 *
 * Yang DIPAKAI Sugest PO: `BAL`. Itu saldo yang sudah memperhitungkan SQ
 * terbuka — angka yang benar-benar bisa dijanjikan ke cabang.
 *
 * Gudang: `GBJD2` ("Bitung - Gudang Barang Jadi 2") lalu `GBJD`
 * ("Bitung - Gudang Barang Jadi") — KEDUANYA diambil, dan URUTANNYA berarti:
 * GBJD2 diperiksa lebih dulu (keputusan user 2 Okt 2026). Diatur lewat `EJI_WHS`,
 * tidak dengan mengubah kode.
 *
 * KREDENSIAL: hanya nama env. Nilainya diisi user di `.env` dan di Vercel, dan
 * tidak pernah ditulis ke berkas repo mana pun.
 *   EJI_USERNAME, EJI_PASSWORD   wajib (kecuali memakai EJI_COOKIE)
 *   EJI_COOKIE                   jalan pintas: cookie sesi yang sudah jadi,
 *                                untuk menguji endpoint tanpa menunggu alur
 *                                login benar. Kedaluwarsa sendiri.
 *   EJI_LOGIN_URL, EJI_FIELD_USER, EJI_FIELD_PASS
 *                                nama medan form login. Struktur halaman
 *                                login TIDAK bisa dibaca saat sesi aktif
 *                                (mengembalikan 200 tanpa form), jadi ini
 *                                dibuat bisa diatur daripada ditebak di kode.
 *   EJI_WHS                      gudang yang diambil; bawaan "GBJD"
 */
import { isiBoxDariNama } from './receive';

const BASIS = process.env.EJI_BASE_URL || 'https://web.eji.co.id';

/**
 * Gudang pemasok yang diambil, URUT PRIORITAS.
 *
 * Urutan di `EJI_WHS` BERARTI: yang pertama diperiksa lebih dulu saat Sugest PO.
 * Keputusan user 2 Okt 2026: GBJD2 dulu, lalu GBJD — dan gudang menentukan lebih
 * dulu daripada kode (lihat `whsPriority` di openpo.ts).
 */
export const whsPemasok = (): string[] => {
  const dari = (process.env.EJI_WHS || 'GBJD2,GBJD')
    .split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
  // Duplikat dibuang tapi urutan pertama dipertahankan — urutan itu prioritas.
  return [...new Set(dari)];
};

/** Urutan gudang: 0 = diperiksa paling dulu. Gudang tak terdaftar ditaruh paling akhir. */
export const prioritasWhs = (whs: string, daftar = whsPemasok()): number => {
  const i = daftar.indexOf(String(whs ?? '').trim().toUpperCase());
  return i < 0 ? 99 : i;
};

/** Satu baris mentah dari /dt/report_iv_stok. Nama medan apa adanya dari API. */
export type BarisStokEji = {
  NO?: unknown;
  KODE?: unknown;
  NAMA?: unknown;
  WHS?: unknown;
  OH?: unknown;
  COM?: unknown;
  OP?: unknown;
  ODR?: unknown;
  BALNOSQ?: unknown;
  BAL?: unknown;
};

export type SaldoPemasokBaris = {
  supplierWhs: string;
  sapCode: string;
  name: string;
  onHand: number;
  committed: number;
  sqOpen: number;
  ordered: number;
  balNoSq: number;
  bal: number;
  perCtn: number;
};

/**
 * Angka dari DataTables bisa datang sebagai "1.234" (titik ribuan ala Indonesia),
 * "1,234", "(50)" untuk negatif, atau sudah number. Dibersihkan di satu tempat
 * supaya tidak ada yang diam-diam jadi NaN lalu dianggap nol.
 */
export function angkaEji(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : 0;
  let t = String(v ?? '').trim();
  if (!t) return 0;
  const negatif = /^\(.*\)$/.test(t) || t.startsWith('-');
  t = t.replace(/[()\-\s]/g, '');
  // Buang pemisah ribuan apa pun; ambil hanya digit (saldo selalu bilangan bulat pcs).
  const digit = t.replace(/[^0-9]/g, '');
  if (!digit) return 0;
  const n = Number(digit);
  if (!Number.isFinite(n)) return 0;
  return negatif ? -n : n;
}

/** Buang markup kalau API mengembalikan sel ber-HTML (DataTables sering begitu). */
const teks = (v: unknown) => String(v ?? '').replace(/<[^>]*>/g, '').trim();

export function mapStokEji(rows: BarisStokEji[], whsBawaan = 'GBJD'): SaldoPemasokBaris[] {
  const out: SaldoPemasokBaris[] = [];
  for (const r of rows) {
    const sapCode = teks(r.KODE).toUpperCase();
    if (!sapCode) continue;
    const name = teks(r.NAMA).slice(0, 500);
    out.push({
      supplierWhs: (teks(r.WHS) || whsBawaan).toUpperCase(),
      sapCode,
      name,
      onHand: angkaEji(r.OH),
      committed: angkaEji(r.COM),
      sqOpen: angkaEji(r.OP),
      ordered: angkaEji(r.ODR),
      balNoSq: angkaEji(r.BALNOSQ),
      bal: angkaEji(r.BAL),
      // Isi karton dibaca dari nama, aturan yang sama dengan dokumen receive OCS
      // ("… 20ml X 100" → 100). Nilai di `sku_link` tetap menang kalau diisi user.
      perCtn: isiBoxDariNama(name) ?? 0,
    });
  }
  return out;
}

/** Parameter DataTables untuk satu permintaan. Kolom harus urut seperti di halaman. */
export const KOLOM_EJI = ['NO', 'KODE', 'NAMA', 'WHS', 'OH', 'COM', 'OP', 'ODR', 'BALNOSQ', 'BAL'] as const;

export function paramStok(opsi: {
  whs: string[];
  start?: number;
  length?: number;
  /** Tampilkan stok kosong? Bawaan tidak — yang nol tidak ada gunanya untuk PO. */
  tampilkanNol?: boolean;
  draw?: number;
}): URLSearchParams {
  const p = new URLSearchParams();
  p.set('draw', String(opsi.draw ?? 1));
  p.set('start', String(opsi.start ?? 0));
  p.set('length', String(opsi.length ?? 2000));
  p.set('search[value]', '');
  p.set('search[regex]', 'false');
  KOLOM_EJI.forEach((nama, i) => {
    p.set(`columns[${i}][data]`, nama);
    p.set(`columns[${i}][name]`, '');
    p.set(`columns[${i}][searchable]`, 'true');
    p.set(`columns[${i}][orderable]`, 'true');
    p.set(`columns[${i}][search][value]`, '');
    p.set(`columns[${i}][search][regex]`, 'false');
  });
  p.set('order[0][column]', '1');
  p.set('order[0][dir]', 'asc');
  // Filter halamannya BERSARANG di bawah `filter`, bukan di tingkat atas.
  //
  // Dibuktikan di Chrome 5 Okt 2026 dengan memanggil fungsi ajax.data milik
  // DataTables-nya sendiri: ia mengisi { draw, filter: { whs: [], itm: [],
  // nol: false, cat: [] } }. Nama medan di DOM (txtWhs/txtItem/txtKat/
  // txtZero) BUKAN nama parameternya.
  //
  // Nama yang salah TIDAK ditolak — diam-diam diabaikan: `whs[]=GBJD2&nol=0`
  // menjawab 200 dengan recordsTotal 618.796 (SEMUA gudang, SEMUA item),
  // sedangkan `filter[whs][]` menjawab 732. Jadi versi lama bukan "gagal",
  // tapi menarik seluruh database — itu lebih berbahaya daripada error.
  for (const w of opsi.whs) p.append('filter[whs][]', w);
  // Boolean, dikirim sebagai 'true'/'false' (bukan 1/0) seperti aslinya.
  p.set('filter[nol]', opsi.tampilkanNol ? 'true' : 'false');
  return p;
}

export type HasilTarikEji = {
  rows: SaldoPemasokBaris[];
  total: number;
  /** Benar kalau jumlah baris yang terbaca < total yang dilaporkan API. */
  sebagian: boolean;
};

/**
 * Baca EJI_COOKIE dan PERIKSA bentuknya.
 *
 * Kesalahan yang terjadi 2 Okt 2026: yang ditempel hanya kolom Value dari
 * DevTools, tanpa nama cookie-nya. Header `cookie: abc123…` tanpa nama tidak sah,
 * server memperlakukannya seperti tidak login, dan gejalanya SAMA PERSIS dengan
 * kredensial salah — HTTP 200 badan kosong. Diperiksa di sini supaya sebabnya
 * disebut, bukan ditebak lagi.
 *
 * Mengembalikan nama-nama cookie saja untuk ditampilkan; NILAINYA tidak pernah
 * dicetak ke mana pun karena setara password untuk sesi itu.
 */
export function bacaCookieEnv(raw: string | undefined | null): { cookie: string; nama: string[] } {
  let t = String(raw ?? '').trim();
  if (!t) return { cookie: '', nama: [] };
  // Tanda kutip pembungkus sering ikut tersalin dari .env atau DevTools.
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1).trim();
  }
  if (t.toLowerCase().startsWith('cookie:')) t = t.slice(7).trim();
  if (!t.includes('=')) {
    throw new Error(
      `EJI_COOKIE harus berbentuk "nama=nilai", bukan hanya nilainya. Yang terisi sekarang `
      + `${t.length} karakter dan tidak memuat tanda "=". Di DevTools → Application → Cookies → `
      + 'web.eji.co.id, salin kolom Name DAN Value lalu gabungkan: ci_session=<nilai>. '
      + 'Cara lain: jalankan document.cookie di Console dan tempel seluruh hasilnya.',
    );
  }
  if (/[\r\n]/.test(t)) {
    throw new Error('EJI_COOKIE memuat ganti baris — tempel dalam SATU baris di .env.');
  }
  const nama = t.split(';').map((x) => x.split('=')[0].trim()).filter(Boolean);
  return { cookie: t, nama };
}

/**
 * Benar kalau galatnya "gagal MENYAMBUNG", bukan "server menjawab salah".
 *
 * ConnectTimeoutError berasal dari undici (mesin fetch bawaan Node) dan batasnya
 * 10 detik, TIDAK dikendalikan AbortController kita — jadi memperbesar timeoutMs
 * tidak menolong. Terbukti 5 Okt 2026: `check:eji` mati dengan
 * ConnectTimeoutError, lalu beberapa menit kemudian fetch ke host yang sama
 * menjawab HTTP 200 dalam 1168 ms. Artinya sesaat, bukan jaringan diblokir.
 */
export function galatSambung(e: unknown): boolean {
  const kode = (e as { cause?: { code?: string }; code?: string })?.cause?.code
    ?? (e as { code?: string })?.code ?? '';
  const nama = (e as { name?: string })?.name ?? '';
  return nama === 'ConnectTimeoutError'
    || ['UND_ERR_CONNECT_TIMEOUT', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED'].includes(kode);
}

const tidur = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Coba ulang HANYA untuk kegagalan menyambung, maksimal 3 kali, jeda 1s lalu 3s.
 *
 * Yang TIDAK diulang: abort karena timeoutMs kita sendiri (itu sudah lama
 * menunggu), dan respons HTTP apa pun — 401/500 diulang tidak akan berubah.
 */
async function denganUlang<T>(kerja: () => Promise<T>, nUlang = 2): Promise<T> {
  let terakhir: unknown;
  for (let i = 0; i <= nUlang; i++) {
    try { return await kerja(); } catch (e) {
      if (!galatSambung(e)) throw e;
      terakhir = e;
      if (i < nUlang) await tidur(i === 0 ? 1000 : 3000);
    }
  }
  const kode = (terakhir as { cause?: { code?: string } })?.cause?.code ?? '';
  throw new Error(
    `Tidak bisa menyambung ke web.eji.co.id setelah ${nUlang + 1} percobaan${kode ? ` (${kode})` : ''}. `
    + 'Jalankan `npm run check:net`: kalau LANGKAH 5 (fetch) menjawab HTTP 2xx/3xx, '
    + 'jaringannya sehat dan ini hanya sesaat — ulangi saja. Kalau langkah 5 juga gagal, '
    + 'baru curigai proxy/antivirus/VPN.',
  );
}

async function minta(url: string, cookie: string, timeoutMs: number): Promise<Response> {
  return denganUlang(async () => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      return await fetch(url, {
        signal: ac.signal,
        headers: {
          cookie,
          accept: 'application/json, text/javascript, */*; q=0.01',
          'x-requested-with': 'XMLHttpRequest',
        },
        redirect: 'manual',
      });
    } finally { clearTimeout(t); }
  });
}

export type FormLogin = {
  /** URL tujuan POST, sudah diselesaikan jadi absolut. */
  action: string;
  method: string;
  /** Nama medan untuk username/email. */
  user: string;
  /** Nama medan untuk password. */
  pass: string;
  /**
   * Medan lain yang harus ikut dikirim apa adanya: hidden (token CSRF dll) DAN
   * tombol submit yang punya `name`.
   *
   * Tombolnya penting dan sempat terlewat (5 Okt 2026): banyak aplikasi PHP
   * memeriksa `isset($_POST['cmdLogin'])` sebelum memproses apa pun, jadi tanpa
   * tombolnya form hanya ditampilkan ulang tanpa pesan galat — persis gejala
   * yang terlihat: POST membalas HTML dengan ukuran sama seperti halaman login.
   */
  hidden: Record<string, string>;
  /** Seluruh nama medan yang terbaca, untuk dibandingkan dengan DevTools. */
  semuaMedan: string[];
};

const atribut = (tag: string, nama: string) =>
  (tag.match(new RegExp(`\\b${nama}\\s*=\\s*["']([^"']*)["']`, 'i')) || [])[1] ?? null;

/**
 * Temukan form login dari HTML halaman login.
 *
 * Penandanya satu dan tidak ambigu: form yang punya `<input type="password">`.
 * Dari situ nama medan username diambil dari medan non-hidden non-password yang
 * namanya paling mirip identitas, dan seluruh medan hidden (token CSRF dan
 * kawan-kawan) dibawa apa adanya — tanpa itu banyak framework menolak POST-nya.
 */
export function bacaFormLogin(html: string, urlHalaman: string): FormLogin | null {
  for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const atr = m[1];
    const isi = m[2];
    const medan: { name: string; type: string; value: string }[] = [];
    // <button> IKUT dibaca. Tanpa itu `cmdLogin` dan sejenisnya tidak terkirim.
    for (const i of isi.matchAll(/<(input|select|textarea|button)\b([^>]*)>/gi)) {
      const name = atribut(i[2], 'name');
      if (!name) continue;
      const tag = i[1].toLowerCase();
      medan.push({
        name,
        // <button> tanpa type bawaannya submit — itu aturan HTML, bukan tebakan.
        type: (atribut(i[2], 'type') || (tag === 'button' ? 'submit' : tag)).toLowerCase(),
        value: atribut(i[2], 'value') ?? '',
      });
    }
    const pass = medan.find((x) => x.type === 'password');
    if (!pass) continue;

    const calon = medan.filter((x) => x.type !== 'password' && x.type !== 'hidden' && x.type !== 'submit');
    const user = calon.find((x) => /user|email|nip|login|akun/i.test(x.name)) ?? calon[0];
    if (!user) continue;

    const act = atribut(atr, 'action');
    const action = !act ? urlHalaman
      : act.startsWith('http') ? act
        : act.startsWith('/') ? new URL(act, urlHalaman).toString()
          : new URL(act, urlHalaman).toString();

    const hidden: Record<string, string> = {};
    for (const x of medan) {
      if (x.name === user.name || x.name === pass.name) continue;
      // hidden: nilainya wajib apa adanya. tombol: cukup ADA namanya — nilainya
      // dipakai kalau disebutkan, kalau tidak dipakai namanya sendiri, seperti
      // yang dikirim browser untuk tombol tanpa value.
      if (x.type === 'hidden') hidden[x.name] = x.value;
      else if (x.type === 'submit' || x.type === 'image') hidden[x.name] = x.value || x.name;
    }

    return {
      action,
      method: (atribut(atr, 'method') || 'post').toLowerCase(),
      user: user.name,
      pass: pass.name,
      hidden,
      semuaMedan: medan.map((x) => `${x.name}(${x.type})`),
    };
  }
  return null;
}

/** Kumpulkan cookie lintas langkah; yang terbaru menimpa yang lama. */
class Keranjang {
  private isi = new Map<string, string>();
  tambah(r: Response) {
    for (const c of r.headers.getSetCookie?.() ?? []) {
      const [pasangan] = c.split(';');
      const i = pasangan.indexOf('=');
      if (i > 0) this.isi.set(pasangan.slice(0, i).trim(), pasangan.slice(i + 1).trim());
    }
  }
  get header() { return [...this.isi].map(([k, v]) => `${k}=${v}`).join('; '); }
  get nama() { return [...this.isi.keys()]; }
}

/**
 * Nama medan dari env, kalau diisi — DENGAN pemeriksaan.
 *
 * Kesalahan nyata 5 Okt 2026: `EJI_FIELD_USER` dan `EJI_FIELD_PASS` diisi dengan
 * email dan password, bukan nama medannya. Akibatnya POST mengirim
 * `email=email` dan login tidak pernah terjadi — tanpa galat, karena halaman
 * login tetap membalas cookie sesi anonim. Nama env-nya memang menyesatkan,
 * jadi sekarang kesalahan itu ditolak dengan pesan yang menjelaskan bedanya.
 */
function namaMedanEnv(kunci: string, nilaiRahasia: (string | undefined)[]): string | null {
  const v = process.env[kunci]?.trim();
  if (!v) return null;
  const salah = v.includes('@') || v.includes(' ') || nilaiRahasia.some((x) => x && x === v);
  if (salah) {
    throw new Error(
      `${kunci} harus berisi NAMA medan form (mis. "username" atau "password"), bukan nilainya. `
      + 'Yang terisi sekarang terlihat seperti email/password. Kosongkan saja baris itu — '
      + 'nama medan ditemukan otomatis dari halaman login.',
    );
  }
  return v;
}

/**
 * Masuk ke web EJI dan kembalikan cookie sesinya.
 *
 * Dua langkah, karena satu langkah tidak cukup:
 *   1. GET halaman login — mengambil cookie awal DAN struktur formnya
 *      (nama medan + medan hidden seperti token CSRF);
 *   2. POST ke action form itu dengan cookie dari langkah 1.
 *
 * Nama medan ditemukan sendiri dari halaman login, jadi tidak ada yang perlu
 * ditebak dan tidak ada yang perlu diisi user. `EJI_FIELD_USER`/`EJI_FIELD_PASS`
 * tetap ada hanya sebagai penimpa kalau penemuannya salah.
 *
 * `EJI_COOKIE` melewati seluruh langkah ini.
 */
export type LaporanLogin = {
  /** Terisi hanya kalau seluruh langkah lolos DAN verifikasinya berhasil. */
  cookie: string;
  langkah: string[];
  /** Petunjuk konkret untuk langkah berikutnya, bukan nasihat umum. */
  saran: string[];
  berhasil: boolean;
};

/** Pesan galat login yang biasa muncul di HTML balasan — dipakai sebagai petunjuk. */
const POLA_GAGAL = [
  /password.{0,20}(salah|tidak|invalid|wrong)/i,
  /(salah|invalid|wrong).{0,20}password/i,
  /(user|akun|email).{0,25}(tidak|belum).{0,25}(ada|terdaftar|ditemukan)/i,
  /login (gagal|failed)/i,
  /captcha/i,
  /terlalu banyak|too many/i,
];

/**
 * Masuk ke web EJI dan LAPORKAN tiap langkahnya.
 *
 * Kenapa perlu laporan: versi sebelumnya hanya memeriksa "apakah dapat cookie".
 * Web EJI memberi cookie sesi anonim bahkan untuk login yang DITOLAK, jadi
 * langkah login terlihat berhasil padahal tidak — dan kegagalannya baru muncul
 * jauh di belakang sebagai "stok menjawab badan kosong". Sekarang ada langkah
 * verifikasi: sesinya dicoba ke halaman yang butuh login, dan kalau badannya
 * kosong berarti belum masuk.
 */
export async function masukEjiRinci(timeoutMs = 30_000): Promise<LaporanLogin> {
  const langkah: string[] = [];
  const saran: string[] = [];
  const siap = bacaCookieEnv(process.env.EJI_COOKIE);
  if (siap.cookie) {
    langkah.push(`EJI_COOKIE dipakai (${siap.nama.join(', ')}) — langkah login dilewati`);
    return { cookie: siap.cookie, langkah, saran, berhasil: true };
  }

  const user = process.env.EJI_USERNAME;
  const pass = process.env.EJI_PASSWORD;
  if (!user || !pass) {
    return {
      cookie: '', berhasil: false, langkah,
      saran: ['Isi EJI_USERNAME dan EJI_PASSWORD di .env (atau EJI_COOKIE).'],
    };
  }

  const urlLogin = process.env.EJI_LOGIN_URL?.trim() || `${BASIS}/login`;
  const keranjang = new Keranjang();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    // 1. halaman login
    // Dibungkus denganUlang: GET inilah yang mati dengan ConnectTimeoutError
    // 5 Okt 2026, dan itu kegagalan sesaat (lihat galatSambung).
    const g = await denganUlang(() => fetch(urlLogin, { signal: ac.signal, redirect: 'follow' }));
    keranjang.tambah(g);
    const html = await g.text();
    langkah.push(`GET ${urlLogin} → HTTP ${g.status}, ${html.length} byte, cookie: ${keranjang.nama.join(', ') || '(tidak ada)'}`);

    const form = bacaFormLogin(html, g.url || urlLogin);
    if (!form) {
      langkah.push('form login: TIDAK KETEMU');
      saran.push(html.length < 200
        ? 'Halaman login hampir kosong — kemungkinan dirender JavaScript, jadi formnya tidak ada di HTML. Login dari skrip tidak bisa membaca strukturnya.'
        : 'Tidak ada <form> dengan medan password. Coba "npm run check:eji-login" untuk URL kandidat lain.');
      saran.push('Jalan paling pasti: DevTools → Network → login manual sekali → lihat permintaan POST-nya (URL + nama medan), lalu setel EJI_LOGIN_URL / EJI_FIELD_USER / EJI_FIELD_PASS.');
      return { cookie: '', berhasil: false, langkah, saran };
    }
    const namaUser = namaMedanEnv('EJI_FIELD_USER', [user, pass]) ?? form.user;
    const namaPass = namaMedanEnv('EJI_FIELD_PASS', [user, pass]) ?? form.pass;
    langkah.push(
      `form login: action=${form.action} method=${form.method.toUpperCase()} `
      + `medan user="${namaUser}" pass="${namaPass}"`
      + `${Object.keys(form.hidden).length ? ` ikut dikirim=[${Object.keys(form.hidden).join(', ')}]` : ' (tanpa medan lain)'}`,
    );
    langkah.push(`seluruh medan di form: ${form.semuaMedan.join(', ') || '(tidak ada)'}`);

    // 2. kirim kredensial
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(form.hidden)) body.set(k, v);
    body.set(namaUser, user);
    body.set(namaPass, pass);
    const r = await denganUlang(() => fetch(form.action, {
      method: 'POST', body, signal: ac.signal, redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: keranjang.header,
        referer: g.url || urlLogin,
      },
    }));
    keranjang.tambah(r);
    const balas = await r.text();
    const lokasi = r.headers.get('location');
    langkah.push(
      `POST login → HTTP ${r.status}${lokasi ? ` → Location: ${lokasi}` : ''}, `
      + `${balas.length} byte, cookie: ${keranjang.nama.join(', ') || '(tidak ada)'}`,
    );

    const petunjuk = POLA_GAGAL.find((re) => re.test(balas));
    if (petunjuk) langkah.push(`balasan login memuat pesan penolakan (pola: ${petunjuk})`);
    // Ukuran yang SAMA dengan halaman login = form ditampilkan ulang, tidak
    // diproses. Penanda yang jauh lebih jelas daripada "HTTP 200".
    const diulang = balas.length === html.length;
    if (diulang) langkah.push('balasan POST berukuran SAMA dengan halaman login → form ditampilkan ulang, tidak diproses');
    // Teks galat yang terlihat di halaman, kalau ada - membantu tanpa menebak.
    const pesan = [...balas.matchAll(/<(?:div|span|p|li)[^>]*(?:alert|error|danger|warning|msg)[^>]*>([\s\S]{0,200}?)<\/(?:div|span|p|li)>/gi)]
      .map((m) => m[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())
      .filter((x) => x.length > 2).slice(0, 2);
    if (pesan.length) langkah.push(`pesan di halaman balasan: ${pesan.map((x) => `"${x.slice(0, 120)}"`).join(' | ')}`);

    // 3. VERIFIKASI — ini yang dulu tidak ada.
    const uji = await fetch(`${BASIS}/sap_whs/stock`, {
      signal: ac.signal, redirect: 'manual', headers: { cookie: keranjang.header },
    });
    const isiUji = await uji.text();
    const masuk = uji.status === 200 && isiUji.length > 500;
    langkah.push(`verifikasi GET /sap_whs/stock → HTTP ${uji.status}, ${isiUji.length} byte → ${masuk ? 'SUDAH login' : 'BELUM login'}`);

    if (masuk) return { cookie: keranjang.header, berhasil: true, langkah, saran };

    if (petunjuk) {
      saran.push('Balasan login berisi pesan penolakan — periksa username/password di .env.');
      saran.push('Kalau ada captcha atau pembatasan percobaan, login dari skrip tidak akan bisa; pakai EJI_COOKIE.');
    } else if (lokasi && /login/i.test(lokasi)) {
      saran.push(`Server mengembalikan Anda ke halaman login (${lokasi}) — kredensial ditolak, atau ada medan wajib yang belum terkirim.`);
    } else if (diulang) {
      saran.push('Form ditampilkan ulang tanpa pesan galat. Dua sebab yang paling sering: (a) kredensial salah, (b) masih ada medan wajib yang belum terkirim.');
      saran.push(`Medan yang saya kirim: ${[namaUser, namaPass, ...Object.keys(form.hidden)].join(', ')}. Bandingkan dengan DevTools → Network → login manual → tab Payload.`);
    } else {
      saran.push('POST diterima tapi sesinya tetap belum login. Kemungkinan ada langkah tambahan (token per-permintaan, header khusus, atau 2FA).');
    }
    saran.push('Pembanding yang menentukan: DevTools → Network → login manual → bandingkan URL, nama medan, dan daftar medan yang dikirim dengan baris "form login" di atas.');
    return { cookie: '', berhasil: false, langkah, saran };
  } finally { clearTimeout(t); }
}

/** Versi ringkas: kembalikan cookie, atau lempar dengan seluruh laporannya. */
export async function masukEji(timeoutMs = 30_000): Promise<string> {
  const l = await masukEjiRinci(timeoutMs);
  if (l.berhasil) return l.cookie;
  throw new Error(
    'Login EJI gagal.\n  ' + l.langkah.map((x) => `· ${x}`).join('\n  ')
    + (l.saran.length ? '\n\n  Langkah berikutnya:\n  ' + l.saran.map((x) => `- ${x}`).join('\n  ') : ''),
  );
}

/**
 * Tarik saldo satu atau beberapa gudang pemasok.
 *
 * Dibaca bertahap (paging DataTables) sampai `recordsFiltered` terpenuhi, supaya
 * tidak bergantung pada satu permintaan raksasa yang bisa kena timeout.
 */
export async function tarikStokEji(opsi: {
  whs?: string[];
  cookie?: string;
  timeoutMs?: number;
  perHalaman?: number;
  maksHalaman?: number;
} = {}): Promise<HasilTarikEji> {
  const whs = opsi.whs ?? whsPemasok();
  const cookie = opsi.cookie ?? await masukEji();
  const timeoutMs = opsi.timeoutMs ?? 45_000;
  const perHalaman = opsi.perHalaman ?? 2000;
  const maksHalaman = opsi.maksHalaman ?? 20;

  const rows: SaldoPemasokBaris[] = [];
  let total = 0;
  for (let h = 0; h < maksHalaman; h++) {
    const p = paramStok({ whs, start: h * perHalaman, length: perHalaman, draw: h + 1 });
    const r = await minta(`${BASIS}/dt/report_iv_stok?${p.toString()}`, cookie, timeoutMs);
    if (r.status >= 300 && r.status < 400) {
      throw new Error('Permintaan stok EJI dialihkan — sesi kemungkinan kedaluwarsa. Perbarui kredensial/cookie.');
    }
    if (!r.ok) throw new Error(`Stok EJI HTTP ${r.status}`);
    const teksBadan = await r.text();
    const tipe = r.headers.get('content-type') || '(tanpa content-type)';
    let j: { data?: BarisStokEji[]; recordsFiltered?: number; recordsTotal?: number };
    try { j = JSON.parse(teksBadan); } catch {
      // Dibedakan, karena penanganannya beda jauh:
      //
      //   badan KOSONG  -> web EJI menjawab 200 tanpa isi untuk permintaan yang
      //                    TIDAK terautentikasi (perilaku yang sama terlihat di
      //                    /login saat diuji 2 Okt 2026). Jadi ini soal sesi.
      //   badan HTML    -> dialihkan ke halaman, bisa jadi halaman login atau
      //                    halaman galat.
      const kosong = teksBadan.trim().length === 0;
      throw new Error(kosong
        ? `Stok EJI menjawab HTTP ${r.status} dengan badan KOSONG (${tipe}) — artinya permintaannya `
          + 'tidak terautentikasi. Cookie sesi tidak terkirim atau sudah tidak sah. '
          + 'Isi EJI_COOKIE dengan cookie sesi dari browser untuk memastikan endpoint & '
          + 'parameternya sudah benar; kalau itu berhasil, yang perlu dibetulkan alur login '
          + '(EJI_LOGIN_URL / EJI_FIELD_USER / EJI_FIELD_PASS).'
        : `Respons stok EJI bukan JSON (HTTP ${r.status}, ${tipe}, ${teksBadan.length} byte). `
          + `Potongan: ${teksBadan.slice(0, 160).replace(/\s+/g, ' ')}`);
    }
    const data = Array.isArray(j.data) ? j.data : [];
    total = Number(j.recordsFiltered ?? j.recordsTotal ?? 0) || total;
    rows.push(...mapStokEji(data, whs[0]));
    if (data.length < perHalaman) break;
    if (total && rows.length >= total) break;
  }
  return { rows, total: total || rows.length, sebagian: Boolean(total && rows.length < total) };
}
