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

## 11. Poster & refresh — perubahan 8 Okt 2026 (sore)

**ATP pindah ke slot kanan, sebelah angka DOI besar** (permintaan user). Slot itu
milik OPSI 2; karena `doi_display` sekarang `OPSI1`, slot itu kosong. Kalau nanti
diubah ke `BOTH`, OPSI 2 tetap memegang slot besar dan ATP turun jadi baris kecil
di jeda 26px yang sudah ada — ATP TIDAK menggantikan angka DOI kedua, karena itu
menghilangkan angka yang memang diminta tampil.

**Kotak "ATP" dan "Siap / disebar" diganti** jadi `Available >5 pcs` (300 / 349)
dan `Stok kosong` (20 SKU). Pembaginya `a.sku` — angka yang SUDAH tertulis di
"SEBARAN STATUS" pada kartu yang sama, jadi pembaca bisa memeriksanya sendiri.

Yang ditolak: memakai `isActive` OCS (356 cabang / 375 Pusat) sebagai "SKU aktif".
Poster sudah menyebut dua angka SKU — strip atas dan sebaran status — dan angka
ketiga yang berbeda tanpa penjelasan hanya membuat orang bertanya mana yang benar.
`available + kosong` sekarang selalu bisa dijumlahkan terhadap angka yang terlihat.

**Ambang hari disejajarkan satu kolom.** Dulu "Kritis ≤4D" satu string, jadi ≤4D /
≤5D / ≤7D berdiri di tiga tempat berbeda mengikuti panjang namanya — padahal
justru angka itu yang dibandingkan antar baris. Sekarang `labelPitaPisah()`
memisah nama dan ambang, `tataLabelStatus()` menaruh ambangnya di satu x.

Kolomnya dihitung dari nama terpanjang yang PUNYA ambang saja ("Kritis"), bukan
dari sepuluh label — kalau ikut "Belum Terjual" (80px), ambangnya terdorong jauh
ke kanan dan "Kritis" menggantung dengan jurang di tengahnya. Saat ruang mentok,
yang dipertahankan utuh adalah ambangnya: angka terpotong membalik arti ("≤14D"
jadi "≤1D"), nama terpotong hanya kurang enak dibaca.

**Refresh menarik SIT lebih dulu, di permintaannya sendiri.** Sebelumnya transit
ditarik DI DALAM `/api/compute` dan cuma kebagian sisa anggaran:

| | sebelum | sesudah |
|---|---|---|
| anggaran transit | ±17 dtk sisa dari 52 dtk | 50 dtk, permintaan sendiri |
| dokumen per klik | ±6 dari 23 | 23 (±30 dtk) |
| klik sampai SIT lengkap | 4 | 1 |

Tombol Refresh sekarang: `POST /api/transit/sync?force=1` → lalu
`POST /api/compute { skipTransit: true }`. Flag itu wajib — tanpa dia transit
ditarik dua kali, dan anggaran yang terpakai untuk pekerjaan yang sudah selesai
diambil dari jatah menghitung 6 area, sehingga area terakhir DILEWATI.

Kalau penarikan SIT gagal, `skipTransit` dikirim `false` supaya `/api/compute`
tetap mencoba sendiri — transit itu pelengkap, lebih baik DOI terhitung dengan
SIT kemarin daripada tidak terhitung. Hasilnya dilaporkan apa adanya di toast,
tidak dilebur jadi "ada langkah yang gagal".

Batas tunggu Refresh naik 70 → 140 dtk. Dua permintaan berurutan yang
masing-masing boleh memakai hampir satu batas fungsi Vercel tidak muat di 70 dtk,
dan yang dibatalkan justru permintaan KEDUA — jadi SIT-nya baru, snapshot-nya tidak.

## 12. Penyesuaian poster lanjutan (8 Okt 2026, sore — putaran kedua)

Urutan kotak dikunci user:

| kiri | kanan |
|---|---|
| Nilai stok | Nilai + Nilai SIT |
| Stok | **SIT** (dulu "Dalam perjalanan") |
| **Aktual DOI + SIT** | ADS |
| Perlu open PO | Available >5 pcs |

"Stok kosong" dihapus. Pasangan per baris tetap satu satuan: rupiah dengan
rupiah, pcs dengan pcs, hari dengan per-hari, SKU dengan SKU.

**Aktual DOI + SIT** = `(stok + SIT) ÷ ADS`, dihitung di server dari ringkasan
yang SAMA dengan `doi1` — keduanya sudah mengeluarkan SKU EXCLUDED, jadi selisih
kedua angka itu murni SIT, bukan akibat cakupan baris yang berbeda. `null` saat
ADS 0, bukan 0 hari. Pusat 8 Okt 2026: (216.752 + 62.024) ÷ 31.725 = **8,8 hari**
berbanding DOI 6,8 hari. Angka DOI besar di kepala kartu tetap TANPA SIT.

**ATP sebesar DOI (38px, tebal), dengan penyusutan otomatis.** Terukur, di kartu
ber-isi 262px ukuran penuh menabrak pada kasus nyata:

```
"105,3 hari" 153px + "71,0%"  118px = 271px   (lewat 8px)
"48,1 hari"  129px + "100,0%" 141px = 271px   (lewat 8px)
```

`ukuranAtpMuat()` memilih ukuran terbesar dari [38, 34, 30, 26, 22] yang muat.

SATU ukuran untuk SELURUH poster, bukan per kartu. Kalau tiap kartu menyusut
sendiri, Makassar bisa ber-ATP 30px sementara Pusat 38px di gambar yang sama, dan
beda ukuran itu terbaca seolah punya arti padahal cuma akibat panjang angka DOI.
Terverifikasi dengan merender posternya betulan (React + react-dom/server) lalu
mengukur SVG-nya:

| | ukuran ATP | jarak terdekat ke angka DOI |
|---|---|---|
| angka seperti sekarang | 38px di kelima kartu | 15,2px |
| DOI 103 hari + ATP 100,0% | 26px di kelima kartu | 12,8px |

