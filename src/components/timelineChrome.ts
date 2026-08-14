// Shared vocabulary for the two timeline views: the same density and zoom
// steps, the same colour helpers, the same month formatting.

export type Screen = "backlog" | "team" | "matrix" | "advanced" | "obsada" | "compare";

/** Ordered from data to results — dane wejściowe | wyniki | hipotezy. The
 *  hairlines in the nav rail sit on the group boundaries, and ⌘1…⌘6 follow
 *  this order, so it is the one place the sequence is defined. */
export const SCREENS: { id: Screen; label: string; hint: string; group: number }[] = [
  { id: "backlog", label: "Projekty", hint: "backlog i kolejność", group: 0 },
  { id: "team", label: "Zespół", hint: "ludzie i produktywność", group: 0 },
  { id: "matrix", label: "Wyceny", hint: "nakład w dniach i maksymalne obłożenie", group: 0 },
  { id: "advanced", label: "Plan", hint: "wyliczony harmonogram", group: 1 },
  { id: "obsada", label: "Obsada", hint: "kto konkretnie i kiedy", group: 1 },
  { id: "compare", label: "Symulacje", hint: "co, gdyby zespół był inny", group: 2 },
];

/** "⌘" only where the shortcut really is the command key. */
export const MOD =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "")
    ? "⌘"
    : "^";

export const MON = ["Sty", "Lut", "Mar", "Kwi", "Maj", "Cze", "Lip", "Sie", "Wrz", "Paź", "Lis", "Gru"];

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

// Continuous zoom range for trackpad pinch — presets above are just waypoints in it.
export const MIN_PPM = 10;
export const MAX_PPM = 600;

export function clampPpm(ppm: number): number {
  return Math.min(MAX_PPM, Math.max(MIN_PPM, ppm));
}

/** Trackpad pinch arrives as a `wheel` event with ctrlKey set (Chrome, Firefox,
 *  and Safari all report it this way on macOS) — plain two-finger scroll has
 *  ctrlKey false and must keep scrolling the page, not zooming the chart. */
export function pinchZoomFactor(event: { ctrlKey: boolean; deltaY: number }): number | null {
  if (!event.ctrlKey) return null;
  return Math.exp(-event.deltaY * 0.012);
}

// One hue per subject — a project in the advanced view, a variant in the
// comparison view — so colour identifies rather than ranks.
export const HUES = [
  232, 196, 286, 148, 338, 258, 104, 308, 172, 18, 244, 124, 352, 208, 272, 88, 214, 300, 136,
];

// One hue per capability, fixed rather than positional: the roster's split
// bars have to mean the same colour on every row, and a person's second
// capability is not "the second colour" — it's BE, or QA, wherever it sits.
// Spread around the wheel so neighbouring capabilities stay distinguishable
// at the 3px widths a 0.1 FTE slice gets.
export const CAPABILITY_HUES: Record<string, number> = {
  PM: 295,
  UX: 340,
  TL: 35,
  BE: 160,
  FE: 245,
  QA: 110,
  SEC: 70,
};

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

/** Labels are often already called "Variant N" / "Wariant N" — don't say it twice. */
export function variantCaption(label: string): string {
  const lower = label.toLowerCase();
  return /variant|wariant/i.test(label) ? lower : `wariant ${lower}`;
}

/** Polish plural rule: 1 → one, 2-4 (not 12-14) → few, else → many. */
export function plCount(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = n === 1 ? one : mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14) ? few : many;
  return `${n} ${word}`;
}

export function fmt(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Math.abs(r - Math.round(r)) < 0.05 ? String(Math.round(r)) : r.toFixed(1);
}

/** Two decimals where they carry information, none where they don't — FTE
 *  figures read as "1.5" or "2", never "2.00". */
export function fmt2(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Math.abs(r - Math.round(r)) < 0.005 ? String(Math.round(r)) : r.toFixed(2);
}

/** Model months are averages, but "11 tygodni" lands better than "2,5 mies."
 *  for deltas a human weighs — weeks are what sprints are made of. */
export function weeksOf(months: number): number {
  return (months * 52) / 12;
}

/** "Optymalizacja: Wariant 2", suffixed "(2)", "(3)"… when taken — the same
 *  tidy-label spirit as the variant editor's "Wariant N". */
export function optimizedLabel(existing: string[], baselineLabel: string): string {
  const base = baselineLabel;
  if (!existing.includes(base)) return base;
  for (let n = 2; n <= existing.length + 2; n += 1) {
    const label = `${base} (${n})`;
    if (!existing.includes(label)) return label;
  }
  return base;
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

// Below this, months are too narrow on screen for individual days to read —
// stick to the month/quarter grid. Above it, switch to day ticks.
const DAY_ZOOM_THRESHOLD = 130;

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

// Each month still occupies exactly `ppm` px (matching the uniform-month model
// bars are positioned in) — days subdivide that width proportionally, so a
// 28-day February is neither longer nor shorter on screen than a 31-day month.
function buildDayAxis(months: number, ppm: number, startYear: number, startMonth: number): AxisMarks {
  const ticks: AxisMarks["ticks"] = [];
  const tickLabels: AxisMarks["tickLabels"] = [];
  const gridlines: number[] = [];

  for (let i = 0; i < months; i++) {
    const abs = startMonth + i;
    const m = ((abs % 12) + 12) % 12;
    const y = startYear + Math.floor(abs / 12);
    const dim = daysInMonth(y, m);
    const monthX = i * ppm;
    const dayWidth = ppm / dim;
    const labelStep = dayWidth >= 30 ? 1 : dayWidth >= 16 ? 2 : dayWidth >= 8 ? 5 : 10;

    ticks.push({ x: monthX, h: 12, color: "var(--line-strong)" });
    tickLabels.push({ x: monthX, label: `${MON[m]} ${String(y).slice(2)}`, color: "var(--ink-2)" });
    gridlines.push(monthX);

    for (let d = 1 + labelStep; d < dim; d += labelStep) {
      const x = monthX + ((d - 1) / dim) * ppm;
      ticks.push({ x, h: 6, color: "var(--line)" });
      tickLabels.push({ x, label: String(d), color: "var(--ink-4)" });
    }
  }
  gridlines.push(months * ppm);
  return { ticks, tickLabels, gridlines };
}

export function buildAxis(
  months: number,
  ppm: number,
  startYear: number,
  startMonth: number,
): AxisMarks {
  if (ppm >= DAY_ZOOM_THRESHOLD) return buildDayAxis(months, ppm, startYear, startMonth);

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
