# DOI Monitor — IEG

Perhitungan **Days of Inventory** otomatis dari OCS untuk SKU area Pusat:
dua opsi ADS, penanda produk baru (NPL), analisis ABC, saran tindakan & qty PO,
DOI total keseluruhan, stok dalam perjalanan, dan master lead time.

Kelanjutan dari `doi-planner` (2 Sep 2026) dengan mesin rumus yang diganti sesuai
spesifikasi 15 Sep 2026.

| | |
|---|---|
| Stack | Next.js 15 (App Router) · Prisma 6 · TiDB Serverless · Vercel (Hobby) |
| Stok | OCS `GET /odata/DTO_WmsItemStockLiteV2` — **seluruh area**, Category = **Sku** saja, kolom **Available Qty** (tanpa pengurangan Reserve) |
| Penjualan | OCS `GET /Report/OrderPerSkuReport` — **seluruh area, seluruh status** (dua panggilan per hari; qty order batal disimpan terpisah) |
| Area | Penarikan selalu semua area dan disimpan terpisah per `areaId`. Pengaturan *Area yang dihitung* hanya menentukan area mana yang masuk DOI — DOI per area menyusul tanpa perlu tarik ulang |
| Jadwal | **01.00 WIB** tarik penjualan 7 hari terakhir · **07.30 WIB** tarik stok + hitung DOI · tombol **Refresh** kapan saja |
| UI | IEG Design System v3.1 (`INV IEG/design-ocs.md`): tema **Morning** & **Evening** (tombol di topbar, default ikut sistem), sidebar datar ala WOMS 3 mode (drawer < 768 · rail 72px 768–1279 · expanded 260px ≥ 1280), tabel menjadi kartu di PDT/HP (basis 360px) |
| Tabel | Semua tabel memakai komponen `DataGrid` ala LX02: urut (klik judul, Shift = bertingkat), filter per kolom (operator + wildcard `*` + `;` untuk OR), tabel selalu selebar kontainer, lebar kolom bisa ditarik sendiri (klik ganda gagang = paskan ke isi), menu **Kolom** untuk sembunyi/tampil, pencarian global, klik ganda sel = salin. Tampilan tersimpan per tabel di `localStorage['ieg-grid3:<id>']` |

---

## Menjalankan pertama kali

```bash
npm install
copy .env.example .env      # isi DATABASE_URL, APP_PASSWORD, CRON_SECRET
npm run db:push             # buat seluruh tabel di TiDB
npm run db:seed             # pengaturan bawaan
npm run check:db            # uji koneksi TiDB
npm run check:ocs           # uji login OCS + contoh stok & penjualan
npm run backfill:sales -- --from=2026-01-01 --to=2026-09-14   # histori (±10 menit), ATAU unggah XLSX lewat UI
npm run compute             # tarik stok + hitung DOI pertama kali
npm run dev                 # http://localhost:3000
```

### Setelah menarik versi baru

Fitur **nilai stok** menambah tabel `product_price` dan kolom `unitPrice` di
`doi_snapshot`, jadi jalankan sekali:

```bash
npm run db:push
npm run compute          # mengisi harga pertama kali dari OCS
```

### Kalau `db:push` gagal soal primary key

TiDB memakai *clustered index* untuk primary key, jadi PK sebuah tabel tidak bisa
diganti di tempat — muncul `Unsupported drop primary key when the table is using
clustered index`. Tabel `phase_out` pernah berganti kunci dari `sku` ke `key`,
jadi tabelnya perlu dibuang dulu (isinya ikut hilang, tinggal unggah ulang):

```bash
npm run db:reset-phase-out  # buang tabel phase_out
npm run db:push             # buat ulang dengan struktur baru
```

Perintah lain: `npm test` (uji mesin, 81 kasus, tanpa database) · `npm run reset-password` (lupa password) · `npm run sync:sales -- --days=7` ·
`npm run sync:stock` · `npm run compute -- --no-stock` (hitung ulang tanpa tarik stok).

---

## Rumus

Semua jendela berakhir **kemarin** — hari ini masih berjalan dan tidak dihitung.

```
Stok                 = Available Qty (OCS) area Pusat, Category = Sku
Posisi               = Stok + Stok Dalam Perjalanan

ADS Opsi 1           = Σ penjualan 90 hari terakhir TANPA tanggal campaign
                       ÷ jumlah hari yang tersisa (90 − hari yang dikecualikan)
                       tanggal campaign = double date (1.1 … 12.12) + gajian (tgl 25) + tanggal manual
ADS Opsi 2           = max( rata-rata 56 hari, rata-rata 28 hari, rata-rata 14 hari )

DOI 1 / DOI 2        = Stok ÷ ADS                (kolom "+T" memakai Posisi)
DOI total            = Σ Stok ÷ Σ ADS  (dua versi; juga per kelas ABC)
Saran Qty PO         = max(0, Target DOI × ADS − Posisi)          (dua versi)
```

**Produk baru (NPL).** Jendela dipotong pada tanggal penjualan pertama — produk berumur
20 hari dibagi 20, bukan 90. Umur jual < 90 hari ditandai *NPL — umur jual N hari*;
< 14 hari ditandai *data belum cukup* dan tidak diberi saran PO. Tanggal penjualan pertama
dicari di seluruh histori (unggah sejak Januari); SKU yang tanggal pertamanya = awal data
ditandai *≥ awal data* dan tidak dianggap NPL.

**Status & saran tindakan** (basis bawaan *konservatif* = ADS terbesar / DOI terkecil dari kedua opsi):

| Kondisi | Status | Saran |
|---|---|---|
| DOI+T ≤ lead time | Kritis | SEGERA OPEN PO — stok habis sebelum barang datang |
| DOI+T ≤ lead time + safety (3) | Low Stock | Low stock, segera open PO |
| DOI ≤ lead time + safety, tapi DOI+T aman | Tunggu Kiriman | Tunggu kiriman, pantau ETA |
| DOI+T > target DOI (14) | Overstock | Overstock — tahan PO |
| di antaranya | Aman | Aman |
| 0 penjualan 90 hari, stok > 0 | Dead Stock | Review / promo |
| belum pernah terjual | Belum Terjual | Pantau |
| NPL < 14 hari | NPL | Data belum cukup |
| ada di daftar Phase Out | Phase Out | Habiskan stok, jangan PO |
| ditandai di master SKU | Dikecualikan | — |

**ABC** berdasarkan qty penjualan 90 hari (semua hari): kumulatif ≤ 70 % → A, ≤ 90 % → B, sisanya C.
Hanya SKU aktif yang menentukan ambangnya — yang dikecualikan dan phase out tidak ikut, supaya
produk yang mau dimatikan tidak merebut kelas A dan menggeser batas untuk produk aktif.

**Phase out & DOI total.** SKU phase out tetap punya DOI sendiri (untuk memantau kapan sisa stok
habis), tapi stok **dan** ADS-nya sama-sama dikeluarkan dari DOI total. Kalau hanya stoknya yang
dikurangi sementara penjualannya tetap ikut, pembaginya tidak berubah dan DOI total jadi salah kecil.

