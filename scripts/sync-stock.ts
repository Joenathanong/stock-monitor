import './env';
import { syncStock } from '../src/lib/sync';
import { getSettings } from '../src/lib/compute';
import { prisma } from '../src/lib/prisma';

getSettings()
  .then((s) => syncStock('cli', s.areaScope))
  .then((r) => console.log(r))
  .catch((e) => { console.error('GAGAL:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
