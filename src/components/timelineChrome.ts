// Shared vocabulary for the two timeline views: the same density and zoom
// steps, the same colour helpers, the same month formatting.

export const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface Density {
  id: string;
  label: string;
  row: number;
  bar: number;
  name: number;
  nameCol: number;
  band: number;
  lane: number;
  hdr: number;
  axis: number;
  foot: number;
  fsName: number;
  fsMono: number;
}

export const DENSITIES: Density[] = [
  { id: "s", label: "S", row: 30, bar: 19, name: 250, nameCol: 112, band: 28, lane: 32, hdr: 48, axis: 32, foot: 26, fsName: 11.5, fsMono: 10 },
  { id: "m", label: "M", row: 42, bar: 26, name: 296, nameCol: 120, band: 38, lane: 40, hdr: 56, axis: 40, foot: 32, fsName: 12.5, fsMono: 11 },
  { id: "l", label: "L", row: 56, bar: 36, name: 356, nameCol: 134, band: 50, lane: 52, hdr: 68, axis: 50, foot: 38, fsName: 14, fsMono: 12 },
];

export const ZOOMS = [
  { id: "s", label: "S", ppm: 26 },
  { id: "m", label: "M", ppm: 46 },
  { id: "l", label: "L", ppm: 80 },
];

// One hue per subject — a project in the advanced view, a variant in the
// comparison view — so colour identifies rather than ranks.
export const HUES = [
  232, 196, 286, 148, 338, 258, 104, 308, 172, 18, 244, 124, 352, 208, 272, 88, 214, 300, 136,
];

// Hue follows a project's identity, not its place in the backlog, so reordering
// never repaints the chart.
export function buildHueMap(projects: { id: string }[]): Record<string, number> {
  const ids = projects.map((p) => p.id).sort();
  const map: Record<string, number> = {};
  ids.forEach((id, i) => {
    map[id] = HUES[i % HUES.length];
  });
  return map;
}

export const solid = (h: number) => `oklch(var(--bar-l) var(--bar-c) ${h})`;
export const soft = (h: number) => `oklch(var(--bar-soft-l) var(--bar-soft-c) ${h})`;
export const envc = (h: number) => `oklch(var(--bar-env-l) var(--bar-env-c) ${h})`;
export const wash = (h: number, a: number) => `oklch(var(--bar-l) var(--bar-c) ${h} / ${a})`;

/** Labels are often already called "Variant N" — don't say it twice. */
export function variantCaption(label: string): string {
  const lower = label.toLowerCase();
  return /variant/i.test(label) ? lower : `variant ${lower}`;
}

export function fmt(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Math.abs(r - Math.round(r)) < 0.05 ? String(Math.round(r)) : r.toFixed(1);
}

/** "Mar 27" for a whole number of months after `startMonth` of `startYear`. */
export function monthLabel(startYear: number, startMonth: number, offsetMonths: number): string {
  const abs = startMonth + Math.round(offsetMonths);
  return `${MON[abs % 12]} ${startYear + Math.floor(abs / 12)}`;
}

export interface AxisMarks {
  ticks: { x: number; h: number; color: string }[];
  tickLabels: { x: number; label: string; color: string }[];
  gridlines: number[];
}

export function buildAxis(
  months: number,
  ppm: number,
  startYear: number,
  startMonth: number,
): AxisMarks {
  const ticks: AxisMarks["ticks"] = [];
  const tickLabels: AxisMarks["tickLabels"] = [];
  const gridlines: number[] = [];
  for (let i = 0; i <= months; i++) {
    const abs = startMonth + i;
    const m = abs % 12;
    const y = startYear + Math.floor(abs / 12);
    const half = m % 6 === 0;
    ticks.push({ x: i * ppm, h: half ? 12 : 5, color: half ? "var(--line-strong)" : "var(--line)" });
    if (half && i < months) {
      tickLabels.push({ x: i * ppm, label: `${MON[m]} ${String(y).slice(2)}`, color: "var(--ink-2)" });
    } else if (m % 3 === 0 && i < months && ppm >= 46) {
      tickLabels.push({ x: i * ppm, label: MON[m], color: "var(--ink-4)" });
    }
    if (half && i > 0) gridlines.push(i * ppm);
  }
  return { ticks, tickLabels, gridlines };
}
