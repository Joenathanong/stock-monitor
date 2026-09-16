import './env';
import { testConnection, fetchStock, fetchSalesForDate, demandStatusCodes, OCS_STATUS } from '../src/lib/ocs';
import { addDays, todayKey } from '../src/lib/dates';

/**
 * Uji koneksi ke OCS tanpa menulis apa pun ke database.
 * Jalankan dari komputer yang bisa menjangkau ocs.iegsystem.id.
 */
async function main() {
  console.log('1) Login…');
  console.log('  ', await testConnection());

  console.log('2) Stok…');
  const stock = await fetchStock();
  const pusatSku = stock.filter((r) => r.AreaId === 'Pusat' && r.Category === 'Sku');
  console.log('   baris seluruh area:', stock.length, '| Pusat & Category=Sku:', pusatSku.length);
  console.log('   contoh:', pusatSku[0]);

  const day = addDays(todayKey(), -1);
  const codes = demandStatusCodes({ includeReady: true, includeReturn: true });
  console.log(`3) Penjualan ${day} area Pusat, ${codes.length} status…`);
  const sales = await fetchSalesForDate(day, 'Pusat', codes);
  console.log('   baris:', sales.length, '| total qty:', sales.reduce((a, r) => a + (r.Qty || 0), 0));
  const onlyPC = await fetchSalesForDate(day, 'Pusat', [OCS_STATUS.PROCESSED, OCS_STATUS.COMPLETED]);
  console.log('   pembanding PROCESSED+COMPLETED saja:', onlyPC.reduce((a, r) => a + (r.Qty || 0), 0), '(pasti jauh lebih kecil — inilah sebabnya semua status dari PROCESSED ke atas ditarik)');
}

main().catch((e) => { console.error('GAGAL:', e.message); process.exitCode = 1; });
