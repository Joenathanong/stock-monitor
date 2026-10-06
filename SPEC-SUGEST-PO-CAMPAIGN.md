# Spesifikasi: Area dari Pengaturan, Sugest PO, dan Campaign Calendar

Keputusan user 2 Okt 2026. Dokumen ini yang dipakai saat mengerjakan; kalau kode
dan dokumen ini berbeda, dokumen ini yang salah dan harus diperbarui.

## 0. Dua jebakan yang harus dipegang sejak awal

**`GBJD` adalah dua gudang berbeda di dua sistem berbeda.**

| | sistem | artinya | dipakai untuk |
|---|---|---|---|
| `GBJD` | OCS `receive-stock` | gudang pusat **IEG** → area "Pusat" | SIT / Barang dalam Perjalanan |
| `GBJD` | web EJI `sap_whs/stock` | gudang pusat **EJI** (pemasok) | saldo sumber PO |

Seluruh area IEG **termasuk Pusat** membuka PO ke GBJD-nya EJI. Pusat bukan
sumber; dia ikut jadi peminta dan ikut berebut saldo yang sama.

Di kode dan database dua hal ini TIDAK PERNAH memakai kolom atau tipe yang sama:
- `areaCode` — milik tabel `area`, kode gudang OCS (GBJD, GJSB, …)
- `supplierWhs` — milik klien SAP WHS EJI, nilainya juga "GBJD" tapi beda dunia

**`prisma db push` MENGHAPUS tabel yang tidak ada di schema.prisma.** Pernah
menghilangkan 4.828 baris snapshot di proyek ini. Aturan untuk pekerjaan ini:
hanya MENAMBAH model, tidak ada rename, dan sebelum push jalankan ekspor JSON
seluruh tabel yang akan disentuh.

**Kredensial.** `EJI_USERNAME` / `EJI_PASSWORD` hanya nama env; nilainya diisi
user sendiri di `.env` dan di Vercel. Tidak pernah ditulis ke berkas repo.
Password yang sempat tertulis di chat 2 Okt 2026 dianggap bocor dan harus diganti.

## 1. Area jadi data, bukan kode

Tabel baru `area`:

| kolom | arti |
|---|---|
| `code` | kode gudang OCS, PK (GBJD, GJSB, GJYG, GJMK, GJMD, …) |
| `name` | nama area yang dipakai di seluruh aplikasi ("Pusat", "Surabaya") |
| `isActive` | ikut ditarik & dihitung |
| `sortOrder` | urutan tampil |
| `doiMin` | ambang masuk Sugest PO (hari) |
| `doiMax` | tingkat isi-ulang, PO dipesan sampai penuh ke sini (hari) |
| `startDate` | tanggal mulai operasional (menggantikan `sales_area_start`) |
| `note` | keterangan bebas |

- `KODE_AREA` di `src/lib/receive.ts` DIHAPUS, diisi dari tabel ini.
- Diisi awal dari 5 kode yang sekarang ada di kode itu.
- Kode gudang yang TIDAK terdaftar: sekarang jatuh ke "Pusat" diam-diam
  (`namaArea`, receive.ts:62). Diganti: tampil apa adanya sebagai area asing
  **plus peringatan di layar**, supaya cabang baru yang belum didaftarkan tidak
  menyamar jadi Pusat dan menambah SIT-nya.
- CRUD di `/settings` → bagian Area. Menambah cabang = menambah baris, tanpa deploy.

## 2. Mapping SKU jadi tabel, bukan heuristik

Alasan: dulu dua wadah (IEG 1222, EJI 1201) berbagi 6 digit terakhir. Sekarang
ada produk sama yang 6 digitnya berbeda, jadi aturan itu tidak bisa dipercaya
lagi. Dan jumlah kode per produk bisa lebih dari 3.

Tabel baru `sku_link`:

| kolom | arti |
|---|---|
| `id` | PK |
| `groupKey` | kunci produk logis — satu produk, berapa pun kodenya |
| `system` | `OCS` \| `SAP` |
| `code` | kode SKU OCS atau kode SAP |
| `priority` | urutan pengambilan saat PO; kecil = diambil dulu |
| `perCtn` | isi karton kode INI (bisa beda antar kode produk yang sama) |
| `note` | |

- Pencocokan 6-digit dipakai **sekali** untuk mengisi awal tabel, lalu user yang
  pegang. Sesudah itu tidak ada lagi kesimpulan dari bentuk kode.
- `src/lib/openpo.ts` sekarang mengunci TEPAT DUA kode (`saldo122`/`saldo120`,
  `qty122`/`qty120`, `perCtn122`/`perCtn120`). Diganti jadi daftar berprioritas
  panjang bebas. `openpo.test.ts` ikut ditulis ulang.

## 3. Sugest PO

Pemicu dan jumlah — kebijakan min-max:

```
posisi = stok + transit(SIT)
masuk Sugest PO   bila  DOI(dengan campaign) <= area.doiMin
kebutuhanDasar    = ceil(ads x area.doiMax) - posisi
kebutuhanCampaign = sisa qty campaign area yang jendelanya tumpang-tindih horizon
need              = max(0, kebutuhanDasar + kebutuhanCampaign)
```

Dipesan sampai **penuh ke `doiMax`**, bukan sampai `doiMin`. Kalau hanya sampai
min, besok menyentuh min lagi dan PO jadi receh tiap hari.

Pembagian ke kode SAP — berurut `priority`, semuanya karton utuh:

```
butuhSisa = need
untuk tiap kode menurut priority:
  box      = perCtn(kode)
  maxCtn   = floor(saldoSisa(kode) / box)        <- hanya karton utuh yang ada
  ambilCtn = min(maxCtn, ceil(butuhSisa / box))
  qty      = ambilCtn x box
  butuhSisa   -= qty
  saldoSisa(kode) -= qty                          <- saldo dipakai bersama antar area
  bila butuhSisa <= 0: berhenti
```

Contoh user (harus lolos sebagai tes): SKU A isi 48 saldo 50, SKU B isi 12,
need 96 → A: floor(50/48)=1 ctn = 48 pcs; sisa 48 → B: ceil(48/12)=4 ctn = 48
pcs. Total 96, semuanya full box.

Aturan yang DIPERTAHANKAN dari openpo.ts sekarang:
- saldo pemasok dikurangi tiap kali dipakai, jadi satu karton tidak dijanjikan
  ke dua area;
