'use client';
/**
 * DataGrid — tabel acuan LX02 (design-ocs.md v3.1 §11.1–11.2).
 * Wajib di setiap tabel: sort (klik label, Shift = bertingkat), filter per kolom
 * (popover operator), lebar kolom bisa ditarik (pointer events, <col>), menu Kolom,
 * pencarian global, klik ganda sel = salin, dan penyimpanan tampilan
 * di localStorage['ieg-grid:<id>'] = {widths, sort, filters, hidden}.
 * Di bawah 768px baris menjadi kartu; resize dimatikan, sort/filter lewat toolbar.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export type ColType = 'text' | 'number' | 'date';
export type Column<T> = {
  key: string;
  label: string;
  /** Nilai mentah untuk sort/filter/cari. */
  get: (r: T) => string | number | null | undefined;
  /** Tampilan sel; default = nilai mentah. */
  render?: (r: T) => ReactNode;
  type?: ColType;
  /** Font mono untuk kode/angka/tanggal (§11.1). */
  mono?: boolean;
  align?: 'left' | 'right';
  width?: number;
  /** Prioritas responsif: p2 hilang <1024, p3 hilang <1280 (§10.3). */
  prio?: 'p2' | 'p3';
  title?: string;
  /** Kolom judul kartu di mode HP. */
  isTitle?: boolean;
  sticky?: boolean;
  /** Tidak ikut dicari/sort/filter (mis. kolom aksi). */
  noSort?: boolean;
  noFilter?: boolean;
  /** Sembunyikan di kartu HP. */
  hideMobile?: boolean;
};

type Op = 'eq' | 'ne' | 'contains' | 'starts' | 'gt' | 'lt' | 'between' | 'empty' | 'notEmpty';
const OPS: { v: Op; l: string }[] = [
  { v: 'eq', l: '= sama dengan' }, { v: 'ne', l: '≠ tidak sama' }, { v: 'contains', l: '≈ mengandung' }, { v: 'starts', l: 'dimulai dengan' },
  { v: 'gt', l: '> lebih besar' }, { v: 'lt', l: '< lebih kecil' }, { v: 'between', l: 'antara' }, { v: 'empty', l: 'kosong' }, { v: 'notEmpty', l: 'tidak kosong' },
];
const OP_SHORT: Record<Op, string> = { eq: '=', ne: '≠', contains: '≈', starts: '^', gt: '>', lt: '<', between: '↔', empty: '∅', notEmpty: '≠∅' };

export type Filter = { op: Op; value: string; value2?: string };
type SortEntry = { key: string; dir: 'asc' | 'desc' };
type Saved = { widths?: Record<string, number>; sort?: SortEntry[]; filters?: Record<string, Filter>; hidden?: string[] };

export type DataGridProps<T> = {
  id: string;
  rows: T[];
  columns: Column<T>[];
  rowKey: (r: T) => string;
  /** Baris rincian di bawah baris terpilih. */
  expanded?: string | null;
  renderExpanded?: (r: T) => ReactNode;
  onRowClick?: (r: T) => void;
  rowClass?: (r: T) => string;
  pageSize?: number;
  /** Sembunyikan toolbar (tabel kecil di dashboard). Sort/filter/resize tetap ada. */
  compact?: boolean;
  emptyText?: ReactNode;
  loading?: boolean;
  /** Elemen tambahan di toolbar kiri (mis. tombol export). */
  toolbarExtra?: ReactNode;
  /** Filter dari luar (mis. select status di halaman) — dijalankan sebelum filter kolom. */
  preFilter?: (r: T) => boolean;
  footerNote?: ReactNode;
};

const MIN_W = 48;
const nfmt = new Intl.NumberFormat('id-ID');

