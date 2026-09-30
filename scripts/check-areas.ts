import './env';
import { testConnection, fetchSalesForDate, demandStatusCodes, ALL_STATUS_CODES, ocsUser } from '../src/lib/ocs';
import { areaDariOcs } from '../src/lib/sync';
import { addDays, todayKey } from '../src/lib/dates';

/**
 * Daftar area yang dibuka oleh akun OCS yang sedang dipakai, beserta angka
 * penjualan kemarin untuk tiap area.
 *
 * Cakupan area ditentukan oleh AKUN, bukan oleh parameter: akun ADMIN hanya
 * mengembalikan Pusat walau diminta `area=All`. Karena itu aplikasi TIDAK
 * PERNAH memakai `area=All` — tiap kota selalu diminta dengan namanya sendiri,
 * dan nama-nama itu diambil dari respons stok, bukan dari daftar tebakan.
 *
 * Tidak menulis apa pun ke database.  `npm run check:areas`
 */
const rp = (n: number) => n.toLocaleString('id-ID');

async function main() {
  const conn = await testConnection();
  console.log(`Akun OCS: ${ocsUser()}  (login sebagai ${conn.user}, ${conn.companyDb}, peran ${conn.role})\n`);

  process.stdout.write('Mengambil daftar area dari respons stok… ');
  const areas = await areaDariOcs();
  console.log(`${areas.length} area.\n`);
  if (!areas.length) {
    console.error('Tidak ada area sama sekali. Periksa akun OCS-nya.');
    process.exitCode = 1; return;
  }
  console.log(`  ${areas.join(', ')}\n`);

  const day = addDays(todayKey(), -1);
  const inti = demandStatusCodes({ includeReady: true, includeReturn: true });
  console.log(`Penjualan ${day} per area — 2 panggilan tiap area (semua status, lalu status konsumsi stok)\n`);
  console.log('   area              baris        qty      batal   % batal   Area di baris OCS');
  console.log('   ' + '-'.repeat(80));

  let totQty = 0, totBatal = 0;
  const kosong: string[] = [];
  for (const area of areas) {
    try {
      const semua = await fetchSalesForDate(day, area, ALL_STATUS_CODES, 60_000, 1);
      const konsumsi = await fetchSalesForDate(day, area, inti, 60_000, 1);
      const qtySemua = semua.reduce((a, r) => a + (Number(r.Qty) || 0), 0);
      const qty = konsumsi.reduce((a, r) => a + (Number(r.Qty) || 0), 0);
      const batal = Math.max(0, qtySemua - qty);
      const balik = [...new Set(semua.map((r) => String(r.Area ?? '').trim() || '(kosong)'))].sort();
      totQty += qty; totBatal += batal;
      if (!semua.length) kosong.push(area);
      console.log(
        `   ${area.padEnd(16)} ${String(semua.length).padStart(6)} ${rp(qty).padStart(10)} ${rp(batal).padStart(10)}` +
        `   ${(qty + batal ? `${((batal / (qty + batal)) * 100).toFixed(1)}%` : '—').padStart(7)}   ${balik.join(', ') || '—'}`,
      );
    } catch (err) {
      console.log(`   ${area.padEnd(16)} GAGAL — ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log('   ' + '-'.repeat(80));
  console.log(`   ${'TOTAL'.padEnd(16)} ${''.padStart(6)} ${rp(totQty).padStart(10)} ${rp(totBatal).padStart(10)}` +
    `   ${(totQty + totBatal ? `${((totBatal / (totQty + totBatal)) * 100).toFixed(1)}%` : '—').padStart(7)}`);

  console.log('\nCatatan:');
  console.log('  Kolom paling kanan adalah nilai Area yang DIKEMBALIKAN OCS di barisnya.');
  console.log('  Kalau isinya berbeda dari nama yang diminta, kabari saya — artinya OCS');
  console.log('  memakai ejaan lain dan pemetaannya perlu disesuaikan.');
  if (kosong.length) {
    console.log(`  Tanpa penjualan kemarin: ${kosong.join(', ')} — wajar untuk area kecil,`);
    console.log('  tetap ditarik tiap hari supaya tidak ada yang terlewat.');
  }
  console.log(`\n  Biaya penarikan: ${areas.length} area × 2 panggilan = ${areas.length * 2} panggilan OCS per tanggal.`);
}

main().catch((e) => { console.error('GAGAL:', e.message); process.exitCode = 1; });
