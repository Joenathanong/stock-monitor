'use client';
import { useCallback, useEffect, useState } from 'react';
import { AREA_GABUNGAN, labelArea } from '@/lib/areas';

const KUNCI = 'ieg-doi-area';

/**
 * Area yang sedang dilihat, dipakai bersama seluruh halaman.
 *
 * Disimpan di localStorage supaya pindah halaman tidak melempar orang kembali
 * ke Pusat, dan dibaca dari `?area=` kalau ada — supaya tautan ke area tertentu
 * bisa dibagikan. Tersimpan per browser, bukan per akun: ini pilihan tampilan,
 * bukan pengaturan sistem.
 */
export function useArea() {
  const [area, setAreaRaw] = useState<string | null>(null);
  const [siap, setSiap] = useState(false);

  useEffect(() => {
    let awal: string | null = null;
    try {
      const dariUrl = new URLSearchParams(window.location.search).get('area');
      awal = dariUrl || localStorage.getItem(KUNCI);
    } catch { /* localStorage bisa ditolak; bukan alasan halaman gagal */ }
    setAreaRaw(awal);
    setSiap(true);
  }, []);

  const setArea = useCallback((v: string | null) => {
    setAreaRaw(v);
    try { v ? localStorage.setItem(KUNCI, v) : localStorage.removeItem(KUNCI); } catch { /* abaikan */ }
  }, []);

  /** Tambahkan `?area=` ke URL API. null = biarkan server memilih bawaannya. */
  const withArea = useCallback(
    (url: string) => (area ? `${url}${url.includes('?') ? '&' : '?'}area=${encodeURIComponent(area)}` : url),
    [area],
  );

  return { area, setArea, withArea, siap };
}

/**
 * Pemilih area. Sengaja TIDAK tampil kalau cuma ada satu area — kontrol yang
 * tidak bisa mengubah apa pun cuma menambah kebisingan di layar.
 */
export function AreaPicker({
  areas, value, onChange, hint,
}: {
  areas: string[];
  value: string | null;
  onChange: (v: string) => void;
  hint?: string;
}) {
  if (!areas || areas.length <= 1) return null;
  return (
    <label className="flex items-center gap-2" title={hint ?? 'Area yang ditampilkan'}>
      <span className="text-[12px] text-label">Area</span>
      <select
        className="input h-8 w-auto py-0 text-[13px]"
        value={value ?? areas[0]}
        onChange={(e) => onChange(e.target.value)}
      >
        {areas.map((a) => (
          <option key={a} value={a}>{labelArea(a)}</option>
        ))}
      </select>
    </label>
  );
}

export { AREA_GABUNGAN, labelArea };