function wildcardToRegex(s: string): RegExp | null {
  if (!s.includes('*')) return null;
  return new RegExp('^' + s.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
}

function matchOne(raw: string | number | null | undefined, f: Filter, type: ColType): boolean {
  const isEmpty = raw === null || raw === undefined || raw === '';
  if (f.op === 'empty') return isEmpty;
  if (f.op === 'notEmpty') return !isEmpty;
  if (isEmpty) return false;
  const values = f.value.split(';').map((v) => v.trim()).filter(Boolean);
  if (!values.length && f.op !== 'between') return true;
  const s = String(raw).toLowerCase();
  const n = type === 'number' ? Number(raw) : type === 'date' ? Date.parse(String(raw)) : NaN;
  const num = (v: string) => (type === 'date' ? Date.parse(v) : Number(v.replace(',', '.')));
  switch (f.op) {
    case 'eq': return values.some((v) => { const re = wildcardToRegex(v); return re ? re.test(s) : type === 'number' ? n === num(v) : s === v.toLowerCase(); });
    case 'ne': return !values.some((v) => { const re = wildcardToRegex(v); return re ? re.test(s) : type === 'number' ? n === num(v) : s === v.toLowerCase(); });
    case 'contains': return values.some((v) => { const re = wildcardToRegex(v); return re ? re.test(s) : s.includes(v.toLowerCase()); });
    case 'starts': return values.some((v) => { const re = wildcardToRegex(v); return re ? re.test(s) : s.startsWith(v.toLowerCase()); });
    case 'gt': return type === 'text' ? s > values[0].toLowerCase() : n > num(values[0]);
    case 'lt': return type === 'text' ? s < values[0].toLowerCase() : n < num(values[0]);
    case 'between': {
      const a = f.value.trim(), b = (f.value2 ?? '').trim();
      if (type === 'text') return (!a || s >= a.toLowerCase()) && (!b || s <= b.toLowerCase());
      return (!a || n >= num(a)) && (!b || n <= num(b));
    }
  }
  return true;
}

function compare(a: unknown, b: unknown, type: ColType): number {
  const ea = a === null || a === undefined || a === '', eb = b === null || b === undefined || b === '';
  if (ea && eb) return 0; if (ea) return 1; if (eb) return -1; // kosong selalu di bawah
  if (type === 'number') return Number(a) - Number(b);
  if (type === 'date') return Date.parse(String(a)) - Date.parse(String(b));
  return String(a).localeCompare(String(b), 'id');
}

const FunnelIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 5h18l-7 8v6l-4-2v-4z" /></svg>
);

