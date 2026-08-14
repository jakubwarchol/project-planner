import { useLayoutEffect, useRef } from "react";
import { CAPABILITY_LABELS } from "../lib/estimation";
import type { ScheduledProject, StreamSchedule } from "../lib/scheduling";
import type { CapabilityVector, EstimationSettings } from "../types";
import { fmt } from "./timelineChrome";

const EPS = 1e-6;

/** Viewport coordinates of the bar the tip hangs off. */
export interface TipAnchor {
  left: number;
  top: number;
  bottom: number;
}

interface ProjectBreakdownTipProps {
  sp: ScheduledProject;
  settings: EstimationSettings;
  /** Productivity of the people behind each capability — `focusByCapability`.
   *  Per capability rather than one number, because the conversion the tip
   *  spells out is only true for the people who actually do that job. */
  focus: CapabilityVector;
  anchor: TipAnchor;
  /** The "P01"-style badge from the row, so the tip names the same thing. */
  positionLabel: string;
}

/** FTE figures get finer resolution than `fmt` — a spread-out residue can sit
 *  at 0.16 FTE, which one decimal would round into a lie. */
function fteFmt(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (value > 0 && rounded === 0) return "<0.01";
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/0$/, "");
}

/** `fmt` keeps one decimal, which turns a real 0.04 into a flat "0" — fine on
 *  a bar label, a lie in a table of workings. Drop to two decimals only where
 *  one isn't enough. Sign-aware: most callers pass magnitudes, but a drift is
 *  signed and must not collapse to "0". */
function numFmt(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude === 0) return "0";
  const sign = value < 0 ? "-" : "";
  if (magnitude < 0.005) return `${sign}<0.01`;
  if (magnitude >= 0.05) return sign + fmt(magnitude);
  return sign + (Math.round(magnitude * 100) / 100).toFixed(2);
}

/** Day counts past ten are whole days — a tenth of a working day is noise at
 *  that scale, and the extra digit only costs column width. */
function dayFmt(days: number): string {
  if (days >= 10) return String(Math.round(days));
  return numFmt(days);
}

interface StreamRow {
  key: string;
  label: string;
  /** This capability is pinned at its own ceiling and is therefore what
   *  decides how long the phase takes — the only cell worth raising. */
  setsPace: boolean;
  /** Too small to spread across the phase, so it runs as a short burst. */
  isBurst: boolean;
  /** Pure-work days owed — what the capability matrix assigned. */
  days: number;
  /** Effort spread over the stream's own span, so days ÷ (fte × focus)
   *  reproduces `workDays` exactly. */
  fte: number;
  /** Working days of wall clock the stream occupies. */
  workDays: number;
  /** What the crew derivation asked for. `fte` falls below it only when the
   *  pool was too tight to field the whole team. */
  crewFte: number;
  isFinite: boolean;
  /** Productivity of this capability's people — the divisor in this row's own
   *  equation, which now differs from row to row. */
  focus: number;
}

function toRow(stream: StreamSchedule, wdPerMonth: number, focus: number): StreamRow {
  const spanMonths = stream.endMonths - stream.startMonths;
  const isFinite = Number.isFinite(spanMonths);
  const workDays = isFinite ? spanMonths * wdPerMonth : Infinity;
  return {
    key: `${stream.capability}-${stream.phase}`,
    label: CAPABILITY_LABELS[stream.capability],
    setsPace: stream.setsPace,
    isBurst: stream.isBurst,
    days: stream.demandDays,
    fte: isFinite && workDays > EPS ? stream.demandDays / (workDays * focus) : 0,
    workDays,
    crewFte: stream.crewFte,
    isFinite,
    focus,
  };
}

