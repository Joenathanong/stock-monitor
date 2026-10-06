import './env';
import { fetchReceiveDocs, fetchReceiveLines } from '../src/lib/ocs';
import { namaAreaDari, petaKodeArea } from '../src/lib/area-master';
import { muatArea } from '../src/lib/area-store';
import { prisma } from '../src/lib/prisma';

/**
 * Apa saja kode gudang tujuan yang ADA di daftar receive-stock OCS saat ini?
 *
 * HANYA MEMBACA. Tidak menulis ke database, tidak memanggil /submit.
 *
 * Gunanya satu: memastikan apakah GBJD (Pusat) memang TIDAK ADA di daftar DO
 * yang belum diterima - bukan ada tapi gagal dicocokkan. Dua kemungkinan itu
 * terlihat sama di dashboard (SIT Pusat nol) padahal perbaikannya jauh berbeda:
 *
 *   tidak ada di daftar  -> memang tidak ada barang dalam perjalanan ke Pusat
 *                           (sudah GR, atau inbound ke gudang pusat tidak lewat
 *                           alur DO antar-gudang ini sama sekali)
 *   ada tapi tak cocok   -> kode SAP-nya tidak ketemu SKU di stock_current
 *
 * `docs` dari OCS hanya memuat dokumen yang BELUM selesai diterima.
 *
 *   npx tsx scripts/check-receive-codes.ts         # ringkas, dari daftar dokumen
 *   npx tsx scripts/check-receive-codes.ts --lines # + buka tiap dokumen (lebih lambat, lebih teliti)
 */
const bukaBaris = process.argv.includes('--lines');
const n = (x: number) => x.toLocaleString('id-ID');

async function main() {
  // Kode gudang yang dikenal datang dari tabel `area`, bukan dari konstanta.
  const daftarArea = await muatArea();
  const peta = petaKodeArea(daftarArea);
  const docs = await fetchReceiveDocs();
  console.log(`\n${docs.length} dokumen receive (belum selesai diterima) di OCS.\n`);

  // --- tingkat dokumen: kolom AddressCodes ---
  const dariDocs = new Map<string, { docs: number; qty: number }>();
  for (const d of docs) {
    const kodes = String(d.AddressCodes ?? '').split(/[,;|\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
    const daftar = kodes.length ? kodes : ['(kosong)'];
    for (const k of daftar) {
      const e = dariDocs.get(k) ?? { docs: 0, qty: 0 };
      e.docs += 1;
      e.qty += Number(d.TotalQty) || 0;
      dariDocs.set(k, e);
    }
  }
  console.log('=== kode gudang menurut kolom AddressCodes di daftar dokumen ===');
  console.log('(qty di sini TotalQty dokumen - dibagi rata bila satu dokumen menyebut beberapa kode)');
  for (const [k, e] of [...dariDocs.entries()].sort()) {
    const a = namaAreaDari(k, peta);
    const area = a.asing ? '-> (kode BELUM terdaftar di Pengaturan -> Area)' : `-> ${a.name}`;
    console.log(`  ${k.padEnd(10)} ${String(e.docs).padStart(4)} dokumen  ${n(e.qty).padStart(10)} pcs  ${area}`);
  }

  console.log('\n=== kode yang TERDAFTAR di tabel area ===');
  if (!daftarArea.length) console.log('  (tabel area masih kosong - jalankan "npm run seed:area")');
  for (const a of daftarArea) {
    const ada = dariDocs.has(a.code.toUpperCase());
    console.log(`  ${a.code.padEnd(10)} -> ${a.name.padEnd(12)} ${a.isActive ? '' : '(nonaktif) '}${ada ? 'ADA di daftar dokumen' : 'TIDAK ADA di daftar dokumen'}`);
  }

  if (!bukaBaris) {
    console.log('\nJalankan dengan --lines untuk membuka tiap dokumen dan menghitung per baris'
      + ' (AddressCode per baris lebih tepat daripada AddressCodes per dokumen).\n');
    return;
  }

  // --- tingkat baris: AddressCode per baris, inilah yang dipakai DOI ---
  const perKode = new Map<string, { baris: number; qty: number; contoh: string[] }>();
  let gagal = 0;
  for (const d of docs) {
    let lines;
    try { lines = await fetchReceiveLines(d.DoDocNum); } catch { gagal++; continue; }
    for (const l of lines) {
      const k = String(l.AddressCode ?? '').trim().toUpperCase() || '(kosong)';
      const qty = Math.max(0, Math.trunc(Number(l.DoQty) || 0));
      const e = perKode.get(k) ?? { baris: 0, qty: 0, contoh: [] };
      e.baris += 1; e.qty += qty;
      if (e.contoh.length < 3 && l.ItemCode) e.contoh.push(String(l.ItemCode));
      perKode.set(k, e);
    }
  }
  console.log('\n=== AddressCode per BARIS (angka yang benar-benar dipakai DOI) ===');
  for (const [k, e] of [...perKode.entries()].sort()) {
    const a = namaAreaDari(k, peta);
    console.log(`  ${k.padEnd(10)} ${String(e.baris).padStart(5)} baris  ${n(e.qty).padStart(10)} pcs  -> ${a.asing ? 'BELUM TERDAFTAR' : `area "${a.name}"`}  contoh ItemCode: ${e.contoh.join(', ')}`);
  }
  if (gagal) console.log(`\n  ${gagal} dokumen gagal dibuka - angka di atas belum lengkap.`);
  console.log('');
}

main()
  .catch((e) => { console.error('GAGAL:', e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