`KARTU.pad` jadi satu sumber; sebelumnya 16 ditulis dua kali (di `KartuArea` dan
di penghitung ukuran ATP), dan dua tempat untuk satu angka adalah cara tata letak
diam-diam melenceng.

## 13. ATP diperluas ke tiga kategori (8 Okt 2026, sore — putaran ketiga)

**Keputusan user: ATP = Sku + Bundle + Gimmick. DOI tetap SKU saja.**

### Tidak perlu tabel ATP sendiri

User menanyakan apakah ATP butuh data sendiri agar tidak merusak DOI. Tidak.
Pemisahannya sudah ada, dan letaknya sudah benar:

- `syncStock` menulis **seluruh** baris OCS ke `stock_current` tanpa menyaring
  kategori, dan menghapus baris yang hilang dari sumber.
- Penyaring `category = 'Sku'` dipasang **saat membaca**, di 7 tempat milik DOI:
  `compute.ts:45`, `compute.ts:317`, `query.ts:394`, `sync.ts:470`,
  `api/sku-master` (×2), `api/transit`.
- ATP membaca lewat `muatStokAtp()` yang tidak menyaring kategori di SQL sama
  sekali; `kelayakan()` yang memutuskan.

Jadi yang berubah hanya `kelayakan()`. Tujuh penyaring DOI tidak disentuh.
**Tabel ATP sendiri justru lebih berbahaya**: salinan kedua stok OCS, sinkronisasi
kedua, dan dua salinan yang akan melenceng — persis yang ingin dihindari.

Efek sampingnya: SKU baru kategori apa pun **otomatis masuk ATP** begitu Refresh
jalan. Tidak ada daftar yang dipelihara tangan.

### Kenapa ini membalik keputusan sebelumnya

Pagi hari saya menyimpulkan bundle harus di luar karena menghitungnya akan
menghitung barang fisik berkali-kali. **Alasan itu lemah dan saya cabut**: ATP
mencacah JUMLAH SKU di atas ambang, bukan menjumlahkan qty. Pencacahan SKU tidak
rusak oleh stok turunan. Dan bundle memang bisa dipesan pembeli — itu arti
harfiah "available to promise".

Yang tetap berlaku sebagai peringatan, terukur 8 Okt 2026 di Pusat:

| | baris aktif punya stok | tanpa lokasi rak & bulk |
|---|---|---|
| Sku | 306 | 0 |
| Gimmick | 47 | 0 |
| **Bundle** | 975 | **975 (100%)** |

User mengonfirmasi 8 Okt 2026: yang ia maksud "turunan" memang **Bundle**, bukan
Gimmick — dan ia tetap ingin bundle ikut dihitung seluruhnya, bukan hanya SKU
asalnya. Jadi sifat turunan itu BUKAN alasan mengeluarkannya; ia hanya alasan
menyediakan `perKategori` supaya pergerakan angkanya bisa ditelusuri.

Stok bundle TURUNAN — tidak menempati lokasi fisik mana pun. Satu komponen habis
menjatuhkan puluhan bundle sekaligus, jadi ATP% akan bergerak lebih tajam. Itu
keadaan sebenarnya, bukan cacat hitungan. `perKategori` di `HasilArea` ada supaya
pergerakan itu bisa ditelusuri sumbernya.

### Brand bundle dari kode SKU

`DTO_LookupStockDetailedData` memuat **NOL bundle** (cakupan 0,0% dari 1.215
bundle aktif). Tanpa penanganan, 1.215 dari 1.662 baris checklist (73%) tidak
punya brand — dan filter brand adalah satu-satunya mekanisme isi borongan.
Pekerjaannya jadi 6.075 keputusan satu per satu.

`brandDariKode()` membaca `BDL-<BRAND>-`. Diukur: **1.215 dari 1.215 cocok, 0
gagal**; HANASUI 924 · NCO 216 · FYNE 49 · EOMMA 26.

Ini TIDAK melanggar aturan user "jangan ambil brand dari nama". Yang dilarang
adalah menerka dari medan `Name` — teks bebas yang bentuknya tidak dijamin. Ini
medan berbeda: kode SKU, tetap dari OCS, bentuknya baku, dan kebenarannya bisa
dihitung. Lookup OCS tetap menang kalau keduanya ada; asalnya dicatat
`"kode BDL-"` supaya bisa ditinjau ulang.

Gimmick sengaja TIDAK ikut pola ini: `GIMMICK-<X>-` cocok 68 dari 68, tapi X
sering bukan brand (TAS, TUMBLER, VOUCHER, STICKER, CATOKAN) — hanya 51 dari 68
yang brand asli. 48 dapat brand dari lookup; 20 sisanya diisi tangan.

### Pilihan aktif / non-aktif di /atp

Tiga pilihan: Aktif saja (bawaan) · Non-aktif saja · Aktif + non-aktif. Nilai
asing di URL jatuh ke `AKTIF`, bukan `SEMUA` — salah ketik tidak boleh diam-diam
melebarkan daftar.

**Persennya SELALU dihitung dari yang aktif, apa pun saringan tampilannya.**
Kalau ikut, menggeser filter ke "Non-aktif" mengubah ATP% jadi angka tentang
barang yang justru TIDAK bisa dijanjikan, tanpa apa pun di layar yang memberi
tahu artinya sudah berganti. Filter mengubah apa yang DILIHAT, bukan yang
DIUKUR. Halaman menampilkan peringatan saat filternya bukan "Aktif".

Penyaringannya per BARIS (sku × area), bukan per SKU: satu SKU bisa aktif di satu
area dan nonaktif di area lain.

### Angka nyata OCS, 8 Okt 2026

Pembagi ATP naik dari 375 jadi 1.657 (Pusat). Kotak "Available" di poster ikut
kumpulan ATP (keputusan user), jadi pembaginya tidak lagi sama dengan
"SEBARAN STATUS · 349 SKU" di kartu yang sama — disadari dan diterima.