- urutan pelayanan saat saldo diperebutkan: CRITICAL → LOW → DOI terkecil → need terbesar;
- `< 1 karton` tapi DOI tipis (CRITICAL/LOW) → tetap diproses walau pecahan;
- saldo ≤ 0 → tanpa angka, keterangan "Stock GBJD Kosong";
- isi karton tidak diketahui → dikirim apa adanya, ditandai `TANPA_ISI_KARTON`.

Sumber saldo: `https://web.eji.co.id/sap_whs/stock`, gudang `GBJD` saja, kolom
Balance (With SQ). Disimpan ke tabel baru `supplier_stock` (`supplierWhs`,
`sapCode`, `balance`, `perCtn`, `pulledAt`) supaya halaman tidak menarik ulang
tiap buka.

## 4. Campaign Calendar

Sumber: `https://ocs.iegsystem.id/campaign-calendar`.

Tabel baru `campaign` (kepala): `id`, `name`, `startDate`, `endDate`,
`isExcluded` (checklist seperti phase out), `remark`, `source`, `updatedAt`.

Tabel baru `campaign_line` (rinci): `id`, `campaignId`, `marketplace`, `shop`,
`sku`, `qty`, `remark`.

Irama kerja: diajukan tiap **Jumat** untuk Senin–Minggu berikutnya, dihitung tiap
**Sabtu**.

### 4.1 Campaign = keranjang permintaan TERPISAH, bukan kenaikan ADS

ADS menengok ke belakang; campaign menunjuk ke depan. Kalau qty campaign
dilebur jadi kenaikan ADS, dua hal rusak sekaligus: DOI antar minggu tidak bisa
dibandingkan lagi, dan laporan rencana-vs-realisasi jadi mustahil karena
rencananya sudah melebur ke dalam realisasinya.

Pembagian ke area: **rata ke semua area aktif, lalu dibulatkan NAIK ke karton**
(keputusan user). Akibatnya total hasil pembagian lebih besar dari rencana —
selisih itu **dilaporkan**, tidak disembunyikan.

```
qtyArea = ceil( (qtyLine / jumlah area aktif) / perCtn ) x perCtn
selisihPembulatan = (qtyArea x jumlah area) - qtyLine     -> ditampilkan di laporan
```

### 4.2 DOI dengan campaign — dihitung berjalan, bukan satu pembagian

```
campHarian = qtyArea / jumlah hari jendela      <- hanya di dalam Senin-Minggu itu

sisa = posisi; hari = 0
untuk d = hari ini .. +365:
  permintaan = ads + (d di dalam jendela ? campHarian : 0)
  bila permintaan <= 0           -> DOI tak terhingga (dibatasi 999)
  bila sisa < permintaan         -> DOI = hari + sisa/permintaan ; selesai
  sisa -= permintaan ; hari += 1
```

`posisi / (ads + campHarian)` SALAH dipakai, karena campaign hanya hidup 7 hari;
rumus itu membuat stok yang sebenarnya cukup sampai bulan depan terlihat kritis.

Status & warna dashboard memakai **DOI dengan campaign** (keputusan user).
DOI dasar tetap ditampilkan sebagai kolom pembanding, supaya tren lama tetap
bisa dibaca.

### 4.3 Checklist exclude — terikat jendela waktu, bukan permanen

Beda dari phase out, yang tandanya menempel di SKU selamanya.

```
terserap   = penjualan SKU+area sejak jendela mulai sampai hari ini
cadangan   = max(0, qtyArea - terserap)      <- hanya SELAMA jendela berjalan
DOI bersih = (posisi - cadangan) / ads
```

Begitu `endDate` lewat, `cadangan` jadi **nol dengan sendirinya** — sisa stok
langsung ikut perhitungan normal, tanpa ada yang perlu mencentang ulang. Itu
menutup kekhawatiran "akan menumpuk kalau ikut ter-exclude": tidak ada jalan bagi
stok untuk tertinggal di luar perhitungan.

Exclude mempengaruhi **angka DOI saja**. Kebutuhan PO tetap menghitung qty
campaign (permintaan user), jadi stok yang dicadangkan tidak membuat DOI
terlihat tipis lalu memicu PO dua kali untuk barang yang sama.

### 4.4 Laporan campaign — rencana vs realisasi

Dua kolom realisasi, keduanya ditampilkan (keputusan user):

| kolom | rumus | menjawab |
|---|---|---|
| Terjual di jendela | Σ qty penjualan SKU+area di Senin–Minggu itu | terserap atau tidak |
| Kenaikan di atas ADS | Σ (qty harian − ads dasar), diambil yang positif | campaign-nya berhasil, atau cuma penjualan biasa |

Plus, sesuai permintaan: **berapa yang TIDAK terserap dan jadi stok WH**

```
tidakTerserap = max(0, qtyArea - terjualDiJendela)
nilaiRupiah   = tidakTerserap x harga
```

dengan keterangan apa adanya: qty ini sekarang menjadi stok gudang biasa dan
ikut perhitungan DOI normal sejak hari setelah campaign selesai.

**Batas yang harus disebut di layar:** `sales_daily` punya kolom per marketplace
(`qtyShopee/qtyTiktok/qtyTokped/qtyLazada/qtyOther`) tapi TIDAK punya kolom shop.
Jadi rencana boleh diisi per shop, realisasinya hanya bisa dibandingkan sampai
tingkat (SKU, area, marketplace). Kalau perlu sampai shop, penarikan penjualan
harus diubah dulu — pekerjaan terpisah.

## 5. Urutan pengerjaan

Tiap batch berdiri sendiri dan bisa dipakai sebelum batch berikutnya jadi.

1. **Tabel `area` + Pengaturan Area** (termasuk doiMin/doiMax), `KODE_AREA`
   dihapus, peringatan kode asing. Tanpa ini, cabang baru tetap perlu deploy.
2. **`sku_link` + UI mapping**, pengisian awal dari 6-digit, `openpo.ts`
   digeneralisasi ke N kode, tes ditulis ulang (termasuk contoh 48/12/96).
3. **Klien SAP WHS EJI** → `supplier_stock`. Env `EJI_USERNAME`/`EJI_PASSWORD`.
4. **Halaman `/sugest-po`** + API: min-max per area, pembagian N kode, full
   karton, saldo dipakai bersama, urutan kemendesakan.
