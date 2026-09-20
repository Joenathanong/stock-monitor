import './env';
import { randomBytes, randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { hashPassword, validatePassword, validateUsername } from '../src/lib/password';
import { ROLES, type Role } from '../src/lib/auth';

/**
 * Reset password lewat CLI — untuk kasus lupa password dan tidak ada admin lain
 * yang bisa meresetkan lewat menu Pengguna.
 *
 * Skrip ini menulis langsung ke tabel `app_user`, jadi tidak perlu login.
 * Password lama tidak bisa dibaca (scrypt satu arah), yang bisa hanya menggantinya.
 *
 *   npm run reset-password                                  daftar semua pengguna
 *   npm run reset-password -- admin                         password acak, dicetak sekali
 *   npm run reset-password -- admin --password=Rahasia123   password pilihan sendiri
 *   npm run reset-password -- admin --create                buat kalau belum ada (jadi ADMIN)
 *   npm run reset-password -- admin --role=ADMIN            sekalian kembalikan perannya
 *
 * Pengguna yang sedang nonaktif otomatis diaktifkan kembali — percuma password
 * baru kalau akunnya tetap ditolak saat login.
 */

type Args = { user: string | null; password: string | null; role: Role | null; create: boolean; help: boolean };

function parseArgs(argv: string[]): Args {
  const a: Args = { user: null, password: null, role: null, create: false, help: false };
  for (const raw of argv) {
    if (raw === '--help' || raw === '-h') a.help = true;
    else if (raw === '--create') a.create = true;
    else if (raw.startsWith('--user=')) a.user = raw.slice(7).trim();
    else if (raw.startsWith('--password=')) a.password = raw.slice(11);
    else if (raw.startsWith('--role=')) a.role = raw.slice(7).trim().toUpperCase() as Role;
    else if (!raw.startsWith('-') && !a.user) a.user = raw.trim();
  }
  return a;
}

/** Password acak yang masih bisa dibacakan lewat telepon — tanpa 0/O/1/l/I. */
function randomPassword(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(14);
  return [...bytes].map((b) => abc[b % abc.length]).join('');
}

const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));

async function daftarPengguna() {
  const rows = await prisma.appUser.findMany({ orderBy: [{ role: 'asc' }, { username: 'asc' }] });
  if (!rows.length) {
    console.log('Belum ada pengguna sama sekali.');
    console.log('Buat admin pertama:  npm run reset-password -- admin --create');
    return rows;
  }
  console.log(`${rows.length} pengguna:\n`);
  console.log(`  ${pad('USERNAME', 22)}${pad('NAMA', 26)}${pad('PERAN', 8)}${pad('AKTIF', 7)}LOGIN TERAKHIR`);
  for (const u of rows) {
    console.log(`  ${pad(u.username, 22)}${pad(u.name, 26)}${pad(u.role, 8)}${pad(u.isActive ? 'ya' : 'TIDAK', 7)}${u.lastLoginAt ? u.lastLoginAt.toISOString().slice(0, 16).replace('T', ' ') : '—'}`);
  }
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log([
      'Reset password DOI Monitor',
      '',
      '  npm run reset-password                                  daftar pengguna',
      '  npm run reset-password -- admin                         password acak',
      '  npm run reset-password -- admin --password=Rahasia123   password sendiri (min 6 karakter)',
      '  npm run reset-password -- admin --create                buat kalau belum ada',
      '  npm run reset-password -- admin --role=ADMIN            sekalian ganti peran',
      '',
      'Jalankan dari folder doi-monitor, dan .env harus berisi DATABASE_URL yang benar.',
    ].join('\n'));
    return;
  }

  if (!args.user) {
    await daftarPengguna();
    console.log('\nPilih salah satu:  npm run reset-password -- <username>');
    return;
  }

  const username = args.user.toLowerCase();
  const salahNama = validateUsername(username);
  if (salahNama) throw new Error(salahNama);

  if (args.role && !ROLES.includes(args.role)) {
    throw new Error(`Peran tidak dikenal: ${args.role}. Pilih ${ROLES.join(' / ')}`);
  }

  const password = args.password ?? randomPassword();
  const salahPassword = validatePassword(password);
  if (salahPassword) throw new Error(salahPassword);

  const ada = await prisma.appUser.findUnique({ where: { username } });

  if (!ada) {
    if (!args.create) {
      console.error(`Pengguna "${username}" tidak ada.\n`);
      await daftarPengguna();
      console.error(`\nKalau memang mau dibuat baru:  npm run reset-password -- ${username} --create`);
      process.exitCode = 1;
      return;
    }
    await prisma.appUser.create({
      data: {
        id: randomUUID(), username, passwordHash: hashPassword(password),
        name: username === 'admin' ? 'Administrator' : username,
        role: args.role ?? 'ADMIN', isActive: true,
      },
    });
    console.log(`Pengguna baru dibuat: ${username} (peran ${args.role ?? 'ADMIN'})`);
  } else {
    // Dicatat sebelum update — supaya pesannya benar apa pun bentuk klien database-nya.
    const sebelum = { isActive: ada.isActive, role: ada.role };
    await prisma.appUser.update({
      where: { username },
      data: {
        passwordHash: hashPassword(password),
        isActive: true,
        ...(args.role ? { role: args.role } : {}),
      },
    });
    console.log(`Password ${username} diganti.`);
    if (!sebelum.isActive) console.log('Akun yang tadinya nonaktif diaktifkan kembali.');
    if (args.role && args.role !== sebelum.role) console.log(`Peran diubah: ${sebelum.role} → ${args.role}`);
  }

  console.log('\n  username : ' + username);
  console.log('  password : ' + password);
  if (!args.password) console.log('\n  (password acak — dicetak sekali di sini, tidak bisa dilihat lagi)');
  console.log('\nLangsung masuk lewat halaman login, lalu ganti sendiri di menu Akun Saya.');
  console.log('Sesi lama tidak ikut keluar; untuk memaksa semua keluar, ganti SESSION_SECRET di .env / Vercel.');
}

main()
  .catch((e) => { console.error('Gagal:', e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect().catch(() => {}));