export function DataGrid<T>(props: DataGridProps<T>) {
  const { id, rows, columns, rowKey, expanded, renderExpanded, onRowClick, rowClass, pageSize = 100, compact, emptyText, loading, toolbarExtra, preFilter, footerNote } = props;
  const storeKey = `ieg-grid:${id}`;
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [sort, setSort] = useState<SortEntry[]>([]);
  const [filters, setFilters] = useState<Record<string, Filter>>({});
  const [hidden, setHidden] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [pop, setPop] = useState<{ key: string; x: number; y: number; draft: Filter } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [fill, setFill] = useState(true);
  const tableRef = useRef<HTMLTableElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ---- persistensi tampilan
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storeKey);
      if (raw) {
        const s = JSON.parse(raw) as Saved;
        if (s.widths) { setWidths(s.widths); setFill(false); }
        if (s.sort) setSort(s.sort);
        if (s.filters) setFilters(s.filters);
        if (s.hidden) setHidden(s.hidden);
      }
    } catch { /* ignore */ }
    setLoaded(true);
  }, [storeKey]);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(storeKey, JSON.stringify({ widths, sort, filters, hidden } satisfies Saved)); } catch { /* ignore */ }
  }, [loaded, storeKey, widths, sort, filters, hidden]);

  const visibleCols = useMemo(() => columns.filter((c) => !hidden.includes(c.key)), [columns, hidden]);
  const colMap = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns]);

  // ---- pipeline: preFilter → cari global → filter kolom → sort
  const processed = useMemo(() => {
    let out = preFilter ? rows.filter(preFilter) : rows;
    const needle = q.trim().toLowerCase();
    if (needle) {
      const searchable = columns.filter((c) => !c.noFilter);
      out = out.filter((r) => searchable.some((c) => { const v = c.get(r); return v !== null && v !== undefined && String(v).toLowerCase().includes(needle); }));
    }
    for (const [key, f] of Object.entries(filters)) {
      const c = colMap.get(key); if (!c) continue;
      out = out.filter((r) => matchOne(c.get(r), f, c.type ?? 'text'));
    }
    if (sort.length) {
      const entries = sort.map((s) => ({ ...s, col: colMap.get(s.key) })).filter((s) => s.col);
      out = [...out].sort((a, b) => {
        for (const s of entries) {
          const d = compare(s.col!.get(a), s.col!.get(b), s.col!.type ?? 'text');
          if (d !== 0) return s.dir === 'asc' ? d : -d;
        }
        return 0;
      });
    }
    return out;
  }, [rows, preFilter, q, filters, sort, columns, colMap]);

  const pages = Math.max(1, Math.ceil(processed.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const pageRows = processed.slice(safePage * pageSize, (safePage + 1) * pageSize);
  useEffect(() => { setPage(0); }, [q, filters, sort, preFilter]);

  // ---- sort
  function clickSort(key: string, shift: boolean) {
    setSort((prev) => {
      const idx = prev.findIndex((s) => s.key === key);
      const cur = idx >= 0 ? prev[idx] : null;
      const next: SortEntry | null = !cur ? { key, dir: 'asc' } : cur.dir === 'asc' ? { key, dir: 'desc' } : null;
      if (!shift) return next ? [next] : [];
      const rest = prev.filter((s) => s.key !== key);
      return next ? (idx >= 0 ? [...prev.slice(0, idx), next, ...prev.slice(idx + 1)] : [...rest, next]) : rest;
    });
  }

  // ---- resize (pointer events, handle di dalam th, lebar di <col>)
  const drag = useRef<{ key: string; startX: number; startW: number; el: HTMLElement } | null>(null);
  const onHandleDown = (key: string) => (e: React.PointerEvent<HTMLSpanElement>) => {
    const th = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
    drag.current = { key, startX: e.clientX, startW: th.getBoundingClientRect().width, el: e.currentTarget };
    e.currentTarget.setAttribute('data-drag', '1');
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* boleh gagal */ }
    document.body.style.userSelect = 'none';
    setFill(false);
    e.preventDefault();
  };
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current; if (!d) return;
      const w = Math.max(MIN_W, Math.round(d.startW + e.clientX - d.startX));
      setWidths((prev) => ({ ...prev, [d.key]: w }));
    };
    const up = () => {
      const d = drag.current; if (!d) return;
      d.el.removeAttribute('data-drag'); drag.current = null; document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    return () => { window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true); };
  }, []);

  /** Auto-fit: ukur lebar isi terpanjang lewat canvas. */
  const autoFit = useCallback((keys?: string[]) => {
    const canvas = document.createElement('canvas').getContext('2d');
    if (!canvas) return;
    const font = getComputedStyle(tableRef.current ?? document.body);
    const sans = `${font.fontWeight} ${font.fontSize} ${font.fontFamily}`;
    const mono = `${font.fontWeight} ${font.fontSize} ui-monospace, Menlo, Consolas, monospace`;
    const next: Record<string, number> = {};
    for (const c of visibleCols) {
      if (keys && !keys.includes(c.key)) continue;
      canvas.font = `600 11px ${font.fontFamily}`;
      let w = canvas.measureText(c.label).width + 44;
      canvas.font = c.mono ? mono : sans;
      for (const r of processed.slice(0, 300)) {
        const v = c.get(r); if (v === null || v === undefined) continue;
        const t = c.type === 'number' ? nfmt.format(Number(v)) : String(v);
        w = Math.max(w, canvas.measureText(t).width + 18);
      }
      next[c.key] = Math.min(480, Math.max(MIN_W, Math.round(w)));
    }
    setWidths((prev) => ({ ...prev, ...next }));
    setFill(false);
  }, [visibleCols, processed]);

  function resetView() {
    setWidths({}); setSort([]); setFilters({}); setHidden([]); setFill(true);
    try { localStorage.removeItem(storeKey); } catch { /* ignore */ }
  }

  // ---- popover filter & menu kolom: tutup dengan ESC / klik luar
  useEffect(() => {
    if (!pop && !menu) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPop(null); setMenu(null); } };
    const click = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.grid-pop') && !t.closest('.grid-menu') && !t.closest('.grid-filter-btn') && !t.closest('[data-colmenu]')) { setPop(null); setMenu(null); }
    };
    document.addEventListener('keydown', key); document.addEventListener('mousedown', click);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('mousedown', click); };
  }, [pop, menu]);

  function openFilter(key: string, e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.min(rect.left, window.innerWidth - 262), y = rect.bottom + 4;
    setMenu(null);
    setPop({ key, x, y, draft: filters[key] ?? { op: 'contains', value: '' } });
  }
  function applyFilter() {
    if (!pop) return;
    const d = pop.draft;
    const active = d.op === 'empty' || d.op === 'notEmpty' || d.value.trim() || (d.op === 'between' && (d.value2 ?? '').trim());
    setFilters((prev) => { const n = { ...prev }; if (active) n[pop.key] = d; else delete n[pop.key]; return n; });
    setPop(null);
  }
  function clearFilter(key: string) { setFilters((prev) => { const n = { ...prev }; delete n[key]; return n; }); }

  // ---- klik ganda sel = salin
  function copyCell(e: React.MouseEvent<HTMLTableCellElement>) {
    const text = (e.currentTarget.textContent ?? '').trim();
    if (!text) return;
    navigator.clipboard?.writeText(text).then(() => { setToast('Disalin'); setTimeout(() => setToast(null), 1200); }).catch(() => {});
  }

  const activeFilters = Object.entries(filters);
  const sortIcon = (key: string) => {
    const i = sort.findIndex((s) => s.key === key);
    if (i < 0) return <span className="grid-sort" aria-hidden="true">⇅</span>;
    return <span className="grid-sort is-on" aria-hidden="true">{sort[i].dir === 'asc' ? '▲' : '▼'}{sort.length > 1 ? <sup>{i + 1}</sup> : null}</span>;
  };

  return (
    <div className="grid-card" data-grid={id}>
      {!compact ? (
        <div className="grid-toolbar">
          <input className="input grid-search" placeholder="Cari di semua kolom …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Pencarian global" />
          <button className="btn btn-sm hidden md:inline-flex" onClick={() => autoFit()} title="Lebar kolom mengikuti isi">Lebar otomatis</button>
          <button className="btn btn-sm hidden md:inline-flex" onClick={() => { setWidths({}); setFill(true); }} title="Regangkan ke lebar kontainer">Lebar penuh</button>
          <button className="btn btn-sm" data-colmenu onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setPop(null); setMenu(menu ? null : { x: Math.min(r.left, window.innerWidth - 220), y: r.bottom + 4 }); }} aria-haspopup="menu" aria-expanded={!!menu}>Kolom</button>
          <select className="input md:hidden" style={{ width: 'auto' }} aria-label="Urutkan" value={sort[0] ? `${sort[0].key}:${sort[0].dir}` : ''} onChange={(e) => { const [k, d] = e.target.value.split(':'); setSort(k ? [{ key: k, dir: d as 'asc' | 'desc' }] : []); }}>
            <option value="">Urutkan…</option>
            {columns.filter((c) => !c.noSort).flatMap((c) => [<option key={c.key + 'a'} value={`${c.key}:asc`}>{c.label} ▲</option>, <option key={c.key + 'd'} value={`${c.key}:desc`}>{c.label} ▼</option>])}
          </select>
          {toolbarExtra}
          <span className="grid-count">{nfmt.format(processed.length)} entries{processed.length !== rows.length ? ` dari ${nfmt.format(rows.length)}` : ''}</span>
        </div>
      ) : null}
      {activeFilters.length ? (
        <div className="grid-chips">
          {activeFilters.map(([key, f]) => (
            <span key={key} className="grid-chip">
              {colMap.get(key)?.label ?? key} {OP_SHORT[f.op]} {f.op === 'between' ? `${f.value}–${f.value2 ?? ''}` : f.op === 'empty' || f.op === 'notEmpty' ? '' : f.value}
              <button onClick={() => clearFilter(key)} aria-label={`Hapus filter ${colMap.get(key)?.label}`}>×</button>
            </span>
          ))}
          <button className="btn btn-sm" onClick={() => setFilters({})}>Hapus semua</button>
        </div>
      ) : null}

      <div ref={scrollRef} className="grid-scroll">
        <table ref={tableRef} className="grid" style={{ width: fill ? '100%' : Math.max(0, visibleCols.reduce((s, c) => s + (widths[c.key] ?? c.width ?? 120), 0)) }}>
          <colgroup>{visibleCols.map((c) => <col key={c.key} style={{ width: widths[c.key] ?? c.width ?? undefined }} />)}</colgroup>
          <thead>
            <tr>
              {visibleCols.map((c) => {
                const s = sort.find((x) => x.key === c.key);
                return (
                  <th key={c.key} className={`${c.align === 'right' || c.type === 'number' ? 'num' : ''} ${c.prio ?? ''} ${c.sticky ? 'sticky-col' : ''}`}
                    aria-sort={s ? (s.dir === 'asc' ? 'ascending' : 'descending') : 'none'} title={c.title}>
                    <div className="grid-th-inner">
                      {c.noSort ? <span className="grid-th-btn">{c.label}</span> : (
                        <button type="button" className="grid-th-btn" onClick={(e) => clickSort(c.key, e.shiftKey)} title={`${c.title ?? c.label} — klik untuk mengurutkan, Shift+klik bertingkat`}>{c.label}</button>
                      )}
                      {c.noSort ? null : sortIcon(c.key)}
                      {c.noFilter ? null : (
                        <button type="button" className={`grid-filter-btn ${filters[c.key] ? 'is-on' : ''}`} onClick={(e) => openFilter(c.key, e)} aria-label={`Filter ${c.label}`} aria-expanded={pop?.key === c.key}><FunnelIcon /></button>
                      )}
                    </div>
                    <span className="col-resize hidden md:block" onPointerDown={onHandleDown(c.key)} onDoubleClick={() => autoFit([c.key])} aria-hidden="true" />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={visibleCols.length} className="py-8 text-center text-label">Memuat…</td></tr>
              : !pageRows.length ? <tr><td colSpan={visibleCols.length} className="py-8 text-center text-label">{emptyText ?? 'Tidak ada baris.'}</td></tr>
              : pageRows.map((r) => {
                const k = rowKey(r);
                const isOpen = expanded === k;
                return (
                  <FragmentRow key={k}>
                    <tr className={`${onRowClick ? 'cursor-pointer' : ''} ${isOpen ? 'is-selected' : ''} ${rowClass?.(r) ?? ''}`} onClick={() => onRowClick?.(r)}>
                      {visibleCols.map((c) => {
                        const v = c.get(r);
                        const empty = v === null || v === undefined || v === '';
                        return (
                          <td key={c.key} data-label={c.label}
                            className={`${c.align === 'right' || c.type === 'number' ? 'num' : ''} ${c.mono ? 'mono' : ''} ${c.prio ?? ''} ${c.sticky ? 'sticky-col' : ''} ${c.isTitle ? 'title' : ''} ${c.hideMobile ? 'is-hidden-mobile' : ''}`}
                            title={c.render ? undefined : empty ? undefined : String(v)} onDoubleClick={copyCell}>
                            {c.render ? c.render(r) : empty ? <span className="empty">—</span> : c.type === 'number' ? nfmt.format(Number(v)) : String(v)}
                          </td>
                        );
                      })}
                    </tr>
                    {isOpen && renderExpanded ? <tr className="is-expand"><td colSpan={visibleCols.length} data-label="">{renderExpanded(r)}</td></tr> : null}
                  </FragmentRow>
                );
              })}
          </tbody>
        </table>
      </div>

      <div className="grid-foot">
        <span>{nfmt.format(processed.length)} entries · klik ganda sel = salin{footerNote ? <> · {footerNote}</> : null}</span>
        {pages > 1 ? (
          <span className="flex items-center gap-1">
            <button className="btn btn-sm" disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} aria-label="Halaman sebelumnya">‹</button>
            <span className="px-1 tabular-nums">{safePage + 1}/{pages}</span>
            <button className="btn btn-sm" disabled={safePage >= pages - 1} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} aria-label="Halaman berikutnya">›</button>
          </span>
        ) : null}
      </div>

      {pop ? (
        <div className="grid-pop" style={{ left: pop.x, top: pop.y }} role="dialog" aria-label={`Filter ${colMap.get(pop.key)?.label}`}>
          <h4>Filter · {colMap.get(pop.key)?.label}</h4>
          <select className="input mb-2" value={pop.draft.op} onChange={(e) => setPop({ ...pop, draft: { ...pop.draft, op: e.target.value as Op } })} aria-label="Operator">
            {OPS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
          {pop.draft.op !== 'empty' && pop.draft.op !== 'notEmpty' ? (
            <>
              <input className="input" autoFocus value={pop.draft.value} placeholder={pop.draft.op === 'between' ? 'dari' : 'nilai'}
                onChange={(e) => setPop({ ...pop, draft: { ...pop.draft, value: e.target.value } })}
                onKeyDown={(e) => { if (e.key === 'Enter') applyFilter(); }} aria-label="Nilai" />
              {pop.draft.op === 'between' ? (
                <input className="input mt-2" value={pop.draft.value2 ?? ''} placeholder="sampai"
                  onChange={(e) => setPop({ ...pop, draft: { ...pop.draft, value2: e.target.value } })}
                  onKeyDown={(e) => { if (e.key === 'Enter') applyFilter(); }} aria-label="Sampai" />
              ) : null}
              <div className="hint">Beberapa nilai dipisah ; · wildcard * didukung</div>
            </>
          ) : null}
          <div className="mt-2 flex gap-2">
            <button className="btn btn-primary flex-1" onClick={applyFilter}>Terapkan</button>
            <button className="btn" onClick={() => { clearFilter(pop.key); setPop(null); }} aria-label="Hapus filter" title="Hapus filter">🗑</button>
          </div>
        </div>
      ) : null}

      {menu ? (
        <div className="grid-menu" style={{ left: menu.x, top: menu.y }} role="menu" aria-label="Kolom yang tampil">
          {columns.map((c) => (
            <label key={c.key}>
              <input type="checkbox" checked={!hidden.includes(c.key)} onChange={(e) => setHidden((h) => (e.target.checked ? h.filter((k) => k !== c.key) : [...h, c.key]))} />
              {c.label}
            </label>
          ))}
          <div className="mt-1 border-t pt-1" style={{ borderColor: 'var(--border-subtle)' }}>
            <button className="btn btn-sm w-full" onClick={() => { resetView(); setMenu(null); }}>Reset tampilan</button>
          </div>
        </div>
      ) : null}

      {toast ? <div className="grid-toast" role="status">{toast}</div> : null}
    </div>
  );
}

function FragmentRow({ children }: { children: ReactNode }) { return <>{children}</>; }