5. **Campaign**: tabel, penarik dari OCS, pembagian rata+karton, kolom DOI
   campaign, exclude terikat jendela, jadwal Sabtu.
6. **Laporan campaign**: dua kolom realisasi, tidak terserap → stok WH,
   selisih pembulatan.

## 6. Yang masih belum diputuskan

- Shop → area: belum ada pemetaan. Selama belum ada, campaign di shop tertentu
  tetap dibagi rata ke SEMUA area aktif.
- `doiMin`/`doiMax` awal per area: belum diisi user. Sementara memakai
  `target_doi_days` dan `safety_days` yang ada sekarang sebagai nilai awal.
- Apakah PO ke principal untuk mengisi GBJD-nya EJI juga perlu disarankan di
  aplikasi ini — user menjawab lingkupnya IEG → GBJD EJI, jadi untuk sekarang
  TIDAK.

---

## Status pengerjaan

### Batch 1 — Area dari Pengaturan: SELESAI dikodekan (2 Okt 2026)

Berkas yang berubah:

| berkas | perubahan |
|---|---|
| `prisma/schema.prisma` | + `model Area` (tabel `area`). 19 model lama UTUH, tidak ada rename |
| `src/lib/area-master.ts` | BARU — modul murni: peta kode, ambang DOI per area, validasi |
| `src/lib/area-master.test.ts` | BARU — 13 tes |
| `src/lib/area-store.ts` | BARU — pembaca tabel `area` + pengisian awal |
| `src/lib/receive.ts` | `KODE_AREA` & `namaArea` DIHAPUS; `mapReceive` menerima peta area; hasilnya menambah `kodeAsing` |
| `src/lib/receive.test.ts` | disesuaikan + 2 tes baru (kode asing, cabang baru tanpa ubah kode) |
| `src/lib/sync.ts` | peta area dari tabel; `areaUntukTarik` membaca tabel `area` lebih dulu; pesan memperingatkan kode belum terdaftar |
| `src/app/api/area-master/route.ts` | BARU — GET / PUT / DELETE / POST (isi otomatis) |
| `src/components/AreaMaster.tsx` | BARU — kartu Cabang/Area di Pengaturan |
| `src/app/settings/page.tsx` | memuat kartu itu; kartu lama diganti nama jadi "Area yang terdeteksi di data" |
| `scripts/seed-area.ts` + `npm run seed:area` | BARU |
| `scripts/check-receive-codes.ts` | ikut memakai tabel `area` |

Perubahan perilaku yang perlu diketahui sebelum deploy:

1. **Kode gudang tak dikenal TIDAK lagi dihitung sebagai "Pusat".** Dulu
   `namaArea` mengembalikan "Pusat" untuk kode asing DAN untuk kode kosong.
   Sekarang keduanya masuk `kodeAsing` dan qty-nya tidak ikut DOI area mana pun
   sampai didaftarkan. Lebih berisik, tapi tidak lagi menambah SIT Pusat diam-diam.
2. **`areaUntukTarik` membaca tabel `area` lebih dulu**, di atas deteksi dari
   `stock_current`. Cabang yang baru dibuka belum punya baris stok sama sekali,
   jadi deteksi dari stok tidak akan pernah menemukannya.
3. **Nama area unik ditegakkan.** Dua kode dengan nama area sama akan
   menggabungkan dua gudang jadi satu angka tanpa kelihatan keliru, jadi ditolak.
4. **Hapus area bawaannya NONAKTIF**, bukan hapus. Data lama memakai NAMA area
   sebagai kunci; menghapus barisnya membuat seluruh riwayat jadi area asing.
   Hapus betulan hanya dengan `?hard=1` dan hanya bila belum ada data memakainya.

Urutan menjalankan (penting — `npm test` akan gagal sebelum Prisma client
diregenerasi, karena `prisma.area` belum ada):

```
npm run db:push      # membuat tabel area + regenerate Prisma client
npm run seed:area    # isi dari 5 kode lama + nama area yang ada di stock_current
npm test             # 142 tes
npm run build
```

`db:push` di sini hanya MENAMBAH satu tabel. Tetap periksa dulu bahwa
`schema.prisma` memuat 20 model (19 lama + `Area`) sebelum menjalankannya —
`db:push` menghapus tabel yang tidak ada di schema.

Diuji di sesi ini dengan `node --experimental-strip-types` (tsx tidak bisa jalan
di shell Linux karena `node_modules` ter-build untuk Windows): **139 dari 142 tes
lulus**; 3 yang gagal murni keterbatasan harness itu — `budget.test.ts` memakai
`await import('./budget')` yang tidak ikut ditulis ulang, dan
`area-status.test.ts` menarik `./sync` → `@prisma/client` yang tidak terpasang di
folder uji. Keduanya harus lulus di `npm test` yang sebenarnya.

Perbaikan setelah ditanya user (2 Okt 2026): jalur kode sementara `TBD…`
DIBUANG. `isiAreaBawaan` dulu membuat baris berkode `TBD123` untuk nama area yang
ada di `stock_current` tapi kodenya belum diketahui. Itu keliru — barisnya tampak
terdaftar padahal tidak berfungsi, karena yang dipakai mencocokkan SIT adalah
kode gudangnya. Sekarang nama seperti itu dikembalikan sebagai `perluKode` dan
ditampilkan sebagai peringatan di Pengaturan, dan barisnya TIDAK dibuat otomatis.
Dengan data 2 Okt 2026 jalur itu memang tidak terpakai sama sekali:
`stock_current` berisi tepat Makassar, Medan, Pusat, Surabaya, Yogyakarta — dan
kelimanya sudah punya kode.

### Batch 2 — mapping SKU & Sugest PO N-kode: INTI SELESAI (2 Okt 2026)

| berkas | perubahan |
|---|---|
| `prisma/schema.prisma` | + `model SkuLink` (tabel `sku_link`), unik per (system, code) |
| `src/lib/sku-link.ts` | BARU — modul murni: group per SKU, kode per produk, penyusun `KodeSumber`, usulan isi awal dari 6-digit, deteksi kode bentrok |
| `src/lib/sku-link.test.ts` | BARU — 13 tes |
| `src/lib/openpo.ts` | DITULIS ULANG: dari dua slot (`saldo122`/`saldo120`) jadi `kode: KodeSumber[]` berurut `priority`, panjang bebas |
| `src/lib/openpo.test.ts` | DITULIS ULANG — 24 tes, termasuk contoh user 48/12/96 |