| area | layak | available >5 | % | Sku | Bundle | Gimmick |
|---|---|---|---|---|---|---|
| Pusat | 1.657 | 1.126 | 68,0% | 278/375 | 811/1.215 | 37/67 |
| Medan | 1.560 | 1.093 | 70,1% | 293/356 | 798/1.163 | 2/41 |
| Makassar | 1.560 | 1.077 | 69,0% | 292/356 | 782/1.163 | 3/41 |
| Surabaya | 1.560 | 1.102 | 70,6% | 293/356 | 802/1.163 | 7/41 |
| Yogyakarta | 1.560 | 1.093 | 70,1% | 294/356 | 796/1.163 | 3/41 |

Gimmick di cabang hampir seluruhnya kosong (2–7 dari 41); hanya Pusat yang
terisi (37 dari 67). Itu bukan cacat data — gimmick memang ditahan di Pusat.

## 14. Brand: pola kode diperluas + kode menang atas prioritas (8 Okt 2026, malam)

Dua keputusan user setelah menjalankan `sync:brand` yang pertama (hasilnya:
cakupan naik 92,8% → **97,2%**, 2.606 baris ditulis, 46 SKU tersisa).

### Pola kode berlaku untuk semua awalan, bukan hanya `BDL-`

`brandDariKode()` memeriksa **dua segmen pertama** kode SKU. Brand bisa ada di
segmen 1 (`NCO-EDP-AMETHYST`) atau segmen 2 (`CS-HANASUI-…`, `BDL-HANASUI-…`,
`GIMMICK-NCO-…`). Segmen ke-3 dan seterusnya sengaja TIDAK diperiksa:
`GIMMICK-VOUCHER-KLIKNCLEAN-EOMMA` memuat EOMMA di ujung, tapi itu voucher UNTUK
EOMMA — memperluas pencarian ke seluruh kode mengubah aturan ini jadi menebak.

Penjaganya tetap sama dan itu yang membuatnya bukan terkaan: segmen hanya
diterima kalau **persis salah satu dari empat brand yang dikenal**.

Hasil terhadap 46 SKU nyata: **30 dapat brand, 16 tetap manual** — dan 16 itu
tepat yang kodenya memang tidak menyebut brand (`CS-MUD-MASK-JAPANESE`,
`GIMMICK-TAS-PUFFY-PINK`, `GIMMICK-TUMBLER-OAWALA`, `GIMMICK-MATTEDORABLE-*`).

### Kode SKU menang atas urutan prioritas pada bentrokan

Terbaca dari hasil nyata: **11 parfum `NCO-EDP-*`** terdaftar di toko Hanasui DAN
NCO, lalu urutan prioritas melabelinya **Hanasui** — padahal kodenya sendiri
menyebut NCO. Akibatnya siapa pun yang mengisi borongan dengan filter brand
"NCO" melewatkan sebelas parfum NCO tanpa tahu.

Aturan baru: kalau kode SKU menyebut brand yang **termasuk kandidat bentrokan**,
itu yang menang. Syarat "harus kandidat" penting — kalau kode menyebut brand yang
TIDAK OCS daftarkan untuk SKU itu, yang meragukan adalah kodenya, bukan datanya,
jadi urutan prioritas yang dipakai. Lima bentrokan sisanya (`BBS-*`,
`BALMTINT-SASSY-3`) kodenya tidak menyebut brand, jadi tetap diputus prioritas.

`bentrok[].dariKode` menandai mana yang diputus kode, dan `sync:brand`
mencetaknya terpisah — dua aturan berbeda tidak boleh terlihat sama.

### Dua bug yang ditangkap tes saya sendiri

Keduanya ada di `brandDariKode` dan keduanya lolos dari pembacaan mata:

1. Regex awal hanya melihat segmen **kedua**, jadi `NCO-EDP-AMETHYST` terbaca
   "EDP" dan jatuh kembali ke Hanasui — persis bug yang hendak diperbaiki.
2. `"- BDL-HANASUI-…"` membuat segmen pertama **kosong** sehingga brand tergeser
   ke indeks 2 dan tidak terbaca. Perlu DUA pembersihan berbeda: awalan di depan
   kode (`"- "`) dibuang sebelum dipotong, awalan di dalam segmen (`"90 "`)
   dibersihkan per segmen.

### `sync:brand` ditulis berkelompok

Dulu satu `upsert` per SKU. Dengan 586 SKU masih tertahankan; begitu bundle ikut
jumlahnya jadi **2.607** dan skripnya duduk 4–13 menit **tanpa satu baris
keluaran** — user wajar mengira macet, dan memang melaporkannya.

Sekarang `INSERT … ON DUPLICATE KEY UPDATE` per 400 baris: **7 bolak-balik, bukan
2.607**, dengan kemajuan dicetak per kelompok. Ukuran kelompoknya sama dengan
`BATCH` di sync.ts.

## 15. Poster masuk sidebar — TANPA token di kode (8 Okt 2026)

User meminta poster WhatsApp jadi menu sidebar, dan menempelkan URL lengkapnya
berikut `?k=<WA_PAGE_TOKEN>`. URL itu **tidak** dipasang apa adanya.

**Kenapa.** Menu sidebar dirender di klien. Menuliskan URL ber-token di
`Shell.tsx` menyalin tokennya ke bundel JavaScript yang diunduh SETIAP pengguna
— termasuk peran "Lihat saja" — dan siapa pun yang membuka source bisa
membacanya lalu memakainya dari luar tanpa login. Token yang ada di dalam bundel
klien bukan token lagi. Ia juga jadi sulit dirotasi: mengganti token berarti
deploy ulang, bukan mengubah environment variable.

**Yang dipakai.** `src/lib/wa-akses.ts` — dua jalan masuk, aturannya satu tempat:

1. `?k=<WA_PAGE_TOKEN>` untuk **bot** (berjalan di server lain, tidak punya sesi)
2. **sesi login yang sah** untuk **orang** (ia sudah melihat angka yang sama di
   Dashboard, jadi tidak ada data baru yang terbuka)

