import './env';

/**
 * Temukan URL dan nama medan form login web EJI.
 *
 * HANYA GET. Tidak mengirim username, password, atau cookie apa pun — jadi aman
 * dijalankan kapan saja, dan hasilnya memang halaman login (bukan halaman yang
 * sudah login), karena permintaan ini tidak membawa sesi.
 *
 *   npm run check:eji-login
 *
 * Keluarannya langsung bisa ditempel ke .env:
 *   EJI_LOGIN_URL=...   EJI_FIELD_USER=...   EJI_FIELD_PASS=...
 *
 * Kenapa perlu: struktur form login TIDAK bisa dibaca dari browser yang sudah
 * login — web EJI menjawab 200 dengan badan kosong untuk permintaan yang tidak
 * terautentikasi, termasuk halaman /login-nya sendiri saat sesi aktif.
 */
const BASIS = process.env.EJI_BASE_URL || 'https://web.eji.co.id';
const KANDIDAT = ['/login', '/login/index', '/login/auth', '/auth/login', '/signin', '/'];

type Form = { action: string | null; method: string; medan: { name: string; type: string }[] };

function bacaForm(html: string): Form[] {
  const out: Form[] = [];
  for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const atr = m[1];
    const isi = m[2];
    const medan: { name: string; type: string }[] = [];
    for (const i of isi.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)) {
      const a = i[2];
      const name = (a.match(/\bname\s*=\s*["']([^"']+)["']/i) || [])[1];
      const type = (a.match(/\btype\s*=\s*["']([^"']+)["']/i) || [])[1] || i[1].toLowerCase();
      if (name) medan.push({ name, type });
    }
    out.push({
      action: (atr.match(/\baction\s*=\s*["']([^"']*)["']/i) || [])[1] ?? null,
      method: ((atr.match(/\bmethod\s*=\s*["']([^"']*)["']/i) || [])[1] || 'get').toLowerCase(),
      medan,
    });
  }
  return out;
}

/** Form yang punya medan password ADALAH form login — itu penandanya. */
const formLogin = (f: Form[]) => f.find((x) => x.medan.some((m) => m.type.toLowerCase() === 'password'));

async function main() {
  console.log('\nMencari form login (hanya GET, tanpa kredensial & tanpa cookie)…');
  let ketemu: { url: string; form: Form } | null = null;

  for (const path of KANDIDAT) {
    const url = BASIS + path;
    let r: Response;
    let html = '';
    try {
      r = await fetch(url, { redirect: 'follow' });
      html = await r.text();
    } catch (e) {
      console.log(`  ${path.padEnd(14)} GAGAL dihubungi: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    const forms = bacaForm(html);
    const login = formLogin(forms);
    const judul = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim() ?? '';
    console.log(
      `  ${path.padEnd(14)} HTTP ${r.status} · ${html.length} byte · ${forms.length} form`
      + `${login ? ' · ADA medan password' : ''}${judul ? ` · "${judul.slice(0, 40)}"` : ''}`,
    );
    if (login && !ketemu) ketemu = { url: r.url || url, form: login };
  }

  if (!ketemu) {
    console.log('\nTidak ada form dengan medan password di URL yang dicoba.');
    console.log('Kalau halaman login web EJI dirender JavaScript, strukturnya tidak ada di HTML awal.');
    console.log('Jalan lain: di Chrome buka DevTools → Network → lakukan login manual → lihat permintaan');
    console.log('POST yang terjadi, lalu isi EJI_LOGIN_URL / EJI_FIELD_USER / EJI_FIELD_PASS dari situ.');
    return;
  }

  const { url, form } = ketemu;
  const act = form.action;
  const tujuan = !act ? url
    : act.startsWith('http') ? act
      : act.startsWith('/') ? BASIS + act
        : `${url.replace(/\/[^/]*$/, '')}/${act}`;
  const user = form.medan.find((m) => /user|email|nip|login|nama/i.test(m.name) && m.type !== 'password');
  const pass = form.medan.find((m) => m.type.toLowerCase() === 'password');
  const lain = form.medan.filter((m) => m !== user && m !== pass);

  console.log(`\nForm login ketemu di ${url}`);
  console.log(`  method : ${form.method.toUpperCase()}`);
  console.log(`  action : ${act ?? '(kosong → dikirim ke URL yang sama)'}`);
  console.log(`  medan  : ${form.medan.map((m) => `${m.name} (${m.type})`).join(', ')}`);

  console.log('\nTempel ini ke .env:');
  console.log(`  EJI_LOGIN_URL=${tujuan}`);
  if (user) console.log(`  EJI_FIELD_USER=${user.name}`);
  if (pass) console.log(`  EJI_FIELD_PASS=${pass.name}`);
  console.log('  EJI_USERNAME=<email akun Anda>');
  console.log('  EJI_PASSWORD=<password akun Anda>');
  console.log('  # dan KOSONGKAN EJI_COOKIE supaya alur login yang dipakai');

  if (!user) {
    console.log('\nPERHATIAN: medan username tidak terdeteksi otomatis — pilih sendiri dari daftar medan di atas.');
  }
  if (lain.length) {
    console.log(`\nForm ini juga punya medan lain: ${lain.map((m) => m.name).join(', ')}.`);
    console.log('Kalau salah satunya token (csrf/_token), login dari skrip butuh langkah tambahan:');
    console.log('GET halaman login dulu untuk mengambil token + cookie, baru POST. Kabari kalau ini muncul.');
  }
  console.log('');
}

main().catch((e) => { console.error('GAGAL:', e instanceof Error ? e.message : e); process.exitCode = 1; });
