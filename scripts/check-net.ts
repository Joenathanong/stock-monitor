import './env';
import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';

/**
 * Kenapa Node tidak bisa menjangkau web.eji.co.id padahal browser bisa.
 *
 * Browser memakai pengaturan proxy Windows; Node TIDAK. Jadi di jaringan
 * berproxy, Chrome jalan dan `npm run check:eji` timeout — gejalanya terlihat
 * seperti situsnya mati padahal bukan. Skrip ini memisahkan sebabnya satu per
 * satu: DNS, sambungan TCP per alamat (IPv4 vs IPv6), TLS, dan proxy.
 *
 *   npm run check:net
 *
 * HANYA menyambung; tidak mengirim kredensial apa pun.
 */
const HOST = new URL(process.env.EJI_BASE_URL || 'https://web.eji.co.id').hostname;
const PORT = 443;
const BATAS = 6000;

/** Sembunyikan user:password kalau URL proxy memuatnya. */
const samarkan = (v: string) => v.replace(/\/\/[^@/]+@/, '//<kredensial>@');

/**
 * Sambung ke SATU alamat IP yang sudah diketahui.
 *
 * Dulu fungsi ini menerima nama host + `family: 4`. Di Windows kombinasi itu
 * bisa TIMEOUT walaupun jaringannya sehat (terbukti 5 Okt 2026: langkah ini
 * melaporkan TIMEOUT, padahal TLS ke host & port yang sama berhasil 31 ms dan
 * fetch() menjawab HTTP 200). Akibatnya diagnosanya MENYESATKAN — menuduh
 * proxy/antivirus padahal tidak ada. Jadi sekarang menyambung ke IP hasil DNS
 * langsung, tanpa resolusi nama di dalam net.connect.
 */
function sambungIp(ip: string): Promise<string> {
  return new Promise((selesai) => {
    const t0 = Date.now();
    const s = net.connect({ host: ip, port: PORT });
    let sudah = false;
    const tutup = (hasil: string) => { if (sudah) return; sudah = true; s.destroy(); selesai(hasil); };
    s.setTimeout(BATAS);
    s.on('connect', () => tutup(`TERSAMBUNG (${Date.now() - t0} ms)`));
    s.on('timeout', () => tutup(`TIMEOUT setelah ${BATAS} ms`));
    s.on('error', (e: NodeJS.ErrnoException) => tutup(`GAGAL ${e.code ?? e.message}`));
  });
}

function jabatTls(host: string): Promise<string> {
  return new Promise((selesai) => {
    const t0 = Date.now();
    const s = tls.connect({ host, port: PORT, servername: host, timeout: BATAS }, () => {
      const c = s.getPeerCertificate();
      const penerbit = c?.issuer?.O ?? c?.issuer?.CN ?? '(tidak diketahui)';
      s.destroy();
      selesai(`OK (${Date.now() - t0} ms), sertifikat diterbitkan oleh: ${penerbit}`);
    });
    s.on('timeout', () => { s.destroy(); selesai(`TIMEOUT setelah ${BATAS} ms`); });
    s.on('error', (e: NodeJS.ErrnoException) => { s.destroy(); selesai(`GAGAL ${e.code ?? e.message}`); });
  });
}

async function main() {
  console.log(`\nMemeriksa jalur Node → ${HOST}:${PORT}\n`);

  // 1. Proxy. Inilah beda terbesar antara Chrome dan Node.
  const kunciProxy = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy', 'NODE_USE_ENV_PROXY'];
  const adaProxy = kunciProxy.filter((k) => process.env[k]);
  console.log('1. Proxy di environment:');
  if (!adaProxy.length) {
    console.log('   (tidak ada) — kalau jaringan Anda memakai proxy, Node TIDAK akan memakainya sendiri.');
    console.log('   Chrome memakai proxy Windows otomatis; itu sebabnya browser bisa dan Node tidak.');
  } else {
    for (const k of adaProxy) console.log(`   ${k} = ${samarkan(process.env[k]!)}`);
  }

  // 2. DNS — sekaligus memperlihatkan apakah ada AAAA (IPv6) yang bisa menggantung.
  console.log('\n2. DNS:');
  let v4: string[] = []; let v6: string[] = [];
  try { v4 = (await dns.resolve4(HOST)).slice(0, 4); console.log(`   A    (IPv4): ${v4.join(', ') || '(tidak ada)'}`); }
  catch (e) { console.log(`   A    (IPv4): GAGAL ${(e as NodeJS.ErrnoException).code}`); }
  try { v6 = (await dns.resolve6(HOST)).slice(0, 4); console.log(`   AAAA (IPv6): ${v6.join(', ') || '(tidak ada)'}`); }
  catch { console.log('   AAAA (IPv6): tidak ada (normal)'); }

  // 3. TCP per keluarga alamat.
  console.log('\n3. Sambungan TCP ke port 443 (ke alamat IP hasil DNS, bukan nama host):');
  for (const ip of v4) console.log(`   IPv4 ${ip} : ${await sambungIp(ip)}`);
  for (const ip of v6) console.log(`   IPv6 ${ip} : ${await sambungIp(ip)}`);
  if (!v4.length && !v6.length) console.log('   (dilewati — DNS tidak memberi alamat)');

  // 4. TLS.
  console.log('\n4. Jabat tangan TLS:');
  console.log(`   ${await jabatTls(HOST)}`);

  // 5. fetch apa adanya — pembanding dengan yang dipakai klien.
  console.log('\n5. fetch() seperti yang dipakai klien:');
  try {
    const t0 = Date.now();
    const r = await fetch(`https://${HOST}/login`, { redirect: 'manual' });
    console.log(`   HTTP ${r.status} dalam ${Date.now() - t0} ms — fetch BISA menjangkau.`);
  } catch (e) {
    const sebab = (e as { cause?: { code?: string } })?.cause?.code ?? '';
    console.log(`   GAGAL ${sebab || (e instanceof Error ? e.message : String(e))}`);
  }

  console.log('\nCara membaca:');
  console.log('  LANGKAH 5 (fetch) ADALAH HAKIMNYA. Kalau fetch HTTP 2xx/3xx, jalur Node SEHAT —');
  console.log('  abaikan langkah 3 walaupun ia bilang TIMEOUT. Yang dipakai klien adalah fetch,');
  console.log('  bukan socket mentah, dan probe socket bisa salah di Windows.');
  console.log('  TCP TERSAMBUNG tapi fetch gagal        → kemungkinan proxy/penyadap TLS.');
  console.log('  TCP & TLS & fetch SEMUA gagal          → baru ini proxy/antivirus/VPN.');
  console.log('  IPv6 TIMEOUT tapi IPv4 TERSAMBUNG      → Node mencoba IPv6 lebih dulu; jalankan dengan');
  console.log('                                            NODE_OPTIONS=--dns-result-order=ipv4first');
  console.log('  Semua TIMEOUT                          → jaringan/VPN memang tidak mengizinkan dari PC ini.');
  console.log('\nKalau memang ada proxy, cari nilainya di Windows: Settings → Network & Internet → Proxy,');
  console.log('lalu isi di .env (Node 24 menghormatinya bila NODE_USE_ENV_PROXY=1):');
  console.log('  NODE_USE_ENV_PROXY=1');
  console.log('  HTTPS_PROXY=http://<host-proxy>:<port>');
  console.log('  NO_PROXY=localhost,127.0.0.1\n');
}

main().catch((e) => { console.error('GAGAL:', e instanceof Error ? e.message : e); process.exitCode = 1; });