Semua angka (jendela, ambang, tanggal gajian, basis) bisa diubah di **Pengaturan**;
klik *Hitung ulang* setelahnya. **Keterangan jendela di seluruh UI ikut angka itu** —
90 hari tampil sebagai *3 bln*, 30 hari jadi *1 bln*, sementara angka yang bukan kelipatan
bulan tetap ditulis apa adanya (*45 hari*) supaya tidak menyesatkan. Berlaku di Dashboard,
Tabel DOI, Pengaturan, Dashboard TV, dan judul kolom export XLSX.

---

## Simulasi Target DOI — cara kerjanya

Mengurangi stok **tidak** mengubah ADS, jadi seluruh simulasi bersandar pada satu persamaan:

```
Target stok = target hari × ADS total
Harus keluar = stok sekarang − target stok
```

Tiap SKU punya **lantai**: coverage minimum yang tetap disisakan (diatur per kelas).
Yang boleh dipotong hanya kelebihan di atas lantai itu — sehingga simulasi tidak pernah
menyarankan memotong SKU yang stoknya memang sudah tipis. Kelas yang tidak dicentang tidak
disentuh sama sekali, tapi stoknya **tetap** ikut dihitung di DOI total; itu sebabnya target
bisa saja tidak tercapai, dan kalau begitu hasilnya dilaporkan apa adanya (`feasible: false`)
lengkap dengan kekurangannya, bukan dipaksa seolah tercapai.

Tiga cara membagi pemotongan:

| Urutan | Untuk apa |
|---|---|
| **Kelebihan terbesar dulu** | menyentuh SKU sesedikit mungkin — paling enak dieksekusi |
| **DOI tertinggi dulu** | membereskan yang paling lama mengendap |
| **Merata** | semua SKU kena sebanding dengan kelebihannya |

Tombol *Pakai saran* mencari lantai seragam **tertinggi** yang masih memenuhi target
(pencarian bagi dua), jadi tidak perlu menebak angkanya sendiri.

Kolom **POTONG** adalah qty yang harus keluar dari gudang — lewat penjualan, diskon,
bundling, retur ke principal, atau write-off. Aplikasi ini tidak pernah mengubah stok.

---

## Nilai stok — harga dari OCS

Harga ditarik dari **`GET /Products/GetProductSkus`** ke tabel `product_price`,
lalu ikut disimpan per baris snapshot (`doi_snapshot.unitPrice`) supaya nilai
historis tidak berubah ketika harga di OCS berubah besok.

**OCS tidak menyimpan HET.** Yang tersedia hanya `SalePrice`, dan bentuknya
**array — satu harga per marketplace**; halaman Products OCS sendiri
menampilkannya sebagai rentang *Rp 47.091 – Rp 53.513*. Aplikasi ini memakai
**yang terendah** secara bawaan (`price_source`, bisa diubah ke `AVG`/`MAX`),
karena angka konservatif lebih aman dibawa ke rapat.

| | |
|---|---|
| Nilai stok | `stok × harga satuan` |
| Satu produk banyak SKU | `SellerSku` OCS bisa berisi `"SKU-A, SKU-B"` — dipecah dan harganya dipakai untuk masing-masing |
| Harga 0 / tidak ada | dianggap **tidak diketahui**, ditulis `—`, dan jumlah SKU-nya dilaporkan di bawah KPI — bukan dihitung sebagai gratis |
| Penarikan | dilewati kalau data masih segar (`price_refresh_hours`, bawaan 12 jam), supaya Refresh tetap cepat |
| Kegagalan | **tidak menggagalkan perhitungan DOI** — dicatat di `sync_log` lalu dilanjutkan dengan harga terakhir |

Muncul di: KPI & tabel ABC Dashboard, resume tiap panel, kolom **Harga** &
**Nilai stok** di Tabel DOI (ikut export), kolom **Nilai dipotong** di Simulasi
Target DOI (ikut export), dan **Nilai kehilangan** di Analisis Stok Kosong.

Angka besar diringkas mengikuti kebiasaan Indonesia: `Rp 8,06 M`, `Rp 945,2 jt`.
Angka penuhnya muncul saat kursor diarahkan ke sel.

---

## Analisis Stok Kosong — cara membacanya

Yang dianalisis hanya **SKU aktif yang ada di Tabel DOI**. SKU yang laku di rentang
tapi tidak ada di daftar itu (nonaktif, kategori bukan `Sku`, clearance, hilang dari OCS)
tidak ikut dihitung — jumlah dan alasannya tetap ditampilkan di halamannya.

Sebuah hari dihitung **kosong** bila qty-nya nol bulat (bukan "anjlok"). Untuk SKU yang
**laku hampir setiap hari** — bawaannya laku pada **≥ 80 % hari** dengan **ADS ≥ 1 pcs/hari** —
**satu hari nol pun sudah dilaporkan**. Ketiga ambang itu bisa digeser di halamannya.

| Yang dipisahkan | Tandanya | Artinya |
|---|---|---|
| Stok kosong (terkonfirmasi) | qty total 0 **dan** `stock_daily` mencatat stok 0 | benar-benar kehabisan |
| Dugaan stok kosong | qty total 0, riwayat stok belum ada | kemungkinan besar habis, belum bisa dibuktikan |
| Stok ada | qty total 0 tapi stok tercatat > 0 | **bukan** masalah stok — listing/iklan/harga |
| Masalah listing | satu shop 0, shop lain tetap laku | listing shop itu bermasalah; qty totalnya tidak nol |

Kedua tabel memakai dua kolom keterangan yang sama, sehingga sifat temuannya terbaca
tanpa perlu pindah tabel:

| | Kosong di semua shop | Kosong di beberapa shop |
|---|---|---|
| Tabel *Stok kosong* | selalu **Ya** | **Ya** bila SKU itu juga punya shop yang berhenti sendiri |
| Tabel *Masalah listing* | **Ya** bila SKU itu juga pernah kosong total | selalu **Ya** |

Baris yang **Ya di kedua kolom** kena dua masalah sekaligus — ada angkanya di KPI *Kena dua-duanya*.

Alasan sebuah SKU berada di luar Tabel DOI dibaca dari `stock_current` tanpa saringan,
lalu diringkas di halamannya: *Tidak ada di stok OCS* · *Nonaktif di OCS* ·
*Kategori &lt;X&gt;* (biasanya item gimmick/hadiah) · *Clearance* · *Ada di area lain*.

Perkiraan kehilangan diberikan sebagai **rentang**: konservatif = hari × angka normal
(ADS acuan dari snapshot terdekat *sebelum* episode, basis mengikuti `action_basis`; atau
median penjualan bila tidak ada), optimis = hari × ADS hari-laku. Angka konservatif cenderung terlalu kecil karena hari kosong ikut
menjadi pembagi saat ADS dihitung — itulah gunanya batas atas.

**Pengaman yang perlu diketahui:**

