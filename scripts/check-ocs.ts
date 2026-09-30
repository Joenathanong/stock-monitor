import './env';
import { testConnection, fetchStock, fetchSalesForDate, demandStatusCodes, ALL_STATUS_CODES, ocsUser } from '../src/lib/ocs';
import { mapSalesRows, gabungSales, areaDariOcs } from '../src/lib/sync';
import { addDays, todayKey } from '../src/lib/dates';

/**
 * Uji koneksi ke OCS tanpa menulis apa pun ke database.
 * Jalankan dari komputer yang bisa menjangkau ocs.iegsystem.id: `npm run check:ocs`.
 *
 * Yang dibuktikan di sini persis tiga hal yang diubah 25 Sep 2026:
 *   1. `area=All` memang mengembalikan seluruh area, dan kolom Area membedakannya.
 *   2. Menarik SELURUH status berhasil (bukan cuma 25 status seperti dulu).
 *   3. Selisih semua-status − status-konsumsi-stok = qty order batal, per area.
 */
const rp = (n: number) => n.toLocaleString('id-ID');

async function main() {
  console.log('1) Login…');
  console.log('  ', await testConnection());
  console.log('   akun:', ocsUser(), '— akun ini yang menentukan area mana yang terlihat');

  console.log('\n2) Stok — seluruh area…');
  const stock = await fetchStock();
  const perArea = new Map<string, { sku: number; qty: number }>();
  for (const r of stock) {
    if (r.Category !== 'Sku') continue;
    const k = String(r.AreaId ?? '').trim() || 'Pusat';
    const a = perArea.get(k) ?? { sku: 0, qty: 0 };
    a.sku += 1; a.qty += Number(r.AvailableQty) || 0;
    perArea.set(k, a);
  }
  console.log('   baris mentah:', rp(stock.length));
  console.table([...perArea.entries()].map(([areaId, v]) => ({ areaId, SKU: v.sku, stok: v.qty })));

  const day = addDays(todayKey(), -1);
  const inti = demandStatusCodes({ includeReady: true, includeReturn: true });

  // area=All TIDAK dipakai — tiap kota diminta dengan namanya sendiri.
  const areas = await areaDariOcs();
  console.log(`\n3) Penjualan ${day} — ${areas.length} kota × 2 panggilan (${ALL_STATUS_CODES.length} status, lalu ${inti.length} status)…`);
  const semua = [], konsumsi = [];
  for (const area of areas) {
    semua.push(...await fetchSalesForDate(day, area, ALL_STATUS_CODES, 60_000, 2));
    konsumsi.push(...await fetchSalesForDate(day, area, inti, 60_000, 2));
  }
  console.log(`   seluruh status  — baris: ${rp(semua.length)} | qty: ${rp(semua.reduce((a, r) => a + (r.Qty || 0), 0))}`);
  console.log(`   konsumsi stok   — baris: ${rp(konsumsi.length)} | qty: ${rp(konsumsi.reduce((a, r) => a + (r.Qty || 0), 0))}`);

  console.log('\n4) (dilewati — pembanding sudah jadi satu dengan langkah 3)');

  console.log('\n5) Hasil gabungan seperti yang akan disimpan (qty = konsumsi stok, batal = selisih):');
  const rows = gabungSales(mapSalesRows(semua, day), mapSalesRows(konsumsi, day));
  const ringkas = new Map<string, { sku: number; qty: number; batal: number }>();
  for (const r of rows) {
    const a = ringkas.get(r.areaId) ?? { sku: 0, qty: 0, batal: 0 };
    a.sku += 1; a.qty += r.qty; a.batal += r.qtyCancel ?? 0;
    ringkas.set(r.areaId, a);
  }
  console.table([...ringkas.entries()].map(([areaId, v]) => ({
    areaId, SKU: v.sku, qty: v.qty, batal: v.batal,
    '% batal': v.qty + v.batal ? `${((v.batal / (v.qty + v.batal)) * 100).toFixed(1)}%` : '—',
  })));

  const dapat = [...ringkas.keys()];
  const kosong = areas.filter((a) => !dapat.includes(a));
  console.log(`\n   ${dapat.length} dari ${areas.length} kota ada penjualannya: ${dapat.join(', ')}`);
  if (kosong.length) console.log(`   Tanpa penjualan kemarin: ${kosong.join(', ')} — tetap ditarik tiap hari.`);
}

main().catch((e) => { console.error('GAGAL:', e.message); process.exitCode = 1; });