Aturan yang DIPERTAHANKAN utuh dari versi dua-slot: pembulatan naik ke karton,
round-down saat saldo kurang, "< 1 karton tapi DOI tipis tetap diproses",
"Stock GBJD Kosong", `TANPA_ISI_KARTON`, saldo dipakai bersama antar kota, dan
urutan kemendesakan CRITICAL → LOW → DOI terkecil → need terbesar.

Yang berubah bentuknya: `qty122/qty120/ctn122/ctn120` → `ambil: AmbilKode[]`, dan
`RingkasOpenPo.perKode`. Tidak ada halaman/API yang memakai `openpo.ts`, jadi
penggantian ini tidak memecahkan apa pun yang sudah jalan.

Catatan tentang prioritas: 122-dulu-lalu-120 sekarang hanya kasus khusus dari
`priority`. Tebakan awalnya dari TIGA digit pertama (`122x` → 1, `120x` → 2,
sisanya 9) — bukan empat digit. Tes pertama saya sempat salah di sini
(`1207010401` saya kira 9, padahal 2); kodenya yang benar.

Sisa batch 2 yang BELUM dikerjakan:
- `src/lib/sku-link-store.ts` (pembaca tabel) + API `/api/sku-link` + UI mapping
- tombol "usulkan dari 6 digit" yang menampilkan usulan untuk DIPERIKSA user
  sebelum disimpan (jangan langsung tulis — isinya tebakan)

### Batch 3 — klien stok gudang pemasok EJI: SELESAI dikodekan (2 Okt 2026)

Struktur halamannya DIBONGKAR LANGSUNG dari browser, bukan ditebak:

| hal | temuan |
|---|---|
| endpoint | `GET https://web.eji.co.id/dt/report_iv_stok` (DataTables server-side) |
| filter | `whs[]`, `itm[]`, `cat[]`, `nol` — dari `#txtWhs`, `#txtItem`, `#txtKat`, `#txtZero`. **Ketiganya MULTI-SELECT**, jadi array |
| kolom | `NO KODE NAMA WHS OH COM OP ODR BALNOSQ BAL` |
| arti | OH=On Hand, COM=Commited, OP=SQ (Open), ODR=Order, BALNOSQ=Balance (No SQ), **BAL=Balance (With SQ)** |
| dipakai PO | `BAL` — saldo yang sudah memperhitungkan SQ terbuka |
| ekspor | `sap_whs/stock/export/` (tidak dipakai) |
| CSRF | tidak ada di blok DataTables |
| isi karton | ikut di nama produk (`… 20ml X 100`), dibaca `isiBoxDariNama` |

Dua temuan yang tidak diduga:

1. **Ada `GBJD2` — "Bitung - Gudang Barang Jadi 2"** selain `GBJD`. Hanya GBJD
   yang diambil (sesuai permintaan user), tapi kalau ternyata stok tersebar di
   keduanya, tambahkan lewat env `EJI_WHS=GBJD,GBJD2` — JANGAN dengan mengubah kode.
2. **Struktur form login tidak bisa dibaca selagi sesi aktif**: `/login`
   menjawab 200 tanpa form, `/login/signin` 404. Jadi nama medan login dibuat
   bisa diatur dari env (`EJI_LOGIN_URL`, `EJI_FIELD_USER`, `EJI_FIELD_PASS`)
   daripada ditebak di kode dan gagal diam-diam dengan pesan menyesatkan.
   `EJI_COOKIE` disediakan sebagai jalan pintas menguji endpoint-nya saja.

| berkas | perubahan |
|---|---|
| `prisma/schema.prisma` | + `model SupplierStock` (tabel `supplier_stock`), PK (supplierWhs, sapCode) |
| `src/lib/eji.ts` | BARU — klien: login, paging DataTables, pembersih angka, pemetaan kolom |
| `src/lib/eji.test.ts` | BARU — 11 tes |
| `scripts/check-eji.ts` + `npm run check:eji` | BARU — uji sambungan, HANYA membaca |
| `scripts/sync-supplier-stock.ts` + `npm run sync:supplier` | BARU — tulis ke `supplier_stock` |
| `.env.example` | + nama env EJI (nilai tetap kosong) |

Catatan ketahanan yang sengaja dipasang: angka `"1.234"` (titik ribuan) dan
`"(50)"` (negatif dalam kurung) tidak jadi `NaN`; sel ber-HTML dibersihkan;
baris tanpa `KODE` dilewati; respons yang bukan JSON (dialihkan ke halaman
login) melempar pesan yang menyebut sebabnya; dan pembersihan baris lama
DILEWATI kalau penarikan cuma sebagian — kalau tidak, Sugest PO akan mengira
gudangnya kosong.

### Batch 3b — DUA gudang pemasok (2 Okt 2026)

User minta kedua gudang dipakai, dan menegaskan urutannya:

> "saya mau mengecek 2 kode di gudang GBJD2, jika tidak ada baru ke GBJD ini
> berlaku juga untuk pengecekan kodenya. jadi pengecekan kode sku berlaku di 2
> gudang dengan urutan 122 dan 120. dan urutan gudang GBJD2 lalu gbjd"

Jadi urutan pengambilannya:

```
1. GBJD2 / kode 122      <- gudang menentukan lebih dulu
2. GBJD2 / kode 120
3. GBJD  / kode 122
4. GBJD  / kode 120
```

`EJI_WHS=GBJD2,GBJD` — dan **urutan di env itu BERARTI**, bukan sekadar daftar.

Perubahan struktur, karena satu kode SAP kini bisa punya saldo di dua tempat:

| berkas | perubahan |
|---|---|
| `src/lib/openpo.ts` | `KodeSumber` + `supplierWhs` & `whsPriority`; urutan jadi (gudang, kode, urutan asli); saldo dikunci per **(gudang, kode)** bukan per kode; `AmbilKode` + `supplierWhs`; keterangan menyebut `GBJD2/1222…`; `RingkasOpenPo.perKode` dipisah per gudang |
| `src/lib/sku-link.ts` | `kodeSumber(..., daftarWhs)` membuat satu sumber per (kode × gudang); `kunciSaldo(kode, gudang)` dipakai bersama agar peta & pembacanya tidak pernah beda |
| `src/lib/eji.ts` | bawaan `GBJD2,GBJD`; `prioritasWhs()`; duplikat dibuang tapi urutan pertama menang |
| `.env` & `.env.example` | `EJI_WHS=GBJD2,GBJD` |

