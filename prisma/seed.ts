import '../scripts/env';
import { prisma } from '../src/lib/prisma';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import { hashPassword } from '../src/lib/password';
import { randomUUID } from 'node:crypto';

/** Isi pengaturan bawaan (hanya kunci yang belum ada). Tanggal pengecualian dihasilkan otomatis dari aturan. */
async function main() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.appSetting.upsert({ where: { key }, create: { key, value: String(value) }, update: {} });
  }
  console.log(`Pengaturan: ${Object.keys(DEFAULT_SETTINGS).length} kunci`);

  // Admin pertama — hanya bila tabel pengguna masih kosong. Bisa juga dibuat lewat halaman login.
  if ((await prisma.appUser.count()) === 0) {
    const username = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    await prisma.appUser.create({ data: { id: randomUUID(), username, passwordHash: hashPassword(password), name: 'Administrator', role: 'ADMIN' } });
    console.log(`Admin pertama dibuat: ${username} / ${password} — segera ganti password lewat menu Akun Saya`);
  } else {
    console.log('Pengguna sudah ada, admin tidak dibuat ulang');
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