- Hari yang **tidak ada satu pun SKU** berpenjualan (atau jauh di bawah kebiasaan) dianggap
  *data tidak ada*, bukan stok kosong — satu cron yang gagal jika tidak akan membuat seluruh
  katalog tampak kosong berbarengan. Hari-hari itu ditampilkan di halamannya.
- Penjualan **7 hari terakhir** masih ditarik ulang tiap malam (pembatalan order), jadi episode
  yang seluruhnya di jendela itu ditandai *bisa berubah*.
- Hari sebelum penjualan pertama sebuah SKU tidak dihitung kosong.
- SKU phase out dan yang ditandai *dikecualikan* dikeluarkan (ada toggle).
- Item gimmick/hadiah punya baris penjualan sendiri di report OCS. Kalau promonya berhenti,
  SKU itu akan muncul seolah kehabisan stok — tandai *dikecualikan* di Lead Time & SKU.

---

## Penjualan: status order OCS (temuan 15 Sep 2026)

Filter *Status* di report OCS menyaring **status order saat ini**, bukan riwayatnya.
Satu order hanya berada di satu status, jadi menjumlahkan beberapa status tidak menggandakan.
Sebaliknya, hanya PROCESSED + COMPLETED **menghilangkan** hampir semua order kemarin
(masih PICKED / PACKED / MANIFESTED / IN_TRANSIT / DELIVERED):

| 14 Sep 2026, Pusat | pcs |
|---|---|
| PROCESSED + COMPLETED | 414 |
| Semua status | 29.729 |
| di antaranya CANCELLED / UNPAID | 2.606 / 421 |

### Sejak 25 Sep 2026: seluruh status ditarik, order batal dipisah

Respons `OrderPerSkuReport` **tidak memuat kolom status**, jadi memisahkan order batal
hanya bisa lewat dua panggilan per hari yang lalu diselisihkan:

| Panggilan | Status | Disimpan di |
|---|---|---|
| 1 | **seluruh** status OCS (29 kode, tanpa kecuali) | — |
| 2 | status yang memakan stok: PROCESSED…COMPLETED + READY_TO_PROCESS + RETURN* (dua toggle di Pengaturan) | `sales_daily.qty` |
| selisih (1 − 2) | NA, UNPAID, IN_CANCEL, CANCELLED | `sales_daily.qtyCancel` |

ADS memakai `qty` saja. Toggle **Ikutkan qty order batal ke ADS** di Pengaturan
(`sales_include_cancel`, bawaan mati) mengubahnya jadi `qty + qtyCancel` — menaikkan ADS
±10% dan **menurunkan** DOI, karena order yang batal tidak pernah memakan stok. Angkanya
tetap terlihat per area di Pengaturan → *Area yang terdeteksi* walau toggle-nya mati.

Selisih negatif (status order berubah di antara dua panggilan) dijadikan 0, bukan ditebak.

Karena status masih berubah beberapa hari (pembatalan), tiap 01.00 tujuh hari terakhir
ditarik ulang dan **menimpa** — baris `source = 'sync'` yang hilang dari OCS ikut dihapus,
sementara baris hasil unggahan manual dibiarkan.

## DOI per area & barang dalam perjalanan (25 Sep 2026)

### DOI dihitung untuk setiap kota, plus satu baris gabungan

`doi_snapshot` dan `doi_summary` sekarang berkunci `(tanggal, areaId, …)`.
`runCompute` memanggil `computeAll(area)` untuk tiap kota yang ada stoknya, lalu sekali
lagi untuk `GABUNGAN`.

GABUNGAN dihitung ULANG dari data mentah, bukan dijumlahkan dari hasil per kota —
DOI itu pembagian, dan Σ(stok/ADS) ≠ Σstok/ΣADS. Menjumlahkan hasil per kota akan
menghasilkan angka yang salah dan sulit dilacak.

Pembersihan snapshot disaring per area (`DELETE … WHERE snapshotDate = ? AND areaId = ?`).
Tanpa saringan itu, menghitung Surabaya akan menghapus snapshot Pusat yang baru ditulis.

Pemilih area ada di Dashboard, Tabel DOI, Stok Kosong, dan Simulasi; pilihannya disimpan
di `localStorage` dan bisa juga lewat `?area=`. Pemilihnya **sengaja tidak tampil** kalau
cuma ada satu area. Export XLSX ikut area yang sedang dilihat.

`area_scope` di Pengaturan tidak lagi membatasi apa pun — semua area dihitung. Ia tetap
ada sebagai bawaan lama.

### Barang dalam perjalanan (SIT) dari OCS

Sumber: `GET /api/receive-stock/docs` + `GET /api/receive-stock/lines?docNum=N`, dua
endpoint yang dipakai halaman /stocks/receive-stock. `/api/receive-stock/submit`
**tidak pernah** dipanggil — dashboard hanya membaca.

Tiga temuan dari pembongkaran yang menentukan bentuk modulnya:

| Temuan | Akibatnya di kode |
|---|---|
| `DoQty` SUDAH total pcs. "39 ctn 32 pcs" cuma format `formatCtnPcs(DoQty, PerCtnQty)`. Contoh nyata: Cinnamon, PerCtnQty 72, DoQty 2840 → 72×39+32 = 2840 | qty dipakai apa adanya, **tidak pernah dikalikan** isi karton |
| `BatchQuantity` ≠ `DoQty` di 18 dari 683 baris DO, dan di situ nilainya stok batch penuh (DoQty 72 vs 3.744). `DoQty` tidak pernah melampaui `BatchQuantity` | DOI memakai `DoQty`; `BatchQuantity` disimpan di kolom `qtyBatch` sebagai pembanding |
| Baris receive tidak punya kolom SKU, cuma `ItemCode` (kode SAP), prefiksnya beda dari stok (1201/1208 vs 1222/1228) | dicocokkan lewat 6 digit terakhir — cara yang sudah dipakai Phase Out |

`transit_stock` berkunci `(sku, areaId)`: barang menuju Surabaya adalah stok Surabaya.
Baris `source='ocs'` diganti seluruhnya tiap sinkronisasi; baris `source='manual'` (hasil
unggahan) tidak pernah disentuh, dan sebaliknya unggahan tidak menghapus baris OCS.

Kalau ada dokumen yang belum sempat ditarik karena waktu habis, **pembersihan dilewati** —
menghapus berdasarkan data separuh akan menghilangkan transit yang masih berjalan.

Tabel `sku_box` menyimpan isi karton: `fromOcs` (PerCtnQty, sering 0 — 531 dari 727 baris
terisi), `fromName` (angka setelah " x " di akhir nama), `manual` (menang kalau diisi).
Dipakai **hanya untuk menampilkan** ctn/pcs. Kalau `fromOcs` dan `fromName` ada tapi beda,
barisnya ditandai ⚠ supaya master OCS atau penamaannya bisa dibetulkan.

Kode gudang OCS diterjemahkan di `KODE_AREA`: GBJD→Pusat, GJSB→Surabaya, GJYG→Yogyakarta,
GJMK→Makassar, GJMD→Medan. Kode tak dikenal tampil apa adanya, bukan hilang diam-diam.

---

### `area=All` tidak pernah dipakai (aturan sejak 25 Sep 2026)