Dipakai `/api/public/wa` dan `/api/public/wa/svg`. Menu sidebar cukup menunjuk
`/wa` tanpa parameter apa pun; tokennya tetap hanya dipegang bot.

Jebakan yang ikut diperbaiki: `/api/public/wa/svg` memanggil `/api/public/wa` di
dalam dirinya. Tanpa meneruskan **cookie** pemanggil, pengguna yang masuk lewat
menu akan lolos di pemeriksaan luar lalu ditolak 401 oleh panggilan dalam — gagal
di tempat yang tidak ada hubungannya dengan sebabnya.

**Dibuka di tab baru.** `/wa` sengaja dirender tanpa shell (`bare` di Shell.tsx)
supaya bot menangkap layar bersih tanpa sidebar ikut terfoto. Kalau menunya
membuka di tab yang sama, orang yang mengkliknya kehilangan menu dan hanya bisa
kembali lewat tombol Back. Jadi `Item.blank` ditambahkan: `target="_blank"` +
`rel="noopener noreferrer"`, dan tautan tab-baru tidak pernah ditandai "aktif".

**Penjaga.** `src/lib/rahasia.test.ts` menggagalkan `npm test` kalau ada
`?k=<nilai>` tertulis mati, URL database bersandi, atau `Bearer <token>` di
`src/` maupun `scripts/`. Perakitan dari variabel (`?k=${kunci}`) tetap lolos.
Penjaganya punya tes sendiri yang membuktikan ia menangkap bentuk terlarang —
tanpa itu, regex yang salah akan lolos diam-diam dan penjaganya jadi hiasan.

## 16. Ubah massal: pilihan baris + bolak-balik Excel (8 Okt 2026)

### Pilih baris lalu ubah massal

Kolom centang di tabel `/atp`. Tombol borongan berlaku ke baris yang dicentang;
tanpa centang sama sekali, berlaku ke semua yang lolos filter (perilaku lama).
Ditambah baris **Semua cabang** supaya 20 SKU x 5 cabang jadi satu klik.

Aturan keamanannya ada di `lingkupBorongan()` — MURNI dan diuji, karena inilah
bagian yang bisa merusak paling banyak:

- **Pilihan dipotong dengan filter.** Mencentang 20 SKU lalu mengganti filter
  brand hanya mengubah yang masih lolos filter. Tanpa ini, borongan mengubah
  baris yang sudah tidak terlihat di layar — cara kerusakan senyap terjadi.
  Selisihnya ditulis di panel ("3 dari pilihan Anda tidak lolos filter sekarang").
- **Jumlah KEPUTUSAN disebut terpisah dari jumlah SKU.** Untuk "semua cabang"
  keduanya berbeda jauh (20 SKU = 100 keputusan), dan angka besar itulah yang
  sebenarnya tersimpan — jadi itu yang muncul di konfirmasi.
- Centang dikosongkan setelah Simpan: pilihan lama yang tertinggal adalah jebakan
  untuk borongan berikutnya.

### Bolak-balik Excel

Unduh → atur di Excel → unggah. `POST /api/atp/import` (pratinjau) lalu
`?terap=1` (menulis). **Pratinjau tidak bisa dilewati tanpa sengaja**, dan itu
disengaja: di lembar unduhan sel kosong berarti "belum diputuskan", jadi supaya
bolak-baliknya setia, sel kosong saat diunggah berarti "kosongkan keputusannya"
— satu berkas keliru bisa menghapus ribuan keputusan sekaligus.

Pengamannya dua lapis: `abaikanKosong` (menyala secara bawaan) untuk berkas yang
memang diisi sebagian, dan ringkasan wajib dibaca sebelum menulis, dengan angka
"Dikosongkan" diberi warna bahaya kalau bukan nol.

Yang dilaporkan, bukan ditelan: SKU tidak dikenal, isi sel yang tidak dikenali
("mungkin", "cek dulu" — BUKAN dianggap kosong), dan kolom yang bukan nama
cabang. Baris yang sudah sama dengan keadaan sekarang tidak ditulis ulang —
mengunggah berkas yang baru diunduh tanpa diedit menghasilkan "tidak ada yang
berubah", bukan 8.000 baris tertulis.

### Dua bug yang hanya ketahuan dari uji bolak-balik NYATA

Tes unit memakai baris sintetis dengan header di baris 1, jadi keduanya lolos:

1. **Berkas hasil unduhan tidak bisa dibaca kembali.** `readSheet` menganggap
   baris 1 sebagai header, padahal lembar ekspor kita menaruh catatan di atasnya
   — baris catatan terbaca sebagai nama kolom dan seluruh isinya jadi omong
   kosong tanpa satu pun galat. Diperbaiki dengan `cariKolom: 'SKU'`.
2. **Nomor baris di laporan masalah salah.** Dengan 3 baris catatan, SKU
   bermasalah di baris 7 dilaporkan "baris 4" — user memeriksa baris yang salah
   lalu menyimpulkan laporannya ngawur. `readSheetRinci()` sekarang
   mengembalikan nomor baris header, dan `susunImpor` menerima `barisPertama`.

Pelajarannya sama dengan jebakan `category` di §5: menulis komentar "harus
menunjuk baris yang user lihat" tidak membuatnya benar. Yang membuktikannya cuma
menjalankan alurnya dari ujung ke ujung dengan berkas sungguhan.

## 17. Pemeriksaan sebelum go-live (8 Okt 2026)

### Penghalang yang ditemukan dan diperbaiki

**`simpanSebaran` menulis satu per satu.** Baik-baik saja untuk beberapa klik
manual, MEMATIKAN untuk dua jalur yang baru dibuat: impor Excel dan borongan
"semua cabang" sama-sama bisa mengirim 1.658 SKU x 5 cabang = **±8.290
keputusan** sekaligus. Pada ±100 md per bolak-balik itu ±14 menit, sementara
fungsi Vercel dibunuh di detik ke-60 — penulisan separuh jalan, tanpa laporan,
dan tidak ada yang tahu bagian mana yang sudah masuk.

