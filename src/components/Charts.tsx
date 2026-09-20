'use client';
/**
 * Grafik SVG kecil untuk halaman analisis SKU — tanpa pustaka grafik.
 * Aturan yang dipatuhi: satu sumbu per grafik (tidak pernah dua skala y),
 * warna deret memakai token --c1..--c5 yang sudah lolos uji buta warna di
 * kedua tema, teks memakai token tinta (bukan warna deret), setiap deret
 * punya nama tertulis (legenda + label langsung) sehingga identitas tidak
 * pernah bergantung pada warna saja, dan setiap grafik punya lapisan hover.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';

const PAD_L = 46, PAD_T = 10, PAD_B = 20;

/**
 * Lebar sebenarnya dari wadah. viewBox yang lebarnya tetap akan ikut mengecil
 * saat kartunya sempit — teks sumbu jadi 6px dan tidak terbaca. Dengan mengukur
 * lebar asli, 1 unit SVG = 1 piksel, jadi ukuran teks selalu apa adanya.
 */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return { ref, W: Math.max(300, Math.round(w) || 760), ready: w > 0 };
}
const nf = (n: number, d = 0) => n.toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
const shortDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** Skala sumbu yang berakhir di angka bulat — 0, 500, 1.000 lebih mudah dibaca. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) if (v <= m * base) return m * base;
  return 10 * base;
}

type Tick = { label: string; x: number };

function Frame({ h, w, max, padR, ticks, labels, children }: {
  h: number; w: number; max: number; padR: number; ticks: number[]; labels: Tick[]; children: React.ReactNode;
}) {
  return (
    <>
      {ticks.map((t) => {
        const y = PAD_T + (1 - t / max) * (h - PAD_T - PAD_B);
        return (
          <g key={t}>
            <line x1={PAD_L} x2={w - padR} y1={y} y2={y} stroke="var(--chart-grid)" strokeWidth={1} />
            <text x={PAD_L - 6} y={y + 3.5} textAnchor="end" fontSize={10} fill="var(--chart-label)">{nf(t, max < 8 ? 1 : 0)}</text>
          </g>
        );
      })}
      {children}
      {labels.map((l) => (
        <text key={l.x} x={l.x} y={h - 5} textAnchor="middle" fontSize={9.5} fill="var(--chart-label)">{l.label}</text>
      ))}
    </>
  );
}

/** Label tanggal secukupnya — kira-kira satu tiap 90px supaya tidak bertumpuk. */
function dateLabels(dates: string[], w: number, step: number, padR: number): Tick[] {
  const slots = Math.max(2, Math.floor((w - PAD_L - padR) / 90));
  const every = Math.max(1, Math.round(dates.length / slots));
  return dates.map((d, i) => ({ label: shortDate(d), x: PAD_L + step * (i + 0.5), i }))
    .filter((t) => t.i % every === 0);
}

type Hover = { i: number; fx: number } | null;

/** Mengubah posisi kursor menjadi indeks hari. */
function useHover(len: number, step: number, w: number) {
  const [hover, setHover] = useState<Hover>(null);
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const i = Math.floor((fx * w - PAD_L) / step);
    setHover(i >= 0 && i < len ? { i, fx } : null);
  };
  return { hover, onMove, clear: () => setHover(null) };
}

/** Batang penjualan harian. Hari campaign digambar bergaris — hari itu tidak
 *  ikut dihitung di ADS Opsi 1, dan itu harus terlihat, bukan disembunyikan. */