Akibat yang DISENGAJA dan sudah dikunci di tes: kode **120 dari GBJD2 bisa
terkirim walau 122 masih ada di GBJD**. Aturan "122 dulu" berlaku DI DALAM satu
gudang, tidak lintas gudang. Keterangan tiap baris menyebut gudang asalnya
supaya ini terlihat, bukan tersembunyi.

Gudang yang tidak punya baris saldo tetap disertakan sebagai sumber dengan saldo
0 — kalau barisnya dihilangkan, "kosong di GBJD2" tidak bisa dibedakan dari
"kodenya belum terdaftar di mapping".

### Batch 4–6 — belum dikerjakan

Lihat bagian 5. Berikutnya: halaman `/sugest-po` yang menyatukan kebutuhan DOI
(min/maks per area) + mapping `sku_link` + saldo `supplier_stock`.

---

## 7. Verifikasi langsung di web EJI — 5 Okt 2026

Dijalankan dari sesi Chrome yang SUDAH login (hanya GET, tidak ada data yang
diubah, password tidak pernah diketikkan). Hasilnya mengubah dua hal di kode.

### 7.1 Nama parameter filter SALAH — dan salahnya SENYAP

Nama medan di DOM bukan nama parameter, dan parameternya bersarang:

| DOM (select/checkbox) | parameter yang benar | yang dipakai kode lama |
|---|---|---|
| `txtWhs`  (multi) | `filter[whs][]` | `whs[]` ❌ |
| `txtItem` (multi) | `filter[itm][]` | `itm[]` ❌ |
| `txtKat`  (multi) | `filter[cat][]` | `cat[]` ❌ |
| `txtZero` (checkbox) | `filter[nol]` = `true`/`false` | `nol` = `1`/`0` ❌ |

Dibuktikan dengan memanggil fungsi `ajax.data` milik DataTables halaman itu
sendiri: ia mengisi `{ draw, filter: { whs: [], itm: [], nol: false, cat: [] } }`.

Yang berbahaya: nama yang salah **tidak ditolak, tapi diabaikan**.

```
whs[]=GBJD2&whs[]=GBJD&nol=0        -> HTTP 200, recordsTotal 618.796  (SEMUA gudang)
filter[whs][]=GBJD2&filter[whs][]=GBJD -> HTTP 200, recordsTotal 732
```

Jadi kalau jaringan Node sudah tembus TANPA perbaikan ini, `sync:supplier`
bukan gagal — ia menarik seluruh database stok EJI (618.796 baris, semua
gudang di seluruh Indonesia) dan menulisnya sebagai "saldo GBJD".
Sudah diperbaiki di `paramStok()`, dengan 2 tes penjaga supaya nama lama tidak
bisa kembali diam-diam.

### 7.2 GBJD2 ada, tapi saat ini KOSONG

| gudang | baris dengan saldo (nol=false) |
|---|---|
| GBJD  | 732 |
| GBJD2 | **0** |

`GBJD2 = GBJD2 - Bitung - Gudang Barang Jadi 2` memang ada di daftar gudang
(kodenya benar), tapi dengan `filter[nol]=false` tidak ada satu pun SKU
bersaldo. Baru muncul kalau `filter[nol]=true` — yaitu baris bernilai 0.

Konsekuensinya: urutan prioritas **GBJD2 lalu GBJD** sudah benar dan tetap
dipakai, tapi hari ini **selalu jatuh ke GBJD**. Itu bukan bug — jangan
dikejar sebagai bug nanti.

### 7.3 Hal lain yang terkonfirmasi

- Endpoint & 10 nama kolom (`NO KODE NAMA WHS OH COM OP ODR BALNOSQ BAL`) benar.
- Angka memakai pemisah ribuan **koma** (`"2,293"`), bukan titik. `angkaEji`
  tetap benar karena ia membuang semua karakter non-digit.
- Awalan kode di GBJD mencakup `1222` dan `1201`/`1207` — sesuai dugaan
  prioritas 122 → 120.
- `filter[nol]=false` bukan "buang semua nol": dari 732 baris GBJD masih ada
  1 baris `BAL = 0`. Jadi penyaringan nol tetap harus dilakukan di sisi kita.

### 7.4 Jaringan: TERNYATA TIDAK ADA YANG MEMBLOKIR — `check:net` 5 Okt 2026

Hasil user:

```
1. Proxy di environment : (tidak ada)
2. DNS A (IPv4)         : 103.146.63.126
3. TCP IPv4             : TIMEOUT setelah 6000 ms
4. Jabat tangan TLS     : OK (31 ms), Sectigo Limited
5. fetch()              : HTTP 200 dalam 1168 ms — BISA
```

**Kesimpulan: jalur Node SEHAT.** Tidak ada proxy perusahaan, tidak ada
antivirus yang memblokir `node.exe`. Jadi semua dugaan itu salah.

Dua kesalahan saya yang terbongkar di sini:

1. **Langkah 3 bohong.** TLS ke host & port yang SAMA berhasil 31 ms, dan fetch
   menjawab 200 — mustahil TCP-nya benar-benar timeout. Penyebabnya
   `net.connect({ host: <nama host>, family: 4 })` di Windows. Sekarang
   menyambung ke IP hasil DNS langsung, dan panduan bacanya ditulis ulang:
   **langkah 5 (fetch) adalah hakimnya** — kalau fetch 2xx/3xx, abaikan
   langkah 3. Ini kelas kesalahan yang sama dengan bug `check:transit` dulu:
   diagnostik yang percaya diri mengatakan hal yang salah, lebih buruk daripada
   tidak ada diagnostik.

2. **`ConnectTimeoutError` itu sesaat, bukan permanen.** Galat itu milik undici
   (mesin fetch bawaan Node) dengan batas 10 detik yang **tidak** dikendalikan
   `AbortController` kita — jadi memperbesar `timeoutMs` tidak pernah menolong.
   Beberapa menit kemudian fetch ke host yang sama sukses 1168 ms.

