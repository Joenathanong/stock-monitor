# Deploy ke Vercel (Hobby) + TiDB Serverless

## 1. Database
TiDB Cloud → Serverless → **Connect** → pilih **Prisma**. Buat database `doi_monitor`, lalu:
```
DATABASE_URL="mysql://<user>.root:<password>@gateway01.<region>.prod.aws.tidbcloud.com:4000/doi_monitor?sslaccept=strict"
```
`?sslaccept=strict` wajib. Kemudian dari komputer: `npm run db:push && npm run db:seed && npm run check:db`.

## 2. Environment Variables di Vercel
| Nama | Isi |
|---|---|
| `DATABASE_URL` | connection string di atas |
| `OCS_BASE_URL` | `https://ocs.iegsystem.id` |
| `OCS_USERNAME` / `OCS_PASSWORD` | `ADMIN` / `ADMIN` |
| `OCS_COMPANY_DB` | `EJI_WMS` |
| `SESSION_SECRET` | string acak ≥ 16 karakter — tanda tangan cookie sesi |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | admin pertama untuk `db:seed` (opsional; bisa lewat halaman login) |
| `PUBLIC_TV_TOKEN` | opsional — kunci untuk `/tv?key=…`; kosong = dashboard TV terbuka |
| `CRON_SECRET` | string acak panjang |
| `APP_TZ_OFFSET_MINUTES` | `420` |

## 3. Deploy
Hubungkan repo ke Vercel (Framework: Next.js). `npm run build` sudah menjalankan `prisma generate`.
Pastikan **Fluid Compute** aktif (bawaan proyek baru) supaya `maxDuration` 300 detik di
`vercel.json` berlaku; tanpa itu Hobby dibatasi 60 detik dan penarikan 7 hari bisa terpotong
(kalau terjadi, turunkan `sales_sync_lookback_days` di Pengaturan ke 3).

## 4. Cron
Dua jadwal di `vercel.json` (batas Hobby: 2 cron, sekali sehari, presisi ±1 jam).
Uji manual:
```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<app>.vercel.app/api/cron/sales
curl -H "Authorization: Bearer $CRON_SECRET" https://<app>.vercel.app/api/cron/compute
```

## 5. Histori awal
Dari komputer (bukan Vercel — terlalu lama untuk satu fungsi):
```bash
npm run backfill:sales -- --from=2026-01-01 --to=2026-09-14
```
Atau unggah XLSX di halaman **Data Penjualan**. Setelah itu `npm run compute` atau klik **Refresh**.

## 6. Urutan pemakaian harian
01.00 penjualan ditarik → 07.30 stok ditarik & DOI dihitung → tim membuka Dashboard.
Unggah stok transit / ubah lead time kapan saja, lalu klik **Hitung ulang** (tanpa tarik OCS).