export function SalesBars({ dates, values, excluded, height = 160, ads }: {
  dates: string[]; values: number[]; excluded: (string | null)[]; height?: number; ads?: number | null;
}) {
  const id = useId();
  const { ref, W } = useWidth();
  const padR = 12;
  const step = (W - PAD_L - padR) / Math.max(1, dates.length);
  const { hover, onMove, clear } = useHover(dates.length, step, W);
  const max = useMemo(() => niceMax(Math.max(1, ...values, ads ?? 0)), [values, ads]);
  const plotH = height - PAD_T - PAD_B;
  const bw = Math.max(1.5, Math.min(step - 2, step * 0.72));
  const adsY = ads && ads > 0 ? PAD_T + (1 - ads / max) * plotH : null;

  return (
    <div className="chart-wrap" ref={ref}>
      <svg viewBox={`0 0 ${W} ${height}`} className="chart-svg" style={{ height }} role="img" aria-label="Penjualan harian"
        onMouseLeave={clear} onMouseMove={onMove}>
        <defs>
          <pattern id={`${id}-hatch`} width="5" height="5" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <rect width="5" height="5" fill="var(--chart-track)" />
            <line x1="0" y1="0" x2="0" y2="5" stroke="var(--chart-axis)" strokeWidth="1.8" />
          </pattern>
        </defs>
        <Frame h={height} w={W} max={max} padR={padR} ticks={[0, max / 2, max]} labels={dateLabels(dates, W, step, padR)}>
          {dates.map((d, i) => {
            const v = values[i] ?? 0;
            const bh = v > 0 ? Math.max(2, (v / max) * plotH) : 0;
            if (!bh) return null;
            return (
              <rect key={d} x={PAD_L + step * i + (step - bw) / 2} y={PAD_T + plotH - bh} width={bw} height={bh}
                rx={Math.min(4, bw / 2)}
                fill={excluded[i] ? `url(#${id}-hatch)` : 'var(--c1)'}
                opacity={hover && hover.i !== i ? 0.4 : 1} />
            );
          })}
          {adsY !== null ? (
            <>
              <line x1={PAD_L} x2={W - padR} y1={adsY} y2={adsY} stroke="var(--c2)" strokeWidth={2} strokeDasharray="5 4" />
              <text x={PAD_L + 4} y={adsY - 5} fontSize={10} fill="var(--chart-label)">ADS {nf(ads!, 1)}/hari</text>
            </>
          ) : null}
        </Frame>
        {hover ? (
          <line x1={PAD_L + step * (hover.i + 0.5)} x2={PAD_L + step * (hover.i + 0.5)} y1={PAD_T} y2={height - PAD_B}
            stroke="var(--chart-axis)" strokeWidth={1} />
        ) : null}
      </svg>
      {hover ? (
        <Tip fx={hover.fx} date={dates[hover.i]} rows={[
          { k: 'Terjual', v: `${nf(values[hover.i] ?? 0)} pcs` },
          ...(excluded[hover.i] ? [{ k: 'Dikecualikan', v: excluded[hover.i]! }] : []),
        ]} />
      ) : null}
    </div>
  );
}

export type Line = { label: string; values: (number | null)[]; color: string; dash?: boolean };

/** Garis satu sumbu, satu atau beberapa deret. Hari tanpa rekaman diputus,
 *  bukan disambung lurus — menyambungkannya akan mengarang data yang tidak ada. */
