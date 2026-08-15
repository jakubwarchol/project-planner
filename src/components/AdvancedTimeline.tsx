import { useEffect, useMemo, useState } from "react";
import { ChevronsLeft, ChevronsRight, Clock, Flag, TriangleAlert } from "lucide-react";
import { formatDateKey, monthsFrom } from "../lib/calendar";
import { computeStartDrift } from "../lib/planning";
import { useCapabilityMatrix } from "../hooks/useCapabilityMatrix";
import { useCapabilitySchedule } from "../hooks/useCapabilitySchedule";
import { useZoomGesture } from "../hooks/useZoomGesture";
import {
  CAPABILITY_LABELS,
  CAPABILITY_ORDER,
  CATEGORY_ORDER,
  CEILING_FTE_EPS,
  CEILING_FTE_STEPS,
  ESTIMATE_ORDER,
  focusByCapability,
} from "../lib/estimation";
import { assignOwnLanes, type ScheduledProject } from "../lib/scheduling";
import { usePlanner } from "../state/plannerContext";
import type { CapabilityVector, Project } from "../types";
import { ProjectBreakdownTip, type TipAnchor } from "./ProjectBreakdownTip";
import {
  DENSITIES,
  HUES,
  MON,
  ZOOMS,
  buildAxis,
  buildHueMap,
  fmt,
  groupArrowNav,
  plCount,
  soft,
  solid,
} from "./timelineChrome";
import "./timeline.css";

interface AdvancedTimelineProps {
  projects: Project[];
  /** Live roster pools — hypothetical variants live only in the projections view. */
  pools: CapabilityVector;
  onOpenMatrix: () => void;
  theme: "auto" | "light" | "dark";
}

const EPS = 1e-6;

interface RowModel {
  sp: ScheduledProject;
  lane: number;
}

interface BandModel {
  category: string;
  rows: RowModel[];
}

