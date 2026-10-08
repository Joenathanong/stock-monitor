# ATP Monitoring — spesifikasi & temuan terverifikasi

Dokumen keputusan. Semua angka di sini **diukur**, bukan diperkirakan, dan
disebutkan dari mana diambil. Yang masih dugaan ditandai tegas.

Diverifikasi 8 Okt 2026 lewat OCS dengan akun **JONATHAN** (`allowed-areas`:
Makassar, Medan, Pusat, Surabaya, Yogyakarta · `CompanyDb: EJI_WMS`). Hanya GET,
tidak ada yang diubah di OCS.

---

## 1. Kenapa program ini ada — checklist sebaran TIDAK bisa diambil dari OCS

Inilah pembenaran utamanya, dan ia terbukti dengan angka.

`DTO_WmsItemStockLiteV2`, 13.565 baris seluruh area:

| area | baris | kategori Sku | aktif | aktif & Sku |
|---|---|---|---|---|
| Pusat | 2.713 | 471 | 1.661 | **375** |
| Medan | 2.713 | 471 | 1.564 | **356** |
| Makassar | 2.713 | 471 | 1.564 | **356** |
| Surabaya | 2.713 | 471 | 1.564 | **356** |
| Yogyakarta | 2.713 | 471 | 1.564 | **356** |

Keempat cabang bukan hanya sama jumlahnya — **himpunan SKU-nya IDENTIK PERSIS**
(diuji dengan membandingkan set, bukan count). Pusat punya 19 SKU tambahan:
EOMMA-*, ACNE-*, FLAWLESS-*, NATURGO-PEEL-OFF-MASK-SACHET, LIPSTAIN-PACKAGE-3,
SERUM-INTENSE-*, FYNE-HAMPERS-RAMADHAN-COLLECTION.

Kalau `IsActive` memang mencatat sebaran per cabang, Medan dan Makassar PASTI
berbeda. Mereka identik. Jadi `IsActive` adalah satu flag katalog + 19 tambahan
khusus Pusat, BUKAN keputusan sebaran.

**Konsekuensi: lapisan checklist manual wajib ada. Tidak ada data OCS yang bisa
menggantikannya.** Dan 19 SKU khusus Pusat itu cocok dengan gejala di ATP lama
(EOMMA 0/29 di cabang, 31/45 di Pusat) — yaitu pembagi yang menghukum cabang
untuk barang yang tidak pernah dimaksudkan ada di sana.

## 2. Keputusan user (terkunci)

| hal | keputusan |
|---|---|
| Ambang available | `availableQty > 5` (lebih dari 5), **global**, bukan per area/brand/SKU |
| Reserve | **TIDAK** dikurangkan |
| Cakupan | hanya SKU **aktif** di OCS, lalu difilter lagi |
| Sebaran | lapisan terpisah di atas `isActive` OCS — bukan menimpanya |
| Cabang baru | **tidak ada yang tercentang** sampai diisi manual + peringatan "N SKU belum diputuskan" |
| Pembagi ATP | SKU tidak tercentang **keluar dari pembagi** |
| Sumber stok | **hanya dari doi-monitor**, tidak dari program lama |
| Brand | dari OCS, **bukan** diterka dari nama |
| SKU 2 brand | ikut **satu saja**, urutan prioritas tetap: **Hanasui → NCO → FYNE → EOMMA** |
| Dua sistem | `replenish-ieg` dan ATP baru sengaja hidup berdampingan, cakupan berbeda |
| doi-monitor | tidak boleh dirusak strukturnya |

## 3. Brand — sumber, cakupan, dan bentrokannya

Tidak ada medan bernama `Brand` di OCS. Yang ada **`ShopCode` / `ShopName`**.

Sumber terbaik: **`DTO_LookupStockDetailedData`** — `SellerSku`, `ItemCode`,
`ShopCode`, `ShopName`, `Barcode`, `SapQty`, `Qty`, `PerCtnQty`, `AreaId`,
`WarehouseArea`. Memuat semua area (±601 baris/area, total 3.006).

Sebaran `ShopCode`: Hanasui 2.361 · NCO 395 · FYNE 150 · EOMMA 100.

