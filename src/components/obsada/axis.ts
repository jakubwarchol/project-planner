/**
 * The day-grid axis the two obsada timelines share: a two-tier header where a
 * context band (year, or month) sits over evenly built unit cells, so a cell
 * is always one short label and never a stacked pair with an empty second row.
 */
import { dateOfIso, isPolishHoliday, isoOfIndex } from "../../lib/days";
import type { StaffingWindow } from "../../lib/staffing";

export type ObsadaUnit = "days" | "weeks" | "months";

export const UNITS: Record<ObsadaUnit, { px: number; days: number; label: string }> = {
  months: { px: 104, days: 30.44, label: "Miesiące" },
  weeks: { px: 46, days: 7, label: "Tygodnie" },
  days: { px: 26, days: 1, label: "Dni" },
};

export const UNIT_ORDER: ObsadaUnit[] = ["months", "weeks", "days"];

export const MON_SHORT = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"];

export function pxPerDayFor(unit: ObsadaUnit): number {
  const u = UNITS[unit];
  return u.px / u.days;
}

export interface AxisCell {
  key: number;
  left: number;
  width: number;
  text: string;
  isNow: boolean;
  /** Heavier tick at a quarter / month / week boundary, depending on unit. */
  strongTick: boolean;
}

export interface AxisBand {
  key: number;
  left: number;
  width: number;
  label: string;
  isNow: boolean;
}

export interface AxisShade {
  key: number;
  left: number;
  width: number;
  /** A public holiday rather than a plain weekend. */
  holiday: boolean;
}

export interface ObsadaAxis {
  cells: AxisCell[];
  bands: AxisBand[];
  /** Gridline x positions, drawn behind the rows. */
  lines: number[];
  /** Weekend and Polish public holiday columns; days unit only. */
  shades: AxisShade[];
  gridW: number;
  todayX: number;
  pxPerDay: number;
}

/** ISO-8601 week number — the number planners actually schedule by. */
export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3);
  const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t.getTime() - first.getTime()) / 86_400_000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
}

/** "12 sie" — the form every tooltip in obsada uses. */
export function shortDay(originIso: string, index: number): string {
  const d = dateOfIso(isoOfIndex(originIso, index));
  return `${d.getDate()} ${MON_SHORT[d.getMonth()]}`;
}

