import test from 'node:test';
import assert from 'node:assert/strict';
import { angkaEji, mapStokEji, paramStok, KOLOM_EJI, whsPemasok, prioritasWhs, bacaCookieEnv, bacaFormLogin, type BarisStokEji, galatSambung } from './eji';

const baris = (o: Partial<BarisStokEji> = {}): BarisStokEji => ({
  NO: 1, KODE: '1201010110', NAMA: 'Hanasui Whitening Gold Serum Renew 20ml X 100',
  WHS: 'GBJD', OH: 1200, COM: 200, OP: 100, ODR: 0, BALNOSQ: 1000, BAL: 900, ...o,
});

test('kolom dibaca sesuai nama medan API, BAL jadi saldo Sugest PO', () => {
  const [r] = mapStokEji([baris()]);
  assert.equal(r.sapCode, '1201010110');
  assert.equal(r.onHand, 1200);
  assert.equal(r.committed, 200);
  assert.equal(r.sqOpen, 100);
  assert.equal(r.balNoSq, 1000);
  assert.equal(r.bal, 900, 'BAL = Balance (With SQ) — yang dipakai Sugest PO');
  assert.equal(r.supplierWhs, 'GBJD');
});

test('isi karton dibaca dari nama produk, aturan sama dengan dokumen receive', () => {
  assert.equal(mapStokEji([baris()])[0].perCtn, 100);
  assert.equal(mapStokEji([baris({ NAMA: 'Hanasui Power Bright Expert Serum 20ml X 48 - Mp' })])[0].perCtn, 48);
  assert.equal(mapStokEji([baris({ NAMA: 'Produk Tanpa Isi Karton' })])[0].perCtn, 0);
});

test('angka: titik ribuan ala Indonesia tidak jadi NaN', () => {
  assert.equal(angkaEji('1.234'), 1234);
  assert.equal(angkaEji('1,234'), 1234);
  assert.equal(angkaEji('12.345.678'), 12345678);
  assert.equal(angkaEji(900), 900);
});

test('angka: negatif dalam tanda kurung dan dengan minus', () => {
  assert.equal(angkaEji('(50)'), -50);
  assert.equal(angkaEji('-50'), -50);
  assert.equal(angkaEji('(1.200)'), -1200);
});

test('angka: kosong & sampah jadi 0, bukan NaN', () => {
  for (const v of ['', ' ', null, undefined, 'abc', NaN, Infinity]) {
    assert.equal(angkaEji(v), 0, `nilai ${String(v)} harus jadi 0`);
  }
});

test('sel ber-HTML dibersihkan — DataTables sering mengirim markup', () => {
  const [r] = mapStokEji([baris({ KODE: '<b>1201010110</b>', NAMA: '<span>Serum 20ml X 48</span>' })]);
  assert.equal(r.sapCode, '1201010110');
  assert.equal(r.name, 'Serum 20ml X 48');
  assert.equal(r.perCtn, 48);
});

test('baris tanpa KODE dilewati, bukan disimpan sebagai kode kosong', () => {
  assert.equal(mapStokEji([baris({ KODE: '' }), baris({ KODE: null })]).length, 0);
});

test('WHS kosong jatuh ke gudang yang diminta, bukan string kosong', () => {
  assert.equal(mapStokEji([baris({ WHS: '' })], 'GBJD')[0].supplierWhs, 'GBJD');
});

test('parameter DataTables: filter BERSARANG di bawah filter[...]', () => {
  const p = paramStok({ whs: ['GBJD2', 'GBJD'] });
  // Diverifikasi langsung di web EJI 5 Okt 2026 (lihat komentar di paramStok).
  assert.deepEqual(p.getAll('filter[whs][]'), ['GBJD2', 'GBJD']);
  assert.equal(p.get('filter[nol]'), 'false', 'stok kosong tidak diambil secara bawaan');
  assert.equal(p.get('start'), '0');
});

test('nama parameter lama (tingkat atas) TIDAK boleh dipakai lagi', () => {
  // Kalau ini muncul kembali, web EJI menjawab 200 dengan SELURUH database
  // (618.796 baris, semua gudang) alih-alih menolak — kegagalan yang senyap.
  const p = paramStok({ whs: ['GBJD'] });
  assert.equal(p.getAll('whs[]').length, 0, 'whs[] tingkat atas diabaikan web EJI');
  assert.equal(p.get('nol'), null, 'nol tingkat atas diabaikan web EJI');
});

test('tampilkanNol memakai true/false, bukan 1/0', () => {
  assert.equal(paramStok({ whs: ['GBJD'], tampilkanNol: true }).get('filter[nol]'), 'true');
});

test('parameter kolom urut persis seperti di halaman', () => {
  const p = paramStok({ whs: ['GBJD'] });
  KOLOM_EJI.forEach((nama, i) => assert.equal(p.get(`columns[${i}][data]`), nama));
  assert.equal(p.get('columns[9][data]'), 'BAL', 'BAL kolom terakhir');
});