**Cakupan: 348 dari 374 SKU yang layak ATP (93,0%).**

Pembaginya **374, bukan 375** — dan selisih satu baris itu kesalahan saya
sendiri, layak dicatat. Jalankan pertama `npm run sync:brand` melaporkan
"348 dari 375" dan menyertakan **`- BDL-HANASUI-0000001615`** di daftar "27 SKU
belum punya brand". Itu **bundle**: ia tidak pernah masuk hitungan ATP, jadi ia
tidak pernah butuh brand, dan memintanya diisi adalah pekerjaan yang hasilnya
tidak dipakai.

Sebabnya query cakupan di skripnya hanya menyaring
`isActive = 1 AND category = 'Sku'` — persis jebakan yang sudah tertulis di §5
no. 3: `category` TIDAK bisa memisahkan bundle. Saya menulis peringatannya lalu
melanggarnya di query skripnya sendiri. Sekarang skrip itu memakai
`adalahBundle()`, fungsi yang sama dengan `kelayakan()` di `src/lib/atp.ts`, dan
`src/lib/kelayakan-atp.test.ts` menggagalkan `npm test` kalau ada berkas ATP
lain yang menyaring `category = 'Sku'` tanpa membuang bundle. Penjaganya
dibatasi berkas ATP saja: DOI Monitor juga menyaring `category = 'Sku'` di tujuh
tempat, dan di sana bundle MEMANG ikut dihitung.

26 yang tidak dapat brand hampir semuanya berawalan **`CS-`**
(`CS-HANASUI-POWER-BRIGHT-SERUM`, `CS-ACNE-TREATMENT-ESSENCE`, dst). Polanya
jelas, TAPI tetap diisi manual — user melarang menerka dari nama, dan itu benar:
menerka akan salah mengelompokkan tanpa ada yang tahu. Tampilkan apa adanya
sebagai "brand belum diketahui".

**16 SKU punya DUA brand.** Semuanya pasangan Hanasui/NCO. Contoh
`BBS-CHEERFUL-BLISS` (ItemCode 1201020204) muncul sebagai Hanasui DAN NCO di
setiap area. Juga `BBS-JOYFULL-DAYS`, `BBS-SUNSHINE-GLOW`, `BBS-HAPPY-VIBES`,
`NCO-EDP-VANILLA-ORCHID`, `NCO-EDP-SUGAR-CREME`.

Aturan tetap: **Hanasui → NCO → FYNE → EOMMA**; yang bentrok jatuh ke yang
paling kiri. Harus deterministik — tanpa ini brand `BBS-CHEERFUL-BLISS` bisa
Hanasui hari ini dan NCO besok hanya karena urutan baris OCS berubah, dan filter
brand jadi tidak stabil tanpa ada yang sadar. Prioritasnya ditaruh di Pengaturan
supaya bisa diubah tanpa deploy.

## 4. ATP milik OCS sudah ada — dan itu BUKAN yang kita bangun

`DTO_AtpDetail`: **16.267 baris**, semua area (Pusat 3.920, Makassar 3.087,
Surabaya 3.087, Yogyakarta 3.087, Medan 3.086). Medan: `SkuId`, `ProductId`,
`PlatformId`, `SellerSku`, `WarehouseCode`, `AreaId`, `CommercePlatform`,
`ShopName`, `Status`, `AvailableQty`, `IsIncluded`, `ExcludeReason`.

`ExcludeReason` hanya: `null` (15.967) dan `BUNDLE` (300).

Sumbunya **per marketplace listing** (CommercePlatform × WarehouseCode ×
ShopName), bukan per SKU per cabang. Jadi tidak menjawab "produk ini disebar ke
Medan atau tidak".

**Tapi wajib diketahui:** akan ada DUA angka bernama "ATP per area" di
lingkungan yang sama, dan yang satu sudah dipakai marketplace. Halaman baru
harus menyebut definisinya sendiri dengan tegas, kalau tidak orang akan
membandingkan dua hal yang berbeda.

## 5. Jebakan yang sudah terbukti — jangan diulang

1. **`$filter` OData DIABAIKAN DIAM-DIAM.** `?$filter=AreaId eq 'Medan'`
   mengembalikan **0 baris, HTTP 200** — bukan error. Jangan pernah mengandalkan
   `$filter`; tarik lalu saring di sisi kita.
