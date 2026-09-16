import { prisma } from '@/lib/prisma';
import { json, safe } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [stockLog, salesLog, computeLog, stockCount, salesRange, transitCount, masterCount, logs] = await Promise.all([
    prisma.syncLog.findFirst({ where: { kind: 'STOCK' }, orderBy: { startedAt: 'desc' } }),
    prisma.syncLog.findFirst({ where: { kind: 'SALES' }, orderBy: { startedAt: 'desc' } }),
    prisma.syncLog.findFirst({ where: { kind: 'COMPUTE' }, orderBy: { startedAt: 'desc' } }),
    prisma.stockCurrent.count({ where: { category: 'Sku' } }),
    prisma.salesDaily.aggregate({ _min: { salesDate: true }, _max: { salesDate: true }, _count: true }),
    prisma.transitStock.count(),
    prisma.skuMaster.count(),
    prisma.syncLog.findMany({ orderBy: { startedAt: 'desc' }, take: 30 }),
  ]);
  return json(safe({ ok: true, stockLog, salesLog, computeLog, stockCount, salesRange, transitCount, masterCount, logs }));
}