Perbaikan: `denganUlang()` di `eji.ts` — ulang **hanya** kegagalan menyambung
(`UND_ERR_CONNECT_TIMEOUT`, `ECONNRESET`, `ETIMEDOUT`, `EAI_AGAIN`,
`ECONNREFUSED`), maksimal 3 percobaan, jeda 1s lalu 3s. Yang **tidak** diulang:
abort dari `timeoutMs` kita sendiri (sudah menunggu lama) dan respons HTTP apa
pun (401/500 diulang tidak berubah). Dipasang di `minta()`, GET halaman login,
dan POST kredensial. Kalau tetap gagal 3x, pesannya menyuruh jalankan
`check:net` dan membaca langkah 5 — bukan menebak proxy.

### 7.5 Konsekuensi arsitektur yang belum pernah diangkat

Kalau `web.eji.co.id` hanya bisa diakses dari jaringan kantor, maka
**Vercel juga tidak akan pernah bisa**. Berarti `sync:supplier` tidak boleh
jadi cron Vercel; ia harus jalan on-prem (PC server yang sama dengan wa-bot)
dan push hasilnya ke TiDB. Perlu diputuskan sebelum Batch 4 dipasang ke
halaman `/sugest-po`.

---

## 8. Koneksi EJI BERHASIL — `check:eji` 5 Okt 2026

Pertama kali jalur Node tembus dari ujung ke ujung. Jejaknya:

```
GET  /login            -> 200, 3208 byte, cookie: web
form: action=/login POST  user="txtUsername" pass="txtPassword"  ikut=[cmdSubmit]
POST /login            -> 200, 0 byte, cookie: web
verifikasi GET /sap_whs/stock -> 200, 239.551 byte -> SUDAH login
732 baris dari 732 yang dilaporkan API
```

### 8.1 Yang sebenarnya memperbaikinya

`cmdSubmit`. Form EJI hanya punya 3 medan — `txtUsername`, `txtPassword`,
`cmdSubmit(submit)` — dan aplikasinya memeriksa keberadaan tombolnya. Sebelum
`bacaFormLogin` bisa membaca `<button>`/`<input type=submit>` bernama dan
mengirimnya, POST dijawab dengan halaman login byte-identik (3208 byte) dan
terlihat seperti "password salah". Jadi penyebabnya bukan kredensial dan bukan
jaringan; keduanya sempat dicurigai dan keduanya salah.

Catat juga: **POST login menjawab 200 dengan badan 0 byte**, bukan 302. Jadi
"dapat cookie" dan "status 2xx" dua-duanya BUKAN bukti login berhasil — hanya
verifikasi GET `/sap_whs/stock` (> 500 byte) yang membuktikannya. Jangan pernah
hapus langkah verifikasi itu.

### 8.2 Data nyata yang sekarang diketahui

| | |
|---|---|
| baris GBJD | 732 (dari 732 yang dilaporkan API — tidak sebagian) |
| baris GBJD2 | **0** — tidak ada barisnya sama sekali |
| kode bersaldo (BAL > 0) | 687 dari 732 → **45 kode bersaldo 0** |
| isi karton terbaca dari nama | 731 dari 732 |
| total BAL GBJD | 13.234.963 pcs |

Awalan kode di 10 terbesar semuanya `1201` (EJI). Isi karton nyata jauh lebih
beragam daripada contoh awal: 48, 72, 100, 144, **1000**. Aturan "full box"
berarti satu baris PO bisa melompat 1000 pcs sekali buka — ini yang membuat
pembulatan ke karton harus tetap dibandingkan dengan DOI max, bukan hanya min.

### 8.3 Satu kode yang isi kartonnya TIDAK terbaca

```
1101000247  Hanasui Next Level 2 in 1 Browmatic Deep Grey #03 Tester0.06
```

Namanya terpotong di sumbernya — tidak ada pola ` x <angka>`. Perilaku kode
sekarang sudah benar dan sengaja: baris ini **tidak** ditebak, ia ditandai
`TANPA_ISI_KARTON` dan dikirim dalam pcs. Isi manual di mapping SKU (`perCtn`
di `sku_link`) kalau kode ini memang di-PO.

Jangan diselesaikan dengan menebak dari kode sejenis — 1101 adalah tester, dan
menebak isi karton salah artinya salah kirim sejumlah karton.

### 8.4 Yang masih terbuka

- Vercel: host `web.eji.co.id` beralamat publik (103.146.63.126) dengan
  sertifikat Sectigo, jadi KEMUNGKINAN bisa dari internet — tapi itu dugaan,
  belum diuji. Shell saya diblokir egress sandbox, jadi saya tidak bisa
  membuktikannya. Uji sebelum memasang `sync:supplier` sebagai cron Vercel.
- `npm run db:push` belum dijalankan → 3 tabel baru (`area`, `sku_link`,
  `supplier_stock`) belum ada, jadi `sync:supplier` belum bisa menulis.

---

## 9. Batch 2 selesai + guard DOI max — 5 Okt 2026

### 9.1 Pembulatan karton sekarang dibatasi DOI max (perubahan perhitungan)

Dipicu data nyata: isi karton di GBJD bukan 48–144 seperti contoh awal. Naturgo
Peel Off Mask isinya **1000 pcs/karton**. Tanpa batas atas,
`Math.ceil(sisa / perCtn)` pada kebutuhan 50 pcs menyarankan 1 karton = 1000 pcs
— 20x kebutuhan, dan DOI langsung melesat di atas max.

`BarisOpenPo` dapat medan baru `maxQty` (pcs). Dihitung PEMANGGIL (mesin DOI yang
tahu ADS & stok), bukan di `openpo.ts` — modul itu tidak boleh tahu soal ADS.
`undefined`/0 = tanpa batas, jadi perilaku lama dipertahankan utuh.

Aturannya:

| keadaan | hasil | alasan |
|---|---|---|
| bulat-naik masih di bawah plafon | seperti dulu | `OK` |
| bulat-naik lewat plafon, masih ada karton yang masuk | **bulat TURUN** | `DIBATASI_DOI_MAX` |
| 1 karton terkecil saja sudah lewat max, DOI TIDAK tipis | **tidak dikirim**, dilaporkan | `KARTON_LEBIH_DARI_MAX` |
| 1 karton terkecil saja sudah lewat max, DOI tipis (CRITICAL/LOW) | **tetap dikirim** 1 karton, ditandai | `KARTON_LEBIH_DARI_MAX` |
| `maxQty` < kebutuhan | **kebutuhan yang menang** (plafon = max(maxQty, need)) | — |

