import './env';
import { prisma } from '../src/lib/prisma';
import { pullSalesDayArea, areaDariOcs, areaSudahJalan } from '../src/lib/sync';
import { parseAreaStart } from '../src/lib/settings';
import { getSettings } from '../src/lib/compute';
import { ocsUser } from '../src/lib/ocs';
import { addDays, keyToUtcDate, toDateKeyUtc, todayKey, type DateKey } from '../src/lib/dates';

/**
 * Tarik ulang histori penjualan dengan aturan 25 Sep 2026: SELURUH status,
 * tiap kota diminta dengan namanya sendiri, qty order batal dipisah ke `qtyCancel`.
 *
 * SATUAN KERJANYA (tanggal × area), bukan tanggal.
 *
 * Versi sebelumnya menghitung kemajuan per tanggal: kalau Surabaya gagal
 * sementara 4 kota lain berhasil, tanggal itu tercatat "selesai" dan `--resume`
 * melewatinya selamanya — lubang yang tidak pernah terisi dan tidak kelihatan.
 * Sekarang tiap pasangan dilacak sendiri, gagalnya dicoba ulang otomatis di
 * akhir, dan sisa lubang dilaporkan dengan tanggal + kota yang tepat.
 *
 *   npm run backfill:sales                       # seluruh rentang yang ada di database
 *   npm run backfill:sales -- --dry-run          # lihat rencananya
 *   npm run backfill:sales -- --resume           # HANYA isi lubang: pasangan yang belum punya data
 *   npm run backfill:sales -- --segarkan=12      # tarik ulang yang datanya lebih tua dari 12 jam
 *   npm run backfill:sales -- --verify           # HANYA laporkan lubang, tidak menarik apa pun
 *   npm run backfill:sales -- --days=90
 *   npm run backfill:sales -- --areas=Pusat,Surabaya
 *   npm run backfill:sales -- --paralel=1        # pelankan kalau OCS sering timeout
 *   npm run backfill:sales -- --mulai=Surabaya=2026-06-01,Medan=2026-06-01
 *        ^ tanggal mulai operasional per area; disimpan ke Pengaturan
 *          (sales_area_start) supaya cron & --verify ikut memakainya.
 */
function arg(name: string): string | undefined {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  // Dipotong di '=' PERTAMA saja — nilainya sendiri boleh memuat '='
  // (mis. --mulai=Surabaya=2026-06-01,Medan=2026-06-01).
  return a?.slice(name.length + 3);
}
const rp = (n: number) => n.toLocaleString('id-ID');
const jam = (ms: number) => {
  const d = Math.round(ms / 1000);
  return d < 90 ? `${d} dtk` : `${Math.floor(d / 60)} mnt ${d % 60} dtk`;
};

type Tugas = { day: DateKey; area: string };

/** Jalankan `tugas` dengan paling banyak `batas` berjalan bersamaan. */
async function berbarengan<T>(tugas: (() => Promise<T>)[], batas: number): Promise<void> {
  let i = 0;
  const pekerja = Array.from({ length: Math.min(batas, tugas.length) }, async () => {
    while (i < tugas.length) await tugas[i++]();
  });
  await Promise.all(pekerja);
}

