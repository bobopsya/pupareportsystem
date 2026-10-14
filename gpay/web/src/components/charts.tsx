import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from './ui';

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(280);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(160, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}

/** Rounds the axis maximum up to a "nice" number. */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

/**
 * Single-series column chart: thin rounded columns anchored to the baseline, recessive grid,
 * crosshair-style hover with a tooltip. One series, so no legend — the card title names it.
 */
export function ColumnChart({ data, height = 220, formatY, formatX, tooltip, label }: {
  data: { x: number; y: number }[];
  height?: number;
  formatY: (v: number) => string;
  formatX: (x: number) => string;
  tooltip: (i: number) => ReactNode;
  label: string;
}) {
  const { ref, w } = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 52;
  const padB = 24;
  const padT = 8;
  const plotW = w - padL;
  const plotH = height - padB - padT;
  const max = niceMax(Math.max(...data.map((d) => d.y), 0));
  const n = data.length;
  const slot = plotW / Math.max(n, 1);
  const barW = Math.max(2, Math.min(28, slot - 2));
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const every = Math.ceil(n / Math.max(2, Math.floor(plotW / 64)));
  const y = (v: number) => padT + plotH - (v / max) * plotH;

  return (
    <div ref={ref} className="relative w-full min-w-0 overflow-hidden select-none" onMouseLeave={() => setHover(null)}>
      <svg width={w} height={height} role="img" aria-label={label} className="block overflow-visible">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={w} y1={y(max * t)} y2={y(max * t)} stroke="var(--color-line)" strokeWidth={1} />
            <text x={padL - 8} y={y(max * t)} dy="0.32em" textAnchor="end" className="fill-faint text-[11px]">{formatY(max * t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = padL + i * slot + (slot - barW) / 2;
          const top = y(d.y);
          const h = padT + plotH - top;
          const r = Math.min(4, barW / 2, h);
          const dim = hover !== null && hover !== i;
          return (
            <g key={d.x}>
              {h > 0 && (
                <path
                  d={`M${x},${padT + plotH} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${padT + plotH} Z`}
                  fill={hover === i ? "var(--color-brand)" : "var(--color-fg)"}
                  opacity={dim ? 0.25 : 1}
                  className="transition-opacity"
                />
              )}
              {i % every === 0 && (
                <text x={x + barW / 2} y={height - 6} textAnchor="middle" className="fill-faint text-[11px]">{formatX(d.x)}</text>
              )}
              <rect x={padL + i * slot} y={padT} width={slot} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-xl bg-ink text-on-ink px-3 py-2 text-[13px] whitespace-nowrap [&_.text-muted]:text-on-ink/70 [&_.text-faint]:text-on-ink/60"
          style={{ left: Math.min(Math.max(padL + hover * slot + slot / 2 - 70, 0), w - 150), transform: 'translateY(-4px)' }}
        >
          {tooltip(hover)}
        </div>
      )}
    </div>
  );
}

/** Ranked horizontal bars with values written beside them (identity by label, not colour). */
export function BarList({ items, format, empty = 'Нет данных' }: { items: { label: ReactNode; value: number; sub?: string }[]; format: (v: number) => string; empty?: string }) {
  const max = Math.max(...items.map((i) => i.value), 0);
  if (!items.length || max === 0) return <div className="text-sm text-muted py-6 text-center">{empty}</div>;
  return (
    <ul className="flex flex-col gap-3">
      {items.map((it, i) => (
        <li key={i} className="group">
          <div className="flex items-baseline justify-between gap-3 text-sm mb-2">
            <span className="min-w-0 truncate">{it.label}</span>
            <span className="shrink-0 font-medium tabular-nums">
              {format(it.value)}
              {it.sub && <span className="text-faint font-normal"> · {it.sub}</span>}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-sunken overflow-hidden">
            <div className="h-full rounded-full bg-fg transition-[width] duration-500" style={{ width: `${(it.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Delta({ cur, prev, invert, className }: { cur: number; prev: number; invert?: boolean; className?: string }) {
  if (!prev) return <span className={cx('text-xs text-faint', className)}>нет данных за прошлый период</span>;
  const d = (cur - prev) / prev;
  const up = d >= 0;
  const good = invert ? !up : up;
  return (
    <span className={cx('inline-flex items-center gap-1 text-xs font-medium', good ? 'text-ok' : 'text-bad', className)}>
      {up ? '↑' : '↓'} {Math.abs(d * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%
      <span className="hidden sm:inline text-faint font-normal">к прошлому периоду</span>
    </span>
  );
}