test('gudang pemasok: bawaan GBJD2 dulu lalu GBJD, dan urutannya PRIORITAS', () => {
  const asli = process.env.EJI_WHS;
  try {
    delete process.env.EJI_WHS;
    // Keputusan user 2 Okt 2026: GBJD2 diperiksa lebih dulu.
    assert.deepEqual(whsPemasok(), ['GBJD2', 'GBJD']);
    assert.equal(prioritasWhs('GBJD2'), 0);
    assert.equal(prioritasWhs('GBJD'), 1);

    process.env.EJI_WHS = 'gbjd, GBJD2 ,';
    assert.deepEqual(whsPemasok(), ['GBJD', 'GBJD2'], 'urutan di env dipertahankan apa adanya');
    assert.equal(prioritasWhs('GBJD'), 0, 'urutan env yang menentukan, bukan nama');

    process.env.EJI_WHS = 'GBJD2,GBJD,GBJD2';
    assert.deepEqual(whsPemasok(), ['GBJD2', 'GBJD'], 'duplikat dibuang, kemunculan pertama menang');
  } finally {
    if (asli === undefined) delete process.env.EJI_WHS; else process.env.EJI_WHS = asli;
  }
});

test('pengaturan po_whs_order MENIMPA env — bisa diubah tanpa deploy', () => {
  // Permintaan user 8 Okt 2026: urutan gudang akan dibalik lagi nanti, jadi
  // harus bisa diubah dari halaman Pengaturan, bukan cuma dari env.
  const asli = process.env.EJI_WHS;
  try {
    process.env.EJI_WHS = 'GBJD2,GBJD';
    assert.deepEqual(whsPemasok('GBJD,GBJD2'), ['GBJD', 'GBJD2'], 'pengaturan menang');
    assert.deepEqual(whsPemasok(['gbjd', 'gbjd2']), ['GBJD', 'GBJD2'], 'array juga diterima');
    assert.deepEqual(whsPemasok('  '), ['GBJD2', 'GBJD'], 'pengaturan kosong → jatuh ke env');
    assert.deepEqual(whsPemasok(null), ['GBJD2', 'GBJD'], 'null → jatuh ke env');
    assert.equal(prioritasWhs('GBJD', whsPemasok('GBJD,GBJD2')), 0);
  } finally {
    if (asli === undefined) delete process.env.EJI_WHS; else process.env.EJI_WHS = asli;
  }
});

test('gudang di luar daftar ditaruh paling akhir, bukan dianggap prioritas 0', () => {
  assert.equal(prioritasWhs('GXXX', ['GBJD2', 'GBJD']), 99);
});

test('EJI_COOKIE tanpa nama DITOLAK — gejalanya sama dengan kredensial salah', () => {
  // Kesalahan nyata 2 Okt 2026: hanya kolom Value dari DevTools yang ditempel.
  assert.throws(() => bacaCookieEnv('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a'), /nama=nilai/);
});

test('EJI_COOKIE yang benar diterima, dan NAMANYA bisa ditampilkan tanpa nilainya', () => {
  const r = bacaCookieEnv('ci_session=abc123');
  assert.equal(r.cookie, 'ci_session=abc123');
  assert.deepEqual(r.nama, ['ci_session']);
});

test('EJI_COOKIE: kutip pembungkus, prefiks "Cookie:", dan beberapa pasangan dirapikan', () => {
  assert.equal(bacaCookieEnv('"ci_session=abc"').cookie, 'ci_session=abc');
  assert.equal(bacaCookieEnv("  Cookie: ci_session=abc  ").cookie, 'ci_session=abc');
  assert.deepEqual(bacaCookieEnv('ci_session=abc; csrf=xyz').nama, ['ci_session', 'csrf']);
});

test('EJI_COOKIE dengan ganti baris ditolak — penyebab yang sulit dilihat di .env', () => {
  assert.throws(() => bacaCookieEnv('ci_session=abc\nlanjut=1'), /ganti baris/);
});

test('EJI_COOKIE kosong bukan galat — berarti pakai username/password', () => {
  assert.deepEqual(bacaCookieEnv(''), { cookie: '', nama: [] });
  assert.deepEqual(bacaCookieEnv(undefined), { cookie: '', nama: [] });
});

const htmlLogin = (o: { action?: string; userName?: string; token?: boolean } = {}) => `
<html><body>
  <form method="post"${o.action === undefined ? '' : ` action="${o.action}"`}>
    ${o.token ? '<input type="hidden" name="csrf_token" value="abc123">' : ''}
    <input type="hidden" name="redirect" value="/dashboard">
    <input type="text" name="${o.userName ?? 'username'}" placeholder="Email">
    <input type="password" name="password">
    <button type="submit">Masuk</button>
  </form>
</body></html>`;