Parameter `area=All` tidak memberi akses apa pun — yang menentukan area mana yang
terlihat adalah **akun OCS yang dipakai**. Akun `ADMIN` hanya mengembalikan `Pusat`
walaupun diminta `All`, jadi penarikan pertama dengan akun itu diam-diam hanya berisi
satu area tanpa galat apa pun. Itu jenis kegagalan yang paling mahal: tidak kelihatan.

Aturannya sekarang tegas: **penarikan selalu menyebut satu kota**, tidak pernah `All`.
`pullSalesDayArea()` menolak `area` kosong atau `'all'`, dan daftar kotanya diambil dari
respons stok OCS (bukan daftar tebakan), disimpan ke pengaturan `sales_pull_areas` supaya
cron malam menarik kota yang sama persis.

`src/lib/ocs.ts` juga **tidak lagi punya nilai bawaan** untuk `OCS_USERNAME` /
`OCS_PASSWORD`: variabel yang lupa diisi melempar galat yang menyebutkan akibatnya,
bukan jatuh ke `ADMIN`/`ADMIN`. Set keduanya di `.env` **dan** di Environment Variables
Vercel — kalau hanya lokal, cron produksi tetap menarik satu area.

`area_scope` di Pengaturan tidak ada hubungannya dengan ini: itu menentukan area mana
yang **dihitung** DOI-nya. Nilai `All` di situ berarti angka semua kota dijumlahkan jadi
satu DOI — bukan cara penarikannya.

### Satuan kerja: (tanggal × area)

Satu pasangan (tanggal, area) = 2 panggilan OCS. Dengan 5 kota dan jendela 7 hari itu
**70 panggilan**, sementara satu fungsi Vercel Hobby dibunuh di detik ke-60 — mustahil
selesai sekali jalan, dan memang tidak dipaksakan.

`antreanTarik()` menyusun antrean per pasangan, bukan per tanggal. Kalau satuannya
tanggal, jalan berikutnya selalu mengulang tanggal yang sama dari kota pertama dan kota
terakhir tidak pernah kebagian. Urutannya: seluruh kota untuk 2 tanggal terbaru dulu,
lalu sisanya dari pasangan yang **paling lama tidak ditarik** — jadi jalan-jalan
berikutnya menyapu sisanya sampai habis.

Pembersihan baris basi juga disaring per area (`DELETE … WHERE salesDate = ? AND
areaId = ?`). Tanpa saringan itu, menarik Medan akan menghapus baris Surabaya yang baru
saja ditulis.

### Migrasi per-area di TiDB: primary key clustered tidak bisa di-drop

`prisma db push` GAGAL TOTAL untuk perubahan ini:

```
Error: Unsupported drop primary key when the table is using clustered index
```

TiDB memakai clustered index untuk primary key, dan kunci seperti itu tidak bisa
di-drop. Tiga tabel yang kuncinya berubah kena: `doi_snapshot`, `doi_summary`,
`transit_stock`. Karena push gagal seluruhnya, tabel BARU (`sales_pull`,
`sku_box`) pun ikut tidak terbuat — jadi kegagalannya total, bukan sebagian.

Menghapus tabelnya memang menyelesaikan masalah, tapi riwayat snapshot ikut
hilang dan tren DOI di dashboard mulai dari nol. Karena itu `npm run migrate:area`
memindahkan datanya, tiga langkah:

```
npm run migrate:area                 # ekspor ke .migrasi-area/*.json + rename ke *_lama
npm run db:push                      # Prisma membuat tabel baru yang benar
npm run migrate:area -- --lanjut     # data dipulihkan, *_lama dihapus
```

**`prisma db push` MENGHAPUS tabel `*_lama`** (kena 29 Sep 2026, riwayat 4.828 baris
hilang). Push menghapus setiap tabel yang tidak ada di `schema.prisma`, dan `*_lama`
memang tidak ada di sana:

```
• You are about to drop the `doi_snapshot_lama` table, which is not empty (4828 rows).
√ Do you want to ignore the warning(s)? ... yes
```

Menjawab "yes" itu wajar — tanpa itu push tidak jalan — jadi jaring pengamannya tidak
boleh berupa tabel. Karena itu langkah 1 juga MENULIS SEMUA BARIS KE `.migrasi-area/*.json`
sebelum menyentuh apa pun; file di luar jangkauan Prisma. Langkah 3 memulihkan dari
tabel `*_lama` kalau masih ada, kalau tidak dari JSON-nya. Folder itu masuk `.gitignore`
dan boleh dihapus setelah dashboard terlihat benar.

Baris lama tidak punya `areaId`; semuanya diberi `Pusat`, karena memang itu
satu-satunya area yang dihitung sebelum perubahan ini. Kolom disalin lewat
irisan `information_schema` kedua tabel, jadi kolom baru terisi nilai bawaan
dan tidak ada nama kolom yang ditulis manual.

### "HTTP 200" di layar, dan kenapa transit tidak pernah tuntas

Halaman Stok Dalam Perjalanan pernah menampilkan error **`HTTP 200`** — status
sukses dilaporkan sebagai kegagalan. Dua sebab yang bertemu:

1. `syncTransit()` mengembalikan `ok: false` kalau ada dokumen yang belum sempat
   ditarik. Itu keliru: barisnya SUDAH ditulis, pembersihan dilewati dengan sengaja
   — penarikan sebagian, bukan gagal.
2. Respons itu tetap berstatus 200 (memakai `json()`, bukan `fail()`), dan penolongnya
   di klien berbunyi `throw new Error(j.error || `HTTP ${r.status}`)`. Karena `j.error`
   tidak ada — yang ada `j.message` — pesannya jatuh ke `HTTP 200`.

Perbaikannya: `ok: true` + `partial: true`, dan klien memakai
`j.error || j.message || HTTP <status>`.

Di bawahnya ada masalah yang lebih besar. Satu dokumen Receive butuh **±5,5 dtk**
dan ada **±20 dokumen** — ±110 dtk, jauh di atas batas 60 dtk satu fungsi Vercel.
Versi lama selalu mulai dari dokumen pertama, jadi tiap klik hanya sempat membaca
±4 dokumen yang sama dan penarikan **tidak pernah maju**; pembersihan pun dilewati
selamanya karena selalu ada yang kurang.

Sekarang isi tiap dokumen di-cache di tabel `receive_doc` (JSON baris mentahnya).
Daftar dokumen SELALU ditarik ulang — itu satu-satunya cara mengetahui ada dokumen
baru — tapi isi dokumen yang sudah pernah dibaca datang dari database. Klik pertama
mengisi sebagian, klik berikutnya melanjutkan, dan sesudah itu sinkronisasi selesai
dalam hitungan detik. Isi dokumen Receive praktis tidak berubah setelah dibuat, jadi
cache dengan jendela `transit_refresh_hours` aman.

Konsekuensinya: **tombol Refresh di dashboard memaksa penarikan transit** (jendela
kesegaran dilewati, `trigger === 'manual'`), karena orang yang menekan Refresh
justru ingin dokumen yang baru masuk ikut terhitung. Urutannya transit → hitung →
simpan, sehingga SIT yang dipakai DOI selalu angka terbaru. Cron tetap menghormati
jendela kesegaran.

