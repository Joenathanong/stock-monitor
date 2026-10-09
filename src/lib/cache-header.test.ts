import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Penjaga: endpoint BER-LOGIN tidak boleh di-cache di edge (CDN).
 *
 * KEJADIAN NYATA 9 Okt 2026. User menekan Refresh, tabel DOI berubah, tapi
 * dashboard tetap menulis "Terakhir dihitung 08.17". Diukur langsung:
 *
 *   /api/dashboard    x-vercel-cache: STALE   age 407   computedAt 08.17 (cron)
 *   /api/monitoring   x-vercel-cache: MISS    age   0   computedAt 12.57 (manual)
 *
 * Satu database, satu snapshotDate. Yang berbeda hanya HTTP cache-nya:
 * `s-maxage=300, stale-while-revalidate=1800` membuat Vercel menyajikan
 * jawaban berumur sampai setengah jam. Perhitungannya benar; yang salah
 * jawabannya di jalan.
 *
 * Inilah bentuk kesalahan yang paling mahal: tidak ada galat, tidak ada
 * gejala, angkanya cuma salah — dan yang dicurigai orang adalah rumusnya.
 *
 * ATURANNYA: `s-maxage` / `stale-while-revalidate` hanya boleh di bawah
 * `src/app/api/public/` — halaman tanpa login, tanpa tombol Refresh, yang
 * memang layar tempel. Di endpoint lain, dipakai orang yang baru saja menekan
 * Refresh dan berhak melihat hasilnya.
 */

function berkas(dir: string, hasil: string[] = []): string[] {
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) berkas(p, hasil);
    else if (/\.ts$/.test(nama)) hasil.push(p);
  }
  return hasil;
}

const PUBLIK = /src[\\/]app[\\/]api[\\/]public[\\/]/;
const CACHE_BERSAMA = /(s-maxage|stale-while-revalidate)/;

test('tidak ada cache edge di endpoint API yang butuh login', () => {
  const pelanggaran: string[] = [];
  for (const f of berkas(join('src', 'app', 'api'))) {
    if (PUBLIK.test(f)) continue;
    const kode = readFileSync(f, 'utf8');
    // Hanya baris yang benar-benar MENYETEL header, bukan komentar yang
    // membicarakannya — berkas dashboard sengaja menyimpan riwayat insidennya.
    for (const baris of kode.split('\n')) {
      const bersih = baris.trim();
      if (bersih.startsWith('*') || bersih.startsWith('//')) continue;
      if (!/Cache-Control/i.test(bersih)) continue;
      if (CACHE_BERSAMA.test(bersih)) {
        pelanggaran.push(`${f} — ${bersih.slice(0, 90)}`);
      }
    }
  }
  assert.deepEqual(
    pelanggaran,
    [],
    'Endpoint ber-login tidak boleh memakai s-maxage / stale-while-revalidate — '
    + 'hasil Refresh harus langsung terlihat:\n' + pelanggaran.join('\n'),
  );
});

test('dashboard ber-login memang no-store', () => {
  const kode = readFileSync(join('src', 'app', 'api', 'dashboard', 'route.ts'), 'utf8');
  assert.match(kode, /Cache-Control'\s*,\s*'no-store/, '/api/dashboard harus no-store');
});