test('form login dikenali dari medan password-nya, bukan dari nama form', () => {
  const f = bacaFormLogin(htmlLogin(), 'https://web.eji.co.id/login')!;
  assert.equal(f.user, 'username');
  assert.equal(f.pass, 'password');
  assert.equal(f.method, 'post');
});

test('action kosong → POST ke URL halaman itu sendiri', () => {
  assert.equal(bacaFormLogin(htmlLogin(), 'https://web.eji.co.id/login')!.action, 'https://web.eji.co.id/login');
});

test('action relatif & absolut diselesaikan jadi URL penuh', () => {
  assert.equal(bacaFormLogin(htmlLogin({ action: '/login/proses' }), 'https://web.eji.co.id/login')!.action,
    'https://web.eji.co.id/login/proses');
  assert.equal(bacaFormLogin(htmlLogin({ action: 'https://web.eji.co.id/auth' }), 'https://web.eji.co.id/login')!.action,
    'https://web.eji.co.id/auth');
});

test('medan hidden dibawa apa adanya — token CSRF sering wajib', () => {
  const f = bacaFormLogin(htmlLogin({ token: true }), 'https://web.eji.co.id/login')!;
  assert.equal(f.hidden.csrf_token, 'abc123');
  assert.equal(f.hidden.redirect, '/dashboard');
});

test('TOMBOL bernama ikut dikirim — banyak app PHP memeriksa isset($_POST[tombol])', () => {
  // Kelalaian nyata 5 Okt 2026: <button> tidak terbaca sama sekali, jadi
  // cmdLogin tidak terkirim dan form hanya ditampilkan ulang tanpa pesan galat.
  const html = `<form method="post">
    <input type="text" name="txtUsername"><input type="password" name="txtPassword">
    <button type="submit" name="cmdLogin">Masuk</button></form>`;
  const f = bacaFormLogin(html, 'https://x/login')!;
  assert.equal(f.hidden.cmdLogin, 'cmdLogin', 'tombol tanpa value dikirim dengan namanya sendiri');
  assert.ok(f.semuaMedan.includes('cmdLogin(submit)'));
});

test('<button> tanpa type dianggap submit — itu aturan HTML', () => {
  const html = '<form><input type="password" name="p"><input name="u"><button name="go">Go</button></form>';
  assert.equal(bacaFormLogin(html, 'https://x/')!.hidden.go, 'go');
});

test('input submit bernama dengan value memakai value-nya', () => {
  const html = '<form><input name="u"><input type="password" name="p"><input type="submit" name="act" value="login"></form>';
  assert.equal(bacaFormLogin(html, 'https://x/')!.hidden.act, 'login');
});

test('medan user & pass tidak ikut masuk ke daftar medan tambahan', () => {
  const f = bacaFormLogin(htmlLogin(), 'https://x/login')!;
  assert.equal(f.hidden[f.user], undefined);
  assert.equal(f.hidden[f.pass], undefined);
});

test('nama medan username tidak harus "username"', () => {
  assert.equal(bacaFormLogin(htmlLogin({ userName: 'email_karyawan' }), 'https://x/login')!.user, 'email_karyawan');
});

test('halaman tanpa medan password → bukan form login', () => {
  assert.equal(bacaFormLogin('<form><input name="q" type="search"></form>', 'https://x/'), null);
  assert.equal(bacaFormLogin('', 'https://x/'), null);
});

test('form pencarian dilewati, form login yang diambil', () => {
  const html = '<form action="/cari"><input name="q" type="search"></form>' + htmlLogin({ action: '/login/proses' });
  assert.equal(bacaFormLogin(html, 'https://x/login')!.action, 'https://x/login/proses');
});

test('galatSambung: HANYA kegagalan menyambung, bukan respons HTTP yang salah', () => {
  // Bentuk asli galat undici yang mematikan check:eji 5 Okt 2026.
  const undici = Object.assign(new Error('fetch failed'), {
    cause: { code: 'UND_ERR_CONNECT_TIMEOUT', name: 'ConnectTimeoutError' },
  });
  assert.equal(galatSambung(undici), true);
  assert.equal(galatSambung(Object.assign(new Error('x'), { cause: { code: 'ECONNRESET' } })), true);
  assert.equal(galatSambung(Object.assign(new Error('dns'), { cause: { code: 'EAI_AGAIN' } })), true);

  // Yang TIDAK boleh diulang — mengulang tidak mengubah hasilnya:
  assert.equal(galatSambung(new Error('Stok EJI HTTP 401')), false);
  assert.equal(galatSambung(Object.assign(new Error('batal'), { name: 'AbortError' })), false,
    'abort dari timeoutMs kita sendiri sudah menunggu lama — jangan diulang');
  assert.equal(galatSambung(undefined), false);
  assert.equal(galatSambung('CONNECT_TIMEOUT'), false, 'string bukan galat');
});