2. **Cakupan data tergantung AKUN.** Akun khusus-Pusat mengembalikan 2.713 baris
   "semua Pusat" dan membuat saya salah menyimpulkan `DTO_AtpDetail` dan
   `DTO_WmsItems` hanya berisi Pusat. Dengan akun JONATHAN keduanya memuat semua
   area. `allowed-areas` di localStorage adalah penentunya.
3. **`Category` TIDAK bisa memisahkan bundle.** Ada baris `Category: "Sku"`
   dengan SKU `"- BDL-HANASUI-0000001615"` dan `SapCode` kosong. Yang lebih bisa
   dipercaya: prefiks `BDL-` dan `SapCode` kosong.
   **Dan jebakan ini sudah memakan saya sendiri**, 8 Okt 2026, di query cakupan
   `scripts/sync-brand.ts` — lihat §3. Pelajarannya: menulis peringatannya di
   dokumen tidak cukup; yang menahan adalah tes. Sekarang ada
   `src/lib/kelayakan-atp.test.ts`.
4. **SKU di OCS kotor.** Ada yang berawalan spasi, angka, dan tanda hubung:
   `"- BDL-..."`, `"90 FYNE-BRIGHT-BARRIER-MOIST"`, `"26483377580"`. Filter harus
   eksplisit dan diuji, bukan diasumsikan.
5. **Tipe `OcsStockRow` di doi-monitor tidak lengkap** — payload nyata punya
   `IsUnderReserve` yang tidak ada di tipe itu. Jangan dijadikan daftar lengkap
   medan yang tersedia.
6. **`stock_current` 2.705 vs OCS 2.713** — selisih 8 baris. Kemungkinan hanya
   beda waktu tarik, tapi periksa sekali saat penarik dibuat.

## 6. Database & repo — FINAL (8 Okt 2026)

**Satu repo (di dalam doi-monitor), satu database `doi_monitor`, tabel baru
ditambahkan ke `schema.prisma` yang sudah ada.**

Alasannya berubah dari pertimbangan awal, dan ini layak dicatat: saran dua
database tadinya berdasarkan asumsi DUA repo dengan DUA `schema.prisma` — di
situ `db push` dari repo mana pun bisa menghapus tabel repo lain, dan arah
ATP→doi_monitor akan memusnahkan 22 tabel.

Ukuran nyata dari `check:push` 8 Okt 2026 — JAUH lebih besar dari yang saya
sebut berulang kali sebelumnya (saya mengutip "37.900 baris" untuk `sales_daily`;
itu jumlah baris SATU penarikan, bukan isi tabelnya):

```
sales_daily     191.051
stock_daily      31.430
doi_snapshot     20.156
stock_current    13.560
sku_master          465
transit_stock       137
```

Begitu repo-nya satu, asumsi itu hilang. Hanya ada SATU `schema.prisma` yang
memuat semuanya, jadi tidak ada repo kedua yang bisa menjalankan `db push`.
Bahayanya hilang secara struktural, bukan karena disiplin.

Dan dua database justru lebih buruk di sini: ATP% harus masuk ke SVG poster yang
sama, jadi satu request membaca stok DAN checklist sekaligus. Dengan dua database
itu berarti query lintas-database di dalam app yang sama — rumit tanpa imbalan.

### Satu alur untuk semua program

```
OCS  ->  sync:stock  ->  stock_current  ->  dipakai DOI, ATP, poster WA
```

Material baru di OCS masuk pada sinkronisasi berikutnya dan LANGSUNG terlihat
oleh DOI maupun ATP tanpa penyesuaian apa pun. Tidak ada penarik kedua, tidak ada
salinan yang bisa basi, tidak ada dua angka stok.

Dua aturan turunannya:

- **Material baru = "belum diputuskan"**, bukan diam-diam dihitung available dan
  bukan diam-diam dibuang. Jadi penambahan di OCS selalu memunculkan pekerjaan
  kecil yang TERLIHAT, bukan angka yang bergeser tanpa sebab.