export function LineChart({ dates, lines, height = 160, refs = [], zeroBand, unit = '', digits = 0 }: {
  dates: string[]; lines: Line[]; height?: number; unit?: string; digits?: number;
  refs?: { value: number; label: string; color?: string }[];
  /** Tandai hari dengan nilai 0 pada deret ini (indeks) — dipakai untuk stok kosong. */
  zeroBand?: number;
}) {
  const { ref, W } = useWidth();
  // Talang kanan untuk label langsung; di kartu sempit legenda saja sudah cukup.
  const showEnds = W >= 430;
  const padR = showEnds ? 66 : 12;
  const step = (W - PAD_L - padR) / Math.max(1, dates.length);
  const { hover, onMove, clear } = useHover(dates.length, step, W);
  const max = useMemo(
    () => niceMax(Math.max(1, ...lines.flatMap((l) => l.values.filter((v): v is number => v !== null)), ...refs.map((r) => r.value))),
    [lines, refs],
  );
  const plotH = height - PAD_T - PAD_B;
  const yOf = (v: number) => PAD_T + (1 - Math.min(v, max) / max) * plotH;
  const xOf = (i: number) => PAD_L + step * (i + 0.5);

  // Potong tiap deret di lubangnya supaya garis tidak melompati hari kosong.
  const segmentsOf = (vals: (number | null)[]) => {
    const out: { i: number; v: number }[][] = [];
    let cur: { i: number; v: number }[] = [];
    vals.forEach((v, i) => { if (v === null) { if (cur.length) out.push(cur); cur = []; } else cur.push({ i, v }); });
    if (cur.length) out.push(cur);
    return out;
  };

  // Label langsung di talang kanan; digeser sedikit kalau dua deret berakhir berdempetan.
  const ends = lines.map((l) => {
    let i = l.values.length - 1;
    while (i >= 0 && l.values[i] === null) i--;
    return i >= 0 ? { label: l.label, color: l.color, y: yOf(l.values[i] as number), x: xOf(i) } : null;
  });
  const endY: (number | null)[] = ends.map(() => null);
  {
    const GAP = 12.5;
    const order = ends.map((e, i) => ({ i, y: e ? e.y : null }))
      .filter((o): o is { i: number; y: number } => o.y !== null)
      .sort((a, b) => a.y - b.y);
    let prev = -Infinity;
    for (const o of order) { const y = Math.max(o.y, prev + GAP); endY[o.i] = y; prev = y; }
    // Kalau tumpukan label melewati dasar grafik, seluruhnya digeser naik.
    const over = prev - (height - PAD_B - 2);
    if (over > 0) for (const o of order) endY[o.i] = Math.max(PAD_T + 4, (endY[o.i] as number) - over);
  }

  return (
    <div className="chart-wrap" ref={ref}>
      <svg viewBox={`0 0 ${W} ${height}`} className="chart-svg" style={{ height }} role="img" aria-label={lines.map((l) => l.label).join(', ')}
        onMouseLeave={clear} onMouseMove={onMove}>
        <Frame h={height} w={W} max={max} padR={padR} ticks={[0, max / 2, max]} labels={dateLabels(dates, W, step, padR)}>
          {zeroBand !== undefined ? dates.map((d, i) => lines[zeroBand]?.values[i] === 0 ? (
            <rect key={`z${d}`} x={PAD_L + step * i} y={PAD_T} width={Math.max(step, 1.5)} height={plotH}
              fill="var(--negative)" opacity={0.14} />
          ) : null) : null}
          {refs.map((r) => (
            <g key={r.label}>
              <line x1={PAD_L} x2={W - padR} y1={yOf(r.value)} y2={yOf(r.value)}
                stroke={r.color ?? 'var(--chart-axis)'} strokeWidth={2} strokeDasharray="5 4" />
              <text x={PAD_L + 4} y={yOf(r.value) - 5} fontSize={10} fill="var(--chart-label)">{r.label}</text>
            </g>
          ))}
          {lines.map((l) => (
            <g key={l.label}>
              {segmentsOf(l.values).map((seg, si) => seg.length === 1 ? (
                <circle key={si} cx={xOf(seg[0].i)} cy={yOf(seg[0].v)} r={3} fill={l.color} />
              ) : (
                <polyline key={si} fill="none" stroke={l.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                  strokeDasharray={l.dash ? '6 4' : undefined}
                  points={seg.map((s) => `${xOf(s.i)},${yOf(s.v)}`).join(' ')} />
              ))}
            </g>
          ))}
          {showEnds ? ends.map((e, i) => e && endY[i] !== null ? (
            <text key={e.label} x={W - padR + 6} y={endY[i]! + 3.5} fontSize={10.5} fill="var(--chart-label)">{e.label}</text>
          ) : null) : null}
        </Frame>
        {hover ? (
          <>
            <line x1={xOf(hover.i)} x2={xOf(hover.i)} y1={PAD_T} y2={height - PAD_B} stroke="var(--chart-axis)" strokeWidth={1} />
            {lines.map((l) => l.values[hover.i] === null ? null : (
              <circle key={l.label} cx={xOf(hover.i)} cy={yOf(l.values[hover.i] as number)} r={4.5}
                fill={l.color} stroke="var(--bg-surface)" strokeWidth={2} />
            ))}
          </>
        ) : null}
      </svg>
      {hover && lines.some((l) => l.values[hover.i] !== null) ? (
        <Tip fx={hover.fx} date={dates[hover.i]} rows={lines.filter((l) => l.values[hover.i] !== null).map((l) => ({
          k: l.label, v: `${nf(l.values[hover.i] as number, digits)}${unit ? ' ' + unit : ''}`,
        }))} />
      ) : null}
      {lines.length >= 2 ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
          {lines.map((l) => (
            <span key={l.label} className="inline-flex items-center gap-1.5">
              <span className="split-dot" style={{ background: l.color }} aria-hidden="true" />
              <span className="text-label">{l.label}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Batang bertumpuk mendatar untuk pecahan platform — bagian-dari-keseluruhan. */
export function PlatformSplit({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (!total) return <div className="text-[12.5px] text-label">Belum ada penjualan pada periode ini.</div>;
  return (
    <div>
      <div className="split-bar" role="img" aria-label="Pecahan penjualan per platform">
        {parts.filter((p) => p.value > 0).map((p) => (
          // flex-grow membagi sisa lebar SETELAH celah 2px, jadi proporsinya tetap tepat
          // dan segmen terakhir tidak terpotong seperti kalau width persen dipakai.
          <span key={p.label} style={{ flexGrow: p.value, flexBasis: 0, background: p.color }}
            title={`${p.label}: ${nf(p.value)} pcs (${nf((p.value / total) * 100, 1)}%)`} />
        ))}
      </div>
      <div className="mt-2.5 grid gap-x-5 gap-y-1.5 text-[12.5px]" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(10rem,1fr))' }}>
        {parts.map((p) => (
          <div key={p.label} className="flex items-center gap-2">
            <span className="split-dot" style={{ background: p.color }} aria-hidden="true" />
            <span className="text-label">{p.label}</span>
            <span className="ml-auto num font-semibold">{nf(p.value)}</span>
            <span className="num w-12 text-right text-label">{nf((p.value / total) * 100, 1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Tip({ fx, date, rows }: { fx: number; date: string; rows: { k: string; v: string }[] }) {
  return (
    <div className="chart-tip" style={{ left: `${Math.min(92, Math.max(8, fx * 100))}%` }}>
      <div className="font-semibold">{date}</div>
      {rows.map((r) => <div key={r.k} className="text-label">{r.k}: <span className="text-ink font-medium">{r.v}</span></div>)}
    </div>
  );
}
