import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTeamVariants } from "../hooks/useTeamVariants";
import { useHiringLadder } from "../hooks/useHiringLadder";
import type { LadderRung } from "../lib/hirePlusCeilings";
import { earliestStartOffsets } from "../hooks/useCapabilitySchedule";
import { monthKeyOf, monthsFrom, parseMonthKey } from "../lib/calendar";
import {
  CAPABILITY_ORDER,
  effectiveDaysByCapability,
  isIncludedInPlan,
  type TeamVariant,
} from "../lib/estimation";
import { newId } from "../lib/id";
import { leaveFteByMonth } from "../lib/leaves";
import type { CapabilityCaps, HiringPlanInput } from "../lib/hiringPlanner";
import { applyCeilingOverrides } from "../lib/planRules";
import {
  simulateCapabilitySchedule,
  type CapabilitySchedule,
} from "../lib/scheduling";
import { usePlanner } from "../state/plannerContext";
import type { Project, VariantCeilings } from "../types";
import { HiringPlanDrawer } from "./HiringPlanDrawer";
import { VariantEditor } from "./VariantEditor";
import { MON, fmt, groupArrowNav, monthLabel, optimizedLabel, plCount, rungRoles, signed, weeksOf } from "./timelineChrome";
import "./timeline.css";

const CAPS_KEY = "planner-capability-caps";

/** The budget-year line: projects that land inside it are this year's wins,
 *  and the headline metric counts them. */
const YEAR_LINE = 12;

const ROW_H = 31;
const AXIS_H = 52;

/** Caps live in localStorage rather than the database: they are a constraint on
 *  a question ("we only ever want one TL"), not a fact about the roster, and
 *  they should be triable without a schema migration. */