Tabel baru ini butuh `npm run db:push` sekali. Tidak ada primary key tabel lama yang
berubah, jadi jebakan clustered index di atas tidak berlaku untuk perubahan ini.

### Notifikasi: toast, bukan chip

Hasil Refresh dulu ditempel sebagai chip di samping tombolnya. Chip (§11.8) dirancang
untuk satu-dua kata status — tinggi 22px, `whitespace-nowrap` — jadi kalimat seperti

> Selesai: 2000 SKU, 18 dtk (pengaturan 0.1s · stok 13400 baris 5.4s · harga masih
> segar 0.0s · transit GAGAL (…) 5.7s · Makassar 327 SKU 1.4s · …)

memaksa tinggi, pembungkusan dan lebar 46ch lewat `style` inline. Hasilnya balon hijau
besar yang mendorong tata letak topbar dan menutupi judul halaman.

Sekarang `src/components/Toast.tsx`: satu antrean untuk seluruh aplikasi, `<Toaster/>`
dipasang di `layout.tsx` (di luar `Shell`, supaya halaman dengan topbar sendiri ikut
kebagian). Satu baris ringkas; langkah-langkahnya disembunyikan di balik tombol
"Rincian" dan hitung mundurnya berhenti selagi rincian dibuka. Sukses hilang sendiri
setelah 6 dtk; peringatan dan galat MENETAP sampai ditutup. Paling banyak 3 sekaligus.
Di bawah 768px melebar penuh di tepi bawah, seperti bottom sheet §11.9.

Langkah yang GAGAL atau SEBAGIAN di tengah perhitungan membuat warnanya kuning, bukan
hijau — `transit GAGAL (…)` pernah lewat sebagai "Selesai" berwarna hijau.

`.grid-toast` milik DataGrid dihapus; semuanya lewat antrean yang sama.

### Poster WhatsApp `/wa` — satu gambar 1600×900

Bot WhatsApp berjalan di server lain, jadi ia tidak punya sesi. Dua jalur, keduanya
minta token `WA_PAGE_TOKEN`:

```
# 1. tanpa browser — paling ringan untuk bot
curl -s "https://doi-monitor.vercel.app/api/public/wa/svg?k=RAHASIA" -o doi.svg
convert doi.svg doi.jpg            # ImageMagick, atau sharp

# 2. lewat browser — buka /wa?k=RAHASIA lalu tekan "Unduh JPG"
```

**Kalau `WA_PAGE_TOKEN` tidak diset, endpoint-nya menolak (503), bukan terbuka.**
Angka stok dan nilai rupiah seluruh area tidak boleh jadi publik hanya karena
seseorang lupa mengisi environment variable.

**Posternya satu elemen `<svg>`, bukan HTML.** Alasannya unduhan: SVG bisa
diserialkan lalu digambar ke `<canvas>` tanpa pustaka apa pun, dan hasilnya persis
sama dengan yang di layar. html2canvas harus menafsirkan ulang CSS, dan design
system ini memakai `color-mix()` yang tidak dipahaminya.

Konsekuensinya **seluruh warna di `src/lib/wa-poster.ts` ditulis hex apa adanya**,
bukan `var(--token)`: SVG yang berdiri sendiri tidak mewarisi custom property dari
dokumen induknya — semua `var(--x)` akan jadi hitam. Ini satu-satunya tempat di repo
yang boleh begitu.

`src/app/wa/poster.tsx` sengaja TANPA `'use client'` supaya komponen yang sama
dipakai dua kali: oleh halaman di browser, dan oleh route handler yang merendernya
jadi teks SVG di server. Tidak ada dua versi gambar yang bisa berbeda diam-diam.
(Next menolak `import … from 'react-dom/server'` di app router, jadi impornya
dinamis di dalam handler.)

Opsi DOI yang digambar mengikuti **`doi_display`** di Pengaturan — setelan yang
sama dengan seluruh layar lain, bukan setelan sendiri, supaya poster dan dashboard
tidak pernah menyebut angka yang berbeda. Kalau hanya Opsi 1 dipilih: kolom Opsi 2
hilang dari strip ringkasan, angka besar di kartu memakai Opsi 1, labelnya jadi
"DOI" tanpa nomor (nomornya tak bermakna kalau cuma ada satu), dan sparkline-nya
memakai deret opsi itu. Helper-nya `tampil1/tampil2/labelDoi/deretTren` di
`wa-poster.ts`, sejajar dengan `show1/show2/doiLabel` di `ui.tsx`.

Blok yang tampil diatur di Pengaturan → *Poster WhatsApp*: angka inti, sebaran
status, tren 30 hari, open PO & SKU mendesak. Blok yang dimatikan tidak
meninggalkan lubang — kursor vertikal di `KartuArea` membuat blok berikutnya naik.

### Riwayat Proses — tempat rinciannya tinggal

Notifikasi hidup 10 detik dan memuat SATU baris. Daftar langkah — yang panjangnya
bisa 300 karakter — tidak ikut ke sana; semuanya sudah tertulis di `sync_log` sejak
awal, yang belum ada cuma layarnya. Halaman `/riwayat` membacanya: 200 proses terakhir,
bisa disaring per jenis dan "hanya yang bermasalah", dan tiap baris bisa dibuka untuk
melihat langkahnya satu per satu (yang `GAGAL`/`SEBAGIAN` ditebalkan).

Baris berstatus `ok` yang di dalam pesannya ada `GAGAL` atau `SEBAGIAN` diberi label
**Ada catatan**, bukan hijau polos — itulah yang dulu lolos tanpa kelihatan.

### `.tag` — label yang boleh membungkus

Chip tidak boleh dipakai untuk kalimat. `.tag` (radius 8, tinggi mengikuti isi,
`overflow-wrap:anywhere`) untuk isi seperti `2026-08-17 · Hari Kemerdekaan` yang dulu
dipaksakan ke dalam chip dan terpotong diam-diam oleh `.app-main{overflow-x:hidden}`.

### Header tabel yang tidak pernah menempel

`overflow-x:auto` menjadikan kotaknya scrollport di KEDUA sumbu (satu sumbu non-visible
memaksa sumbu lain jadi `auto`). Tanpa `max-height`, kotak itu tidak pernah menggulir
vertikal, jadi `thead{position:sticky;top:0}` menempel pada sesuatu yang tidak bergerak
dan judul kolom tetap hilang saat halaman digulir. `.grid-scroll` dan `.table-scroll`
sekarang `max-height:70dvh` — salah satu dari 4 penggulir yang diizinkan §7.2 — dan
dilepas lagi di mode kartu (<768px).

### Kekhususan: `.dgrid.dgrid-auto`

`.dgrid-auto{table-layout:auto}` kalah dari `.dgrid{table-layout:fixed}` karena
kekhususannya sama dan `.dgrid` ditulis belakangan, jadi kolom tetap dimampatkan sampai
`71,7%` terpotong jadi `71,…`. Ditulis `.dgrid.dgrid-auto` agar menang.