function PhaseColumn({
  phase,
  title,
  rows,
  spanStart,
  spanEnd,
  waitBefore,
  barredBefore = 0,
}: {
  phase: 1 | 2;
  title: string;
  rows: StreamRow[];
  /** Working days from the plan's day zero. */
  spanStart: number | null;
  spanEnd: number | null;
  waitBefore: number;
  /** Of `waitBefore`, the part an external constraint accounts for — no amount
   *  of extra staff would shorten it, so it is named separately. */
  barredBefore?: number;
}) {
  const totalDays = rows.reduce((sum, r) => sum + r.days, 0);

  return (
    <div className="atl-tip-col">
      <div className="atl-tip-phase">
        <div className="atl-tip-phase-name">
          <b>faza {phase}</b>
          <span>{title}</span>
        </div>
        <div className="atl-tip-phase-span">
          {spanStart != null && spanEnd != null && Number.isFinite(spanEnd)
            ? `dzień ${dayFmt(spanStart)} → ${dayFmt(spanEnd)} · trwa ${dayFmt(spanEnd - spanStart)} dni rob.`
            : "—"}
        </div>
      </div>

      {barredBefore > EPS && (
        <div className="atl-tip-wait">+ {dayFmt(barredBefore)} dni rob. — nie wolno zacząć</div>
      )}
      {waitBefore - barredBefore > EPS && (
        <div className="atl-tip-wait">
          + {dayFmt(waitBefore - barredBefore)} dni rob. oczekiwania na obsadę
        </div>
      )}

      {rows.length === 0 ? (
        <div className="atl-tip-none">brak nakładu w tej fazie</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>komp.</th>
              <th>nakład</th>
              <th>FTE</th>
              <th>dni rob.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td title={`${row.label} pracuje z produktywnością ${fmt(row.focus * 100)}%`}>
                  {row.label}
                  {row.setsPace && <i className="atl-tip-star">▲</i>}
                  {row.isBurst && <i className="atl-tip-star">*</i>}
                </td>
                <td>{numFmt(row.days)}</td>
                <td>
                  {row.isFinite ? fteFmt(row.fte) : "—"}
                  {row.isFinite && row.fte < row.crewFte - 0.005 && (
                    <i className="atl-tip-short"> z {fteFmt(row.crewFte)}</i>
                  )}
                </td>
                <td>{row.isFinite ? dayFmt(row.workDays) : "∞"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {/* Effort adds up; elapsed time doesn't — the streams run side by
                side, so the phase span is in the header rather than
                pretending to be a column total. */}
            <tr>
              <td>razem</td>
              <td>{numFmt(totalDays)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}

/**
 * Hover breakdown for one project bar: faza 1 and faza 2 side by side, each
 * showing per capability how much work it owes, how many people are on it,
 * and how many working days that therefore takes.
 *
 * Everything is in days and FTE — no person-months. One row is one equation,
 * `nakład ÷ (FTE × produktywność) = dni robocze`, so the bar can be checked by
 * eye rather than taken on trust. Productivity is the whole conversion: a
 * person on the job for a working day delivers only their own share of a day
 * of the estimate, and since that share is now set per person (see
 * `Person.focusFactor`) it varies by capability — each row uses the
 * FTE-weighted productivity of the people who staff it.
 */
export function ProjectBreakdownTip({
  sp,
  settings,
  focus,
  anchor,
  positionLabel,
}: ProjectBreakdownTipProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const wdPerMonth = settings.workingDaysPerMonth;
  const toDays = (months: number) => months * wdPerMonth;

  // Placed below the bar by default, flipped above and clamped sideways when
  // that would run it off-screen. Done in a layout effect so the corrected
  // position is the first one painted.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let left = anchor.left;
    let top = anchor.bottom + pad;
    if (left + rect.width > window.innerWidth - pad) left = window.innerWidth - pad - rect.width;
    if (left < pad) left = pad;
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, anchor.top - pad - rect.height);
    }
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [anchor]);

  const rows1 = sp.streams
    .filter((s) => s.phase === 1)
    .map((s) => toRow(s, wdPerMonth, focus[s.capability]));
  const rows2 = sp.streams
    .filter((s) => s.phase === 2)
    .map((s) => toRow(s, wdPerMonth, focus[s.capability]));
  // The footer states the conversion once. With one productivity across every
  // capability on show — the usual case — that is a single number the reader
  // can check each row against by hand; when they differ, quoting any one of
  // them would be a lie about the others, so name the span instead and leave
  // the exact figure to each row's own tooltip.
  const focusPercents = [...rows1, ...rows2].map((r) => Math.round(r.focus * 100));
  const focusLabel =
    focusPercents.length === 0
      ? null
      : Math.min(...focusPercents) === Math.max(...focusPercents)
        ? `${focusPercents[0]}%`
        : `${Math.min(...focusPercents)}–${Math.max(...focusPercents)}%`;
  const phase1 = sp.phases.find((p) => p.phase === 1) ?? null;
  const phase2 = sp.phases.find((p) => p.phase === 2) ?? null;
  // Dead time in front of each phase: for faza 1 everything before it could
  // gather a crew (a blocker, or the queue); for faza 2 the gate wait on top
  // of that. Between them they account for the whole bar.
  const wait1 = phase1 ? Math.max(0, toDays(phase1.startMonths)) : 0;
  const wait2 =
    phase1 && phase2 ? Math.max(0, toDays(phase2.startMonths - phase1.endMonths)) : 0;
  const hasPace = [...rows1, ...rows2].some((r) => r.setsPace);
  const hasBurst = [...rows1, ...rows2].some((r) => r.isBurst);
  const totalDays = [...rows1, ...rows2].reduce((sum, r) => sum + r.days, 0);

  return (
    <div
      ref={ref}
      className="atl-tip"
      role="tooltip"
      style={{ left: anchor.left, top: anchor.bottom + 8 }}
    >
      <div className="atl-tip-head">
        <span className="atl-tip-id">{positionLabel}</span>
        <b>{sp.project.name}</b>
        <span className="atl-tip-total">
          {numFmt(totalDays)} dni nakładu ·{" "}
          {Number.isFinite(sp.endMonths)
            ? `${dayFmt(toDays(sp.endMonths - sp.startMonths))} dni rob.`
            : "nigdy się nie kończy"}
        </span>
      </div>

      {sp.hasNoDemand ? (
        <div className="atl-tip-none">brak przypisanych kompetencji — nie ma czego planować</div>
      ) : (
        <div className="atl-tip-cols">
          <PhaseColumn
            phase={1}
            title="inicjacja"
            rows={rows1}
            spanStart={phase1 ? toDays(phase1.startMonths) : null}
            spanEnd={phase1 ? toDays(phase1.endMonths) : null}
            waitBefore={wait1}
            barredBefore={Math.min(wait1, toDays(sp.earliestStartMonths))}
          />
          <PhaseColumn
            phase={2}
            title="wytwarzanie"
            rows={rows2}
            spanStart={phase2 ? toDays(phase2.startMonths) : null}
            spanEnd={phase2 ? toDays(phase2.endMonths) : null}
            waitBefore={wait2}
          />
        </div>
      )}

      <div className="atl-tip-foot">
        nakład ÷ (FTE × {focusLabel ?? "—"} produktywności) = dni robocze
        {" — "}
        oś czasu liczy {fmt(wdPerMonth)} dni rob. na miesiąc
        {hasPace && (
          <>
            <br />▲ ta kompetencja jest na swoim suficie i wyznacza długość fazy — reszta załogi
            schodzi z tempa, żeby skończyć razem z nią
          </>
        )}
        {hasBurst && (
          <>
            <br />* za mało pracy, by rozłożyć ją na całą fazę — idzie krótkim zrywem i kończy
            wcześniej
          </>
        )}
        {sp.isImpossible && (
          <>
            <br />
            <span className="atl-tip-short">projekt nigdy się nie kończy — te strumienie nigdy nie dostają obsady</span>
          </>
        )}
      </div>
    </div>
  );
}