Sekarang berkelompok 400: **21 pernyataan, bukan 8.290**. INSERT … ON DUPLICATE
KEY UPDATE untuk yang ditulis, `DELETE … WHERE (sku, areaId) IN (…)` untuk yang
dikosongkan. Satu kelompok gagal tidak menggagalkan sisanya, dan seluruh isinya
dilaporkan.

Ini kesalahan yang SAMA dengan `sync:brand` beberapa jam sebelumnya, di tempat
berbeda. Pelajarannya: setiap kali sebuah jalur baru bisa mengirim ribuan baris,
periksa penulisnya — bukan hanya pembacanya.

**`maxDuration = 120` bohong.** Tiga route ATP menuliskannya; Hobby tetap
membunuh di detik ke-60. Diturunkan ke 60 dengan komentar, supaya tidak ada yang
mengira punya waktu yang tidak ada.

`dihapus` sekarang menghitung baris yang BENAR-BENAR terhapus (hasil DELETE),
bukan yang diminta: mengosongkan keputusan yang memang belum ada tidak mengubah
apa pun, dan melaporkannya sebagai "dikosongkan" membuat angkanya mengarang.

### Yang TIDAK bisa saya buktikan sendiri

- `npm run build` / `npm run typecheck` — tidak bisa dijalankan dari sini.
  Seluruh perubahan halaman (`/atp` +239 baris) belum pernah dikompilasi.
- Tampilan `/atp` dan `/wa` belum pernah dibuka di peramban.
- Impor Excel belum pernah dijalankan melawan database sungguhan.

## 18. Sel "—" di halaman ATP — bukan bug, tapi UI-nya kurang (8 Okt 2026)

User bertanya kenapa banyak sel area bergaris. Jawabannya: **SKU itu NONAKTIF di
cabang tersebut menurut OCS**, dan halaman sedang disaring "Aktif saja".
Dibuktikan dari dua sisi:

| SKU | Pusat | 4 cabang |
|---|---|---|
| `ACNE-DAY-CREAM` | aktif | NONAKTIF |
| `BDL-EOMMA-0000000001` | aktif | NONAKTIF |
| `GIMMICK-TAS-GENTLE-WOMEN` | NONAKTIF | aktif |

**98 SKU** bergaris di keempat cabang (19 Sku + 52 Bundle + 27 Gimmick), dan
himpunannya IDENTIK di keempat cabang — konsisten dengan temuan §1 bahwa keempat
cabang punya daftar SKU aktif yang sama persis. Satu SKU bergaris di Pusat.

Jadi barisnya ADA di OCS, hanya `IsActive = false`. Mengganti filter ke
"Aktif + non-aktif" membuatnya muncul.

**Yang diperbaiki:** sel kosong sekarang menjelaskan dirinya sendiri. `MuatAtp`
mengisi `sku[].lain` — area yang barisnya ada tapi tersaring keluar, berikut
statusnya — sehingga sel menulis **"nonaktif"** (bukan "—") dengan tooltip yang
menyebut cabangnya dan cara melihatnya.

Pelajaran: "—" polos membuat orang mengira keputusannya belum diisi, padahal
artinya SKU itu memang tidak dijual di cabang itu. Dua hal yang butuh tindakan
sama sekali berbeda, ditulis dengan lambang yang sama. Pertanyaan user adalah
buktinya — kalau layar harus dijelaskan lewat percakapan, layarnya yang kurang.

## 19. Centang per cabang + pembagi Available diperbaiki (8 Okt 2026)

### Ubah massal: SATU lingkup, yaitu filter yang aktif

```
Semua cabang  [Semua disebar] [Semua tidak] [Kosongkan]
Makassar      [Semua disebar] [Semua tidak] [Kosongkan]
…
```

**Kolom centang DIBUANG.** Sempat ada, dan diam-diam MENANG atas filter kalau
ada isinya. User menolaknya dan benar: tombol yang artinya berubah tergantung
keadaan layar adalah tombol yang tidak bisa dipercaya — orang menekan
"Semua tidak" sambil mengira lingkupnya yang ia lihat, padahal masih ada
centang dari pekerjaan sebelumnya.

Cara mengubah sebagian sekarang hanya satu: **persempit filternya** (brand,
kategori, pencarian, status), lalu tekan tombolnya. Yang terlihat di layar
itulah yang berubah.

`lingkupBorongan(baris, areaKena)` tinggal dua parameter, dan satu tes mengunci
jumlah parameternya — kalau suatu saat ada yang menambahkan "terpilih" lagi,
tes itu yang pertama memberi tahu.

Dua ronde salah baca sebelum ini mendarat: user menulis "centang semua /
batalkan centang" yang saya kira tombol pemilih baris, padahal yang ia maksud
adalah MENCENTANG SELURUH KOLOM CABANG — yaitu "Semua disebar" dan "Kosongkan"
yang sudah ada. Pelajaran: kalau permintaan menyebut nama tombol yang sudah ada
dengan kata lain, tanyakan dulu, jangan bangun yang baru.

### Pembagi "Available >5 pcs" = SKU yang dicentang

Dulu pembaginya seluruh SKU layak ATP, lepas dari checklist. User menemukan
akibatnya: Pusat menampilkan **1.158 / 1.663 = 69,6%** di kotak Available
sementara ATP di kartu yang SAMA menghitung **1.158 / 1.659 = 69,8%**. Dua angka
yang terlihat seharusnya cocok, beda tipis, tanpa apa pun yang menjelaskan.

Sekarang `stok` diturunkan dari `hasil` yang sama dengan ATP% (`siap` /
`dihitung`), jadi keduanya TIDAK BISA berbeda lagi. Kotak Available kini
menampilkan angka mentah di balik persen ATP.

