import './env';
import { syncSales } from '../src/lib/sync';
import { getSettings } from '../src/lib/compute';
import { prisma } from '../src/lib/prisma';

const days = Number(process.argv.find((a) => a.startsWith('--days='))?.split('=')[1] ?? 7);

getSettings()
  .then((s) => syncSales(s, { trigger: 'cli', days }))
  .then((r) => console.log(r))
  .catch((e) => { console.error('GAGAL:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
