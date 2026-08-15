import { useCallback, useEffect, useMemo, useState } from "react";
import { useTeamVariants } from "../hooks/useTeamVariants";
import { useHiringPlan } from "../hooks/useHiringPlan";
import { useHiringLadder } from "../hooks/useHiringLadder";
import type { LadderRung } from "../lib/hirePlusCeilings";
import { earliestStartOffsets } from "../hooks/useCapabilitySchedule";
import { monthKeyOf, monthsFrom, parseMonthKey } from "../lib/calendar";
import {
  CAPABILITY_ORDER,
  effectiveDaysByCapability,
  isIncludedInPlan,
  totalCapabilityEffortDays,
  type TeamVariant,
} from "../lib/estimation";
import { newId } from "../lib/id";
import { leaveFteByMonth } from "../lib/leaves";
import type { CapabilityCaps, HiringPlanInput, HiringScenario } from "../lib/hiringPlanner";
import { applyCeilingOverrides } from "../lib/planRules";
import { simulateCapabilitySchedule } from "../lib/scheduling";
import { usePlanner } from "../state/plannerContext";
import type { CapabilityVector, Project } from "../types";
import { useZoomGesture } from "../hooks/useZoomGesture";
import { HiringPlanDrawer } from "./HiringPlanDrawer";
import { VariantEditor } from "./VariantEditor";
import {
  DENSITIES,
  HUES,
  ZOOMS,
  buildAxis,
  fmt,
  monthLabel,
  optimizedLabel,
  plCount,
  variantCaption,
  soft,
  solid,
  wash,
} from "./timelineChrome";
import "./timeline.css";

const CAPS_KEY = "planner-capability-caps";

/** How many project × capability cells this variant plans differently. */
function ceilingOverrideCount(variant: TeamVariant): number {
  return Object.values(variant.ceilings).reduce((sum, row) => sum + Object.keys(row).length, 0);
}

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

const WHOLE_PLAN = "Cała praca";

interface VariantRow {
  variant: TeamVariant;
  hue: number;
  fte: number;
  /** Infinity when nobody is on it. */
  months: number;
  isBaseline: boolean;
}

interface CompareBand {
  label: string;
  fteMonths: number;
  rows: VariantRow[];
  isWholePlan: boolean;
}