Keadaan checklist saat ini (diukur 8 Okt 2026 dari API hidup): **Pusat sudah
terisi** (dihitung 1.659, takDisebar 4, belum 0); empat cabang lain masih kosong
(belum 1.566). Konsekuensi yang disengaja: cabang yang belum diisi menampilkan
**0 / 0** dan **"—"**. Itu jujur — belum ada yang diputuskan, jadi belum ada yang
bisa dijanjikan.

## Perubahan 8 Okt 2026 (lanjutan) — stok bisa diurutkan, refresh aman, pengingat SKU baru

### 1. Kolom stok bisa diurutkan & ikut Excel

Masalahnya: angka stok memang sudah tampil di tiap sel cabang, tapi nilai
sort/filter kolom cabang adalah **teks keputusannya** (`Ya` / `Tidak` / `Belum`),
jadi tidak ada satu pun kolom yang bisa mengurutkan angka.

Ditambahkan di `/atp`:

| kolom | isi |
|---|---|
| `Stok total` | jumlah available seluruh cabang yang barisnya tampil |
| `Stok <cabang>` | available cabang itu, satu kolom per cabang (prio p3, bisa disembunyikan dari toolbar tabel) |

Keduanya `type: 'number'`, jadi filter kolom bisa dipakai angka — mis. `Stok
Pusat < 5` digabung sel `Ya` memunculkan janji yang tidak bisa dipenuhi.

Di Excel, lembar **Sebaran** sekarang memuat `Stok total` dan `Stok <cabang>`
**berdampingan** dengan kolom keputusannya: sebaran ditentukan di Excel, dan
menentukannya tanpa melihat stok cabang itu berarti menebak.

Kolom stok itu **keterangan, bukan masukan**. `susunImpor` melewatinya diam-diam
(bukan melaporkannya sebagai "kolom asing" — kolom asing adalah tanda berkasnya
salah, dan kolom ini kita sendiri yang menulis). `petaArea` diperiksa lebih dulu,
jadi cabang yang namanya kebetulan diawali "Stok" tetap terbaca sebagai cabang.
Lembar **Stok** (bentuk panjang) tidak berubah — ia sudah memuat qty sejak awal.

### 2. Refresh OCS TIDAK menghapus sebaran — dibuktikan, lalu dikunci

Pertanyaan user: "saat saya tarik ulang data ocs (refresh), semua perubahan saya
apakah akan hilang? perubahan hanya berlaku jika sku di delete, ada create baru,
dan perubahan quantity. untuk sebaran jangan sampai berubah."

Jawabannya **tidak hilang**, dan alasannya struktural — bukan kebetulan:

| tabel | apa yang dilakukan Refresh |
|---|---|
| `stock_current` | ditulis ulang; baris yang hilang dari OCS **dihapus** |
| `stock_daily` | baris hari ini ditimpa; hari lain tidak disentuh |
| `atp_share` (sebaran) | **tidak disentuh sama sekali** |

Jadi yang berubah persis tiga hal yang diminta user: SKU hilang dari OCS →
barisnya hilang dari tampilan; SKU baru → barisnya muncul; qty berubah → angkanya
berubah. Keputusan sebaran tetap, karena kuncinya `(sku, areaId)` di tabel
sendiri. Satu-satunya `DELETE FROM atp_share` ada di `simpanSebaran()`, dan itu
jalan hanya ketika **orang** menekan "Kosongkan" atau mengirim sel kosong lewat
Excel.

Catatan yang disengaja: SKU yang hilang dari OCS meninggalkan baris `atp_share`
yatim. Itu **tidak dibersihkan** — kalau SKU-nya kembali, keputusannya ikut
kembali, dan barisnya tidak merugikan apa pun karena tampilan selalu menjoin ke
`stock_current`.

Sifat ini dikunci di `src/lib/sebaran-aman.test.ts` (4 tes):

1. tidak ada penghapusan `atp_share` di luar `atp-store.ts`;
2. `src/lib/sync.ts` tidak menyebut `atp_share` sama sekali;
3. `deleteMany` di jalur sinkronisasi hanya mengenai `stockCurrent`;
4. `firstSeenAt` **tidak** ada di blok `ON DUPLICATE KEY UPDATE`.

Tes keempat menjaga poin berikutnya: tanpa itu, "terlihat sejak" akan jadi
tanggal hari ini untuk semua SKU setiap kali Refresh jalan.

### 3. Pengingat SKU baru yang belum diatur sebarannya

Definisinya: **SKU layak ATP yang belum punya SATU PUN keputusan sebaran di area
mana pun** (`skuBelumDiset()` di `src/lib/atp.ts`).

Sengaja BUKAN "firstSeenAt < N hari":

- SKU yang sudah lama ada tapi belum pernah diputuskan juga merusak angka ATP,
  dan tidak boleh hilang dari pengingat hanya karena sudah lama diabaikan;
- begitu diputuskan — **Ya maupun Tidak** — SKU-nya langsung berhenti muncul.
  Jadi daftarnya mengosongkan dirinya sendiri, dan tidak bisa jadi peringatan
  yang selalu menyala lalu diabaikan orang.

`firstSeenAt` tetap dibawa, tapi hanya untuk mengurutkan (terbaru di atas) dan
memberi tahu sejak kapan — bukan untuk menyaring.

Di layar: **modal** sekali per kunjungan (memuat 50 teratas: SKU, kategori,
cabang, terlihat sejak) dengan tombol "Atur sekarang" yang memfilter tabel ke
SKU tersebut; sesudah ditutup, **banner tetap ada** — ditutup bukan berarti
selesai. Penutupannya tidak disimpan: kalau disimpan, SKU baru berikutnya tidak
akan pernah terlihat lagi oleh orang yang pernah menutupnya sekali.

Kenapa harus menghalangi sekali: SKU yang belum diputuskan **tidak ikut pembagi
ATP**, jadi produk baru yang terlewat membuat ATP% terlihat bagus justru karena
barangnya tidak dihitung — kesalahan yang tidak menimbulkan gejala apa pun di
layar.

