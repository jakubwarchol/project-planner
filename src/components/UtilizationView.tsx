/**
 * Obłożenie — the result of staffing, day by day.
 *
 * Every other screen answers "what is the plan"; this one answers "what does
 * the plan do to people". One cell per person per day: how much of their
 * working day the assignments already claim. Lightness carries the load, so a
 * fortnight of nobody-is-free reads as a bright block before a single number
 * is read, and orange starts exactly at a hundred percent — the one place the
 * answer stops being a matter of degree.
 */
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCapabilitySchedule } from "../hooks/useCapabilitySchedule";
import { useRoster } from "../hooks/useRoster";
import { useStaffing } from "../hooks/useStaffing";
import { usePlanner } from "../state/plannerContext";
import { addDays, dateOfIso, isWorkingDate, isoOfIndex } from "../lib/days";
import { computeStaffingWindow, buildPersonLoadRows } from "../lib/staffing";
import { MON_SHORT, isoWeek } from "./obsada/axis";
import { plCount } from "./timelineChrome";
import {
  Gap,
  IconButton,
  Legend,
  ScreenFooter,
  ScreenHeader,
  UnderlineTabs,
  type ResolvedTheme,
} from "../design";
import type { Project } from "../types";
import "./utilization.css";

type Grain = "days" | "weeks";

/** A page of the grid, counted in weeks either way: days show six weeks in
 *  detail (thirty columns), weeks zoom out to a full quarter and a bit. In
 *  both the cell count stays in the range where a cell is still wide enough
 *  to hold its own number. */
const SPAN: Record<Grain, number> = { days: 6, weeks: 18 };

const WD = ["pn", "wt", "śr", "cz", "pt"];
const MON_FULL = [
  "styczeń",
  "luty",
  "marzec",
  "kwiecień",
  "maj",
  "czerwiec",
  "lipiec",
  "sierpień",
  "wrzesień",
  "październik",
  "listopad",
  "grudzień",
];

/** What one cell of the grid stands for. */
interface Cell {
  key: string;
  /** Share of the person's availability that is already committed. */
  share: number;
  /** No working day inside this cell — a holiday, or a week made entirely of
   *  holidays. Drawn as the faintest wash and left blank. */
  off: boolean;
}

/** Lightness is the load: the ramp runs from the barely-there wash of an
 *  empty day up to a full one; past a hundred it switches to warn, because
 *  over-commitment is a different kind of fact, not more of the same one.
 *  The channel behind the wash is a theme token so light mode inverts it. */
function cellVisual(cell: Cell): { label: string; bg: string; fg: string } {
  const v = Math.round(cell.share * 100);
  if (cell.off || v <= 0) return { label: "", bg: "rgba(var(--heat-ch), 0.02)", fg: "transparent" };
  if (v > 100) {
    const t = Math.min(1, (v - 100) / 35);
    return {
      label: String(v),
      bg: `rgba(240, 160, 104, ${(0.18 + t * 0.36).toFixed(3)})`,
      fg: "var(--heat-over-on)",
    };
  }
  return {
    label: String(v),
    bg: `rgba(var(--heat-ch), ${(0.04 + (v / 100) * 0.3).toFixed(3)})`,
    fg: v > 62 ? "var(--heat-on)" : "var(--v5-ink2)",
  };
}

interface UtilizationViewProps {
  projects: Project[];
  theme: ResolvedTheme;
}