Dua baris terakhir adalah penilaian, bukan fakta, jadi ditulis di sini terang-
terangan: kehabisan barang dinilai lebih mahal daripada kelebihan stok, TAPI
hanya saat DOI sudah tipis. Di luar itu sistem menolak memutuskan dan menyerahkan
ke orang. Kalau penilaian ini tidak cocok dengan cara kerja tim, ini satu tempat
yang perlu diubah — bukan tersebar.

Jebakan yang ketemu lewat tes sendiri: versi pertama perbaikan ini menulis
keterangan "agar tidak melewati DOI max (batas 400 pcs)" untuk hasil 432 pcs,
karena plafonnya sebenarnya berasal dari `need`, bukan dari `maxQty`. Pesan yang
berbohong. Sekarang keterangannya menyebut batas yang BENAR-BENAR mengikat, dan
ada tes yang menjaganya.

### 9.2 Berkas baru

| berkas | isi |
|---|---|
| `src/lib/sku-link-store.ts` | baca/tulis `sku_link`; tabel belum ada → `siap: false`, bukan galat |
| `src/app/api/sku-link/route.ts` | GET (daftar / `?usul=1`), PUT (satu baris), POST (simpan borongan), DELETE |
| `src/components/SkuLinkMaster.tsx` | tabel mapping per produk + panel usulan yang harus dicentang dulu |

Keputusan yang dipertahankan di tiga tempat itu:

- **Usulan 6 digit tidak pernah auto-simpan.** Panel usulan muncul dengan
  centang KOSONG — mencentang semua secara bawaan membuat tombol simpan terasa
  seperti "terima saja", padahal isinya tebakan.
- **POST menyimpan baris yang DIKIRIM user**, bukan menghitung ulang usulannya di
  server. Kalau dihitung ulang, yang tersimpan bisa beda dari yang dilihat dan
  disetujui user — untuk mapping yang menentukan ke mana barang di-PO itu tidak
  boleh terjadi.
- **Kode yang sudah dipakai produk lain tidak dipindah diam-diam.** Ditolak
  dengan menyebut groupKey lamanya; pemindahan butuh `bolehPindah: true`.
- **Simpan borongan per baris, bukan satu transaksi besar.** Usulan bisa ratusan
  baris dan sebagian memang bentrok; menggagalkan semua karena satu bentrok
  memaksa user memperbaiki satu-satu tanpa tahu mana yang sudah masuk.
- **Isi karton per KODE, bukan per produk.** Dari 51 pasangan di GBJD, 35
  pasangan isi kartonnya berbeda antar wadah.
- **`kodeBentrok` ditampilkan sebagai galat merah**, bukan peringatan: satu kode
  di dua produk membuat Sugest PO tidak bisa menentukan barangnya milik siapa.

### 9.3 Jebakan penjaga `sql-cadangan.test.ts` (kena lagi, beda bentuk)

`npm test` merah karena penjaga kata-cadangan menuduh `sku-link-store.ts`
memakai kolom `system` tanpa backtick di SQL mentah. **Tuduhannya palsu** — SQL
mentah di berkas itu tidak memuat `system` sama sekali.

Penyebabnya: pemindai itu mencari literal berkutip dan **tidak mengerti literal
REGEX**. Satu apostrof di dalam `/doesn't exist/` dibaca sebagai pembuka string,
paritas kutip SELURUH berkas bergeser, dan potongan KODE terbaca sebagai SQL.

Diperbaiki dua-duanya, karena memperbaiki berkas saya saja tidak menghapus
jebakannya untuk orang berikutnya:

1. `sku-link-store.ts` memakai `/doesn.t exist/` (sama maksudnya, tanpa apostrof).
2. `petikanSql()` sekarang menuntut kandidat **berawal** dengan kata kerja SQL.
   Ditambah tes "pemindai masih MENANGKAP pelanggaran setelah dipersempit" —
   tanpa itu, mempersempit penjaga bisa membuatnya diam-diam tidak menjaga apa
   pun, kegagalan yang tidak akan pernah terlihat.

### 9.4 Status verifikasi

- `npm run typecheck` bersih.
- 207 tes; 202 lulus di lingkungan saya, 5 sisanya gagal HANYA karena harness
  saya menjalankan salinan di luar repo (`@prisma/client` tidak terpasang, satu
  `await import()` dinamis, dan dua tes yang membaca `prisma/schema.prisma`
  lewat path relatif). Dua tes yang menyentuh kode baru — `prisma-args` dan
  `sql-cadangan` — dijalankan dari root repo dan LULUS.
- `next build` belum dijalankan; perlu dijalankan user.

---

## 10. Kategori stok per kota — 4 pita, 3 batas (data user 5 Okt 2026)

### 10.1 Angka yang dikirim user, apa adanya

| | Pusat | Medan | Makassar | Surabaya | Yogyakarta |
|---|---|---|---|---|---|
| Kritis | <4 | <14 | <14 | <7 | <7 |
| Low | <5 | 15-21 | 15-31 | 8-14 | 8-13 |
| Aman | =7 | 22-35 | 32-45 | 15-21 | 14-20 |
| Overstock | >7 | >35 | >45 | >21 | >20 |

### 10.2 Ada CELAH kalau dibaca harfiah

Dibaca harfiah, `<14` = 0..13 sedangkan Low mulai 15 → **hari ke-14 tidak masuk
pita mana pun**. Sama di Makassar. Surabaya & Yogyakarta: **hari ke-7** hilang.
SKU yang persis di hari itu tidak akan muncul di laporan mana pun, tanpa jejak.

Dibaca sebagai **"sampai N"** (≤N), keempat kota itu jadi RAPAT sempurna —
tidak ada celah, tidak ada tumpang-tindih. Jadi itu bacaan yang dipakai.

### 10.3 Disimpan sebagai TIGA batas, bukan enam

Empat pita hanya butuh tiga angka, karena batas atas satu pita adalah batas
bawah pita berikutnya:

