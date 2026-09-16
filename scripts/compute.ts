import './env';
import { runCompute } from '../src/lib/compute';
import { prisma } from '../src/lib/prisma';

/** Hitung DOI dari CLI. `--no-stock` = tanpa tarik stok dari OCS. */
runCompute('cli', !process.argv.includes('--no-stock'))
  .then((r) => console.log(r))
  .catch((e) => { console.error('GAGAL:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