export function UtilizationView({ projects, theme }: UtilizationViewProps) {
  const { people, pools } = useRoster();
  const { settings } = usePlanner();
  const schedule = useCapabilitySchedule(projects, pools);
  const { assignments, leaves } = useStaffing();

  const [grain, setGrain] = useState<Grain>("days");
  const [page, setPage] = useState(0);

  const today = useMemo(() => new Date(), []);
  const window_ = useMemo(
    () =>
      computeStaffingWindow(assignments, leaves, schedule, today, settings.workingDaysPerMonth),
    [assignments, leaves, schedule, today, settings.workingDaysPerMonth],
  );
  const rows = useMemo(
    () => buildPersonLoadRows(people, assignments, leaves, window_),
    [people, assignments, leaves, window_],
  );

  const grid = useMemo(() => {
    const origin = window_.originIso;

    // One pass over the calendar: what each day index is, and whether anyone
    // can work it. Every person's row then indexes into this rather than
    // re-deriving the calendar fourteen times.
    const dayCount = window_.windowDays;
    const days = Array.from({ length: dayCount }, (_, i) => {
      const iso = isoOfIndex(origin, i);
      const date = dateOfIso(iso);
      const dow = date.getDay();
      return { index: i, iso, date, weekday: dow >= 1 && dow <= 5, working: isWorkingDate(date) };
    });

    // The week is the one axis at two tiers: days are its columns zoomed in,
    // weeks its columns zoomed out. Keyed by the week's Monday so a year
    // boundary can't split a week in two.
    const byWeek = new Map<string, typeof days>();
    for (const day of days) {
      const monday = addDays(day.iso, -((day.date.getDay() + 6) % 7));
      const list = byWeek.get(monday);
      if (list) list.push(day);
      else byWeek.set(monday, [day]);
    }
    const weeks = [...byWeek.entries()]
      .map(([key, list]) => ({ key, days: list, weekdays: list.filter((d) => d.weekday) }))
      .filter((w) => w.weekdays.length > 0);

    // A page is whole weeks in both grains, so the tier above the columns
    // always spans exactly its own columns.
    const span = SPAN[grain];
    const pages = Math.max(1, Math.ceil(weeks.length / span));
    const at = Math.min(Math.max(page, 0), pages - 1);
    const visibleWeeks = weeks.slice(at * span, at * span + span);

    // Buckets are the columns. Days keep their holidays as blank columns —
    // the grid answers "what does the plan do to each day", and a holiday is
    // an answer, not a gap. Weekends never get a column.
    const buckets: { key: string; holiday: boolean; label: string; days: typeof days }[] =
      grain === "days"
        ? visibleWeeks.flatMap((week) =>
            week.weekdays.map((day) => ({
              key: day.iso,
              holiday: !day.working,
              label: WD[(day.date.getDay() + 6) % 7],
              days: [day],
            })),
          )
        : visibleWeeks.map((week) => ({
            key: week.key,
            holiday: false,
            label: `T${isoWeek(week.weekdays[0].date)}`,
            days: week.weekdays,
          }));

    // The tier above the columns: week-start dates over the days, month names
    // over the weeks — with the year only where it changes.
    const bands: { key: string; label: string; span: number; month?: string }[] = [];
    if (grain === "days") {
      for (const week of visibleWeeks) {
        const first = week.weekdays[0].date;
        bands.push({
          key: week.key,
          label: `${first.getDate()} ${MON_SHORT[first.getMonth()]}`,
          span: week.weekdays.length,
        });
      }
    } else {
      let lastYear: number | undefined;
      for (const week of visibleWeeks) {
        const first = week.weekdays[0].date;
        const month = `${first.getFullYear()}-${first.getMonth()}`;
        const last = bands[bands.length - 1];
        if (last && last.month === month) {
          last.span += 1;
          continue;
        }
        const label =
          first.getFullYear() === lastYear
            ? MON_FULL[first.getMonth()]
            : `${MON_FULL[first.getMonth()]} ${first.getFullYear()}`;
        lastYear = first.getFullYear();
        bands.push({ key: week.key, label, span: 1, month });
      }
    }

    const shareOf = (row: (typeof rows)[number], dayIndex: number) => {
      const slice = row.slices.find((s) => s.start <= dayIndex && dayIndex < s.end);
      return row.capacity > 0 ? (slice?.total ?? 0) / row.capacity : 0;
    };

    const people_ = rows.map((row) => {
      const cells: Cell[] = buckets.map((bucket) => {
        const working = bucket.days.filter((d) => d.working);
        if (working.length === 0) return { key: bucket.key, share: 0, off: true };
        // A week's number is the mean of its working days, so a Monday-only
        // booking doesn't read as a full week.
        const sum = working.reduce((s, day) => s + shareOf(row, day.index), 0);
        return { key: bucket.key, share: sum / working.length, off: false };
      });
      const live = cells.filter((c) => !c.off);
      const avg = live.length ? live.reduce((s, c) => s + c.share, 0) / live.length : 0;
      // The headline counts person-weeks over a hundred in the visible
      // window, in both grains — a week is the unit anyone reschedules in.
      const overWeeks = visibleWeeks.filter((week) => {
        const working = week.weekdays.filter((d) => d.working);
        if (working.length === 0) return false;
        const mean = working.reduce((s, day) => s + shareOf(row, day.index), 0) / working.length;
        return Math.round(mean * 100) > 100;
      }).length;
      return { person: row.person, cells, avg, overWeeks };
    });

    // The team row: everyone's load averaged per column, so the bottom line
    // reads on the same scale as the rows above it.
    const totals: Cell[] = buckets.map((bucket, i) => {
      const live = people_.filter((p) => !p.cells[i].off);
      const share = live.length ? live.reduce((s, p) => s + p.cells[i].share, 0) / live.length : 0;
      return { key: bucket.key, share, off: people_.length > 0 && live.length === 0 };
    });
    const liveTotals = totals.filter((c) => !c.off);
    const teamAvg = liveTotals.length
      ? liveTotals.reduce((s, c) => s + c.share, 0) / liveTotals.length
      : 0;

    const overWeeks = people_.reduce((n, p) => n + p.overWeeks, 0);

    const first = buckets[0]?.days[0]?.date;
    const lastWeek = visibleWeeks[visibleWeeks.length - 1];
    const last =
      grain === "days"
        ? buckets[buckets.length - 1]?.days[0]?.date
        : lastWeek?.days[lastWeek.days.length - 1]?.date;
    const range =
      first && last
        ? `${first.getDate()} ${MON_SHORT[first.getMonth()]} ${first.getFullYear()} – ${last.getDate()} ${MON_SHORT[last.getMonth()]} ${last.getFullYear()}`
        : "";

    const workingDays = buckets.reduce((n, b) => n + b.days.filter((d) => d.working).length, 0);
    const cols =
      grain === "weeks"
        ? plCount(buckets.length, "tydzień", "tygodnie", "tygodni")
        : plCount(workingDays, "dzień roboczy", "dni robocze", "dni roboczych");

    return { buckets, bands, people: people_, totals, teamAvg, overWeeks, range, pages, at, cols };
  }, [rows, window_, grain, page]);

  return (
    <div className="atl util" data-theme={theme}>
      <ScreenHeader
        eyebrow="wynik obsady"
        value={String(grid.overWeeks)}
        unit="osobotygodni ponad 100%"
        actions={
          <>
            <span className="util-range">
              <IconButton
                label="Wcześniej"
                size="lg"
                filled
                disabled={grid.at === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft size={13} strokeWidth={1.75} />
              </IconButton>
              <span className="util-range-label">{grid.range}</span>
              <IconButton
                label="Później"
                size="lg"
                filled
                disabled={grid.at >= grid.pages - 1}
                onClick={() => setPage((p) => Math.min(grid.pages - 1, p + 1))}
              >
                <ChevronRight size={13} strokeWidth={1.75} />
              </IconButton>
            </span>
            <UnderlineTabs
              label="Ziarno"
              value={grain}
              onChange={(next) => {
                setGrain(next);
                setPage(0);
              }}
              items={[
                { id: "days" as const, label: "Dni" },
                { id: "weeks" as const, label: "Tygodnie" },
              ]}
            />
          </>
        }
      >
        Komórka to udział dnia pracy zajęty planem. Im jaśniejsza, tym pełniejszy dzień;
        pomarańcz zaczyna się dokładnie na stu procentach. Święta zostają puste.
      </ScreenHeader>

      <div className="util-axis">
        <span className="util-name" />
        <div className="util-track">
          <div className="util-bands">
            {grid.bands.map((band) => (
              <span key={band.key} className="ds-eyebrow" style={{ flex: band.span }}>
                {band.label}
              </span>
            ))}
          </div>
          <div className="util-cells">
            {grid.buckets.map((bucket) => (
              <span
                key={bucket.key}
                className={`util-dow ${bucket.holiday ? "is-holiday" : grain === "weeks" ? "is-week" : ""}`}
              >
                {bucket.label}
              </span>
            ))}
          </div>
        </div>
        <span className="util-avg ds-eyebrow">śr.</span>
      </div>

      <div className="util-body">
        {grid.people.map((row) => {
          const avg = Math.round(row.avg * 100);
          return (
            <div className="util-row" key={row.person.id}>
              <span className="util-name">{row.person.name}</span>
              <span className="util-track util-cells">
                {row.cells.map((cell) => {
                  const visual = cellVisual(cell);
                  return (
                    <span
                      key={cell.key}
                      className="util-cell"
                      style={{ background: visual.bg, color: visual.fg }}
                      title={`${row.person.name} · ${cell.off ? "wolne" : `${Math.round(cell.share * 100)}% obłożenia`}`}
                    >
                      {visual.label}
                    </span>
                  );
                })}
              </span>
              <span className={`util-avg ${avg > 100 ? "is-warn" : avg < 70 ? "is-dim" : ""}`}>
                {avg}%
              </span>
            </div>
          );
        })}

        <div className="util-row is-total">
          <span className="util-name ds-eyebrow">zespół</span>
          <span className="util-track util-cells">
            {grid.totals.map((cell) => {
              const visual = cellVisual(cell);
              return (
                <span
                  key={cell.key}
                  className="util-cell"
                  style={{ background: visual.bg, color: visual.fg }}
                >
                  {visual.label}
                </span>
              );
            })}
          </span>
          <span className="util-avg is-loud">{Math.round(grid.teamAvg * 100)}%</span>
        </div>
      </div>

      <ScreenFooter>
        <Legend color="rgba(var(--heat-ch), 0.06)">poniżej 20%</Legend>
        <Legend color="rgba(var(--heat-ch), 0.20)">około 60%</Legend>
        <Legend color="rgba(var(--heat-ch), 0.34)">pełny dzień</Legend>
        <Legend color="rgba(240, 160, 104, 0.42)">ponad 100%</Legend>
        <Legend color="rgba(var(--heat-ch), 0.02)">święto</Legend>
        <Gap />
        <span>
          {plCount(grid.people.length, "osoba", "osoby", "osób")} · {grid.cols}
        </span>
      </ScreenFooter>
    </div>
  );
}