```
DOI <= doiCritical -> CRITICAL
DOI <= doiMin      -> LOW        (masuk Sugest PO)
DOI <= doiMax      -> HEALTHY    (PO diisi sampai sini)
DOI >  doiMax      -> OVERSTOCK
```

Ini bukan penghematan kolom, ini pencegahan: dengan tiga batas, celah dan
tumpang-tindih **mustahil terjadi** — bentuk kesalahan yang justru ada di data
asli di 10.2. Menyimpan batas bawah DAN atas setiap pita membuka kembali pintu itu.

Hasil pembacaan:

| area | kritis | low | aman | pita |
|---|---|---|---|---|
| Pusat | 4 | **6** | 7 | ≤4 / 5-6 / 7 / >7 |
| Medan | 14 | 21 | 35 | ≤14 / 15-21 / 22-35 / >35 |
| Makassar | 14 | 31 | 45 | ≤14 / 15-31 / 32-45 / >45 |
| Surabaya | 7 | 14 | 21 | ≤7 / 8-14 / 15-21 / >21 |
| Yogyakarta | 7 | 13 | 20 | ≤7 / 8-13 / 14-20 / >20 |

**PUSAT low = 6 adalah DUGAAN saya, bukan data user.** Datanya menyebut Low
"<5" dan Aman "=7", yang meninggalkan hari ke-6 tanpa pita. Diisi 6 supaya
rapat. Perlu dikonfirmasi.

### 10.4 Yang berubah di perhitungan

- `Area.doiCritical` BARU (aditif, bukan rename — rename + `db:push` berbahaya).
- `ambangDoi()` mengembalikan 3 batas dan **memaksa** urutan naik, bukan hanya
  memvalidasinya di form: baris lama atau yang masuk lewat jalur lain tidak boleh
  membuat satu pita hilang. `kritis` dipotong ke `min - 1`, `max` diangkat ke `min`.
- `pitaDoi()` — urutan pita ditulis SATU kali, dipakai layar dan perhitungan.
  Kalau layar punya rumus sendiri, keduanya bisa berbeda tanpa kelihatan keliru,
  dan yang dipercaya user adalah yang di layar.
- `doi.ts` memakai ambang per area kalau ada. Saran qty diisi sampai `doiMax`
  area, bukan `targetDoiDays` global (Makassar jadi 45 hari, bukan 14).
- **Area yang ambangnya KOSONG tidak berubah sama sekali** — tetap relatif
  terhadap lead time (`CRITICAL: DOI <= leadTime`, `LOW: DOI <= leadTime +
  safetyDays`). Memasang fitur ini tidak boleh menggeser status area yang belum
  diatur.
- **GABUNGAN tidak memakai ambang kota mana pun.** Pitanya terlalu berbeda
  (Pusat 7 vs Makassar 45) untuk dijumlahkan; gabungan memakai pengaturan global.

### 10.5 Menu inputnya

`Pengaturan → Cabang / Area` dapat tiga kolom `Kritis ≤ / Low ≤ / Aman ≤` plus
kolom **Pita** yang menampilkan hasilnya hidup, dihitung dengan `ambangDoi` +
`ringkasPita` yang sama dengan perhitungan. Batas yang salah urut diwarnai merah
dan disebut akan dikoreksi otomatis. Validasi menyebut AKIBATNYA, bukan hanya
"tidak valid": "pita LOW hilang dan tidak ada SKU yang pernah berstatus LOW".

`npm run seed:ambang` mengisi 5 kota di atas. Hanya baris yang ambangnya masih
KOSONG — nilai yang sudah diubah dari layar TIDAK ditimpa, karena skrip tidak
boleh membatalkan keputusan user tanpa ia tahu. `--paksa` untuk menimpa. Skrip
ini memakai SQL mentah, bukan Prisma Client, supaya jalan sebelum maupun sesudah
`prisma generate`.

### 10.6 Status

- `npm run typecheck` bersih. 218 tes; 213 lulus, 5 sisanya artefak harness saya
  (lihat 9.4). Tes penjaga SQL dan prisma-args dijalankan dari root repo: lulus.
- `prisma generate` dan `next build` TIDAK bisa saya jalankan: engine Prisma
  diblokir egress sandbox (403), dan `node_modules` repo ini ter-build untuk
  Windows. Keduanya harus user jalankan.

---

## 11. Jawaban user 6 Okt 2026 — tiga hal yang tadinya menggantung

### 11.1 Pusat low = 5 hari (dugaan saya SALAH)

Saya menduga low=6; yang benar **5**. Jadi Pusat = **4 / 5 / 7**:

```
kritis 0-4   low 5 (satu hari)   aman 6-7   over >7
```

Tetap rapat tanpa celah. Perhatikan akibatnya: pita LOW Pusat hanya **satu
hari**. Begitu DOI Pusat turun dari 6 ke 5, besoknya sudah kritis. Jadi Sugest PO
Pusat praktis harus diperiksa harian — bukan masalah di kode, tapi konsekuensi
operasional dari angka itu yang perlu diketahui.

Diperbaiki di `scripts/seed-ambang.ts` dan 4 tes.

### 11.2 web.eji.co.id bisa diakses dari mana saja

Dikonfirmasi user. Jadi kekhawatiran di 7.5 / 8.4 **tidak berlaku**:
`sync:supplier` BOLEH jadi cron Vercel, tidak perlu dipaksa on-prem. Itu
menghapus satu syarat sebelum Batch 4.

Yang tetap berlaku: cron Vercel punya batas waktu eksekusi, sedangkan penarikan
GBJD 732 baris itu ringan — jadi tidak ada masalah di sisi itu.

### 11.3 Bot WhatsApp /doi SUDAH bisa kirim gambar

Dikonfirmasi user. Tujuh lapis tambalan di `wa-media-fix.js` berhasil.
Konsekuensinya: tidak perlu pindah ke Baileys, dan tidak perlu laporan
teks-saja. `/wasrc` tidak perlu dijalankan.

CATATAN PENTING untuk nanti: keberhasilan ini bergantung pada tambalan yang
dipasang DI DALAM halaman WhatsApp Web, dan versinya dipin lewat
`WA_WEB_VERSION`. Kalau suatu hari `/doi` gagal lagi setelah update, yang
pertama dicurigai adalah WhatsApp Web berubah — bukan kode bot.
