import ExcelJS from 'exceljs';
import { parseDateCell, type DateKey } from './dates';

export type SheetRow = Record<string, unknown>;

/**
 * Baca lembar pertama sebuah berkas XLSX/CSV menjadi objek per baris.
 *
 * Nama kolom dinormalkan (huruf kecil, tanpa spasi/underscore) supaya
 * "SKU", "Sku", "sku " dan "seller_sku" semuanya cocok. Pengguna menyusun
 * berkasnya sendiri; memaksa satu ejaan persis hanya menghasilkan keluhan.
 */
export async function readSheet(
  buffer: ArrayBuffer | Buffer,
  opsi?: Parameters<typeof readSheetRinci>[1],
): Promise<SheetRow[]> {
  return (await readSheetRinci(buffer, opsi)).rows;
}

/**
 * Sama seperti `readSheet`, tapi IKUT mengembalikan nomor baris header.
 *
 * Perlu karena pelapor masalah harus menyebut nomor baris yang BENAR-BENAR
 * dilihat user di Excel. Lembar yang kita ekspor sendiri punya baris catatan di
 * atas header, jadi "baris ke-3 dari data" bukan "baris 4 di Excel" — kena 8 Okt
 * 2026: SKU bermasalah di baris 7 dilaporkan sebagai baris 4, dan user yang
 * membuka berkasnya akan memeriksa baris yang salah.
 */
export async function readSheetRinci(
  buffer: ArrayBuffer | Buffer,
  opsi?: {
    /**
     * Cari baris header, jangan anggap baris 1.
     *
     * Perlu karena lembar yang KITA ekspor sendiri menaruh baris catatan di
     * atas header (filter yang berlaku, tanggal). Tanpa ini, berkas hasil unduh
     * tidak bisa diunggah kembali — baris 1 terbaca sebagai nama kolom dan
     * seluruh isinya jadi omong kosong, tanpa galat.
     *
     * Isinya nama kolom yang pasti ada, mis. 'SKU'.
     */
    cariKolom?: string;
    /** Nama lembar yang dibaca. Tanpa ini: lembar pertama. */
    namaLembar?: string;
  },
): Promise<{ rows: SheetRow[]; barisHeader: number }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);
  const ws = opsi?.namaLembar
    ? (wb.getWorksheet(opsi.namaLembar) ?? wb.worksheets[0])
    : wb.worksheets[0];
  if (!ws) throw new Error('Berkas tidak memiliki lembar kerja');

  // Baris header: baris 1, atau baris pertama yang memuat `cariKolom`.
  let barisHeader = 1;
  if (opsi?.cariKolom) {
    const cari = normalizeKey(opsi.cariKolom);
    let ketemu = 0;
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (ketemu) return;
      let ada = false;
      row.eachCell({ includeEmpty: true }, (cell) => {
        if (normalizeKey(cellText(cell.value)) === cari) ada = true;
      });
      if (ada) ketemu = rowNumber;
    });
    if (!ketemu) throw new Error(`Kolom "${opsi.cariKolom}" tidak ditemukan di berkas`);
    barisHeader = ketemu;
  }

  const headers: string[] = [];
  ws.getRow(barisHeader).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = normalizeKey(cellText(cell.value));
  });

  const rows: SheetRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= barisHeader) return;
    const obj: SheetRow = {};
    let hasValue = false;
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const key = headers[col];
      if (!key) return;
      const v = unwrap(cell.value);
      obj[key] = v;
      if (v !== null && v !== '') hasValue = true;
    });
    if (hasValue) rows.push(obj);
  });
  return { rows, barisHeader };
}

function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[\s_\-.]/g, '');
}

function cellText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object' && v !== null && 'text' in (v as object)) return String((v as { text: unknown }).text);
  if (typeof v === 'object' && v !== null && 'result' in (v as object)) return String((v as { result: unknown }).result);
  return String(v);
}

function unwrap(v: unknown): unknown {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    const o = v as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join('');
    if ('result' in o) return o.result ?? null;
    if ('text' in o) return o.text ?? null;
    return null;
  }
  return v;
}

/** Ambil nilai kolom pertama yang cocok dari beberapa kemungkinan nama. */
export function pick(row: SheetRow, ...names: string[]): unknown {
  for (const n of names) {
    const key = normalizeKey(n);
    if (key in row && row[key] !== null && row[key] !== '') return row[key];
  }
  return null;
}

export function pickInt(row: SheetRow, ...names: string[]): number | null {
  const v = pick(row, ...names);
  if (v === null) return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function pickString(row: SheetRow, ...names: string[]): string | null {
  const v = pick(row, ...names);
  return v === null ? null : String(v).trim();
}

export function pickDate(row: SheetRow, ...names: string[]): DateKey | null {
  return parseDateCell(pick(row, ...names));
}

/** Bangun berkas XLSX dari daftar kolom dan baris. */
export async function writeSheet(
  sheetName: string,
  columns: { header: string; key: string; width?: number }[],
  rows: SheetRow[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DOI Planner';
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName);
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 16 }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of rows) ws.addRow(r);
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export type Lembar = {
  nama: string;
  columns: { header: string; key: string; width?: number }[];
  rows: SheetRow[];
  /** Baris catatan di atas tabel — mis. filter yang berlaku saat diunduh. */
  catatan?: string[];
};

/**
 * Bangun XLSX berisi BEBERAPA lembar.
 *
 * `writeSheet` di atas tetap ada dan tidak diubah: ia dipakai /api/export yang
 * sudah jalan, dan menambah parameter di sana berarti menyentuh jalur ekspor DOI
 * yang tidak sedang dikerjakan.
 *
 * `catatan` ditulis DI ATAS header, dan autoFilter/freeze digeser mengikutinya.
 * Gunanya satu: berkas yang diunduh dengan filter brand aktif harus menyebutkan
 * filternya di dalam berkas. Tanpa itu, "ATP 71%" di sebuah berkas tidak bisa
 * dibedakan dari ATP seluruh produk, dan berkas yang beredar lewat WhatsApp
 * kehilangan konteks URL-nya.
 */
export async function writeWorkbook(lembar: Lembar[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DOI Planner';
  wb.created = new Date();

  for (const L of lembar) {
    const ws = wb.addWorksheet(L.nama);
    // `ws.columns` DITETAPKAN LEBIH DULU, sebelum baris apa pun ditambahkan.
    // ExcelJS memakai `columns` untuk memetakan kunci objek ke nomor kolom; kalau
    // baris sudah ada saat ia diset, pemetaannya tidak berlaku untuk baris itu.
    // `header` sengaja TIDAK diisi di sini — kalau diisi, ExcelJS menulis header
    // di baris 1 dan baris catatan tidak bisa berada di atasnya.
    ws.columns = L.columns.map((c) => ({ key: c.key, width: c.width ?? 16 }));

    const catatan = L.catatan ?? [];
    for (const c of catatan) {
      const r = ws.addRow([c]);
      r.font = { italic: true, color: { argb: 'FF666666' } };
    }
    const barisHeader = catatan.length + 1;
    const head = ws.getRow(barisHeader);
    L.columns.forEach((c, i) => { head.getCell(i + 1).value = c.header; });
    head.font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: barisHeader }];
    for (const row of L.rows) ws.addRow(row);
    ws.autoFilter = {
      from: { row: barisHeader, column: 1 },
      to: { row: barisHeader, column: L.columns.length },
    };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