Daftarnya dihitung dari **seluruh** baris dengan saringan `'AKTIF'` tegas, bukan
dari baris yang tampil: kalau ikut filter tampilan, memasang filter apa pun akan
menyembunyikan pengingatnya.

### 4. Halaman baru: Rekap Harian (`/rekap`)

Permintaan user: "menu untuk menampilkan data stock dan penjualan harian, bisa
back date ke tanggal yang kita tentukan."

Sumbernya dua tabel yang kuncinya memuat TANGGAL — `stock_daily` dan
`sales_daily` — bukan `stock_current` (tabel itu memang "sekarang": ditimpa tiap
Refresh dan barisnya dihapus kalau SKU-nya hilang, jadi ia tidak punya masa
lalu). Keduanya ditulis `ON DUPLICATE KEY UPDATE`, jadi menarik ulang hari yang
sama memperbarui baris hari itu — bukan menambah baris, bukan menyentuh hari
lain.

`susunRekap()` menggabungkan keduanya dengan **gabungan luar DUA arah**: SKU
yang terjual hari itu tapi stoknya sudah nol dan barisnya hilang dari potret
akan lenyap kalau digabung dari sisi stok saja — padahal justru itu baris yang
paling ingin dilihat. `stok: null` (tidak ada di potret) dibedakan dari
`stok: 0` (tercatat kosong).

Baris KESELURUHAN menghitung **SKU unik lintas cabang**, bukan menjumlahkan
kolom per area: satu SKU di lima cabang bukan lima SKU, dan kesalahan itu tidak
pernah terlihat salah secara aritmetika.

Kotak "Terjual padahal kosong" menyorot hari yang **menurunkan ADS** dan
membuat DOI terlihat lebih aman daripada kenyataannya.

**Batas yang disebut di halamannya, bukan dibiarkan jadi selisih yang
membingungkan:** `stock_daily` hanya merekam `category = 'Sku'` (lihat
`syncStock`), sementara ATP menghitung Sku + Bundle + Gimmick. Jadi jumlah SKU
di `/rekap` lebih kecil daripada di `/atp`. Kalau Bundle & Gimmick mau ikut
punya riwayat harian, `WHERE category = 'Sku'` di `syncStock` perlu dibuang —
itu menaikkan `stock_daily` dari ±1.900 jadi ±8.300 baris per hari, dan **tidak
bisa dibuat ulang ke belakang**, jadi menunggu keputusan user.

### 5. Popup tembus pandang — satu nama token yang salah (9 Okt 2026)

Dilaporkan user: "pop up nya transparan?". Benar, dan sebabnya satu baris:

```tsx
style={{ background: 'var(--surface)' }}   // nama itu TIDAK ADA; yang benar --bg-surface
```

Yang membuatnya berbahaya bukan "warnanya tidak muncul". Custom property yang
tidak terdefinisi **tidak diabaikan** browser — ia jadi *invalid at
computed-value time*, yang berarti `unset`, dan untuk `background-color` itu
**transparent**. Jadi deklarasi itu bukan gagal diam-diam: ia MEMBATALKAN latar
yang sudah benar dari kelas `.card`. Hasilnya elemen yang kelihatan sengaja
transparan, bukan rusak — bentuk kesalahan yang tidak dicurigai saat kode dibaca
ulang.

Diperbaiki dengan memakai sheet milik aplikasi sendiri, bukan latar rakitan:
`.sheet-backdrop` / `.sheet` / `.sheet-head` / `.sheet-body` / `.sheet-foot` —
nama generik yang ditambahkan ke aturan `.wa-*` yang sudah ada (satu aturan
untuk keduanya; kalau disalin jadi dua blok, salah satunya akan tertinggal saat
yang lain diperbaiki). Dapat gratis: token yang benar, `--z-modal` yang benar,
`--overlay` yang ikut tema Morning/Evening, dan **di lebar 360px (PDT Zebra)
berubah jadi bottom sheet** — dialog di tengah terlalu sempit di sana.

Tes yang sama ikut menemukan kesalahan LAIN yang sudah lama ada: `--line`
dipakai di 6 tempat di `/atp` padahal tidak pernah didefinisikan, jadi
border-nya selama ini dirender sebagai `currentColor` — ikut warna teks tanpa
ada yang sadar. Semuanya diganti ke `--border`.

Penjaga: `src/lib/token-css.test.ts` — setiap `var(--nama)` tanpa fallback harus
menunjuk token yang benar-benar didefinisikan di `src`. `var(--nama, cadangan)`
dikecualikan, karena menulis cadangan berarti penulisnya memang tahu tokennya
bisa tidak ada.

## Turunan bundling di /atp (9 Okt 2026) — TAMPILAN saja

Permintaan user: setiap SKU bundling menampilkan produk turunannya berikut
status aktif/nonaktifnya, dan urutan kolom jadi `SKU, Turunan Bundling, Stock
Total, Makassar, Stock Makassar, …`. Ditegaskan user: **hanya menampilkan,
tidak sampai mengedit.**

### Sumber datanya — dibongkar, bukan ditebak

Sebelum ini TIDAK ADA satu pun sumber yang kita pegang yang tahu isi sebuah
bundle: `DTO_WmsItemStockLiteV2` tidak punya kolom parent/child,
`DTO_LookupStockDetailedData` hanya brand, `/Products/GetProductSkus` hanya
harga, dan `sku_link` itu kode SAP. User menunjuk halamannya
(`ocs.iegsystem.id/master/bundle`) dan endpoint di belakangnya dibongkar dari
browser 9 Okt 2026:

```
GET /MasterData/GetBundleStock      (BUKAN OData — array polos, tanpa paging)

[{ BundleSku, BundleName, TotalQty, TotalAvailableQty,
   Stocks: [{ AreaId, AvailableQty }],
   Items:  [{ SellerSku, SellerSkuQty, TotalAvailableQty,
              Stocks: [{ AreaId, AvailableQty }] }] }]
```