async function main() {
  const settings = await getSettings();
  const resume = process.argv.includes('--resume');
  // --segarkan=JAM: tarik ulang pasangan yang datanya lebih tua dari JAM jam.
  //
  // Dulu perilaku ini MELEKAT pada --resume dengan batas 12 jam tetap, dan itu
  // jebakan: sehari setelah backfill selesai, semua data sudah lebih tua dari
  // 12 jam, jadi --resume mengantre SELURUH rentang lagi (751 pasangan) padahal
  // lubangnya cuma 16. Sekarang --resume murni mengisi lubang; menarik ulang
  // data yang sudah ada harus diminta terang-terangan.
  const segarkanJam = Number(arg('segarkan') ?? '0');
  const dryRun = process.argv.includes('--dry-run');
  const verify = process.argv.includes('--verify');
  // Bawaannya 1. Paralel 3 diuji 25 Sep 2026 dan hasilnya LEBIH BURUK:
  // berurutan ±2% pasangan gagal, paralel 3 jadi ±17% — endpoint laporan OCS
  // berbasis SAP dan melambat drastis kalau ditanya beberapa hal sekaligus,
  // sampai melewati batas waktu. Naikkan hanya kalau memang terbukti aman.
  const paralel = Math.max(1, Math.min(5, Number(arg('paralel') ?? 1)));
  const kemarin = addDays(todayKey(), -1);

  let from: DateKey, to: DateKey, asal: string;
  if (arg('from') && arg('to')) {
    from = arg('from')!; to = arg('to')!; asal = 'rentang dari argumen';
  } else if (arg('days')) {
    to = kemarin; from = addDays(to, -(Number(arg('days')) - 1)); asal = `${arg('days')} hari terakhir`;
  } else {
    const batas = await prisma.salesDaily.aggregate({ _min: { salesDate: true }, _max: { salesDate: true } });
    if (!batas._min.salesDate) {
      console.error('Database penjualan masih kosong. Sebutkan rentangnya: --from=YYYY-MM-DD --to=YYYY-MM-DD');
      process.exitCode = 1; return;
    }
    from = toDateKeyUtc(batas._min.salesDate);
    to = kemarin > toDateKeyUtc(batas._max.salesDate!) ? kemarin : toDateKeyUtc(batas._max.salesDate!);
    asal = 'seluruh rentang yang sudah ada di database';
  }

  console.log(`Akun OCS: ${ocsUser()}`);
  let daftarArea = arg('areas')?.split(',').map((v) => v.trim()).filter(Boolean) ?? [];
  if (!daftarArea.length) {
    if (verify) {
      daftarArea = settings.salesPullAreas;
      if (!daftarArea.length) { console.error('sales_pull_areas kosong — sebutkan --areas=...'); process.exitCode = 1; return; }
    } else {
      process.stdout.write('Mengambil daftar area dari OCS… ');
      daftarArea = await areaDariOcs();
      console.log('selesai.');
    }
  }
  if (!daftarArea.length) { console.error('Tidak ada area.'); process.exitCode = 1; return; }
  console.log(`  ${daftarArea.length} area: ${daftarArea.join(', ')}`);

  // Tanggal mulai operasional per area: dari argumen kalau ada, kalau tidak dari Pengaturan.
  const dariArg = arg('mulai') ? parseAreaStart(arg('mulai')!) : null;
  const mulai = dariArg ?? settings.salesAreaStart;
  if (dariArg && !dryRun && !verify) {
    const teks = Object.entries(dariArg).map(([a, d]) => `${a}=${d}`).join(',');
    await prisma.appSetting.upsert({
      where: { key: 'sales_area_start' },
      create: { key: 'sales_area_start', value: teks },
      update: { value: teks },
    });
    console.log(`  disimpan ke Pengaturan: sales_area_start = ${teks}`);
  }
  if (Object.keys(mulai).length) {
    console.log(`  mulai operasional  : ${Object.entries(mulai).map(([a, d]) => `${a} sejak ${d}`).join(' · ')}`);
    const takDikenal = Object.keys(mulai).filter((a) => !daftarArea.includes(a));
    if (takDikenal.length) console.log(`  PERHATIAN: nama area tidak dikenal di sales_area_start: ${takDikenal.join(', ')}`);
  }

  if (!dryRun && !verify) {
    await prisma.appSetting.upsert({
      where: { key: 'sales_pull_areas' },
      create: { key: 'sales_pull_areas', value: daftarArea.join(',') },
      update: { value: daftarArea.join(',') },
    });
    console.log(`  disimpan ke Pengaturan: sales_pull_areas = ${daftarArea.join(',')}`);
  }

  // ---- Keadaan per pasangan (tanggal, area) ----
  //
  // Dua sumber, sengaja digabung:
  //   sales_pull  — bukti pasangan ini PERNAH ditarik, walau hasilnya nol baris
  //   sales_daily — barisnya sendiri, untuk data lama yang ditarik sebelum
  //                 sales_pull ada
  //
  // Tanpa yang pertama, hari tanpa penjualan (cabang baru buka, libur) dilapor
  // sebagai lubang selamanya dan ditarik ulang tiap kali --resume dijalankan.
  const [rows, pulls] = await Promise.all([
    prisma.$queryRawUnsafe<{ d: Date; a: string; t: Date; n: bigint }[]>(
      `SELECT salesDate AS d, areaId AS a, MAX(updatedAt) AS t, COUNT(*) AS n
         FROM sales_daily WHERE salesDate BETWEEN ? AND ? GROUP BY salesDate, areaId`,
      keyToUtcDate(from), keyToUtcDate(to),
    ),
    prisma.$queryRawUnsafe<{ d: Date; a: string; t: Date; n: number }[]>(
      'SELECT salesDate AS d, areaId AS a, pulledAt AS t, rowCount AS n FROM sales_pull WHERE salesDate BETWEEN ? AND ?',
      keyToUtcDate(from), keyToUtcDate(to),
    ).catch(() => []),
  ]);
  const ada = new Map<string, { t: number; n: number }>();
  for (const r of rows) ada.set(`${toDateKeyUtc(new Date(r.d))}|${r.a}`, { t: new Date(r.t).getTime(), n: Number(r.n) });
  for (const r of pulls) {
    const k = `${toDateKeyUtc(new Date(r.d))}|${r.a}`;
    const t = new Date(r.t).getTime();
    const prev = ada.get(k);
    // Yang paling baru yang dipakai; catatan tarik menang kalau lebih segar.
    if (!prev || t > prev.t) ada.set(k, { t, n: Number(r.n) });
  }
  const nolSah = new Set(pulls.filter((r) => Number(r.n) === 0).map((r) => `${toDateKeyUtc(new Date(r.d))}|${r.a}`));

  const segar = segarkanJam > 0 ? Date.now() - segarkanJam * 3600_000 : 0;
  const semua: Tugas[] = [];
  const lubang: Tugas[] = [];
  let dilewati = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    for (const area of daftarArea) {
      // Sebelum area itu beroperasi, tidak ada yang bisa ditarik — dan bukan lubang.
      if (!areaSudahJalan(area, d, mulai)) { dilewati++; continue; }
      const t: Tugas = { day: d, area };
      semua.push(t);
      if (!ada.has(`${d}|${area}`)) lubang.push(t);
    }
  }

  // ---- Mode verifikasi: hanya melapor ----
  if (verify) {
    console.log(`\nPeriksa ${from} s/d ${to} — ${semua.length} pasangan (tanggal × area)` +
      `${dilewati ? `, ${dilewati} dilewati karena areanya belum beroperasi` : ''}\n`);
    if (nolSah.size) {
      const perNol = new Map<string, number>();
      for (const k of nolSah) { const a = k.split('|')[1]; perNol.set(a, (perNol.get(a) ?? 0) + 1); }
      console.log(`  ${nolSah.size} pasangan sudah ditarik dan HASILNYA MEMANG NOL (bukan lubang):`);
      for (const [a, n] of [...perNol.entries()].sort((x, y) => y[1] - x[1])) console.log(`    ${a.padEnd(12)} ${n} tanggal`);
      console.log('');
    }
    const perArea = new Map<string, number>();
    for (const l of lubang) perArea.set(l.area, (perArea.get(l.area) ?? 0) + 1);
    if (!lubang.length) console.log('  Tidak ada lubang — semua pasangan sudah pernah ditarik.');
    else {
      console.log(`  ${lubang.length} pasangan TANPA data sama sekali:`);
      for (const [area, n] of [...perArea.entries()].sort((a, b) => b[1] - a[1])) {
        const tgl = lubang.filter((l) => l.area === area).map((l) => l.day);
        console.log(`    ${area.padEnd(12)} ${String(n).padStart(4)} tanggal: ${tgl.slice(0, 12).join(', ')}${tgl.length > 12 ? ` … (+${tgl.length - 12})` : ''}`);
      }
      console.log('\n  Perbaiki dengan: npm run backfill:sales -- --resume');
    }
    return;
  }

  // --resume        → hanya pasangan yang sama sekali belum punya data (lubang)
  // --segarkan=JAM  → tambah pasangan yang datanya lebih tua dari JAM jam
  // tanpa keduanya  → seluruh rentang (tarik ulang penuh, disengaja)
  const antre = resume || segarkanJam > 0
    ? semua.filter((t) => {
        const k = ada.get(`${t.day}|${t.area}`);
        if (!k) return true;                       // lubang: selalu ditarik
        return segar > 0 && k.t < segar;           // sudah ada: hanya kalau diminta
      })
    : semua;

  console.log(`\nBackfill penjualan — ${asal}`);
  console.log(`  rentang     : ${from} s/d ${to} — ${semua.length} pasangan` +
    `${dilewati ? ` (${dilewati} dilewati: areanya belum beroperasi)` : ''}`);
  console.log(`  lubang saat ini: ${lubang.length} pasangan tanpa data`);
  const mode = resume && segarkanJam > 0 ? `lubang + data lebih tua dari ${segarkanJam} jam`
             : resume ? 'hanya lubang (pasangan tanpa data)'
             : segarkanJam > 0 ? `data lebih tua dari ${segarkanJam} jam`
             : 'SELURUH rentang — tarik ulang penuh';
  console.log(`  mode        : ${mode}`);
  console.log(`  akan ditarik: ${antre.length} pasangan${antre.length < semua.length ? ` (${semua.length - antre.length} dilewati, sudah punya data)` : ''}`);
  if (!resume && segarkanJam <= 0 && semua.length > 30) {
    console.log('\n  PERHATIAN: ini menarik ulang semua, bukan mengisi lubang.');
    console.log('             Kalau yang Anda mau hanya menambal lubang: --resume\n');
  }
  console.log(`  paralel     : ${paralel} pasangan sekaligus${paralel > 1 ? '  — PERHATIAN: >1 membuat OCS sering timeout' : ''}`);
  console.log(`  batas waktu : 90 dtk per panggilan, 2 percobaan`);
  console.log(`  perkiraan   : ±${jam((antre.length * 5_000) / paralel)}\n`);
  console.log('  Boleh dihentikan kapan saja (Ctrl+C) — lanjutkan dengan --resume.\n');
  if (dryRun) { console.log('--dry-run: tidak ada yang ditulis.'); return; }

  const t0 = Date.now();
  let selesai = 0, rowsTulis = 0;
  let gagal: Tugas[] = [];
  const catat = (t: Tugas, teks: string) =>
    console.log(`  [${String(selesai).padStart(4)}/${antre.length}] ${t.day} ${t.area.padEnd(11)} ${teks}`);

  const jalankan = (daftar: Tugas[]) => berbarengan(daftar.map((t) => async () => {
    try {
      const n = await pullSalesDayArea(t.day, t.area, settings, 90_000, 2);
      rowsTulis += n; selesai++;
      catat(t, `${String(n).padStart(4)} baris`);
    } catch (err) {
      selesai++; gagal.push(t);
      catat(t, `GAGAL — ${(err instanceof Error ? err.message : String(err)).slice(0, 90)}`);
    }
  }), paralel);

  await jalankan(antre);

  // ---- Percobaan ulang otomatis, satu per satu (OCS sering timeout kalau diparalel) ----
  if (gagal.length) {
    const ulang = gagal; gagal = [];
    console.log(`\n  Mencoba ulang ${ulang.length} pasangan yang gagal, satu per satu…`);
    selesai = 0;
    await berbarengan(ulang.map((t) => async () => {
      try {
        const n = await pullSalesDayArea(t.day, t.area, settings, 150_000, 2);
        rowsTulis += n; selesai++;
        console.log(`  ulang ${t.day} ${t.area.padEnd(11)} ${String(n).padStart(4)} baris`);
      } catch (err) {
        selesai++; gagal.push(t);
        console.log(`  ulang ${t.day} ${t.area.padEnd(11)} GAGAL LAGI — ${(err instanceof Error ? err.message : String(err)).slice(0, 70)}`);
      }
    }), 1);
  }

  // ---- Ringkasan ----
  const s1 = (await prisma.$queryRawUnsafe<{ baris: bigint; qty: bigint; cancel: bigint; area: bigint }[]>(
    `SELECT COUNT(*) AS baris, COALESCE(SUM(qty),0) AS qty, COALESCE(SUM(qtyCancel),0) AS cancel,
            COUNT(DISTINCT areaId) AS area
       FROM sales_daily WHERE salesDate BETWEEN ? AND ?`,
    keyToUtcDate(from), keyToUtcDate(to),
  ))[0];
  const perArea = await prisma.$queryRawUnsafe<{ areaId: string; hari: bigint; baris: bigint; qty: bigint; cancel: bigint }[]>(
    `SELECT areaId, COUNT(DISTINCT salesDate) AS hari, COUNT(*) AS baris,
            COALESCE(SUM(qty),0) AS qty, COALESCE(SUM(qtyCancel),0) AS cancel
       FROM sales_daily WHERE salesDate BETWEEN ? AND ? GROUP BY areaId ORDER BY SUM(qty) DESC`,
    keyToUtcDate(from), keyToUtcDate(to),
  );
  const hariPerArea = new Map<string, number>();
  for (const t of semua) hariPerArea.set(t.area, (hariPerArea.get(t.area) ?? 0) + 1);

  console.log(`\nSelesai dalam ${jam(Date.now() - t0)} — ${rp(rowsTulis)} baris ditulis.`);
  console.log(`  total sekarang: ${rp(Number(s1.baris))} baris · qty ${rp(Number(s1.qty))} · batal ${rp(Number(s1.cancel))} · ${Number(s1.area)} area`);
  console.log('\n  Per area (hari terisi / hari yang memang dicakup):');
  console.table(perArea.map((r) => ({
    area: r.areaId, hari: `${Number(r.hari)}/${hariPerArea.get(r.areaId) ?? '?'}`, baris: Number(r.baris),
    qty: Number(r.qty), batal: Number(r.cancel),
    '% batal': Number(r.qty) + Number(r.cancel)
      ? `${((Number(r.cancel) / (Number(r.qty) + Number(r.cancel))) * 100).toFixed(1)}%` : '—',
  })));

  if (gagal.length) {
    console.log(`\n  MASIH GAGAL: ${gagal.length} pasangan`);
    for (const t of gagal.slice(0, 20)) console.log(`    ${t.day}  ${t.area}`);
    if (gagal.length > 20) console.log(`    … (+${gagal.length - 20})`);
    console.log('\n  Jalankan lagi: npm run backfill:sales -- --resume --paralel=1');
  } else {
    console.log('\n  Tidak ada yang gagal. Periksa lubang: npm run backfill:sales -- --verify');
    console.log('  Lalu: npm run compute');
  }
}

main().catch((e) => { console.error('GAGAL:', e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