export function TimelineView({
  projects,
  theme,
  initialOptimizerOpen,
}: TimelineViewProps) {
  // The one screen where variants apply — every other view plans on the live
  // roster, so the comparison owns its selection instead of the app shell.
  const variantsApi = useTeamVariants();
  const { variants } = variantsApi;
  const [variantId, setVariantId] = useState(() => variants[0].id);
  const { cells, people, leaves, settings, addVariant } = usePlanner();
  // Every FTE figure in this view is headcount; productivity is in the rate,
  // and each capability's rate is its own people's.
  const edpm = useMemo(() => effectiveDaysByCapability(people, settings), [people, settings]);
  const baseline: TeamVariant = variants.find((v) => v.id === variantId) ?? variants[0];

  // The baseline can be deleted from the editor below — fall back to the first.
  useEffect(() => {
    if (!variants.some((v) => v.id === variantId)) setVariantId(variants[0].id);
  }, [variants, variantId]);

  const { ppm, setPpm, scrollRef } = useZoomGesture(ZOOMS[1].ppm);
  const [densityId, setDensityId] = useState("m");
  const [keyOpen, setKeyOpen] = useState(true);
  const [hover, setHover] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [optimizerOpen, setOptimizerOpen] = useState(initialOptimizerOpen ?? false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Innermost layer first: the editor is a modal above the drawer.
      if (editorOpen) setEditorOpen(false);
      else if (optimizerOpen) setOptimizerOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editorOpen, optimizerOpen]);

  const hueByVariant = useMemo(() => {
    const map: Record<string, number> = {};
    variants.forEach((v, i) => {
      map[v.id] = HUES[i % HUES.length];
    });
    return map;
  }, [variants]);

  const plannedProjects = useMemo(() => projects.filter(isIncludedInPlan), [projects]);
  const totalsByCapability = useMemo(
    () => totalCapabilityEffortDays(plannedProjects, cells),
    [plannedProjects, cells],
  );

  // Same inputs as the harmonogram's simulation — dropping `earliestStart`
  // here made the same variant finish earlier on this screen than on that one.
  const earliestStart = useMemo(() => earliestStartOffsets(plannedProjects), [plannedProjects]);
  const leaveDips = useMemo(() => leaveFteByMonth(people, leaves), [people, leaves]);

  // A whole-plan month count run through the real phase-gated simulation for
  // each variant — cheap (three sims of ~47 projects) and the only honest way
  // to account for phase gating and pool contention across capabilities.
  const wholePlanMonthsByVariant = useMemo(() => {
    const map: Record<string, number> = {};
    for (const v of variants) {
      const schedule = simulateCapabilitySchedule({
        projects: plannedProjects,
        // A variant plans on its own ceilings: the matrix with the variant's
        // overrides laid on top (upward only; identity when it has none).
        cells: applyCeilingOverrides(cells, v.ceilings),
        pools: v.fte,
        effectiveDaysPerMonth: edpm,
        minStaffingFraction: settings.minStaffingFraction,
        minCrewFte: settings.minCrewFte,
        earliestStart,
        leaveFteByMonth: leaveDips,
      });
      const anyImpossible = schedule.scheduled.some((s) => s.isImpossible);
      map[v.id] = anyImpossible ? Infinity : schedule.horizonMonths;
    }
    return map;
  }, [variants, plannedProjects, cells, edpm, earliestStart, leaveDips, settings.minStaffingFraction, settings.minCrewFte]);

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
  // Kept on the client — this is a knob you turn while asking a question, not
  // roster data, and it should not migrate the database to be tried out.
  const [caps, setCaps] = useState<CapabilityCaps>(savedCaps);
  useEffect(() => {
    localStorage.setItem(CAPS_KEY, JSON.stringify(caps));
  }, [caps]);

  // The optimizer plans in the baseline variant's world: the matrix with its
  // ceiling overrides laid on top — the same cells its comparison row uses.
  const baselineCells = useMemo(
    () => applyCeilingOverrides(cells, baseline.ceilings),
    [cells, baseline.ceilings],
  );

  const optimizerInput = useMemo<HiringPlanInput>(
    () => ({
      projects: plannedProjects,
      cells: baselineCells,
      effectiveDaysPerMonth: edpm,
      minStaffingFraction: settings.minStaffingFraction,
      minCrewFte: settings.minCrewFte,
      earliestStart,
      leaveFteByMonth: leaveDips,
      deadlineMonths,
      caps,
    }),
    [plannedProjects, baselineCells, edpm, earliestStart, leaveDips, settings.minStaffingFraction, settings.minCrewFte, deadlineMonths, caps],
  );

  // Calls the simulation through the lib directly — the shared schedule hook's
  // tiny identity-keyed cache would thrash under hundreds of trial vectors.
  const proposal = useHiringPlan(baseline.fte, optimizerInput);
  const ladder = useHiringLadder(baseline.fte, optimizerInput);
  const projectNameOf = useCallback(
    (id: string) => projects.find((p) => p.id === id)?.name ?? id,
    [projects],
  );
  const baselineTotalFte = useMemo(
    () => CAPABILITY_ORDER.reduce((sum, c) => sum + (baseline.fte[c] ?? 0), 0),
    [baseline.fte],
  );

  const applyProposal = useCallback(
    (vector: CapabilityVector, scenario: HiringScenario) => {
      const id = newId("variant");
      // The label carries the hire, because that is what distinguishes this
      // variant from its siblings: "+3: BE×2 · UX" beats "Optymalizacja (4)".
      // The absolute team size rides along because "+N" is relative to the
      // baseline selected at creation — baselines change and get deleted, and
      // a "+4" built on a big baseline once read as smaller than a "+7" built
      // on the roster, which cost a real afternoon of confusion.
      const who = CAPABILITY_ORDER.filter((c) => (scenario.byCapability[c] ?? 0) > 0)
        .map((c) => {
          const n = scenario.byCapability[c] ?? 0;
          return n > 1 ? `${c}×${n}` : c;
        })
        .join(" · ");
      const total = CAPABILITY_ORDER.reduce((sum, c) => sum + (vector[c] ?? 0), 0);
      const label = optimizedLabel(
        variants.map((v) => v.label),
        `+${scenario.hires} → ${fmt(total)} FTE: ${who}`,
      );
      // Straight through addVariant, not createVariant — clampFte would
      // re-round the vector and store a different plan than the drawer showed.
      // A mode-1 scenario keeps the baseline's overrides: it was simulated on
      // exactly those cells.
      addVariant({
        id,
        label,
        fte: vector,
        isRosterDerived: false,
        ceilings: structuredClone(baseline.ceilings),
      });
      setVariantId(id);
      proposal.reset();
      setOptimizerOpen(false);
    },
    [variants, addVariant, proposal, baseline.ceilings],
  );

  const applyRung = useCallback(
    (rung: LadderRung) => {
      const id = newId("variant");
      // The rung's raises were computed on top of the baseline's overrides,
      // so the new variant carries both: the old set with the rung's final
      // per-cell values written over it. Moves chain (1→1.5, 1.5→2); applied
      // in order, the last write per cell is the rung's final ceiling.
      const ceilings = structuredClone(baseline.ceilings);
      for (const move of rung.ceilingMoves) {
        (ceilings[move.projectId] ??= {})[move.capability] = move.to;
      }
      const raisedCells = new Set(
        rung.ceilingMoves.map((m) => `${m.projectId}:${m.capability}`),
      ).size;
      const who = CAPABILITY_ORDER.filter((c) => (rung.byCapability[c] ?? 0) > 0)
        .map((c) => {
          const n = rung.byCapability[c] ?? 0;
          return n > 1 ? `${c}×${n}` : c;
        })
        .join(" · ");
      const total = CAPABILITY_ORDER.reduce((sum, c) => sum + (rung.pools[c] ?? 0), 0);
      const core =
        rung.hires === 0
          ? `sufity ×${raisedCells} (${fmt(total)} FTE)`
          : `+${rung.hires} → ${fmt(total)} FTE: ${who}${raisedCells > 0 ? ` · sufity ×${raisedCells}` : ""}`;
      const label = optimizedLabel(
        variants.map((v) => v.label),
        core,
      );
      addVariant({ id, label, fte: rung.pools, isRosterDerived: false, ceilings });
      setVariantId(id);
      ladder.reset();
      setOptimizerOpen(false);
    },
    [variants, addVariant, ladder, baseline.ceilings],
  );

  // One band, not eight. The per-capability bands answered "how long would BE's
  // work take if BE were the only thing in the world" — a number no plan ever
  // realises, since capabilities gate each other inside every phase. It read as
  // seven competing forecasts next to the one real one.
  const bands: CompareBand[] = useMemo(() => {
    const fteMonths = CAPABILITY_ORDER.reduce((sum, capability) => {
      const days = totalsByCapability[capability] ?? 0;
      return sum + (edpm[capability] > 0 ? days / edpm[capability] : 0);
    }, 0);

    return [
      {
        label: WHOLE_PLAN,
        fteMonths,
        rows: variants.map((v) => ({
          variant: v,
          hue: hueByVariant[v.id] ?? HUES[0],
          fte: CAPABILITY_ORDER.reduce((sum, c) => sum + (v.fte[c] ?? 0), 0),
          months: wholePlanMonthsByVariant[v.id] ?? Infinity,
          isBaseline: v.id === baseline.id,
        })),
        isWholePlan: true,
      },
    ];
  }, [variants, totalsByCapability, hueByVariant, baseline.id, wholePlanMonthsByVariant, edpm]);

  const D = DENSITIES.find((d) => d.id === densityId) ?? DENSITIES[1];
  const nameW = D.name;
  const barTop = Math.round((D.row - D.bar) / 2);

  const longest = useMemo(() => {
    let max = 0;
    for (const band of bands) {
      for (const row of band.rows) {
        if (Number.isFinite(row.months)) max = Math.max(max, row.months);
      }
    }
    return max;
  }, [bands]);

  const months = Math.max(12, Math.ceil(longest / 6) * 6 + 6);
  const totalW = months * ppm;

  const now = useMemo(() => new Date(), []);
  const startYear = now.getFullYear();
  const startMonth = now.getMonth();

  const { ticks, tickLabels, gridlines } = useMemo(
    () => buildAxis(months, ppm, startYear, startMonth),
    [months, ppm, startYear, startMonth],
  );

  const planRows = bands[0].rows;
  const baselinePlan = planRows.find((r) => r.isBaseline) ?? planRows[0];
  const fastestPlan = planRows.reduce((best, r) => (r.months < best.months ? r : best), planRows[0]);

  function deltaAgainstBaseline(row: VariantRow, band: CompareBand) {
    const base = band.rows.find((r) => r.isBaseline);
    if (!base || row.isBaseline) return null;
    if (!Number.isFinite(row.months) || !Number.isFinite(base.months)) return null;
    const diff = base.months - row.months;
    if (Math.abs(diff) < 0.05) return { text: "tak samo", color: "var(--ink-3)" };
    const pct = base.months > 0 ? Math.abs(diff) / base.months : 0;
    const faster = diff > 0;
    return {
      text: `${faster ? "−" : "+"}${fmt(Math.abs(diff))} mies. · ${Math.round(pct * 100)}% ${faster ? "szybciej" : "wolniej"}`,
      color: faster ? "var(--accent)" : "var(--warn)",
    };
  }

  function renderRow(band: CompareBand, row: VariantRow) {
    const hovered = hover === row.variant.id;
    const base = band.rows.find((r) => r.isBaseline);
    const delta = deltaAgainstBaseline(row, band);
    const noPeople = row.fte <= 0 && band.fteMonths > 0;
    const noWork = band.fteMonths === 0;

    const width = noPeople || noWork ? 0 : Math.max(4, Math.round(row.months * ppm));
    const height = D.bar;
    const baselineX =
      base && !row.isBaseline && Number.isFinite(base.months) ? Math.round(base.months * ppm) : null;

    const outParts: { text: string; color: string }[] = [];
    if (noWork) outParts.push({ text: "brak zaplanowanej pracy", color: "var(--ink-4)" });
    else if (noPeople) outParts.push({ text: "nikt nie przypisany — nigdy się nie skończy", color: "var(--warn)" });
    else outParts.push({ text: `${fmt(row.months)} mies.`, color: "var(--ink-2)" });
    if (delta) outParts.push({ text: delta.text, color: delta.color });

    return (
      <div
        key={row.variant.id}
        className="atl-row"
        style={{ height: D.row, background: hovered ? "var(--row-hover)" : "transparent" }}
        onMouseEnter={() => setHover(row.variant.id)}
        onMouseLeave={() => setHover((h) => (h === row.variant.id ? null : h))}
        onClick={() => setVariantId(row.variant.id)}
      >
        <div
          className="atl-row-name"
          style={{
            width: nameW,
            background: hovered ? "var(--name-hover)" : "var(--band)",
            cursor: "pointer",
          }}
          title={`Porównaj z ${row.variant.label}`}
        >
          <span
            className="atl-hue"
            style={{ height: D.bar, background: solid(row.hue), opacity: row.isBaseline ? 1 : 0.55 }}
          />
          <span
            className="atl-row-title"
            style={{ fontSize: D.fsName, fontWeight: row.isBaseline ? 600 : 400 }}
          >
            {row.variant.label}
          </span>
          {row.isBaseline && <span className="atl-band-badge">bazowy</span>}
          <span className="atl-row-id" style={{ fontSize: D.fsMono }}>
            {fmt(row.fte)}
          </span>
        </div>

        <div className="atl-row-track" style={{ width: totalW, height: D.row }}>
          {gridlines.map((x) => (
            <div key={x} className="atl-grid" style={{ left: x, height: D.row, background: "var(--line)" }} />
          ))}

          {width > 0 && height > 0 && (
            <div
              className="atl-bar"
              style={{
                left: 0,
                top: barTop,
                width,
                height,
                border: `1px solid ${row.isBaseline ? solid(row.hue) : "transparent"}`,
                background: row.isBaseline ? solid(row.hue) : soft(row.hue),
                cursor: "pointer",
              }}
            >
              {width >= 34 && height >= 12 && (
                <span
                  className="atl-seg-people"
                  style={{
                    bottom: Math.max(2, Math.round((height - 10) / 2)),
                    color: row.isBaseline ? "var(--on-bar)" : "var(--ink)",
                  }}
                >
                  {fmt(row.fte)}
                </span>
              )}
            </div>
          )}

          {/* where the baseline lands, so the gap is visible and not just stated */}
          {baselineX != null && width > 0 && (
            <div
              style={{
                position: "absolute",
                left: baselineX,
                top: barTop - 3,
                width: 1,
                height: D.bar + 6,
                background: "transparent",
                borderLeft: `1px dashed ${wash(base!.hue, 0.75)}`,
              }}
            />
          )}

          <div
            className="atl-out-label"
            style={{ left: width, top: barTop, height: D.bar, gap: 10 }}
          >
            {outParts.map((p, i) => (
              <span key={i} style={{ color: p.color }}>
                {p.text}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  function renderBand(band: CompareBand) {
    const finite = band.rows.filter((r) => Number.isFinite(r.months) && r.months > 0);
    const best = finite.reduce<VariantRow | null>(
      (b, r) => (b == null || r.months < b.months ? r : b),
      null,
    );
    const worst = finite.reduce<VariantRow | null>(
      (b, r) => (b == null || r.months > b.months ? r : b),
      null,
    );
    const spread =
      best && worst && worst.months > 0 && best.variant.id !== worst.variant.id
        ? Math.round(((worst.months - best.months) / worst.months) * 100)
        : 0;

    return (
      <section className={`atl-band ${band.isWholePlan ? "atl-band-total" : ""}`} key={band.label}>
        <div className="atl-band-head" style={{ height: D.band }}>
          <div className="atl-band-name" style={{ width: nameW }}>
            <div
              style={{
                flex: "none",
                width: 3,
                height: D.bar,
                background: band.isWholePlan ? "var(--accent)" : "var(--ink-3)",
                opacity: 0.6,
              }}
            />
            <b>{band.label}</b>
            <span className="atl-band-people">{fmt(band.fteMonths)} FTE-mies.</span>
          </div>
          <div className="atl-band-track" style={{ width: totalW }}>
            <div className="atl-band-chips" style={{ left: 0, height: D.band }}>
              {best && (
                <span style={{ color: "var(--ink-2)" }}>
                  najszybszy {best.variant.label.toLowerCase()} · {fmt(best.months)} mies.
                </span>
              )}
              {spread > 0 && (
                <span style={{ color: "var(--accent)" }}>{spread}% różnicy między najlepszym i najgorszym</span>
              )}
              {!best && <span style={{ color: "var(--ink-4)" }}>brak zaplanowanych prac</span>}
              {band.isWholePlan && (
                <span style={{ color: "var(--ink-4)" }} title="uwzględnia fazowanie i kolejkowanie zdolności">
                  z symulacji fazowej
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="atl-rows">{band.rows.map((row) => renderRow(band, row))}</div>
      </section>
    );
  }

  const planDelta = deltaAgainstBaseline(fastestPlan, bands[0]);

  return (
    <div className="atl" data-theme={theme === "auto" ? undefined : theme}>
      <header className="atl-header" style={{ height: D.hdr }}>
        <div className="atl-title">
          <b>Symulacje</b>
          <span className="atl-chip">
            {plCount(variants.length, "wariant", "warianty", "wariantów")}
          </span>
        </div>

        <div className="atl-group is-divided">
          <span className="atl-eyebrow" style={{ paddingLeft: 10 }}>
            bazowy
          </span>
          <div className="atl-seg">
            {variants.map((v) => {
              const overrides = ceilingOverrideCount(v);
              return (
                <button
                  key={v.id}
                  type="button"
                  className={`atl-seg-text ${v.id === variantId ? "is-active" : ""}`}
                  onClick={() => setVariantId(v.id)}
                  title={
                    overrides > 0
                      ? `${plCount(overrides, "nadpisany sufit", "nadpisane sufity", "nadpisanych sufitów")} — szczegóły w Edytuj…`
                      : undefined
                  }
                >
                  {v.label}
                  {overrides > 0 ? ` ▲${overrides}` : ""}
                </button>
              );
            })}
          </div>
          <button type="button" className="atl-btn" onClick={() => setEditorOpen(true)}>
            Edytuj…
          </button>
          <button
            type="button"
            className={`atl-btn ${optimizerOpen ? "is-on" : ""}`}
            onClick={() => setOptimizerOpen(true)}
            disabled={baselineTotalFte <= 0 || plannedProjects.length === 0}
            title={
              baselineTotalFte <= 0
                ? "Wariant bez ludzi — nie ma czego przesuwać"
                : plannedProjects.length === 0
                  ? "Brak projektów w planie"
                  : undefined
            }
          >
            <span className="atl-spark">✦</span> Optymalizuj…
          </button>
        </div>

        <div className="atl-spacer" />

        <div className="atl-group">
          <span className="atl-eyebrow" title="gęstość wierszy">
            gęstość
          </span>
          <div className="atl-seg">
            {DENSITIES.map((d) => (
              <button
                key={d.id}
                type="button"
                className={`atl-seg-icon ${d.id === D.id ? "is-active" : ""}`}
                onClick={() => setDensityId(d.id)}
              >
                {d.label}
              </button>
            ))}
          </div>
          <span className="atl-eyebrow" title="miesięcy na ekran" style={{ paddingLeft: 3 }}>
            zoom
          </span>
          <div className="atl-seg">
            {ZOOMS.map((z) => (
              <button
                key={z.id}
                type="button"
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
          >
            Legenda
          </button>
        </div>
      </header>

      {keyOpen && (
        <div className="atl-key">
          <div className="atl-key-item">
            <div className="atl-key-bar" style={{ borderStyle: "solid", borderColor: "var(--line-strong)" }}>
              <i style={{ left: 0, width: 20, height: 13, background: "var(--accent)", borderRadius: 1 }} />
            </div>
            <span>jeden wiersz na wariant · długość = kiedy kończy się cała praca · liczba = etaty w zespole</span>
          </div>
          <div className="atl-key-item">
            <div
              className="atl-key-bar"
              style={{ border: "none", background: "none", width: 34, display: "flex", alignItems: "center" }}
            >
              <span style={{ borderLeft: "1px dashed var(--accent)", height: 15, marginLeft: 16 }} />
            </div>
            <span>gdzie kończy wariant bazowy</span>
          </div>
          <div className="atl-key-item">
            <span className="atl-key-num" style={{ color: "var(--accent)" }}>
              −2 mies. · 30% szybciej
            </span>
            <span>względem wariantu bazowego</span>
          </div>
          <div className="atl-key-item">
            <span className="atl-key-num">kliknij</span>
            <span>wiersz, aby ustawić ten wariant jako bazowy</span>
          </div>
        </div>
      )}

      <div className="atl-scroll" ref={scrollRef}>
        <div className="atl-axis" style={{ height: D.axis }}>
          <div className="atl-axis-corner" style={{ width: nameW }}>
            <span className="atl-eyebrow">wariant</span>
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
        <span>bazowy · {variantCaption(baseline.label)}</span>
        <span>
          {fmt(bands[0].fteMonths)} FTE-mies. pracy ·{" "}
          {plCount(CAPABILITY_ORDER.length, "kompetencja", "kompetencje", "kompetencji")}
        </span>
        <span>
          kończy się{" "}
          {Number.isFinite(baselinePlan.months) ? monthLabel(startYear, startMonth, baselinePlan.months) : "nigdy"}
        </span>
        {planDelta ? (
          <span style={{ color: planDelta.color }}>
            najlepszy {fastestPlan.variant.label.toLowerCase()} · {planDelta.text}
          </span>
        ) : (
          <span style={{ color: "var(--accent)" }}>wariant bazowy jest najszybszy</span>
        )}
        <span style={{ flex: 1 }} />
        <span>kliknij wiersz, aby zmienić punkt odniesienia · esc zamyka panele</span>
      </footer>

      {optimizerOpen && (
        <HiringPlanDrawer
          api={proposal}
          ladder={ladder}
          baselineLabel={baseline.label}
          baselineFte={baseline.fte}
          insets={{ top: D.hdr, bottom: D.foot }}
          caps={caps}
          onCapsChange={setCaps}
          onApply={applyProposal}
          onApplyRung={applyRung}
          projectNameOf={projectNameOf}
          onClose={() => setOptimizerOpen(false)}
        />
      )}

      {editorOpen && (
        <VariantEditor
          api={variantsApi}
          activeId={baseline.id}
          projectNameOf={projectNameOf}
          onActivate={setVariantId}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </div>
  );
}