### `tsc` lokal TIDAK bisa dipercaya untuk tipe Prisma

Engine Prisma tidak bisa diunduh di lingkungan pengembangan yang dipakai Claude,
jadi `node_modules/.prisma/client` di sana isinya stub tulis tangan dengan
`deleteMany(args?: any)` — jauh lebih longgar daripada tipe asli. Akibatnya ada
kelas galat yang LOLOS `npm run typecheck` lokal tapi menggagalkan build Vercel.

Kena 30 Sep 2026:

```ts
prisma.transitStock.deleteMany(semua ? {} : { where: { source: 'manual' } })
```

```
Argument of type '{} | { where: { source: string; } }' is not assignable…
  Property 'where' is missing in type '{}'
```

Metode Prisma bergeneric — `deleteMany<T extends …Args>(args?: SelectSubset<T, …>)`
— dan `T` disimpulkan dari argumennya. Argumen union membuat penyimpulan memilih
satu bentuk lalu menolak bentuk lainnya.

**Aturannya: pilih di antara dua PANGGILAN, jangan di antara dua ARGUMEN.**

```ts
// JANGAN
prisma.x.findMany(cond ? { where: a } : {})
// BOLEH
cond ? prisma.x.findMany({ where: a }) : prisma.x.findMany({ where: b })
cond ? prisma.x.findMany() : Promise.resolve([])
```

Penjaganya `src/lib/prisma-args.test.ts` — memindai teks sumber (komentar dibuang,
berkas tes dilewati) dan gagal kalau ada argumen ternary di metode Prisma mana pun.
Tes teks dipakai justru karena compiler-nya di sini tidak bisa diandalkan.

### Kata cadangan SQL: `rows`, `trigger`, `key`

Sudah kena dua kali, dua-duanya error 1064 yang TIDAK terdeteksi `tsc` maupun
`next build` — hanya muncul saat dijalankan:

| Tanggal | SQL | Perbaikan |
|---|---|---|
| 25 Sep 2026 | `SELECT … rows AS n FROM sales_pull` | kolomnya dinamai `rowCount` |
| 29 Sep 2026 | `INSERT INTO doi_summary (…, trigger, …)` | dibungkus backtick di `compute.ts` |

`ROWS` dipakai fungsi window, `TRIGGER` dipakai `CREATE TRIGGER`. Prisma Client
mengutip nama kolom sendiri, jadi lewat `prisma.syncLog.create({ data: { trigger } })`
aman — masalahnya hanya ada di `$queryRawUnsafe` / `$executeRawUnsafe` / `$queryRaw`.

**Aturannya: di SQL mentah, SETIAP nama tabel dan kolom dibungkus backtick**, bukan
hanya yang kelihatan berisiko. Penjaganya `src/lib/sql-cadangan.test.ts`: tes itu
membaca `schema.prisma`, mengambil nama kolom yang merupakan kata cadangan (sekarang
`key`, `rows`, `trigger`), lalu memindai setiap literal SQL di `src/` dan `scripts/`.
Kata cadangan telanjang membuat `npm test` gagal dengan nama file dan potongan SQL-nya,
jadi kelas bug ini ketahuan sebelum sampai ke layar user.

### "Tidak ada baris" ≠ "belum pernah ditarik"

Backfill 25–28 Sep 2026 selesai tanpa satu pun kegagalan, tapi `--verify`
melaporkan 30 lubang: Medan 13 hari, Makassar 17 hari. Semuanya palsu. Cabang itu
memang belum berjualan di awal Juni — penarikan berhasil dan menulis **0 baris**:

| Cabang | Penjualan pertama | Hari nol | Terisi |
|---|---|---|---|
| Surabaya | 2026-06-01 | 0 | 116/116 |
| Yogyakarta | 2026-06-01 | 0 | 116/116 |
| Medan | **2026-06-14** | 13 | 103/116 |
| Makassar | **2026-06-18** | 17 | 99/116 |

Karena kemajuan dilacak dari ADA-TIDAKNYA baris di `sales_daily`, hari tanpa
penjualan tidak bisa dibedakan dari hari yang belum ditarik. Dua akibatnya:
`--verify` melaporkan lubang yang tidak pernah bisa ditambal, dan `--resume`
menarik ulang hari-hari itu setiap kali dijalankan, selamanya.

Tabel `sales_pull` (tanggal, area) mencatat bahwa satu pasangan **pernah
ditarik**, berikut jumlah barisnya — termasuk nol. `--verify` kini memisahkan
"sudah ditarik, hasilnya memang nol" dari "belum pernah ditarik". Data lama yang
ditarik sebelum tabel ini ada tetap dianggap sah lewat keberadaan barisnya, jadi
tidak ada yang perlu ditarik ulang.

### Tanggal mulai operasional per area

Cabang baru beroperasi pertengahan tahun, jadi tanggal sebelum itu tidak akan pernah
punya penjualan. Menariknya membuang waktu **dan** membuat laporan lubang penuh lubang
palsu. Pengaturan `sales_area_start` menyimpannya:

```
Surabaya=2026-06-01,Medan=2026-06-01,Makassar=2026-06-01,Yogyakarta=2026-06-01
```

Dipakai `antreanTarik()` (cron), backfill, dan `--verify`. Bisa diisi dari halaman
Pengaturan, atau sekalian saat backfill:

```
npm run backfill:sales -- --mulai=Surabaya=2026-06-01,Medan=2026-06-01,Makassar=2026-06-01,Yogyakarta=2026-06-01
```

Contoh nyata: 267 hari × 5 area = 1.335 pasangan; dengan 4 cabang mulai 1 Juni menjadi
**731 pasangan** — 45% lebih sedikit.

### Backfill setelah perubahan ini

Data yang ditarik **sebelum 25 Sep 2026** tidak punya angka order batal sama sekali
(`qtyCancel = 0` di seluruh histori), karena 4 status itu memang tidak pernah diminta ke
OCS. Kolom `qty` sendiri tidak berubah artinya — status yang memakan stok sama persis
seperti sebelumnya. Jadi backfill di sini gunanya **mengisi histori `qtyCancel`**, bukan
memperbaiki `qty`.

Selama histori itu belum terisi, menyalakan *Ikutkan qty order batal ke ADS* membuat ADS
timpang: hari baru punya angka batalnya, hari lama nol. Halaman Pengaturan memperingatkan
kalau kombinasi itu terjadi (`cakupanBatal()` di `src/lib/query.ts`).

```
npm run check:areas                 # kota apa saja yang dibuka akun OCS ini
npm run backfill:sales              # 30 hari terakhir (BAWAAN), semua area dari OCS
npm run backfill:sales -- --penuh   # seluruh rentang yang sudah ada di database
npm run backfill:sales -- --dry-run # lihat rencananya dulu
npm run backfill:sales -- --days=90
npm run backfill:sales -- --areas=Pusat,Surabaya   # batasi kota (bawaan: semua dari OCS)
npm run backfill:sales -- --resume  # HANYA isi lubang: pasangan yang belum punya data
npm run backfill:sales -- --segarkan=12  # tarik ulang yang datanya lebih tua dari 12 jam
npm run backfill:sales -- --verify  # HANYA laporkan lubang, tidak menarik apa pun
npm run backfill:sales -- --paralel=1   # pelankan kalau OCS sering timeout
npm run compute                     # wajib — snapshot dihitung ulang dari data baru
```

