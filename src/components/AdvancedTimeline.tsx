import { useEffect, useMemo, useState } from "react";
import { ChevronsLeft, ChevronsRight, Clock, Flag } from "lucide-react";
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
  focusByCapability,
} from "../lib/estimation";
import { assignOwnLanes, type ScheduledProject } from "../lib/scheduling";
import { usePlanner } from "../state/plannerContext";
import type { CapabilityVector, Project } from "../types";
import { ProjectBreakdownTip, type TipAnchor } from "./ProjectBreakdownTip";
import {
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
import {
  Gap,
  Legend,
  PillButton,
  ScreenFooter,
  ScreenHeader,
  UnderlineTabs,
  type ResolvedTheme,
} from "../design";

interface AdvancedTimelineProps {
  projects: Project[];
  /** Live roster pools — hypothetical variants live only in the projections view. */
  pools: CapabilityVector;
  onOpenMatrix: () => void;
  theme: ResolvedTheme;
}

const EPS = 1e-6;

/* One geometry, the design's: 44px rows carrying 24px bars, a 264px name
   column (120px when collapsed to bare hue pills), and a bare label strip for
   the axis. The v5 tokens carry the same numbers for CSS. */
const ROW_H = 44;
const BAR_H = 24;
const NAME_W = 264;
const NAME_COLLAPSED_W = 96;
const AXIS_H = 26;
const BAR_TOP = Math.round((ROW_H - BAR_H) / 2);

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

  const { ppm, setPpm, scrollRef } = useZoomGesture(ZOOMS[2].ppm);
  const [nameCollapsed, setNameCollapsed] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [popover, setPopover] = useState<string | null>(null);
  const [tip, setTip] = useState<{ projectId: string; anchor: TipAnchor } | null>(null);
  // The width the viewport actually shows — the category rules span it, so a
  // label line never scrolls away with the track behind it.
  const [viewW, setViewW] = useState(0);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && popover) setPopover(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [popover]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollRef]);

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

  const nameW = nameCollapsed ? NAME_COLLAPSED_W : NAME_W;
  const showNames = !nameCollapsed;

  const months = Math.max(12, Math.ceil(schedule.horizonMonths / 6) * 6 + 6);
  const totalW = months * ppm;

  const now = useMemo(() => new Date(), []);
  const startYear = now.getFullYear();
  const startMonth = now.getMonth();
  // t=0 on this axis, so calendar constraints can be placed against it.
  const nowMonth = useMemo(() => ({ year: startYear, month: startMonth }), [startYear, startMonth]);

  const { tickLabels, gridlines } = useMemo(
    () => buildAxis(months, ppm, startYear, startMonth),
    [months, ppm, startYear, startMonth],
  );

  const landMonth = startMonth + Math.round(schedule.horizonMonths);
  const landLabel = `${MON[landMonth % 12]} ${startYear + Math.floor(landMonth / 12)}`;
  const totalIdle = CAPABILITY_ORDER.reduce((sum, c) => sum + schedule.idleFteMonths[c], 0);
  const impossibleCount = schedule.scheduled.filter((sp) => sp.isImpossible).length;
  const overPoolCount = schedule.scheduled.filter((sp) => sp.isOverPool).length;

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
        style={{ height: ROW_H, background: hovered ? "var(--row-hover)" : "transparent" }}
        onMouseEnter={() => setHover(project.id)}
        onMouseLeave={() => setHover((h) => (h === project.id ? null : h))}
      >
        <div
          className="atl-row-name"
          style={{ width: nameW, background: hovered ? "var(--row-hover)" : "var(--bg)" }}
          title={`${positionLabel(project)} · rozmiar ${project.estimate} · ${fmt(sp.assignedEffortDays)} dni nakładu${project.description ? ` — ${project.description}` : ""}`}
        >
          <span className="atl-hue" style={{ background: solid(hue) }} />
          {showNames ? (
            <span className="atl-row-title">{project.name}</span>
          ) : (
            <span className="atl-row-id">{positionLabel(project)}</span>
          )}
        </div>

        <div className="atl-row-track" style={{ width: totalW, height: ROW_H }}>
          {gridlines.map((x) => (
            <div key={x} className="atl-grid" style={{ left: x, height: ROW_H }} />
          ))}

          {sp.earliestStartMonths > EPS && (
            <div
              className="atl-earliest"
              style={{ left: Math.round(sp.earliestStartMonths * ppm), height: ROW_H }}
              title={`nie może ruszyć przed ${formatDateKey(project.earliestStartDate)} — ograniczenie zewnętrzne, nie kolejka`}
            />
          )}

          {deadlineMonths != null && (
            <div
              className={`atl-deadline ${missesDeadline ? "is-missed" : ""}`}
              style={{ left: Math.round(deadlineMonths * ppm), height: ROW_H }}
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
              style={{ left: Math.round(plannedStartMonths * ppm), height: ROW_H }}
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
                top: BAR_TOP,
                width,
                height: BAR_H,
                border: envStyle === "none" ? "0" : `1px ${envStyle} ${envColor}`,
                background: envFill,
                boxShadow: hovered ? "0 0 0 2px var(--bg), 0 0 0 3.5px var(--ink-2)" : "none",
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
                  style={{ left: 0, width: phase1WidthPx, height: "100%", background: soft(hue) }}
                />
              )}
              {phase2WidthPx > 0 && (
                <div
                  className="atl-seg-fill"
                  style={{ left: phase1WidthPx, width: phase2WidthPx, height: "100%", background: solid(hue) }}
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
              style={{ left: left + width, top: BAR_TOP, height: BAR_H, color: outLabelColor }}
            >
              {outLabel}
            </div>
          )}

          {popover === project.id && (
            <div
              className="ds-popover atl-pop"
              style={{ left: Math.max(0, left + 8), top: BAR_TOP + BAR_H + 6 }}
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
    const spanEnd = band.rows.reduce(
      (max, r) => (Number.isFinite(r.sp.endMonths) ? Math.max(max, r.sp.endMonths) : max),
      0,
    );

    // v5's category header is a label in the light: eyebrow, count, a
    // hairline claiming the rest of the line, and the figures at its end. It
    // spans the viewport, not the track, so it never scrolls away sideways.
    return (
      <section className="atl-band" key={band.category}>
        <div className="atl-rule" style={{ width: viewW || undefined }}>
          <span className="ds-eyebrow">{band.category}</span>
          <span className="atl-rule-meta">
            {plCount(band.rows.length, "projekt", "projekty", "projektów")}
          </span>
          <span className="atl-rule-line" />
          {overs > 0 && <span className="atl-rule-meta is-warn">{overs} przeciążonych</span>}
          <span className="atl-rule-meta is-loud">{spanEnd ? `${fmt(spanEnd)} mies.` : "—"}</span>
        </div>

        <div className="atl-rows">{band.rows.map((row) => renderRow(row))}</div>
      </section>
    );
  }

  function renderUtilizationBand() {
    return (
      <section className="atl-band" key="__util">
        <div className="atl-rule" style={{ width: viewW || undefined }}>
          <span className="ds-eyebrow">Wykorzystanie zdolności</span>
          <span className="atl-rule-line" />
          <span className="atl-rule-meta is-loud">{fmt(totalIdle)} FTE-mies. bezczynnych</span>
        </div>
        <div className="atl-rows">
          {CAPABILITY_ORDER.map((capability) => {
            const pool = schedule.pools[capability] ?? 0;
            const idleSpans = schedule.idleSpans.filter((s) => s.capability === capability);
            return (
              <div className="atl-row atl-util-row" key={capability} style={{ height: ROW_H }}>
                <div className="atl-row-name" style={{ width: nameW, background: "var(--bg)" }}>
                  <span className="atl-util-cap">{CAPABILITY_LABELS[capability]}</span>
                  {showNames && <span className="atl-util-pool">{fmt(pool)} FTE</span>}
                </div>
                <div className="atl-row-track" style={{ width: totalW, height: ROW_H }}>
                  {gridlines.map((x) => (
                    <div key={x} className="atl-grid" style={{ left: x, height: ROW_H }} />
                  ))}
                  {pool > 0 && (
                    <div
                      className="atl-util-used"
                      style={{
                        left: 0,
                        top: BAR_TOP,
                        width: Math.round(schedule.horizonMonths * ppm),
                        height: BAR_H,
                        background: soft(HUES[0]),
                      }}
                    />
                  )}
                  {/* Idle capacity is a wash over the used bar, full height —
                      where it sits and for how long, not a second data axis. */}
                  {idleSpans.map((span, i) => (
                    <div
                      key={i}
                      className="atl-util-idle"
                      style={{
                        left: Math.round(span.startMonths * ppm),
                        top: BAR_TOP,
                        width: Math.max(2, Math.round((span.endMonths - span.startMonths) * ppm)),
                        height: BAR_H,
                      }}
                      title={`${fmt(span.idleFte)} FTE wolnych`}
                    />
                  ))}
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
    <div className="atl" data-theme={theme}>
      <ScreenHeader
        eyebrow="Plan"
        value={landLabel}
        unit="koniec całej pracy"
        actions={
          <>
            <UnderlineTabs
              label="Skala czasu"
              value={ZOOMS.reduce((best, z) =>
                Math.abs(z.ppm - ppm) < Math.abs(best.ppm - ppm) ? z : best,
              ).id}
              onChange={(id) => {
                const zoom = ZOOMS.find((z) => z.id === id);
                if (zoom) setPpm(zoom.ppm);
              }}
              items={ZOOMS.map((z) => ({ id: z.id, label: z.label }))}
            />
            <PillButton
              icon={
                nameCollapsed ? (
                  <ChevronsRight size={13} strokeWidth={1.75} />
                ) : (
                  <ChevronsLeft size={13} strokeWidth={1.75} />
                )
              }
              active={nameCollapsed}
              onClick={() => setNameCollapsed((v) => !v)}
              aria-pressed={nameCollapsed}
            >
              {nameCollapsed ? "Rozwiń nazwy" : "Zwiń nazwy"}
            </PillButton>
          </>
        }
      >
        Jasny odcień to inicjacja, pełny to wytwarzanie. Pas na dole pokazuje, ile mocy każdej
        kompetencji zostaje niewykorzystane.
      </ScreenHeader>

      <div
        className="atl-scroll"
        ref={scrollRef}
        onClick={() => popover && setPopover(null)}
        onScroll={() => tip && setTip(null)}
      >
        {/* v5's axis is a bare label strip — no ticks, no rule under it. */}
        <div className="atl-axis" style={{ height: AXIS_H }}>
          <div className="atl-axis-corner" style={{ width: nameW }} />
          <div className="atl-track" style={{ width: totalW, height: AXIS_H }}>
            {tickLabels.map((t, i) => (
              <div key={i} className="atl-tick-label" style={{ left: t.x, color: t.color }}>
                {t.label}
              </div>
            ))}
          </div>
        </div>

        {bands.map((band) => renderBand(band))}
        {renderUtilizationBand()}
      </div>

      <ScreenFooter>
        <Legend color="var(--accent-soft)">inicjacja</Legend>
        <Legend color="var(--accent)">wytwarzanie</Legend>
        <Legend color="var(--idle-wash)">bezczynne</Legend>
        <Gap />
        {overPoolCount > 0 && <span className="is-warn">{overPoolCount} przeciążonych</span>}
        {impossibleCount > 0 && (
          <span className="is-warn">{impossibleCount} nigdy się nie kończy</span>
        )}
        {schedule.truncated && <span className="is-warn">symulacja przerwana — zgłoś błąd</span>}
        <span>
          {plCount(projectCount, "projekt", "projekty", "projektów")} ·{" "}
          {plCount(CATEGORY_ORDER.length, "kategoria", "kategorie", "kategorii")}
        </span>
      </ScreenFooter>

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