function savedCaps(): CapabilityCaps {
  try {
    const raw = localStorage.getItem(CAPS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: CapabilityCaps = {};
    for (const capability of CAPABILITY_ORDER) {
      const value = (parsed as Record<string, unknown>)[capability];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        out[capability] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

interface TimelineViewProps {
  projects: Project[];
  theme: "auto" | "light" | "dark";
  /** Arrive with the optimizer drawer already open — the cross-screen link
   *  from the autopilot's "nobody to add" blocks in Wyceny. */
  initialOptimizerOpen?: boolean;
}

export type FillMode = "serify" | "kreska";

interface VariantSummary {
  horizon: number;
  within: number;
  impossible: number;
  totalFte: number;
}

function summarize(schedule: CapabilitySchedule, totalFte: number): VariantSummary {
  let within = 0;
  let impossible = 0;
  for (const sp of schedule.scheduled) {
    if (sp.isImpossible) impossible += 1;
    else if (
      !sp.hasNoDemand &&
      Number.isFinite(sp.endMonths) &&
      sp.endMonths <= YEAR_LINE + 1e-9
    ) {
      within += 1;
    }
  }
  return { horizon: schedule.horizonMonths, within, impossible, totalFte };
}

function gainColor(better: number): string {
  return better > 0 ? "var(--win)" : better < 0 ? "var(--warn)" : "var(--ink-4)";
}

const totalFteOf = (v: TeamVariant) =>
  CAPABILITY_ORDER.reduce((sum, c) => sum + (v.fte[c] ?? 0), 0);

export function TimelineView({ projects, theme, initialOptimizerOpen }: TimelineViewProps) {
  // The one screen where variants apply — every other view plans on the live
  // roster, so the comparison owns them instead of the app shell.
  const variantsApi = useTeamVariants();
  const { variants } = variantsApi;
  const { cells, people, leaves, settings, addVariant } = usePlanner();
  // Every FTE figure in this view is headcount; productivity is in the rate,
  // and each capability's rate is its own people's.
  const edpm = useMemo(() => effectiveDaysByCapability(people, settings), [people, settings]);

  // Obecny zespół is the fixed reference every comparison is measured against;
  // the *selected* variant is what the timeline draws.
  const reference = variants.find((v) => v.isRosterDerived) ?? variants[0];
  const [variantId, setVariantId] = useState(reference.id);
  const selected = variants.find((v) => v.id === variantId) ?? reference;

  // The selected variant can be deleted from the editor — fall back to the
  // reference.
  useEffect(() => {
    if (!variants.some((v) => v.id === variantId)) setVariantId(reference.id);
  }, [variants, variantId, reference.id]);

  const [fillMode, setFillMode] = useState<FillMode>("serify");
  const [drawerOpen, setDrawerOpen] = useState(initialOptimizerOpen ?? false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [viewW, setViewW] = useState(0);
  const [winW, setWinW] = useState(() => window.innerWidth);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Innermost layer first: the editor is a modal above the drawer.
      if (editorOpen) setEditorOpen(false);
      else if (drawerOpen) setDrawerOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editorOpen, drawerOpen]);

  // The chart always fits the whole horizon to the visible track, so it has to
  // know how wide the track is; the sidebar and drawer widths follow the
  // window's overall width.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      setViewW(el.clientWidth);
      setWinW(window.innerWidth);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const plannedProjects = useMemo(() => projects.filter(isIncludedInPlan), [projects]);

  // Same inputs as the harmonogram's simulation — dropping `earliestStart`
  // here made the same variant finish earlier on this screen than on that one.
  const earliestStart = useMemo(() => earliestStartOffsets(plannedProjects), [plannedProjects]);
  const leaveDips = useMemo(() => leaveFteByMonth(people, leaves), [people, leaves]);

  const simulate = useCallback(
    (variantCells: typeof cells, pools: TeamVariant["fte"]) =>
      simulateCapabilitySchedule({
        projects: plannedProjects,
        cells: variantCells,
        pools,
        effectiveDaysPerMonth: edpm,
        minStaffingFraction: settings.minStaffingFraction,
        minCrewFte: settings.minCrewFte,
        earliestStart,
        leaveFteByMonth: leaveDips,
      }),
    [plannedProjects, edpm, settings.minStaffingFraction, settings.minCrewFte, earliestStart, leaveDips],
  );

  // One real phase-gated simulation per variant. The sidebar reads the
  // summaries; the chart reads the full per-project schedules of the selected
  // and the reference variant.
  const schedByVariant = useMemo(() => {
    const map: Record<string, CapabilitySchedule> = {};
    for (const v of variants) {
      // A variant plans on its own ceilings: the matrix with the variant's
      // overrides laid on top (upward only; identity when it has none).
      map[v.id] = simulate(applyCeilingOverrides(cells, v.ceilings), v.fte);
    }
    return map;
  }, [variants, cells, simulate]);

  const summaryByVariant = useMemo(() => {
    const map: Record<string, VariantSummary> = {};
    for (const v of variants) map[v.id] = summarize(schedByVariant[v.id], totalFteOf(v));
    return map;
  }, [variants, schedByVariant]);

  const refSummary = summaryByVariant[reference.id];
  const selSummary = summaryByVariant[selected.id];
  const refSched = schedByVariant[reference.id];
  const selSched = schedByVariant[selected.id];

  // The optimizer's input — everything but the pools it searches over. The
  // deadline map follows the Plan screen's comparison to the letter, past
  // deadlines included un-clamped: still missable, still worth saving.
  const nowMonth = useMemo(() => parseMonthKey(monthKeyOf(new Date()))!, []);
  const deadlineMonths = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of plannedProjects) {
      const m = monthsFrom(nowMonth, p.deadlineDate);
      if (m != null) map[p.id] = m;
    }
    return map;
  }, [plannedProjects, nowMonth]);

  // Per-capability ceilings on team size. The planner would otherwise happily
  // staff four tech leads: nothing in the model knows that a team wants one.
  const [caps, setCaps] = useState<CapabilityCaps>(savedCaps);
  useEffect(() => {
    localStorage.setItem(CAPS_KEY, JSON.stringify(caps));
  }, [caps]);

  // The optimizer always plans from today's real team — the reference — no
  // matter which variant the timeline currently draws. Planning from a
  // selected variant compounded hypothetical worlds.
  const referenceCells = useMemo(
    () => applyCeilingOverrides(cells, reference.ceilings),
    [cells, reference.ceilings],
  );

  const optimizerInput = useMemo<HiringPlanInput>(
    () => ({
      projects: plannedProjects,
      cells: referenceCells,
      effectiveDaysPerMonth: edpm,
      minStaffingFraction: settings.minStaffingFraction,
      minCrewFte: settings.minCrewFte,
      earliestStart,
      leaveFteByMonth: leaveDips,
      deadlineMonths,
      caps,
    }),
    [plannedProjects, referenceCells, edpm, earliestStart, leaveDips, settings.minStaffingFraction, settings.minCrewFte, deadlineMonths, caps],
  );

  // Calls the simulation through the lib directly — the shared schedule hook's
  // tiny identity-keyed cache would thrash under hundreds of trial vectors.
  const ladder = useHiringLadder(reference.fte, optimizerInput);
  const projectNameOf = useCallback(
    (id: string) => projects.find((p) => p.id === id)?.name ?? id,
    [projects],
  );

  // Hiring's hard floor: the horizon with unlimited people. Whatever it is,
  // no headcount goes below it — past that point only ceilings and ordering
  // move the plan. One simulation, computed only while the drawer is open.
  const hiringFloorMonths = useMemo(() => {
    if (!drawerOpen || plannedProjects.length === 0) return null;
    const unlimited = { ...reference.fte };
    for (const c of CAPABILITY_ORDER) unlimited[c] = 100;
    const s = simulate(referenceCells, unlimited);
    return s.scheduled.some((p) => p.isImpossible) ? null : s.horizonMonths;
  }, [drawerOpen, plannedProjects.length, referenceCells, reference.fte, simulate]);

  // The option cards headline "N projektów w 12 mies." — one extra simulation
  // per rung, only once a search has finished (the search itself ran hundreds).
  const rungWithin = useMemo(() => {
    const out: Record<number, number> = {};
    if (!ladder.result) return out;
    for (const rung of ladder.result.rungs) {
      const overrides: VariantCeilings = structuredClone(reference.ceilings);
      for (const move of rung.ceilingMoves) {
        (overrides[move.projectId] ??= {})[move.capability] = move.to;
      }
      const s = simulate(applyCeilingOverrides(cells, overrides), rung.pools);
      out[rung.hires] = summarize(s, 0).within;
    }
    return out;
  }, [ladder.result, reference.ceilings, cells, simulate]);

  // A rung the user already turned into a variant flips its card button to
  // "Dodany — pokaż". The map lives per search: a rerun resets it.
  const [appliedByHires, setAppliedByHires] = useState<Record<number, string>>({});
  useEffect(() => {
    setAppliedByHires({});
  }, [ladder.result]);

  const appliedVariantIdOf = useCallback(
    (rung: LadderRung) => {
      const id = appliedByHires[rung.hires];
      return id && variants.some((v) => v.id === id) ? id : null;
    },
    [appliedByHires, variants],
  );

  const applyRung = useCallback(
    (rung: LadderRung) => {
      const id = newId("variant");
      // Moves chain per cell (1→1.5, 1.5→2); applied in order, the last write
      // per cell is the rung's final ceiling. The reference variant they were
      // computed against never carries overrides of its own.
      const ceilings = structuredClone(reference.ceilings);
      for (const move of rung.ceilingMoves) {
        (ceilings[move.projectId] ??= {})[move.capability] = move.to;
      }
      const raisedCells = new Set(
        rung.ceilingMoves.map((m) => `${m.projectId}:${m.capability}`),
      ).size;
      const core =
        rung.hires === 0 ? `sufity ×${raisedCells}` : `+${rung.hires}: ${rungRoles(rung)}`;
      const label = optimizedLabel(
        variants.map((v) => v.label),
        core,
      );
      addVariant({ id, label, fte: rung.pools, isRosterDerived: false, ceilings });
      // The drawer stays open — the card flips to "Dodany — pokaż" and the
      // timeline behind it already follows the new variant.
      setAppliedByHires((m) => ({ ...m, [rung.hires]: id }));
      setVariantId(id);
    },
    [variants, addVariant, reference.ceilings],
  );

  // ── Chart geometry ──────────────────────────────────────────────────────
  const wide = (winW || 1280) >= 1180;
  const nameW = wide ? 300 : 280;
  const drawerW = wide ? 460 : 380;
  const variantsW = wide ? 224 : 196;

  const maxEnd = useMemo(() => {
    let max = YEAR_LINE;
    for (const s of [selSched, refSched]) {
      for (const sp of s.scheduled) {
        if (Number.isFinite(sp.endMonths)) max = Math.max(max, sp.endMonths);
      }
    }
    return max;
  }, [selSched, refSched]);

  const months = Math.ceil((maxEnd * 1.06) / 3) * 3 + 3;
  // The drawer slides over the canvas, so the chart keeps the full width.
  const trackW = (viewW || 1100) - nameW - 6;
  const ppm = Math.max(3, trackW / months);
  const totalW = Math.round(months * ppm);
  const yearX = Math.round(YEAR_LINE * ppm);
  const labelStep = ppm >= 34 ? 3 : ppm >= 17 ? 6 : 12;

  const now = useMemo(() => new Date(), []);
  const startYear = now.getFullYear();
  const startMonth = now.getMonth();

  const { ticks, tickLabels, gridlines } = useMemo(() => {
    const t: { x: number; h: number; color: string }[] = [];
    const l: { x: number; label: string }[] = [];
    const g: number[] = [];
    for (let i = 0; i <= months; i++) {
      const abs = startMonth + i;
      const m = abs % 12;
      const y = startYear + Math.floor(abs / 12);
      const quarter = m % 3 === 0;
      const x = Math.round(i * ppm);
      t.push({ x, h: quarter ? 11 : 5, color: quarter ? "var(--line-strong)" : "var(--line-soft)" });
      if (i % labelStep === 0 && i < months) l.push({ x, label: `${MON[m]} ${String(y).slice(2)}` });
      if (quarter && i > 0) g.push(x);
    }
    return { ticks: t, tickLabels: l, gridlines: g };
  }, [months, ppm, startYear, startMonth, labelStep]);

  const compare = selected.id !== reference.id;
  const refByProject = useMemo(() => {
    const map: Record<string, CapabilitySchedule["scheduled"][number]> = {};
    for (const sp of refSched.scheduled) map[sp.project.id] = sp;
    return map;
  }, [refSched]);

  function renderRow(sp: CapabilitySchedule["scheduled"][number]) {
    const p = sp.project;
    const ref = refByProject[p.id];
    const finite = !sp.isImpossible && Number.isFinite(sp.endMonths) && !sp.hasNoDemand;
    const refFinite = ref && !ref.isImpossible && Number.isFinite(ref.endMonths) && !ref.hasNoDemand;

    const endLabel = sp.hasNoDemand ? "—" : finite ? monthLabel(startYear, startMonth, sp.endMonths) : "nigdy";
    const endColor = sp.hasNoDemand ? "var(--ink-4)" : finite ? "var(--ink-3)" : "var(--warn)";

    const barX = finite ? Math.round(sp.startMonths * ppm) : 0;
    const barW = finite ? Math.max(3, Math.round((sp.endMonths - sp.startMonths) * ppm)) : 0;
    const refStartX = refFinite ? Math.round(ref.startMonths * ppm) : 0;
    const refEndX = refFinite ? Math.round(ref.endMonths * ppm) : 0;

    const compareRow = compare && finite && refFinite;
    // Start shifts are fractions of a month, so pixel rounding wipes them out
    // — measure in months and give the marker a legible floor.
    const startDelta = compareRow ? ref.startMonths - sp.startMonths : 0;
    const hasStartShift = startDelta > 0.05;
    const leadW = hasStartShift ? Math.max(5, Math.round(startDelta * ppm)) : 0;
    // The reference band hugs the bar's start when the shift is small — except
    // for a variant that starts *later* than the reference, where the honest
    // position is the reference's own.
    const bandX = compareRow
      ? sp.startMonths <= ref.startMonths + 1e-9
        ? barX + leadW
        : refStartX
      : 0;
    const bandW = compareRow ? Math.max(1, refEndX - bandX) : 0;

    // kreska startu: the ghost is the reference plan. When the two spans
    // overlap, its left edge merges with the bar's start so the pair reads as
    // one nested shape; when they don't, that anchor would stretch the ghost
    // across the gap (or collapse it to a sliver on a slower variant) — so a
    // disjoint ghost sits on the reference's true span, hair included.
    const spansOverlap =
      compareRow && sp.startMonths < ref.endMonths && ref.startMonths < sp.endMonths;
    const outlineX = spansOverlap ? Math.min(barX, refStartX) : refStartX;
    const outlineW = Math.max(3, refEndX - outlineX);
    const hairX = spansOverlap ? barX + leadW : refStartX;

    const endDiff = compareRow ? ref.endMonths - sp.endMonths : 0;
    const endTitle =
      endDiff > 0.05
        ? `koniec wcześniej o ${fmt(endDiff)} mies.`
        : endDiff < -0.05
          ? `koniec później o ${fmt(-endDiff)} mies.`
          : "koniec bez zmian";
    const startTitle = hasStartShift
      ? `start wcześniej o ${fmt(startDelta)} mies.`
      : "start bez zmian";
    const refTitle = refFinite
      ? `${reference.label} · ${fmt(ref.startMonths)}–${fmt(ref.endMonths)} mies.`
      : reference.label;

    const serify = compareRow && fillMode === "serify";
    const kreska = compareRow && fillMode === "kreska";

    return (
      <div key={p.id} className="sv-row" style={{ height: ROW_H }}>
        <div className="sv-row-name" title={`${p.name} · ${selected.label}`} style={{ width: nameW }}>
          <span className="sv-row-title">{p.name}</span>
          <span className="sv-row-end" style={{ color: endColor }}>
            {endLabel}
          </span>
        </div>
        <div className="sv-row-track" style={{ width: totalW, height: ROW_H }}>
          {gridlines.map((x) => (
            <div key={x} className="atl-grid" style={{ left: x, height: ROW_H, background: "var(--line-soft)" }} />
          ))}
          <div className="sv-year-line" style={{ left: yearX, height: ROW_H, opacity: 0.55 }} />

          {kreska && (
            <div className="sv-outline" title={refTitle} style={{ left: outlineX, width: outlineW }} />
          )}

          {serify && (
            <>
              <div className="sv-refband" title={refTitle} style={{ left: bandX, width: bandW }} />
              <div className="sv-refband-hatch" style={{ left: bandX, width: bandW }} />
              <div className="sv-serif" title={startTitle} style={{ left: bandX }} />
              <div className="sv-serif" title={endTitle} style={{ left: refEndX }} />
            </>
          )}

          {finite && (
            <div
              className="sv-bar"
              title={`${p.name} · ${fmt(sp.startMonths)}–${fmt(sp.endMonths)} mies. · kończy ${monthLabel(startYear, startMonth, sp.endMonths)}`}
              style={{
                left: barX,
                width: barW,
                background: serify ? "var(--win)" : "var(--accent)",
                borderColor: serify ? "var(--win-edge)" : "transparent",
              }}
            />
          )}

          {kreska && hasStartShift && (
            <div className="sv-hair" title={startTitle} style={{ left: hairX }} />
          )}
        </div>
      </div>
    );
  }

  // ── Sidebar cards ───────────────────────────────────────────────────────
  function variantCard(v: TeamVariant) {
    const s = summaryByVariant[v.id];
    const active = v.id === selected.id;
    const isRef = v.id === reference.id;
    const broken = s.impossible > 0;
    const refBroken = refSummary.impossible > 0;

    let metaPlan: string;
    let planColor: string;
    if (broken) {
      metaPlan = `nie domyka się (${s.impossible})`;
      planColor = "var(--warn)";
    } else if (isRef || refBroken) {
      metaPlan = `plan ${fmt(s.horizon)} mies.`;
      planColor = active ? "var(--ink-2)" : "var(--ink-4)";
    } else {
      const weeks = Math.round(weeksOf(s.horizon - refSummary.horizon));
      metaPlan = `${signed(weeks)} tyg.`;
      planColor = gainColor(-weeks);
    }

    const projDiff = s.within - refSummary.within;
    const metaProj = isRef
      ? `${s.within} proj. w ${YEAR_LINE} mies.`
      : `${signed(projDiff)} proj. w ${YEAR_LINE} mies.`;
    const projColor = isRef ? (active ? "var(--ink-2)" : "var(--ink-4)") : gainColor(projDiff);

    return (
      <button
        key={v.id}
        type="button"
        className={`sv-card ${active ? "is-active" : ""}`}
        onClick={() => setVariantId(v.id)}
        title={v.label}
      >
        <span className="sv-card-top">
          <span className="sv-card-label" style={{ fontWeight: active ? 600 : 450 }}>
            {v.label}
          </span>
          <span className="sv-card-fte">{fmt(s.totalFte)} etatów</span>
        </span>
        <span className="sv-card-meta" style={{ color: planColor }}>
          {metaPlan}
        </span>
        <span className="sv-card-meta" style={{ color: projColor }}>
          {metaProj}
        </span>
      </button>
    );
  }

  const stripHeadline = `${selSummary.within} projektów w ${YEAR_LINE} mies. · ${selected.label}`;
  const stripSecondary =
    selSummary.impossible > 0
      ? `plan nie domyka się — ${plCount(selSummary.impossible, "projekt bez końca", "projekty bez końca", "projektów bez końca")} · ${fmt(selSummary.totalFte)} etatów · ${plannedProjects.length} projektów w portfelu`
      : `koniec planu ${fmt(selSummary.horizon)} mies. · ${fmt(selSummary.totalFte)} etatów · ${plannedProjects.length} projektów w portfelu`;

  return (
    <div className="atl" data-theme={theme === "auto" ? undefined : theme}>
      <header className="sv-header">
        <b className="sv-title">Symulacje</b>
        <span className="atl-chip">
          {plCount(variants.length, "wariant", "warianty", "wariantów")}
        </span>
        <span className="sv-vr" />
        <span className="sv-hdr-note" title={selected.label}>
          wybrany wariant · {selected.label}
        </span>
        <span className="sv-vr" />
        <span className="atl-eyebrow">porównanie</span>
        <div className="atl-seg" role="tablist" aria-label="Sposób porównania" onKeyDown={groupArrowNav}>
          {(
            [
              { id: "serify", label: "serify" },
              { id: "kreska", label: "kreska startu" },
            ] as { id: FillMode; label: string }[]
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={fillMode === m.id}
              tabIndex={fillMode === m.id ? 0 : -1}
              title={m.label}
              className={`atl-seg-text ${fillMode === m.id ? "is-active" : ""}`}
              onClick={() => setFillMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className="atl-spacer" />
        <button
          type="button"
          className={`sv-opt-toggle ${drawerOpen ? "is-on" : ""}`}
          onClick={() => setDrawerOpen((v) => !v)}
          disabled={plannedProjects.length === 0}
          aria-expanded={drawerOpen}
          title={plannedProjects.length === 0 ? "Brak projektów w planie" : undefined}
        >
          <span className="atl-spark">✦</span> Optymalizuj…
        </button>
      </header>

      <div className="sv-content">
        <aside className="sv-side" aria-label="Warianty zespołu" style={{ width: variantsW }}>
          <div className="sv-side-head">
            <b>Warianty zespołu</b>
            <span>{plCount(variants.length, "wariant", "warianty", "wariantów")}</span>
          </div>
          <div className="sv-side-list">{variants.map((v) => variantCard(v))}</div>
          <div className="sv-side-foot">
            <button type="button" className="sim-btn" onClick={() => setEditorOpen(true)}>
              Edytuj warianty…
            </button>
            <button
              type="button"
              className="sv-btn-dashed"
              onClick={() => {
                setVariantId(variantsApi.createVariant(selected));
                setEditorOpen(true);
              }}
            >
              + Nowy wariant
            </button>
          </div>
        </aside>

        <div className="sv-main">
          <div className="sv-strip">
            <div className="sv-strip-text">
              <b>{stripHeadline}</b>
              <span>{stripSecondary}</span>
            </div>
          </div>

          <div className="sv-scroll" ref={scrollRef}>
            <div className="sv-axis" style={{ height: AXIS_H }}>
              <div className="sv-axis-corner" style={{ width: nameW }}>
                <span className="atl-eyebrow">projekt</span>
                <span className="atl-eyebrow">koniec</span>
              </div>
              <div className="atl-track" style={{ width: totalW, height: AXIS_H }}>
                <div
                  className="sv-year-label"
                  title="koniec roku budżetowego"
                  style={{ width: yearX }}
                >
                  {YEAR_LINE} mies.
                </div>
                {ticks.map((t, i) => (
                  <div key={i} className="atl-tick" style={{ left: t.x, height: t.h, background: t.color }} />
                ))}
                {tickLabels.map((t, i) => (
                  <div key={i} className="sv-tick-label" style={{ left: t.x }}>
                    {t.label}
                  </div>
                ))}
                <div className="sv-year-line" style={{ left: yearX, top: 20, bottom: 0 }} />
              </div>
            </div>

            {selSched.scheduled.map((sp) => renderRow(sp))}

            <div className="sv-legend" style={{ width: viewW > 0 ? viewW : undefined }}>
              <span className="sv-legend-item">
                <span style={{ width: 22, height: 9, borderRadius: 2, background: "var(--accent)" }} />
                plan wybranego wariantu
              </span>
              <span className="sv-legend-item">
                <span
                  style={{
                    width: 22,
                    height: 9,
                    borderRadius: 2,
                    background: "var(--ghost-soft)",
                    border: "1px solid var(--ghost)",
                  }}
                />
                {fillMode === "serify"
                  ? `${reference.label} · pas i kreski = bazowy start i koniec`
                  : `${reference.label} · obrys = plan bazowy, kreska = bazowy start`}
              </span>
            </div>
          </div>
        </div>

        <HiringPlanDrawer
          ladder={ladder}
          open={drawerOpen}
          width={drawerW}
          referenceLabel={reference.label}
          referenceFte={reference.fte}
          referenceWithin={refSummary.within}
          referenceHorizon={refSummary.horizon}
          rungWithin={rungWithin}
          yearLine={YEAR_LINE}
          hiringFloorMonths={hiringFloorMonths}
          caps={caps}
          onCapsChange={setCaps}
          appliedVariantIdOf={appliedVariantIdOf}
          onApplyRung={applyRung}
          onShowVariant={setVariantId}
          projectNameOf={projectNameOf}
          onClose={() => setDrawerOpen(false)}
        />
      </div>

      {editorOpen && (
        <VariantEditor
          api={variantsApi}
          activeId={selected.id}
          projectNameOf={projectNameOf}
          onActivate={setVariantId}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </div>
  );
}