**Satuan kerjanya (tanggal × area), bukan tanggal.** Versi pertama melacak kemajuan per
tanggal: kalau Surabaya timeout sementara 4 kota lain berhasil, tanggal itu tercatat
selesai dan `--resume` melewatinya selamanya — lubang permanen yang tidak kelihatan.
Sekarang tiap pasangan dilacak sendiri, yang gagal dicoba ulang otomatis satu per satu di
akhir, dan sisa lubang dilaporkan dengan tanggal + kota yang tepat.

**Bawaannya 30 hari terakhir, bukan seluruh riwayat.** Dulu perintah tanpa argumen
menarik seluruh rentang yang ada di database — 267 hari untuk Pusat, ±1 jam sekali jalan.
Untuk pemakaian sehari-hari yang dibutuhkan hanya jendela pendek, jadi riwayat panjang
sekarang harus diminta terang-terangan: `--days=N`, `--from/--to`, atau `--penuh`.

**Nama area `All` ditolak di semua jalur masuk.** `--areas`, Pengaturan
`sales_pull_areas`, dan daftar dari OCS disaring lewat fungsi yang sama
(`saringArea()`), dan `All`/`semua`/kosong menghentikan skrip dengan penjelasan.
OCS memang menerima `area=All`, tapi cakupannya ditentukan AKUN, bukan parameternya —
dengan akun `ADMIN` hasilnya hanya Pusat, tanpa error, dan 4 kota hilang diam-diam.
Lapisan kedua ada di `pullSalesDayArea()` yang melempar error untuk area `"all"`.

**`--resume` hanya mengisi lubang, dan itu memang harus begitu.** Versi pertama
menempelkan ambang kesegaran 12 jam pada `--resume`: pasangan dilewati hanya kalau
datanya lebih baru dari 12 jam. Sehari setelah backfill selesai, SEMUA data lebih tua
dari itu, jadi `--resume` mengantre seluruh rentang lagi — 751 pasangan padahal
lubangnya 16 (kena 29 Sep 2026). Sekarang `--resume` murni menambal lubang, dan menarik
ulang data yang sudah ada harus diminta terang-terangan dengan `--segarkan=JAM`.
Baris `mode :` di ringkasan selalu menyebut mana yang sedang berjalan, dan tarik ulang
penuh tanpa flag apa pun diberi peringatan dulu.

**Bawaannya 1 pasangan pada satu waktu (berurutan).** Paralel 3 diuji 25 Sep 2026 dan
hasilnya lebih buruk: berurutan ±2% pasangan gagal, paralel 3 jadi ±17%. Endpoint laporan
OCS berbasis SAP dan melambat drastis kalau ditanya beberapa hal sekaligus sampai
melewati batas waktu. `--paralel=N` masih ada, tapi jangan dinaikkan tanpa bukti.

`perPanggilanMs` pada `pullSalesDayArea` adalah batas **satu panggilan**, bukan total
untuk sepasang — ini ditegaskan setelah salah sekali: parameter itu dulu total lalu
dibagi (2 panggilan × jumlah percobaan), sehingga menaikkan percobaan jadi 2 diam-diam
memangkas batas tiap panggilan dari 60 dtk ke 22,5 dtk dan hari-hari Pusat yang berat
langsung berguguran. Backfill memakai 90 dtk × 2 percobaan, percobaan ulang di akhir
150 dtk. Vercel tetap 1 percobaan: di sana percobaan kedua membuat fungsi dibunuh di
tengah jalan, dan pasangannya lebih baik ditunda ke jalan berikutnya.

Tiap hari dilaporkan `qty` baru vs lama plus selisihnya, lalu ada ringkasan SEBELUM →
SESUDAH di akhir. `qty` yang **naik banyak di tanggal lama** bukan hal normal — kabari
kalau muncul; di tanggal baru wajar, karena status order masih berubah beberapa hari.

Stok tidak bisa di-backfill: OCS hanya memberi stok saat ini, tidak ada riwayatnya.
`stock_daily` terisi maju ke depan mulai hari pertama aplikasi jalan.

### Anggaran waktu penarikan

Satu hari kini = 2 panggilan OCS, sementara satu fungsi Vercel Hobby dibunuh di detik
ke-60. Jadi loop hari di `syncSales` beranggaran: berhenti rapi selagi masih sempat
menutup log & melepas kunci, lalu melaporkan hari yang **belum sempat**. Urutannya
2 hari terbaru dulu (paling sering berubah), sisanya dari yang **paling lama tidak
ditarik** — jalan berikutnya melanjutkan yang tertinggal, bukan mengulang hari yang sama.

Report OCS sudah memecah order ke level SKU komponen (item Gimmick hadiah ikut muncul),
jadi bundle tidak perlu dipecah lagi.

---

## Halaman

| Halaman | Isi |
|---|---|
| **Dashboard** | KPI (DOI total, perlu PO, NPL), status, distribusi DOI, ABC, prioritas open PO, overstock, phase out, tanggal yang dikecualikan, tombol Refresh. Tiap tabel diawali **resume total** yang dihitung dari SELURUH baris kelompoknya, bukan dari baris yang tampil. Phase Out / Overstock / NPL memuat **20 SKU dengan qty stok terbesar**, prioritas open PO 25 SKU paling mendesak (DOI terkecil); label *TOP 20* hanya muncul kalau daftarnya memang terpotong. Tautan *Lihat semua* membuka Tabel DOI yang sudah difilter |
| **Dashboard publik** | `/dashboard` — isi yang sama, baca-saja, **tanpa login**. Dikunci `?key=` bila `PUBLIC_TV_TOKEN` diset |
| **Tabel DOI** | Semua SKU: stok, transit, ADS 1/2, DOI 1/2 (+T), lead time, saran qty 1/2, status, tindakan, jual pertama; klik baris → rincian; export XLSX |
| **Stok Dalam Perjalanan** | Unggah 1 kolom qty per SKU (replace), edit per baris, kosongkan |
| **Lead Time & SKU** | Ganti massal (semua / terpilih), unggah, edit satu per satu, tandai dikecualikan |
| **Phase Out** | Unggah daftar **kode SAP**, dicocokkan lewat 6 digit terakhir (prefiks 1222/1201 diabaikan). SKU yang kena: status Phase Out, tanpa saran PO, keluar dari DOI total & ABC |
| **Simulasi Target DOI** | `/simulasi` — tentukan target DOI total, pilih kelas yang boleh dikurangi dan berapa hari yang disisakan, lalu sistem menghitung **SKU mana yang stoknya harus dipotong dan berapa pcs**. Hasilnya bisa di-**export XLSX** |
| **Analisis Stok Kosong** | `/stockout` — pilih rentang tanggal, lalu cari hari ketika SKU yang biasanya laku tiba-tiba **nol penjualan**, beserta perkiraan penjualan yang hilang. Dua tabel terpisah: *stok kosong* (semua platform nol) dan *masalah listing* (satu platform nol padahal platform lain tetap laku) |
| **Analisis SKU** | `/sku/<kode>` — grafik penjualan harian (hari campaign ditandai bergaris), riwayat stok, riwayat DOI, pecahan penjualan per platform, dan tabel angka harian. Dibuka dari tombol *Analisis lengkap* pada rincian baris Tabel DOI |
| **Data Penjualan** | Cakupan & tanggal yang hilang, unggah histori XLSX (panjang/melebar), tarik dari OCS (N hari / rentang ≤ 31 hari), log |
| **Pengaturan** | Semua parameter + tanggal pengecualian manual |