export function AdvancedTimeline({ projects, pools, onOpenMatrix, theme }: AdvancedTimelineProps) {
  const { cells, setCell } = useCapabilityMatrix();
  const schedule = useCapabilitySchedule(projects, pools);
  const { people, settings } = usePlanner();

  const { ppm, setPpm, scrollRef } = useZoomGesture(ZOOMS[1].ppm);
  const [densityId, setDensityId] = useState("m");
  const [keyOpen, setKeyOpen] = useState(true);
  const [nameCollapsed, setNameCollapsed] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [popover, setPopover] = useState<string | null>(null);
  const [tip, setTip] = useState<{ projectId: string; anchor: TipAnchor } | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && popover) setPopover(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [popover]);

  const hueById = useMemo(() => buildHueMap(projects), [projects]);
  const focusByCap = useMemo(() => focusByCapability(people), [people]);

  const bands: BandModel[] = useMemo(() => {
    const byCategory = new Map<string, ScheduledProject[]>();
    for (const sp of schedule.scheduled) {
      const list = byCategory.get(sp.project.category) ?? [];
      list.push(sp);
      byCategory.set(sp.project.category, list);
    }
    return CATEGORY_ORDER.map((category) => {
      const sps = byCategory.get(category) ?? [];
      const lanes = assignOwnLanes(sps.map((sp) => ({ startMonths: sp.startMonths })));
      const rows = sps.map((sp, i) => ({ sp, lane: lanes[i] })).sort((a, b) => a.lane - b.lane);
      return { category, rows };
    }).filter((band) => band.rows.length > 0);
  }, [schedule]);

  const D = DENSITIES.find((d) => d.id === densityId) ?? DENSITIES[1];
  const nameW = nameCollapsed ? D.nameCol : D.name;
  const barTop = Math.round((D.row - D.bar) / 2);
  const showNames = !nameCollapsed;

  const months = Math.max(12, Math.ceil(schedule.horizonMonths / 6) * 6 + 6);
  const totalW = months * ppm;

  const now = useMemo(() => new Date(), []);
  const startYear = now.getFullYear();
  const startMonth = now.getMonth();
  // t=0 on this axis, so calendar constraints can be placed against it.
  const nowMonth = useMemo(() => ({ year: startYear, month: startMonth }), [startYear, startMonth]);

  const { ticks, tickLabels, gridlines } = useMemo(
    () => buildAxis(months, ppm, startYear, startMonth),
    [months, ppm, startYear, startMonth],
  );

  const landMonth = startMonth + Math.round(schedule.horizonMonths);
  const landLabel = `${MON[landMonth % 12]} ${startYear + Math.floor(landMonth / 12)}`;
  const totalIdle = CAPABILITY_ORDER.reduce((sum, c) => sum + schedule.idleFteMonths[c], 0);
  const impossibleCount = schedule.scheduled.filter((sp) => sp.isImpossible).length;
  const overPoolCount = schedule.scheduled.filter((sp) => sp.isOverPool).length;

  function sizeIndex(project: Project) {
    return ESTIMATE_ORDER.indexOf(project.estimate) + 1;
  }

  // A short "P01"-style label from backlog position — not `project.id`,
  // which is a long UUID for anything added by hand and would otherwise
  // swamp the fixed-width id badge and crowd out the name next to it.
  const indexById = useMemo(() => new Map(projects.map((p, i) => [p.id, i])), [projects]);
  function positionLabel(project: Project) {
    const index = indexById.get(project.id) ?? 0;
    return `P${String(index + 1).padStart(2, "0")}`;
  }

  // For naming the other projects on a `dependency-cycle` reason — those ids
  // belong to whichever projects are on the loop, not necessarily this row.
  const projectNameById = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);

  function renderRow(row: RowModel) {
    const sp = row.sp;
    const project = sp.project;
    const hue = hueById[project.id] ?? HUES[0];
    const hovered = hover === project.id;
    const left = Math.round(sp.startMonths * ppm);
    const finite = Number.isFinite(sp.endMonths);
    const width = sp.hasNoDemand ? 0 : Math.max(4, Math.round(((finite ? sp.endMonths : sp.startMonths + 6) - sp.startMonths) * ppm));

    // The flat phase1/phase2 fill is the whole bar now — a fully-scheduled
    // project needs no outline. Only the problem states (no demand,
    // impossible, over target) still draw a border, as the signal for them.
    let envStyle = "none";
    let envColor = "transparent";
    let envFill = "transparent";
    let hasOutLabel = false;
    let outLabel = "";
    let outLabelColor = "var(--ink-3)";

    if (sp.hasNoDemand) {
      envStyle = "dotted";
      envColor = "var(--line-strong)";
      envFill = "transparent";
      hasOutLabel = true;
      outLabel = "brak przypisanych kompetencji";
      outLabelColor = "var(--ink-4)";
    } else if (sp.isImpossible) {
      envStyle = "dotted";
      envColor = "var(--warn)";
      envFill = "var(--warn-wash)";
      hasOutLabel = true;
      const capNames = sp.impossibleReasons
        .filter((r) => r.capability != null && r.kind !== "min-above-pool")
        .map((r) => CAPABILITY_LABELS[r.capability!]);
      // Distinct from "brak" — the capability exists, but the minimum crew
      // this project needs from it is bigger than the whole pool.
      const tooSmallPool = sp.impossibleReasons
        .filter((r) => r.kind === "min-above-pool")
        .map((r) => CAPABILITY_LABELS[r.capability!]);
      const blockedByImpossible = sp.impossibleReasons.some((r) => r.kind === "blocked-by-impossible");
      // A dependency cycle is invalid data, not a capacity problem — every
      // project on the loop carries the same full cycle, so name it plainly
      // rather than folding it into the capability-shortage phrasing above.
      const cycle = sp.impossibleReasons.find((r) => r.kind === "dependency-cycle")?.cycle;
      const parts: string[] = [];
      if (cycle) {
        const names = cycle.map((id) => projectNameById.get(id) ?? id);
        parts.push(
          cycle.length === 1
            ? `projekt blokuje sam siebie (${names[0]})`
            : `cykl zależności: ${names.join(" → ")} → ${names[0]}`,
        );
      }
      if (capNames.length > 0) parts.push(`brak: ${capNames.join(", ")}`);
      if (tooSmallPool.length > 0) parts.push(`zespół mniejszy od minimalnej obsady: ${tooSmallPool.join(", ")}`);
      if (blockedByImpossible) parts.push("blokujący projekt nigdy się nie kończy");
      outLabel = `nigdy się nie skończy — ${parts.join(" · ")}`;
      outLabelColor = "var(--warn)";
    } else if (sp.isOverPool) {
      envStyle = "solid";
      envColor = "var(--warn)";
      const caps = sp.overPoolCapabilities.map((c) => CAPABILITY_LABELS[c]).join(", ");
      hasOutLabel = true;
      outLabel = `przeciążone: ${caps}`;
      outLabelColor = "var(--warn)";
    }

    // The deadline is drawn, never scheduled around — so it is derived here in
    // the view and never reaches the scheduler. A month already past still
    // gets a marker, at t=0, rather than being clamped away like an expired
    // earliest start: a deadline in the past is the whole point of showing it.
    const deadlineMonths = monthsFrom(nowMonth, project.deadlineDate);
    const missesDeadline =
      deadlineMonths != null && (!finite || sp.endMonths > deadlineMonths + EPS);
    // Planned start is the same kind of marker as the deadline — a soft,
    // display-only comparison. `startDrift` is only meaningful once the
    // project actually has a computed start (segments exist); an impossible
    // or no-demand project has nothing to compare against.
    const plannedStartMonths = monthsFrom(nowMonth, project.plannedStartDate);
    const startDrift =
      plannedStartMonths != null && !sp.isImpossible && !sp.hasNoDemand
        ? computeStartDrift(nowMonth, sp.startMonths, project.plannedStartDate)
        : null;
    const isLateStart = startDrift != null && startDrift > EPS;
    const phase1 = sp.phases.find((p) => p.phase === 1);
    // Impossible projects carry no real phases/segments — the outer envelope
    // (dotted warn border + wash) is the only signal for them; a solid fill
    // would lie about work that never actually gets scheduled.
    const phase1EndMonths = phase1 ? phase1.endMonths : sp.startMonths;
    const phase1WidthPx = sp.isImpossible
      ? 0
      : Math.max(0, Math.min(width, Math.round((phase1EndMonths - sp.startMonths) * ppm)));
    const phase2WidthPx = sp.isImpossible ? 0 : Math.max(0, width - phase1WidthPx);

    return (
      <div
        key={project.id}
        className="atl-row"
        style={{ height: D.row, background: hovered ? "var(--row-hover)" : "transparent" }}
        onMouseEnter={() => setHover(project.id)}
        onMouseLeave={() => setHover((h) => (h === project.id ? null : h))}
      >
        <div
          className="atl-row-name"
          style={{ width: nameW, background: hovered ? "var(--name-hover)" : "var(--band)" }}
          title={project.description || project.name}
        >
          <span className="atl-hue" style={{ height: D.bar, background: solid(hue), opacity: 0.9 }} />
          <span className="atl-row-id" style={{ fontSize: D.fsMono }}>
            {positionLabel(project)}
          </span>
          {showNames && (
            <span className="atl-row-title" style={{ fontSize: D.fsName }}>
              {project.name}
            </span>
          )}
          <span
            className="atl-size"
            title={`rozmiar ${project.estimate} · ${fmt(sp.assignedEffortDays)} dni nakładu w macierzy`}
          >
            <span className="atl-size-ticks">
              {ESTIMATE_ORDER.map((_, k) => (
                <i
                  key={k}
                  style={{
                    height: 4 + k * 2,
                    background: k < sizeIndex(project) ? "var(--ink-3)" : "var(--line-strong)",
                  }}
                />
              ))}
            </span>
            <span className="atl-size-label">{project.estimate}</span>
          </span>
        </div>

        <div className="atl-row-track" style={{ width: totalW, height: D.row }}>
          {gridlines.map((x) => (
            <div key={x} className="atl-grid" style={{ left: x, height: D.row, background: "var(--line)" }} />
          ))}

          {sp.earliestStartMonths > EPS && (
            <div
              className="atl-earliest"
              style={{ left: Math.round(sp.earliestStartMonths * ppm), height: D.row }}
              title={`nie może ruszyć przed ${formatDateKey(project.earliestStartDate)} — ograniczenie zewnętrzne, nie kolejka`}
            />
          )}

          {deadlineMonths != null && (
            <div
              className={`atl-deadline ${missesDeadline ? "is-missed" : ""}`}
              style={{ left: Math.round(deadlineMonths * ppm), height: D.row }}
              title={
                missesDeadline
                  ? `termin ${formatDateKey(project.deadlineDate)} — projekt kończy się ${fmt(sp.endMonths - deadlineMonths)} mies. po nim`
                  : `termin ${formatDateKey(project.deadlineDate)} — mieści się`
              }
            >
              <Flag size={9} />
            </div>
          )}

          {plannedStartMonths != null && (
            <div
              className={`atl-planned-start ${isLateStart ? "is-late" : ""}`}
              style={{ left: Math.round(plannedStartMonths * ppm), height: D.row }}
              title={
                startDrift != null && startDrift > EPS
                  ? `plan startu ${formatDateKey(project.plannedStartDate)} — realny start jest o ${fmt(startDrift)} mies. późniejszy`
                  : startDrift != null && startDrift < -EPS
                    ? `plan startu ${formatDateKey(project.plannedStartDate)} — realny start jest o ${fmt(-startDrift)} mies. wcześniejszy`
                    : `plan startu ${formatDateKey(project.plannedStartDate)} — zgodny z harmonogramem`
              }
            >
              <Clock size={9} />
            </div>
          )}

          {width > 0 && (
            <div
              className="atl-bar"
              style={{
                left,
                top: barTop,
                width,
                height: D.bar,
                border: `1px ${envStyle} ${envColor}`,
                background: envFill,
                boxShadow: hovered ? "0 0 0 2px var(--band), 0 0 0 3.5px var(--ink-2)" : "none",
              }}
              onMouseEnter={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setTip({ projectId: project.id, anchor: { left: r.left, top: r.top, bottom: r.bottom } });
              }}
              onMouseLeave={() => setTip((t) => (t?.projectId === project.id ? null : t))}
              onClick={(e) => {
                e.stopPropagation();
                setPopover((p) => (p === project.id ? null : project.id));
              }}
            >
              {phase1WidthPx > 0 && (
                <div
                  className="atl-seg-fill"
                  style={{ left: 0, width: phase1WidthPx, height: D.bar, background: soft(hue) }}
                />
              )}
              {phase2WidthPx > 0 && (
                <div
                  className="atl-seg-fill"
                  style={{ left: phase1WidthPx, width: phase2WidthPx, height: D.bar, background: solid(hue) }}
                />
              )}
              {phase1 && finite && phase1.endMonths > sp.startMonths + EPS && phase1.endMonths < sp.endMonths - EPS && (
                <div
                  className="atl-phase-tick"
                  style={{ left: Math.round((phase1.endMonths - sp.startMonths) * ppm) }}
                  title={`faza 1 kończy się po ${fmt((phase1.endMonths - sp.startMonths) * settings.workingDaysPerMonth)} dniach rob.`}
                />
              )}
            </div>
          )}

          {hasOutLabel && (
            <div
              className="atl-out-label"
              style={{ left: left + width, top: barTop, height: D.bar, color: outLabelColor }}
            >
              {outLabel}
            </div>
          )}

          {popover === project.id && (
            <div
              className="atl-pop"
              style={{ left: Math.max(0, left + 8), top: barTop + D.bar + 6 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="atl-pop-head">
                <span>Maks. obsada na {positionLabel(project)}</span>
              </div>
              <div className="atl-pop-cells">
                {CAPABILITY_ORDER.map((capability) => {
                  const cell = cells[project.id]?.[capability] ?? { days: 0, maxFte: 0 };
                  if (cell.days <= 0) return null;
                  // Same reading as the matrix strip, from the same simulation:
                  // each phase has one capability pinned at its ceiling, and
                  // that is the only one whose ceiling is worth touching. The
                  // colours mean here exactly what they mean in Wyceny.
                  const pacePhases = sp.streams
                    .filter((s) => s.capability === capability && s.setsPace)
                    .map((s) => s.phase);
                  const isPace1 = pacePhases.includes(1);
                  const isPace2 = pacePhases.includes(2);
                  const paceNote = isPace1 && isPace2
                    ? "wyznacza tempo obu faz"
                    : isPace1
                      ? "wyznacza tempo inicjacji"
                      : isPace2
                        ? "wyznacza tempo budowy"
                        : "";
                  // The same six stops as the matrix strip, from one shared
                  // list — a ceiling is a headcount judgement, so the popover
                  // offers exactly the values worth choosing and nothing else.
                  return (
                    <div className="atl-pop-cell" key={capability}>
                      <span className="atl-pop-cell-top">
                        <span>
                          {CAPABILITY_LABELS[capability]} <i>{fmt(cell.days)} dni</i>
                        </span>
                        <b>{fmt(cell.maxFte)} FTE</b>
                      </span>
                      <span
                        className={`atl-fte ${isPace1 ? "is-pace1" : ""} ${isPace2 ? "is-pace2" : ""}`}
                        role="radiogroup"
                        onKeyDown={groupArrowNav}
                        aria-label={`Maks. obsada ${CAPABILITY_LABELS[capability]}${paceNote ? ` — ${paceNote}` : ""}`}
                        title={
                          paceNote
                            ? `${CAPABILITY_LABELS[capability]} pracuje na maksimum i ${paceNote} — podniesienie tego sufitu skróci projekt.`
                            : `${CAPABILITY_LABELS[capability]} ma zapas — załoga jest zwolniona, żeby skończyć razem z resztą, więc podniesienie tego sufitu niczego nie zmieni.`
                        }
                      >
                        {CEILING_FTE_STEPS.map((v, i, steps) => {
                          const on = cell.maxFte >= v - CEILING_FTE_EPS;
                          const current = Math.abs(cell.maxFte - v) < CEILING_FTE_EPS;
                          // Roving tabindex: the chosen stop is the group's one
                          // Tab stop; with nothing on a step, the first stop is.
                          const hasCurrent = steps.some(
                            (s) => Math.abs(cell.maxFte - s) < CEILING_FTE_EPS,
                          );
                          return (
                            <button
                              key={v}
                              type="button"
                              role="radio"
                              aria-checked={current}
                              tabIndex={current || (!hasCurrent && i === 0) ? 0 : -1}
                              className={`atl-fte-slot ${on ? "is-on" : ""} ${current ? "is-current" : ""}`}
                              title={`Ustaw maks. obsadę ${CAPABILITY_LABELS[capability]} na ${fmt(v)} FTE`}
                              onClick={() => setCell(project.id, capability, { maxFte: v })}
                            >
                              {fmt(v)}
                            </button>
                          );
                        })}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="atl-pop-foot">
                <button type="button" className="atl-pop-clear" onClick={onOpenMatrix}>
                  otwórz wyceny
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderBand(band: BandModel) {
    // Only the rare, actionable state is counted here. A "waiting" tally used
    // to sit alongside it, but in a capacity-bound portfolio nearly every
    // project waits for someone at some point, so it flagged the whole band
    // and told you nothing you could act on.
    const overs = band.rows.filter((r) => r.sp.isOverPool || r.sp.isImpossible).length;
    const warnBits: { icon: typeof TriangleAlert; text: string }[] = [];
    if (overs) warnBits.push({ icon: TriangleAlert, text: `${overs} przeciążonych` });

    const spanEnd = band.rows.reduce(
      (max, r) => (Number.isFinite(r.sp.endMonths) ? Math.max(max, r.sp.endMonths) : max),
      0,
    );

    return (
      <section className="atl-band" key={band.category}>
        <div className="atl-band-head" style={{ height: D.band }}>
          <div className="atl-band-name" style={{ width: nameW }}>
            <div style={{ flex: "none", width: 3, height: D.bar, background: "var(--ink-3)", opacity: 0.6 }} />
            <b>{band.category}</b>
            {showNames && (
              <span className="atl-band-people">
                {plCount(band.rows.length, "projekt", "projekty", "projektów")}
              </span>
            )}
          </div>
          <div className="atl-band-track" style={{ width: totalW }}>
            <div className="atl-band-chips" style={{ left: Math.round(spanEnd * ppm), height: D.band }}>
              <span style={{ color: "var(--ink-2)" }}>{spanEnd ? `${fmt(spanEnd)} mies.` : "—"}</span>
              {warnBits.length > 0 && (
                <span style={{ color: "var(--warn)", display: "inline-flex", alignItems: "center", gap: 10 }}>
                  {warnBits.map(({ icon: Icon, text }, i) => (
                    <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <Icon size={11} />
                      {text}
                    </span>
                  ))}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="atl-rows">{band.rows.map((row) => renderRow(row))}</div>
      </section>
    );
  }

  function renderUtilizationBand() {
    return (
      <section className="atl-band atl-util-band" key="__util">
        <div className="atl-band-head" style={{ height: D.band }}>
          <div className="atl-band-name" style={{ width: nameW }}>
            <div style={{ flex: "none", width: 3, height: D.bar, background: "var(--accent)", opacity: 0.7 }} />
            <b>wykorzystanie zdolności</b>
          </div>
          <div className="atl-band-track" style={{ width: totalW }} />
        </div>
        <div className="atl-rows">
          {CAPABILITY_ORDER.map((capability) => {
            const pool = schedule.pools[capability] ?? 0;
            const idleSpans = schedule.idleSpans.filter((s) => s.capability === capability);
            return (
              <div className="atl-row atl-util-row" key={capability} style={{ height: D.row }}>
                <div className="atl-row-name" style={{ width: nameW, background: "var(--band)" }}>
                  <span className="atl-row-id" style={{ fontSize: D.fsMono }}>
                    {CAPABILITY_LABELS[capability]}
                  </span>
                  {showNames && <span className="atl-band-people">{fmt(pool)} FTE</span>}
                </div>
                <div className="atl-row-track" style={{ width: totalW, height: D.row }}>
                  {gridlines.map((x) => (
                    <div key={x} className="atl-grid" style={{ left: x, height: D.row, background: "var(--line)" }} />
                  ))}
                  {pool > 0 && (
                    <div
                      className="atl-util-used"
                      style={{
                        left: 0,
                        top: barTop,
                        width: Math.round(schedule.horizonMonths * ppm),
                        height: D.bar,
                        background: soft(HUES[0]),
                      }}
                    />
                  )}
                  {idleSpans.map((span, i) => {
                    const spanLeft = Math.round(span.startMonths * ppm);
                    const spanW = Math.max(2, Math.round((span.endMonths - span.startMonths) * ppm));
                    const idleRatio = pool > 0 ? span.idleFte / pool : 1;
                    return (
                      <div
                        key={i}
                        className="atl-util-idle"
                        style={{
                          left: spanLeft,
                          top: barTop,
                          width: spanW,
                          height: Math.max(3, Math.round(idleRatio * D.bar)),
                        }}
                        title={`${fmt(span.idleFte)} FTE wolnych`}
                      />
                    );
                  })}
                  {pool > 0 && (
                    <div
                      className="atl-util-idle"
                      style={{
                        left: Math.round(schedule.horizonMonths * ppm),
                        top: barTop,
                        width: Math.max(2, totalW - Math.round(schedule.horizonMonths * ppm)),
                        height: D.bar,
                      }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  const projectCount = schedule.scheduled.length;

  // The tip yields to the click-through popover rather than stacking on it —
  // both hang off the same bar.
  const tipTarget =
    tip && popover !== tip.projectId
      ? (schedule.scheduled.find((sp) => sp.project.id === tip.projectId) ?? null)
      : null;

  return (
    <div className="atl" data-theme={theme === "auto" ? undefined : theme}>
      <header className="atl-header" style={{ height: D.hdr }}>
        <div className="atl-title">
          <b>Plan</b>
          <span className="atl-chip">obecny zespół</span>
        </div>

        <div className="atl-spacer" />

        <div className="atl-group">
          <span className="atl-eyebrow">gęstość</span>
          <div className="atl-seg" role="tablist" aria-label="Gęstość wierszy" onKeyDown={groupArrowNav}>
            {DENSITIES.map((d) => (
              <button
                key={d.id}
                type="button"
                role="tab"
                aria-selected={d.id === D.id}
                tabIndex={d.id === D.id ? 0 : -1}
                aria-label={`Gęstość ${d.label}`}
                className={`atl-seg-icon ${d.id === D.id ? "is-active" : ""}`}
                onClick={() => setDensityId(d.id)}
              >
                {d.label}
              </button>
            ))}
          </div>
          <span className="atl-eyebrow" style={{ paddingLeft: 3 }}>
            zoom
          </span>
          <div className="atl-seg" role="tablist" aria-label="Miesięcy na ekran" onKeyDown={groupArrowNav}>
            {ZOOMS.map((z) => (
              <button
                key={z.id}
                type="button"
                role="tab"
                aria-selected={Math.abs(z.ppm - ppm) < 0.5}
                tabIndex={Math.abs(z.ppm - ppm) < 0.5 ? 0 : -1}
                aria-label={`Zoom ${z.label}`}
                className={`atl-seg-icon ${Math.abs(z.ppm - ppm) < 0.5 ? "is-active" : ""}`}
                onClick={() => setPpm(z.ppm)}
              >
                {z.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`atl-btn ${keyOpen ? "is-on" : ""}`}
            onClick={() => setKeyOpen((v) => !v)}
            aria-expanded={keyOpen}
          >
            Legenda
          </button>
        </div>
      </header>

      {keyOpen && (
        <div className="atl-key">
          <div className="atl-key-item">
            <div className="atl-key-bar">
              <i style={{ left: 0, width: 16, height: 13, background: "var(--accent-soft)", borderRadius: 1 }} />
              <i style={{ left: 16, width: 18, height: 13, background: "var(--accent)" }} />
            </div>
            <span>jaśniejszy odcień = faza 1 (inicjacja) · pełny odcień = faza 2 (wytwarzanie) · kreska = przełączenie</span>
          </div>
          <div className="atl-key-item">
            <div className="atl-key-warn" />
            <span>przeciążone lub nigdy się nie kończy — brak puli lub docelowego FTE dla jakiejś kompetencji</span>
          </div>
          <div className="atl-key-item">
            <span>kliknij pasek</span>
            <span>aby ustawić docelowe FTE poszczególnych kompetencji</span>
          </div>
        </div>
      )}

      <div
        className="atl-scroll"
        ref={scrollRef}
        onClick={() => popover && setPopover(null)}
        onScroll={() => tip && setTip(null)}
      >
        <div className="atl-axis" style={{ height: D.axis }}>
          <div className="atl-axis-corner" style={{ width: nameW }}>
            <span className="atl-eyebrow">{nameCollapsed ? "id" : "projekt"}</span>
            <button
              type="button"
              className="atl-collapse"
              title={nameCollapsed ? "rozwiń kolumnę projektu" : "zwiń kolumnę projektu"}
              aria-label={nameCollapsed ? "Rozwiń kolumnę projektu" : "Zwiń kolumnę projektu"}
              aria-pressed={nameCollapsed}
              onClick={() => setNameCollapsed((v) => !v)}
            >
              {nameCollapsed ? <ChevronsRight size={11} /> : <ChevronsLeft size={11} />}
            </button>
          </div>
          <div className="atl-track" style={{ width: totalW, height: D.axis }}>
            {ticks.map((t, i) => (
              <div key={i} className="atl-tick" style={{ left: t.x, height: t.h, background: t.color }} />
            ))}
            {tickLabels.map((t, i) => (
              <div key={i} className="atl-tick-label" style={{ left: t.x, color: t.color }}>
                {t.label}
              </div>
            ))}
          </div>
        </div>

        {bands.map((band) => renderBand(band))}
        {renderUtilizationBand()}

        <div style={{ display: "flex", height: D.axis }}>
          <div
            style={{
              position: "sticky",
              left: 0,
              zIndex: 4,
              flex: "none",
              width: nameW,
              background: "var(--surface)",
              borderRight: "1px solid var(--line-strong)",
            }}
          />
          <div style={{ flex: "none", width: totalW }} />
        </div>
      </div>

      <footer className="atl-footer" style={{ height: D.foot }}>
        <span>obecny zespół</span>
        <span>
          {plCount(projectCount, "projekt", "projekty", "projektów")} ·{" "}
          {plCount(CATEGORY_ORDER.length, "kategoria", "kategorie", "kategorii")}
        </span>
        <span>cała praca kończy się {landLabel}</span>
        <span style={{ color: "var(--idle)" }}>{fmt(totalIdle)} FTE-mies. bezczynnych</span>
        {overPoolCount > 0 && <span style={{ color: "var(--warn)" }}>{overPoolCount} przeciążonych</span>}
        {impossibleCount > 0 && (
          <span style={{ color: "var(--warn)" }}>{impossibleCount} nigdy się nie kończy</span>
        )}
        {schedule.truncated && <span style={{ color: "var(--warn)" }}>symulacja przerwana — zgłoś błąd</span>}
        <span style={{ flex: 1 }} />
        <span>esc zamyka okno projektu</span>
      </footer>

      {tipTarget && (
        <ProjectBreakdownTip
          key={tipTarget.project.id}
          sp={tipTarget}
          settings={settings}
          focus={focusByCap}
          anchor={tip!.anchor}
          positionLabel={positionLabel(tipTarget.project)}
        />
      )}
    </div>
  );
}
