import './env';
import { tarikStokEji, whsPemasok, bacaCookieEnv, masukEjiRinci } from '../src/lib/eji';

/**
 * Uji sambungan ke stok gudang pemasok EJI. HANYA MEMBACA — tidak menulis ke
 * database. Jalankan ini lebih dulu sebelum `sync:supplier`.
 *
 *   npm run check:eji
 *
 * Nilai cookie dan password TIDAK pernah dicetak — hanya nama dan panjangnya.
 */
const n = (x: number) => x.toLocaleString('id-ID');

/** Galat jaringan dibedakan dari galat autentikasi: tindakannya beda jauh. */
function jelaskanGalat(e: unknown): string[] {
  const pesan = e instanceof Error ? e.message : String(e);
  const sebab = (e as { cause?: { code?: string; message?: string } })?.cause;
  const kode = sebab?.code ?? '';
  if (/UND_ERR_CONNECT_TIMEOUT|ETIMEDOUT/.test(kode) || /Connect Timeout/i.test(sebab?.message ?? '')) {
    return [
      'web.eji.co.id tidak menjawab (timeout saat menyambung) — ini masalah JARINGAN, bukan login.',
      'Periksa: koneksi internet, VPN kantor (web EJI mungkin hanya bisa dari jaringan internal),',
      'atau situsnya sedang mati. Uji cepat: buka https://web.eji.co.id di browser di PC yang sama.',
    ];
  }
  if (/ENOTFOUND|EAI_AGAIN/.test(kode)) {
    return ['Nama web.eji.co.id tidak bisa diterjemahkan (DNS gagal) — periksa koneksi atau VPN.'];
  }
  if (/ECONNREFUSED/.test(kode)) {
    return ['Sambungan ditolak server — port 443 tertutup dari jaringan ini.'];
  }
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(kode)) {
    return ['Sertifikat TLS tidak bisa diverifikasi — kemungkinan ada proxy/firewall yang menyadap HTTPS.'];
  }
  return [pesan];
}

async function main() {
  // Bentuk EJI_COOKIE diperiksa lebih dulu supaya salah tempel ketahuan di sini.
  bacaCookieEnv(process.env.EJI_COOKIE);

  const l = await masukEjiRinci();
  console.log('\nLangkah login:');
  for (const x of l.langkah) console.log(`  · ${x}`);
  if (!l.berhasil) {
    console.log('\nLogin BELUM berhasil. Langkah berikutnya:');
    for (const x of l.saran) console.log(`  - ${x}`);
    console.log('');
    process.exitCode = 1;
    return;
  }

  const r = await tarikStokEji({ cookie: l.cookie });
  console.log(`\nGudang: ${whsPemasok().join(', ')} (urut prioritas)`);
  console.log(`${n(r.rows.length)} baris terbaca dari ${n(r.total)} yang dilaporkan API${r.sebagian ? ' — SEBAGIAN' : ''}.\n`);

  const adaSaldo = r.rows.filter((x) => x.bal > 0);
  const tanpaKarton = r.rows.filter((x) => x.perCtn <= 0);
  console.log(`  bersaldo (BAL > 0) : ${n(adaSaldo.length)} kode`);
  console.log(`  isi karton terbaca : ${n(r.rows.length - tanpaKarton.length)} dari ${n(r.rows.length)}`);

  // Per gudang — kalau GBJD2 nol padahal diminta lebih dulu, itu harus kelihatan.
  const perWhs = new Map<string, { baris: number; qty: number }>();
  for (const x of r.rows) {
    const e = perWhs.get(x.supplierWhs) ?? { baris: 0, qty: 0 };
    e.baris += 1; e.qty += x.bal;
    perWhs.set(x.supplierWhs, e);
  }
  console.log('\nPer gudang:');
  for (const w of whsPemasok()) {
    const e = perWhs.get(w);
    console.log(`  ${w.padEnd(8)} ${e ? `${n(e.baris)} kode, total BAL ${n(e.qty)}` : 'TIDAK ADA barisnya'}`);
  }

  console.log('\n10 saldo terbesar:');
  console.log('gudang   kode          BAL        BALNOSQ    ON HAND    isi ctn  nama');
  for (const x of [...adaSaldo].sort((a, b) => b.bal - a.bal).slice(0, 10)) {
    console.log(
      x.supplierWhs.padEnd(8),
      x.sapCode.padEnd(13),
      n(x.bal).padStart(9),
      n(x.balNoSq).padStart(10),
      n(x.onHand).padStart(10),
      String(x.perCtn || '-').padStart(8),
      ' ' + x.name.slice(0, 44),
    );
  }

  if (tanpaKarton.length) {
    console.log(`\n${n(tanpaKarton.length)} kode isi kartonnya tidak terbaca dari nama — isi manual di mapping SKU,`);
    console.log('kalau tidak, barisnya dikirim dalam pcs dan ditandai TANPA_ISI_KARTON:');
    for (const x of tanpaKarton.slice(0, 5)) console.log(`  ${x.sapCode}  ${x.name.slice(0, 60)}`);
  }
  console.log('');
}

// SATU penangkap untuk seluruh alur. Versi sebelumnya memasang .catch di rantai
// dalam saja, jadi kegagalan di langkah login lolos sebagai unhandled rejection
// dan muncul sebagai stack trace Node, bukan pesan yang bisa dibaca.
main().catch((e) => {
  console.error('\nGAGAL:');
  for (const baris of jelaskanGalat(e)) console.error(`  ${baris}`);
  console.error('');
  process.exitCode = 1;
});
