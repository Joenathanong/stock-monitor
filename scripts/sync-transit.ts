import './env';
import { syncTransit } from '../src/lib/sync';
import { prisma } from '../src/lib/prisma';

/**
 * Tarik barang dalam perjalanan dari OCS. `--force` mengabaikan jendela kesegaran.
 *   npm run sync:transit
 *   npm run sync:transit -- --force
 */
const force = process.argv.includes('--force');

syncTransit(15 * 60_000, 3, force)
  .then(async (r) => {
    console.log(r.skipped ? r.message
      : `${r.rows} baris dari ${r.docs} dokumen`
        + `${r.docsCache ? ` — ${r.docsCache} dari cache, ${r.docsBaru} ditarik` : ''}`
        + ` (${Math.round((r.durationMs ?? 0) / 1000)} dtk)`
        + `${r.partial ? `\n  SEBAGIAN: ${r.docsKurang} dokumen belum terbaca` : ''}`);
    if (r.areas) {
      console.log('\nPer gudang (qty = DoQty, yang dipakai DOI):');
      console.table(Object.entries(r.areas).map(([area, qty]) => ({ area, qty })));
      console.log(`  total DoQty ${r.totalDoQty?.toLocaleString('id-ID')} · BatchQuantity ${r.totalBatchQty?.toLocaleString('id-ID')}`);
    }
    // Area yang dokumennya ADA tapi tidak menghasilkan satu baris transit pun.
    // Inilah keadaan yang paling membingungkan di layar ("kok SIT-nya nol?"),
    // jadi disebut lebih dulu dan dengan namanya.
    const takCocok = r.takCocokRinci ?? [];
    if (takCocok.length) {
      const perArea = new Map<string, { qty: number; kode: string[] }>();
      for (const t of takCocok) {
        const a = perArea.get(t.areaId) ?? { qty: 0, kode: [] };
        a.qty += t.qty;
        if (a.kode.length < 6) a.kode.push(`${t.sapCode} (${t.qty})`);
        perArea.set(t.areaId, a);
      }
      console.log(`\n${r.takCocok} kode SAP TIDAK ketemu SKU-nya — qty-nya TIDAK masuk DOI.`);
      console.log('Penyebab biasanya: kodenya belum ada di stock_current area itu,');
      console.log('atau 6 digit terakhirnya tidak cocok dengan SKU mana pun.\n');
      for (const [area, v] of [...perArea.entries()].sort((a, b) => b[1].qty - a[1].qty)) {
        const nolTransit = !(r.areas && r.areas[area]);
        console.log(
          `  ${area.padEnd(12)} ${String(v.qty).padStart(8)} pcs terbuang`
          + `${nolTransit ? '   <-- area ini TIDAK punya transit sama sekali' : ''}`,
        );
        console.log(`    kode: ${v.kode.join(', ')}`);
      }
    }
    if (r.kodeAsing?.length) {
      console.log('\nKode gudang BELUM terdaftar di Pengaturan -> Cabang / Area:');
      for (const k of r.kodeAsing) console.log(`  ${k.kode} — ${k.baris} baris, ${k.qty} pcs (tidak masuk area mana pun)`);
    }
    if (r.message && !r.skipped) console.log(`\n  ${r.message}`);
  })
  .catch((e) => { console.error('GAGAL:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