Yang TERUKUR saat itu, dan ikut membentuk desainnya:

| hal | angka |
|---|---|
| bundle | 2.029 |
| baris komponen | 6.040 |
| komponen per bundle | rata-rata 2,98 — **paling banyak 14**, paling sedikit 1 |
| bundle tanpa komponen | 0 |
| `SellerSkuQty` | 1 … 10 |
| area | persis 5 cabang kita |
| payload | 2,5 MB dalam 2,4 detik |
| prefiks | 2.028 `BDL-`, **1 `GIMMICK-`** |

Dua angka itu langsung jadi keputusan desain: **14 komponen** berarti kolomnya
tidak boleh memuat daftar komponen sebagai teks (baris rincian yang dibuka,
bukan sel), dan **1 baris berawalan GIMMICK** berarti daftar ini TIDAK boleh
disaring dengan `adalahBundle()` — satu baris akan hilang diam-diam.

### Yang disimpan: HANYA komposisinya

Tabel baru `bundle_item` (bundleSku, itemSku, qty, name) — 6.040 baris.
`Items[].Stocks` dan `TotalAvailableQty` **sengaja tidak disimpan**: stok per SKU
per area sudah ada di `stock_current` yang ditarik tiap Refresh. Menyimpannya
dua kali berarti dua angka bernama sama dengan umur berbeda, dan yang akan
dicurigai user adalah perhitungannya — bukan dua sumbernya. Status aktif
komponen juga dibaca dari `stock_current.isActive`, bukan dari sini.

Akibatnya fitur ini **tidak menambah satu pun kueri stok**: `muatAtp` membangun
peta stok sekali dari baris yang memang sudah dibacanya, dan yang ditambah cuma
satu bacaan `bundle_item`.

### Penarikannya TIDAK ikut tombol Refresh

Komposisi bundling itu master data yang jarang berubah dan payloadnya 2,5 MB,
sementara Refresh harus selesai dalam 60 detik. Jadi tiga jalan: tombol
**"Tarik komposisi bundling"** di toolbar tabel `/atp` (`force=1` — orang yang
sengaja menekan tidak boleh ditahan jeda), cron ATP, dan `npm run sync:bundle`.
Jeda otomatisnya `bundle_refresh_hours` (bawaan 12).

Dua pengaman yang sengaja dipasang:

- **Daftar kosong TIDAK menimpa apa pun.** Kalau OCS menjawab 0 komponen,
  komposisi lama dipertahankan dan dilaporkan. Tanpa ini, satu respons aneh
  menghapus seluruh komposisi dan kolom Turunan jadi kosong tanpa sebab.
- Pemeriksaan kesegaran membaca baris **PALING TUA** (`pulledAt asc`), bukan
  paling baru — pelajaran dari bug transit `desc` 8 Okt 2026, di mana satu baris
  yang baru ditulis membuat seluruh tabel tampak segar dan mengunci penarikan
  berikutnya selama 3 jam.
- Di cron ATP, komposisi ditarik **lebih dulu** dan kegagalannya **tidak**
  membatalkan perekaman `atp_daily`: kolom layar bisa menunggu, riwayat harian
  tidak bisa dibuat ulang besok.

### Yang ditampilkan, dan kenapa

Kolom `Turunan Bundling` memuat ringkasan + tombol; nilai sort/filter-nya
**jumlah komponen** (angka), supaya "urutkan dari bundle paling rumit" dan
"filter > 5 komponen" bisa. Sel kosong membedakan **"bukan Bundle"** dari
**"komposisinya belum ditarik"** — dua hal yang butuh tindakan berbeda, dan "—"
polos pernah jadi pertanyaan user 8 Okt.

Baris rinciannya memuat, per komponen: `qty/bundle`, stok per cabang, status
**per cabang** (bukan satu nilai global — `isActive` OCS memang per (sku, area),
jadi satu komponen bisa aktif di Makassar dan nonaktif di Medan), dan
`floor(stok / qty)`.

Lalu dua baris penutup yang berdampingan:

```
Bisa dibentuk menurut komponen   (hitungan kami, bukan angka OCS)
Tercatat OCS (yang dipakai ATP)
```

`susunTurunan` menghitung yang pertama sebagai `min(floor(stok/qty))` atas
seluruh komponen, dan menandai komponen **pembatas** per cabang. Itulah yang
menjawab "kenapa bundling ini kosong padahal komponennya ada". Dua aturan yang
dikunci di tes:

- komponen yang **tidak terdaftar** di sebuah cabang membuat jawabannya `null`,
  bukan dilewati — melewatinya memberi angka terlalu optimistis dari komponen
  yang tersisa, tanpa satu pun tanda bahwa angkanya tidak lengkap;
- angka OCS **tidak pernah ditimpa**. Kalau keduanya beda, itu informasi yang
  perlu dilihat orang. ATP tetap memakai angka OCS.

### Urutan kolom

Sekarang persis seperti yang diminta user:

```
SKU | Turunan Bundling | Stok total | Makassar | Stok Makassar | Medan | Stok Medan | … | Nama | Kategori | Brand
```

Nama/Kategori/Brand dipindah ke belakang karena urutan yang diminta menaruh
cabang lebih dulu; ketiganya tetap bisa diurutkan & difilter, Brand tetap bisa
diklik untuk diedit, dan Nama tetap jadi judul kartu di mode HP.

Lembar **Sebaran** di Excel memakai urutan yang SAMA — dua urutan berbeda untuk
data yang sama adalah cara orang salah kolom. Kolom `Turunan` ikut masuk
`KOLOM_KETERANGAN` di importer supaya tidak dilaporkan sebagai "kolom asing".

Lembar baru **Turunan** (bentuk panjang: satu baris per komponen per cabang,
bukan matriks — 14 komponen akan melebar tak terkendali) memuat qty, stok,
status, bisa-dibentuk, penanda pembatas, dan angka OCS berdampingan.
