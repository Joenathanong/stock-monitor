import './env';
import { prisma } from '../src/lib/prisma';
import { pullSalesDay } from '../src/lib/sync';
import { getSettings } from '../src/lib/compute';
import { addDays, todayKey, type DateKey } from '../src/lib/dates';

/**
 * Backfill histori penjualan, satu hari per permintaan (OCS menjawab 504 untuk
 * rentang panjang). Dijalankan dari komputer, bukan dari Vercel — sejak Januari
 * berarti ±250 hari × ~2 detik ≈ 10 menit.
 *
 *   npm run backfill:sales -- --from=2026-01-01 --to=2026-09-14
 *   npm run backfill:sales -- --days=90
 *   npm run backfill:sales -- --from=2026-01-01 --to=2026-09-14 --skip-existing
 */
function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
}

async function main() {
  const settings = await getSettings();
  const skipExisting = process.argv.includes('--skip-existing');
  let from: DateKey, to: DateKey;
  if (arg('from') && arg('to')) { from = arg('from')!; to = arg('to')!; }
  else {
    const days = Number(arg('days') ?? 90);
    to = addDays(todayKey(), -1);
    from = addDays(to, -(days - 1));
  }
  console.log(`Backfill ${from} s/d ${to}, area=${settings.areaScope}${skipExisting ? ', melewati tanggal yang sudah ada' : ''}`);

  let done = 0, rows = 0; const failed: DateKey[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    if (skipExisting) {
      const existing = await prisma.salesDaily.count({ where: { salesDate: new Date(`${day}T00:00:00Z`) } });
      if (existing > 0) { console.log(`  ${day}: sudah ada ${existing} baris, dilewati`); done++; continue; }
    }
    try {
      const written = await pullSalesDay(day, settings);
      rows += written; done++;
      console.log(`  ${day}: ${written} baris`);
    } catch (err) {
      failed.push(day);
      console.warn(`  ${day}: GAGAL — ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`\nSelesai: ${done} hari, ${rows} baris.`);
  if (failed.length) {
    console.log(`Gagal pada ${failed.length} tanggal: ${failed.join(', ')}`);
    console.log('Jalankan ulang dengan --skip-existing untuk mencoba lagi hanya yang gagal.');
  }
}

main().catch((e) => { console.error('GAGAL:', e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