- **SKU yang HILANG dari OCS: barisnya DISIMPAN**, ditandai "tidak ada di OCS".
  Kalau dihapus, keputusan sebaran yang pernah diambil hilang, dan kalau SKU itu
  kembali harus diputuskan ulang dari nol.

### Kanvas poster ditinggikan

Keputusan user: kanvas poster WA **dinaikkan dari 900px** supaya ATP per cabang
muat tanpa mengorbankan blok yang ada.

Dasarnya pengukuran 7 Okt 2026: strip ringkasan atas sudah **9 kolom** (standar
tata letak menyebut batas 5-7 per tingkat — sudah terlampaui), dan kartu area
terpakai **618 dari 628px** dengan daftar PALING MENDESAK hanya muat 1 SKU. ATP%
tidak bisa sekadar "ditambahkan" ke ruang 10px sisa.

Rasio gambar yang dikirim ke grup WhatsApp berubah — itu konsekuensi yang
diterima user dengan sadar.

## 7. Pembagian tempat — apa muncul di mana (ditegaskan user 8 Okt 2026)

Poster WA **hanya menampilkan persentase**. Menu checklist TIDAK ikut ke poster.

| tempat | isi |
|---|---|
| `/api/public/wa/svg` (poster, dikirim bot) | **hanya ATP%** — keseluruhan + per cabang. Tanpa daftar SKU, tanpa checklist. |
| `/atp` (halaman, perlu login) | tabel SKU x cabang, centang sebaran, filter brand, unduh Excel |

Alasannya bukan sekadar permintaan: poster itu **gambar** yang dikirim ke grup
WhatsApp. Ia tidak bisa diklik, tidak bisa disimpan, dan 375 SKU x 6 kolom
centang mustahil terbaca di sana. Checklist adalah alat kerja yang butuh klik dan
penyimpanan — tempatnya di halaman, bukan di gambar.

Konsekuensi untuk kanvas: tambahan tingginya hanya perlu memuat ATP% per cabang,
bukan tabel. Terlaksana sebagai 1000px — rinciannya di §8.

## 8. Keputusan yang saya ambil sendiri (8 Okt 2026) — silakan dikoreksi

Empat hal yang sebelumnya terbuka. Dikerjakan dengan pilihan di bawah supaya
tidak menunggu; semuanya bisa diubah tanpa membongkar yang lain.

**Excel: tiga lembar.** `Ringkasan` (persen per cabang), `Sebaran` (matriks
SKU x cabang), `Stok` (bentuk panjang, satu baris per SKU per cabang).
Alasannya matriks dan bentuk panjang menjawab dua pertanyaan berbeda dan
bentuknya bertentangan — matriks enak dibaca tapi tidak bisa di-pivot, bentuk
panjang bisa di-pivot tapi 2.250 baris tidak enak dibaca. Lembar `Sebaran` dan
`Stok` **ikut filter brand & pencarian**; lembar `Ringkasan` **selalu seluruh
produk**, dan filternya ditulis sebagai catatan di dalam tiap lembar. Berkas ini
beredar lewat WhatsApp tanpa URL-nya, jadi "ATP 71%" harus menyebut sendiri
cakupannya.

**Riwayat harian: tabel `atp_daily` sendiri**, bukan `stock_daily`. Yang direkam
adalah hasil KEPUTUSAN pada ambang yang berlaku hari itu. Menghitung ulang dari
`stock_daily` nanti akan memakai ambang yang berlaku SEKARANG, jadi mengubah
ambang dari 5 akan menulis ulang sejarah secara diam-diam. Kolom `ambang` ikut
direkam karena itu.

**Isi massal: per cabang, dibatasi filter halaman.** Tombol per kolom cabang
("Semua disebar / Semua tidak / Kosongkan") berlaku pada baris yang lolos filter
brand + pencarian + "belum diputuskan", dan jumlahnya ditulis sebelum diklik.
SENGAJA tidak mengklaim "semua yang tampil": tabelnya punya filter kolom sendiri
yang halaman ini tidak tahu hasilnya. Impor CSV belum dibuat — kalau "semua
brand Hanasui ke 5 cabang" ternyata masih terlalu kasar, itu langkah berikutnya.