export function longDay(iso: string): string {
  const d = dateOfIso(iso);
  return `${d.getDate()} ${MON_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

interface MonthRun {
  a: number;
  b: number;
  date: Date;
}

function monthRunsIn(window: StaffingWindow): MonthRun[] {
  const origin = dateOfIso(window.originIso);
  const runs: MonthRun[] = [];
  let i = 0;
  while (i < window.windowDays) {
    const t = new Date(origin.getFullYear(), origin.getMonth(), origin.getDate() + i);
    let e = i + 1;
    while (
      e < window.windowDays &&
      new Date(origin.getFullYear(), origin.getMonth(), origin.getDate() + e).getMonth() === t.getMonth()
    ) {
      e++;
    }
    runs.push({ a: i, b: e, date: t });
    i = e;
  }
  return runs;
}

export function buildObsadaAxis(window: StaffingWindow, unit: ObsadaUnit): ObsadaAxis {
  const pxPerDay = pxPerDayFor(unit);
  const X = (d: number) => Math.round(d * pxPerDay);
  const origin = dateOfIso(window.originIso);
  const dateOf = (i: number) => new Date(origin.getFullYear(), origin.getMonth(), origin.getDate() + i);
  const N = window.windowDays;

  const cells: AxisCell[] = [];
  const bands: AxisBand[] = [];
  const lines: number[] = [];
  const shades: AxisShade[] = [];
  const months = monthRunsIn(window);

  if (unit === "months") {
    let yearRun: { year: number; a: number; b: number } | null = null;
    for (const m of months) {
      const quarter = m.date.getMonth() % 3 === 0;
      cells.push({
        key: m.a,
        left: X(m.a),
        width: X(m.b) - X(m.a),
        text: MON_SHORT[m.date.getMonth()],
        isNow: window.todayIndex >= m.a && window.todayIndex < m.b,
        strongTick: quarter,
      });
      if (quarter) lines.push(X(m.a));
      if (!yearRun || yearRun.year !== m.date.getFullYear()) {
        yearRun = { year: m.date.getFullYear(), a: m.a, b: m.b };
        bands.push({
          key: m.a,
          left: X(m.a),
          width: 0,
          label: String(m.date.getFullYear()),
          isNow: false,
        });
      } else {
        yearRun.b = m.b;
      }
      const band = bands[bands.length - 1];
      band.width = X(yearRun.b) - band.left;
      band.isNow = window.todayIndex >= yearRun.a && window.todayIndex < yearRun.b;
    }
  } else if (unit === "weeks") {
    let i = 0;
    while (i < N) {
      let e = i + 1;
      while (e < N && dateOf(e).getDay() !== 1) e++;
      const t = dateOf(i);
      cells.push({
        key: i,
        left: X(i),
        width: X(e) - X(i),
        text: `T${isoWeek(t)}`,
        isNow: window.todayIndex >= i && window.todayIndex < e,
        strongTick: t.getDate() <= 7,
      });
      if (t.getDate() <= 7) lines.push(X(i));
      i = e;
    }
    for (const m of months) {
      bands.push({
        key: m.a,
        left: X(m.a),
        width: X(m.b) - X(m.a),
        label: `${MON_SHORT[m.date.getMonth()]} ${m.date.getFullYear()}`,
        isNow: window.todayIndex >= m.a && window.todayIndex < m.b,
      });
    }
  } else {
    for (let i = 0; i < N; i++) {
      const t = dateOf(i);
      const dow = t.getDay();
      cells.push({
        key: i,
        left: X(i),
        width: Math.max(1, X(i + 1) - X(i)),
        text: String(t.getDate()),
        isNow: i === window.todayIndex,
        strongTick: dow === 1,
      });
      if (dow === 1) lines.push(X(i));
      const iso = isoOfIndex(window.originIso, i);
      const holiday = isPolishHoliday(iso);
      if (dow === 0 || dow === 6 || holiday) {
        shades.push({ key: i, left: X(i), width: Math.max(1, X(i + 1) - X(i)), holiday });
      }
    }
    for (const m of months) {
      bands.push({
        key: m.a,
        left: X(m.a),
        width: X(m.b) - X(m.a),
        label: `${MON_SHORT[m.date.getMonth()]} ${m.date.getFullYear()}`,
        isNow: window.todayIndex >= m.a && window.todayIndex < m.b,
      });
    }
  }

  return { cells, bands, lines, shades, gridW: Math.round(N * pxPerDay), todayX: X(window.todayIndex), pxPerDay };
}

/** What the header's period navigator names, from the leftmost visible day. */
export function focusLabel(window: StaffingWindow, unit: ObsadaUnit, scrollLeft: number): string {
  const pxPerDay = pxPerDayFor(unit);
  const index = Math.min(window.windowDays - 1, Math.max(0, Math.round(scrollLeft / pxPerDay)));
  const d = dateOfIso(isoOfIndex(window.originIso, index));
  if (unit === "months") return `${MON_SHORT[d.getMonth()]} ${d.getFullYear()}`;
  if (unit === "weeks") return `T${isoWeek(d)} · ${MON_SHORT[d.getMonth()]} ${d.getFullYear()}`;
  return `${d.getDate()} ${MON_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

/** The cell boundary one step from where the view currently sits — what the
 *  ◀ / ▶ buttons jump to, so a step is always one unit of whatever is shown. */
export function stepTo(axis: ObsadaAxis, scrollLeft: number, direction: -1 | 1): number {
  const index = axis.cells.findIndex((c) => scrollLeft < c.left + c.width);
  const from = index === -1 ? axis.cells.length - 1 : index;
  const target = axis.cells[Math.max(0, Math.min(axis.cells.length - 1, from + direction))];
  return target ? target.left : 0;
}
