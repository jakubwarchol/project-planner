/**
 * The chrome both obsada timelines share: the period navigator, the unit
 * switch, the two-tier sticky axis and the backdrop behind the rows. Scroll
 * itself lives in `timelineScroll.ts`.
 */
import type { ReactNode } from "react";
import { UNITS, UNIT_ORDER, type ObsadaAxis, type ObsadaUnit } from "./axis";
import { AXIS_H, BAND_H } from "./timelineScroll";

interface ToolbarProps {
  focusLabel: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  unit: ObsadaUnit;
  onUnit: (unit: ObsadaUnit) => void;
  children?: ReactNode;
  summary?: ReactNode;
}

export function ObsadaToolbar({
  focusLabel,
  onPrev,
  onNext,
  onToday,
  unit,
  onUnit,
  children,
  summary,
}: ToolbarProps) {
  return (
    <header className="obs-bar">
      <div className="obs-nav">
        <button type="button" className="obs-nav-btn" onClick={onPrev} aria-label="Wstecz">
          ◀
        </button>
        <span className="obs-nav-label">{focusLabel}</span>
        <button type="button" className="obs-nav-btn" onClick={onNext} aria-label="Dalej">
          ▶
        </button>
        <button type="button" className="atl-btn" onClick={onToday}>
          Dziś
        </button>
      </div>

      <div className="atl-seg">
        {UNIT_ORDER.map((u) => (
          <button
            key={u}
            type="button"
            className={u === unit ? "is-active" : undefined}
            onClick={() => onUnit(u)}
          >
            {UNITS[u].label}
          </button>
        ))}
      </div>

      {children}

      <div className="atl-spacer" />
      {summary}
    </header>
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
          className={`obs-axis-cell${c.strongTick ? " is-strong" : ""}${c.isNow ? " is-now" : ""}`}
          style={{ left: c.left, width: c.width, top: BAND_H }}
        >
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
