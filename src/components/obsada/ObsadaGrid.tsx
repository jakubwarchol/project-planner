/**
 * The chrome both obsada timelines share: the v5 header (headline figure,
 * period stepper and the unit tabs), the two-tier sticky axis and the
 * backdrop behind the rows. Scroll itself lives in `timelineScroll.ts`.
 */
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { UNITS, type ObsadaAxis, type ObsadaUnit } from "./axis";
import { IconButton, ScreenHeader, UnderlineTabs } from "../../design";
import { AXIS_H, BAND_H } from "./timelineScroll";

/** Dni first — the order the design reads the grains in. */
const UNIT_TABS: ObsadaUnit[] = ["days", "weeks", "months"];

interface ToolbarProps {
  /** The view's headline: eyebrow over one large figure and its unit. */
  eyebrow: string;
  value: string;
  unit: string;
  /** The sentence under the figure — what the drawing means. */
  prose: ReactNode;
  focusLabel: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  timeUnit: ObsadaUnit;
  onUnit: (unit: ObsadaUnit) => void;
  /** Extra view-specific controls, placed before the stepper. */
  children?: ReactNode;
}

export function ObsadaToolbar({
  eyebrow,
  value,
  unit,
  prose,
  focusLabel,
  onPrev,
  onNext,
  onToday,
  timeUnit,
  onUnit,
  children,
}: ToolbarProps) {
  return (
    <ScreenHeader
      eyebrow={eyebrow}
      value={value}
      unit={unit}
      actions={
        <>
          {children}
          <span className="obs-range">
            <IconButton label="Wcześniej" size="lg" filled onClick={onPrev}>
              <ChevronLeft size={13} strokeWidth={1.75} />
            </IconButton>
            <button
              type="button"
              className="obs-range-label"
              onClick={onToday}
              title="Wróć do dziś"
            >
              {focusLabel}
            </button>
            <IconButton label="Później" size="lg" filled onClick={onNext}>
              <ChevronRight size={13} strokeWidth={1.75} />
            </IconButton>
          </span>
          <UnderlineTabs
            label="Skala czasu"
            value={timeUnit}
            onChange={onUnit}
            items={UNIT_TABS.map((u) => ({ id: u, label: UNITS[u].label }))}
          />
        </>
      }
    >
      {prose}
    </ScreenHeader>
  );
}

/** The sticky two-tier header, drawn inside the scrolling grid column. */
export function AxisHeader({ axis }: { axis: ObsadaAxis }) {
  return (
    <div className="obs-axis" style={{ height: AXIS_H }}>
      {axis.bands.map((b) => (
        <div
          key={b.key}
          className={`obs-axis-band${b.isNow ? " is-now" : ""}`}
          style={{ left: b.left, width: b.width, height: BAND_H }}
        >
          {b.label}
        </div>
      ))}
      {axis.cells.map((c) => (
        <div
          key={c.key}
          className={`obs-axis-cell${c.strongTick ? " is-strong" : ""}${c.isNow ? " is-now" : ""}${c.sub ? " is-day" : ""}${c.tone ? ` is-${c.tone}` : ""}`}
          style={{ left: c.left, width: c.width, top: BAND_H }}
        >
          {c.sub && <i>{c.sub}</i>}
          <span>{c.text}</span>
        </div>
      ))}
      <div className="obs-axis-today" style={{ left: axis.todayX }} />
    </div>
  );
}

/** Gridlines, weekend/holiday shading and the today line, behind every row. */
export function AxisBackdrop({ axis }: { axis: ObsadaAxis }) {
  return (
    <div className="obs-back" style={{ top: AXIS_H }}>
      {axis.shades.map((s) => (
        <div
          key={s.key}
          className={`obs-shade${s.holiday ? " is-holiday" : ""}`}
          style={{ left: s.left, width: s.width }}
        />
      ))}
      {axis.lines.map((x) => (
        <div key={x} className="obs-gridline" style={{ left: x }} />
      ))}
      <div className="obs-back-today" style={{ left: axis.todayX }} />
    </div>
  );
}