Setiap halaman unggah punya tautan *Template*.

---

## Penjadwalan (Vercel Hobby)

`vercel.json`: `/api/cron/sales` `0 18 * * *` (01.00 WIB) dan `/api/cron/compute`
`30 0 * * *` (07.30 WIB). Hobby membatasi dua cron per proyek, masing-masing sekali sehari,
dan waktunya bisa meleset sampai ±1 jam. Keduanya dilindungi `Authorization: Bearer <CRON_SECRET>`.

Tombol **Refresh** = `POST /api/compute` — tarik stok OCS saat itu, hitung, timpa snapshot hari ini.
Tabel `sync_lock` mencegah cron dan Refresh berjalan bersamaan.

### Batas waktu — kenapa Refresh pernah "lama lalu tidak berubah"

Vercel **Hobby membatasi satu fungsi 60 detik**. Menulis `maxDuration = 300` tidak
menaikkannya: prosesnya tetap dibunuh di detik ke-60, dan karena dibunuh, blok
`finally` tidak pernah jalan sehingga **kunci sinkronisasi tertinggal dipegang proses
yang sudah mati**. Selama jendela kunci basi belum lewat, setiap Refresh berikutnya
langsung ditolak dengan `skipped` — dari layar terlihat seperti "diproses lama, lalu
dashboard tidak berubah". Pemicu tersering: `fetchStock` dulu memakai timeout 90 dtk
× 3 percobaan (±276 dtk) — lebih panjang dari umur fungsinya sendiri.

Yang berlaku sekarang:

| | |
|---|---|
| `maxDuration` | **60 dtk** di semua route berat, sama dengan batas nyata platform |
| Anggaran internal | **52 dtk** (`src/lib/budget.ts`) — pekerjaan berhenti sendiri sebelum dibunuh, memberi pesan jelas, dan **melepas kuncinya** |
| Tarik stok OCS | diberi *sisa* anggaran dikurangi cadangan 20 dtk untuk hitung + simpan |
| Kunci basi | **2 menit** (dulu 10–15), karena fungsi tidak mungkin hidup lebih lama dari 60 dtk |
| Klien | penghitung detik berjalan, menyerah sendiri di 70 dtk, dan `skipped` ditampilkan sebagai peringatan mencolok — bukan teks abu yang terbaca seperti sukses |
| Log | `sync_log.message` mencatat waktu per langkah (`stok 18.4s · hitung 12.1s · simpan 10.3s`) supaya "lambat" bisa ditunjuk penyebabnya |

Skrip CLI (`npm run compute`, backfill) tidak dibatasi 52 dtk — di luar Vercel
anggarannya 15 menit, karena tidak ada yang akan membunuh prosesnya.

Setiap perhitungan juga menyimpan potret stok harian (`stock_daily`: available, on hand,
on order per SKU) dan potret DOI harian (`doi_snapshot`) — bahan grafik di halaman Analisis
SKU dan untuk pengaturan *keluarkan hari stok kosong* setelah data beberapa minggu terkumpul.

**Riwayat stok baru dimulai dari perhitungan pertama.** OCS hanya memberi stok *saat ini*,
tidak ada riwayatnya, jadi grafik stok kosong untuk tanggal sebelum aplikasi dipakai —
berbeda dengan penjualan, yang bisa diunggah mundur sampai Januari.

---

## Pengguna & login (multi-user)

Tabel `app_user`, password di-hash scrypt, sesi = cookie bertanda tangan HMAC (`SESSION_SECRET`, 14 hari).

| Role | Hak |
|---|---|
| **Admin** | semua, termasuk menu **Pengguna** (tambah, edit, reset password, nonaktifkan) dan Pengaturan |
| **User** | membaca + mengubah data (transit, lead time, unggah, refresh) |
| **Lihat saja** | hanya membaca; semua tombol simpan ditolak server (403) |

### Lupa password

Password disimpan sebagai hash scrypt satu arah — tidak bisa dibaca, hanya bisa diganti.
Kalau masih ada admin lain, reset lewat menu **Pengguna**. Kalau tidak ada, dari CLI:

```bash
npm run reset-password                                  # daftar semua pengguna
npm run reset-password -- admin                         # password acak, dicetak sekali
npm run reset-password -- admin --password=Rahasia123   # password pilihan sendiri (min 6 karakter)
npm run reset-password -- admin --create                # buat kalau belum ada (jadi ADMIN)
npm run reset-password -- admin --role=ADMIN            # sekalian kembalikan perannya
```

Akun yang nonaktif ikut diaktifkan kembali. Skrip menulis langsung ke `app_user` lewat
`DATABASE_URL` di `.env`, jadi jalankan dari folder `doi-monitor` dan pastikan `.env`
menunjuk ke database yang sama dengan yang dipakai Vercel. Sesi yang sudah berjalan tidak
ikut keluar — untuk memaksa semua keluar, ganti `SESSION_SECRET`.

Admin pertama: `npm run db:seed` membuatnya dari `ADMIN_USERNAME` / `ADMIN_PASSWORD` di `.env`
bila tabel masih kosong — atau buka halaman login, yang menampilkan form *Buat admin pertama*
selama belum ada pengguna. Tiap pengguna mengganti password sendiri di **Akun Saya**.
Admin aktif terakhir tidak bisa dinonaktifkan / dihapus / diturunkan.

## Dashboard TV — `/tv` (tanpa login)

Layar penuh, satu layar per slide, berganti otomatis: Ringkasan (KPI, status, distribusi DOI,
ABC, penjualan tertinggi) → Prioritas Open PO (dipecah N baris per slide) → Overstock →
Produk Baru → Dead Stock. Tombol keyboard: `←` `→` ganti slide, `spasi` jeda, `F` layar penuh.
Data dimuat ulang otomatis. Detik per slide, baris per slide, dan interval muat ulang diatur di
**Pengaturan → Dashboard TV**, atau lewat URL: `/tv?slide=20&rows=15`.

Bila `PUBLIC_TV_TOKEN` diisi di environment, halaman hanya terbuka dengan `/tv?key=<token>` —
pakai ini kalau URL aplikasi bisa dijangkau dari luar kantor. Kredensial OCS (`ADMIN`) hanya
dipakai server-side untuk membaca.