**Kanvas poster: 1000px** (dari 900). Yang dibayar kenaikan ini, dan diuji di
`wa-poster.test.ts`:

| | kanvas 900 (sebelum) | kanvas 1000 (sesudah) |
|---|---|---|
| tinggi kartu area | 628 | 728 |
| blok angka | 3 baris kotak (226px) | **4 baris kotak (272px)** — ATP + pembaginya |
| jarak baris status | 16px | **20px** (yang paling longgar) |
| daftar mendesak | 1 baris | 1 baris (tidak memendek) |

Jadi ATP masuk DAN jarak barisnya justru melonggar. Di kanvas 900, blok angka 4
baris memaksa jarak baris turun lagi — mundur dari perbaikan 7 Okt 2026. Itulah
pembenaran angkanya, bukan selera.

Kotak ATP menampilkan **persen DAN pembaginya** bersebelahan ("ATP" dan
"Siap / disebar"). ATP lama menampilkan persen sendirian, dan 68,6% Yogyakarta
tidak bisa ditelusuri siapa pun sampai ada yang memeriksa EOMMA.

## 9. Masih terbuka

- Impor CSV untuk checklist, kalau isi massal per cabang masih terlalu kasar.
- `/api/cron/atp` belum masuk `vercel.json`. Paket Hobby membatasi jumlah cron
  dan `vercel.json` sudah punya dua; menambah yang ketiga bisa membuat DEPLOY
  gagal — dan itu memadamkan seluruh aplikasi, bukan cuma ATP. Barisnya:
  `{ "path": "/api/cron/atp", "schedule": "45 0 * * *" }`. Sengaja tidak saya
  pasang sendiri.
- 27 SKU masih perlu brand manual (angka terbaru 348 dari 374 — lihat §3).

## 10. Yang sudah ada di repo (8 Okt 2026)

Semuanya **tambahan**; tidak ada tabel, kolom, atau berkas DOI Monitor yang
diubah artinya. `prisma/schema.prisma` tidak disentuh di tahap ini, jadi
**`db:push` tidak perlu dijalankan lagi** untuk bagian ini.

| berkas | isi |
|---|---|
| `src/lib/atp.ts` | aturan MURNI: kelayakan, pembagi, persen, peta brand (24 tes) |
| `src/lib/atp-store.ts` | baca/tulis `atp_share`, `sku_brand`, `atp_daily`; `muatAtp()`, `persenAtpPerArea()` |
| `src/lib/kelayakan-atp.test.ts` | penjaga: penyaring `category='Sku'` di berkas ATP wajib membuang bundle |
| `src/app/api/atp/route.ts` | GET bahan halaman · POST simpan sebaran · PUT brand manual · PATCH rekam harian |
| `src/app/api/atp/export/route.ts` | unduh XLSX tiga lembar |
| `src/app/api/cron/atp/route.ts` | rekam `atp_daily` (butuh `CRON_SECRET`); belum di `vercel.json` |
| `src/app/atp/page.tsx` | halaman checklist SKU x cabang + isi borongan + filter + unduh |
| `src/lib/xlsx.ts` | `writeWorkbook()` untuk banyak lembar; `writeSheet()` lama tidak diubah |
| `src/lib/wa-poster.ts` | `KANVAS.h` 900 → 1000, `KARTU` + `tinggiKartuTersedia()`, blok angka 4 baris |
| `src/app/wa/poster.tsx` | kotak ATP + pembaginya; geometri kartu dari satu sumber |
| `src/app/api/public/wa/route.ts` | kirim `atp` per area; gagalnya ATP tidak memadamkan poster |
| `scripts/check-push.ts` | bandingkan tabel hidup vs `@@map` sebelum `db:push` |
| `scripts/sync-brand.ts` | tarik brand dari OCS; isi manual dilindungi |

Satu hal yang belum bisa saya periksa sendiri: **tampilannya**. Saya tidak bisa
menjalankan `next build` maupun merender SVG di lingkungan ini. Tinggi kartu dan
luberan sudah diuji secara angka (`wa-poster.test.ts`), tapi apakah "ATP" dan
"Siap / disebar" enak dibaca di kotaknya hanya bisa dilihat dengan mata.
