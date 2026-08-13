import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Eye, EyeOff, Wand2, X } from "lucide-react";
import { useCapabilityMatrix } from "../hooks/useCapabilityMatrix";
import { useCapabilitySchedule, earliestStartOffsets } from "../hooks/useCapabilitySchedule";
import { useCeilingProposal } from "../hooks/useCeilingProposal";
import { useProjectCrud } from "../hooks/useProjectCrud";
import { useRoster } from "../hooks/useRoster";
import { capacityFloor, type AutopilotInput, type CeilingMove } from "../lib/autopilot";
import { leaveFteByMonth } from "../lib/leaves";
import {
  CAPABILITY_LABELS,
  CAPABILITY_ORDER,
  CATEGORY_ORDER,
  ESTIMATE_ORDER,
  effectiveDaysByCapability,
  isIncludedInPlan,
  referenceEffortDays,
} from "../lib/estimation";
import { usePlanner } from "../state/plannerContext";
import type { Capability, Estimate, EstimationSettings, Project } from "../types";
import { CeilingProposals } from "./CeilingProposals";
import { NumberField } from "./NumberField";
import { fmt, plCount } from "./timelineChrome";
import "./timeline.css";

interface CapabilityMatrixProps {
  projects: Project[];
  theme: "auto" | "light" | "dark";
  onClose: () => void;
}

type Tab = "days" | "settings";

// The name column carries the plan toggle, a size badge, an ellipsised name
// and the row's running total, and takes any width left over — project names
// here run to sixty characters, and the value columns gain nothing from being
// wider. Below 340px it stops shrinking and the grid scrolls instead. The
// trailing column holds the sum against its reference plus a bar, so it needs
// more room than a bare number would.
const GRID_TEMPLATE = `minmax(300px, 1fr) repeat(${CAPABILITY_ORDER.length}, 118px) 104px`;

/** What the scheduler made of one project × capability, folded across phases.
 *  PM and TL run in both, so the cell shows the larger crew and says so. */
interface CellPlan {
  setsPace: boolean;
  crewFte: number;
  isBurst: boolean;
  phases: number[];
}

/** One colour per T-shirt size, warm as the size grows. Purely an identity
 *  aid for scanning the column — it ranks nothing the number doesn't. */
const sizeColor = (estimate: Estimate) => `var(--size-${estimate.toLowerCase()})`;

/**
 * Background weight for a cell holding `days`, against the heaviest cell in
 * the matrix.
 *
 * Square-rooted rather than linear: effort is very unevenly spread — a handful
 * of XXL rows carry numbers ten times the median — and a linear ramp would
 * leave everything but those few cells indistinguishable from empty. The floor
 * of 0.1 keeps the lightest real number visibly different from no number at
 * all, which is the distinction the grid is scanned for.
 */
function heatAlpha(days: number, maxDays: number): number {
  if (days <= 0 || maxDays <= 0) return 0;
  return 0.1 + 0.55 * Math.sqrt(days / maxDays);
}

export function CapabilityMatrix({ projects, theme, onClose }: CapabilityMatrixProps) {
  const { cells, setCell } = useCapabilityMatrix();
  const { setIncludeInPlan } = useProjectCrud();
  const { settings, people, leaves, updateEstimationSettings, setEstimateWeight } = usePlanner();
  const { pools } = useRoster();
  const [tab, setTab] = useState<Tab>("days");
  const [showProposals, setShowProposals] = useState(false);

  // The plan this screen is editing, priced against the real roster — the same
  // pools Obsada uses, so the horizon in the footer is the one the rest of the
  // app quotes rather than a fourth opinion.
  const schedule = useCapabilitySchedule(projects, pools);
  const plannedProjects = useMemo(() => projects.filter(isIncludedInPlan), [projects]);

  /** Per cell: is this the capability holding the phase, and what crew does it
   *  actually run at. Both come from the simulation, never from the cell. */
  const cellPlan = useMemo(() => {
    const map = new Map<string, CellPlan>();
    for (const sp of schedule.scheduled) {
      for (const stream of sp.streams) {
        const key = `${sp.project.id}:${stream.capability}`;
        const prev = map.get(key);
        if (!prev) {
          map.set(key, {
            setsPace: stream.setsPace,
            crewFte: stream.crewFte,
            isBurst: stream.isBurst,
            phases: [stream.phase],
          });
        } else {
          prev.setsPace = prev.setsPace || stream.setsPace;
          prev.crewFte = Math.max(prev.crewFte, stream.crewFte);
          prev.isBurst = prev.isBurst && stream.isBurst;
          prev.phases.push(stream.phase);
        }
      }
    }
    return map;
  }, [schedule]);

  // The horizon as it stood when the screen opened, so the footer can show what
  // this editing session has cost or bought rather than a bare number.
  const openingHorizon = useRef<number | null>(null);
  if (openingHorizon.current === null) openingHorizon.current = schedule.horizonMonths;

  const paceTally = useMemo(() => {
    const tally = new Map<Capability, number>();
    for (const sp of schedule.scheduled) {
      for (const stream of sp.streams) {
        if (stream.setsPace) tally.set(stream.capability, (tally.get(stream.capability) ?? 0) + 1);
      }
    }
    return [...tally.entries()].sort((a, b) => b[1] - a[1]);
  }, [schedule]);

  const autopilotInput = useMemo<AutopilotInput>(
    () => ({
      projects: plannedProjects,
      pools,
      effectiveDaysPerMonth: effectiveDaysByCapability(people, settings),
      minStaffingFraction: settings.minStaffingFraction,
      minCrewFte: settings.minCrewFte,
      earliestStart: earliestStartOffsets(plannedProjects),
      leaveFteByMonth: leaveFteByMonth(people, leaves),
    }),
    [plannedProjects, pools, people, leaves, settings],
  );

  const proposal = useCeilingProposal(cells, autopilotInput);
  const floor = useMemo(
    () =>
      capacityFloor(
        cells,
        plannedProjects.map((p) => p.id),
        pools,
        autopilotInput.effectiveDaysPerMonth,
      ),
    [cells, plannedProjects, pools, autopilotInput],
  );

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const applyMoves = useCallback(
    (moves: CeilingMove[]) => {
      for (const move of moves) setCell(move.projectId, move.capability, { maxFte: move.to });
      proposal.reset();
      setShowProposals(false);
    },
    [setCell, proposal],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // The drawer is the innermost layer, so it takes Escape first.
      if (showProposals) setShowProposals(false);
      else onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, showProposals]);

  const byCategory = useMemo(() => {
    return CATEGORY_ORDER.map((category) => ({
      category,
      projects: projects.filter((p) => p.category === category),
    })).filter((group) => group.projects.length > 0);
  }, [projects]);

  const outOfPlanCount = useMemo(() => projects.filter((p) => !isIncludedInPlan(p)).length, [projects]);

  // Flat top-to-bottom position of every rendered row, so ↑/↓ can step across
  // a category heading the way the eye does rather than stopping at it.
  const rowIndexById = useMemo(() => {
    const index: Record<string, number> = {};
    let row = 0;
    for (const group of byCategory) for (const project of group.projects) index[project.id] = row++;
    return index;
  }, [byCategory]);

  const gridRef = useRef<HTMLDivElement>(null);

  // A deferred field keeps its edit local until blur, so every total computed
  // from it would sit stale for the whole time you are typing into that cell —
  // the one moment they exist to be read. The focused cell reports its draft
  // here and every total is computed against it, without a keystroke reaching
  // the store, the scheduler or the network. Only one cell can hold focus, so
  // one slot is enough.
  const [liveDraft, setLiveDraft] = useState<
    { projectId: string; capability: Capability; days: number } | null
  >(null);

  /** The single reader every total goes through, so the draft is applied once
   *  and consistently instead of being patched into each aggregate by hand. */
  const cellDays = useCallback(
    (projectId: string, capability: Capability): number => {
      if (liveDraft && liveDraft.projectId === projectId && liveDraft.capability === capability) {
        return liveDraft.days;
      }
      return cells[projectId]?.[capability]?.days ?? 0;
    },
    [cells, liveDraft],
  );

  function rowTotal(projectId: string): number {
    return CAPABILITY_ORDER.reduce((sum, c) => sum + cellDays(projectId, c), 0);
  }

  // Every aggregate on this screen counts only what is actually in the plan:
  // a parked project draws from no pool, so folding it into a column total
  // would overstate the demand these seven pools have to absorb. The full
  // figure is a keystroke away in the tooltip rather than gone.
  const totals = useMemo(() => {
    const planned = {} as Record<Capability, number>;
    const parked = {} as Record<Capability, number>;
    for (const capability of CAPABILITY_ORDER) {
      planned[capability] = 0;
      parked[capability] = 0;
    }
    // Scaled against every cell drawn, in plan or not, so toggling a project
    // never repaints the rest of the grid.
    let maxDays = 0;
    for (const project of projects) {
      const bucket = isIncludedInPlan(project) ? planned : parked;
      for (const capability of CAPABILITY_ORDER) {
        const days = cellDays(project.id, capability);
        bucket[capability] += days;
        if (days > maxDays) maxDays = days;
      }
    }
    const grandPlanned = CAPABILITY_ORDER.reduce((s, c) => s + planned[c], 0);
    const grandParked = CAPABILITY_ORDER.reduce((s, c) => s + parked[c], 0);
    return { planned, parked, grandPlanned, grandParked, maxDays };
  }, [projects, cellDays]);

  // Vertical movement, grid convention. Tab already walks a row correctly —
  // `.cm-row` is `display: contents`, so DOM order is row-major — and left/
  // right stay with the caret, where a text input needs them. Moving focus is
  // what commits the field being left: see NumberField's `deferCommit`.
  function handleGridKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const step =
      event.key === "ArrowDown" || (event.key === "Enter" && !event.shiftKey)
        ? 1
        : event.key === "ArrowUp" || (event.key === "Enter" && event.shiftKey)
          ? -1
          : 0;
    if (step === 0) return;
    const from = (event.target as HTMLElement).closest<HTMLElement>("[data-cm-row]");
    if (!from) return;
    const next = gridRef.current?.querySelector<HTMLInputElement>(
      `[data-cm-row="${Number(from.dataset.cmRow) + step}"][data-cm-col="${from.dataset.cmCol}"] input`,
    );
    if (!next) return;
    event.preventDefault();
    next.focus();
  }

  // Every knob-field commit sends all of them — `updateEstimationSettings`
  // replaces the whole set at once, so a partial patch would blow away
  // whichever knobs weren't just edited.
  function patchSettings(patch: Partial<Omit<EstimationSettings, "estimateValues">>) {
    updateEstimationSettings({
      daysPerValue: settings.daysPerValue,
      workingDaysPerMonth: settings.workingDaysPerMonth,
      minStaffingFraction: settings.minStaffingFraction,
      minCrewFte: settings.minCrewFte,
      ...patch,
    });
  }

  const maxWeight = Math.max(...ESTIMATE_ORDER.map((e) => settings.estimateValues[e]));

  return (
    <div
      className="atl"
      data-theme={theme === "auto" ? undefined : theme}
      role="dialog"
      aria-modal="true"
      aria-label="Macierz kompetencji"
    >
      <header className="atl-header" style={{ height: 56 }}>
        <div className="atl-title">
          <b>Macierz kompetencji</b>
          <span className="atl-chip">{plCount(projects.length, "projekt", "projekty", "projektów")}</span>
          {outOfPlanCount > 0 && (
            <span className="atl-chip" style={{ color: "var(--ink-4)" }}>
              {plCount(outOfPlanCount, "poza planem", "poza planem", "poza planem")}
            </span>
          )}
        </div>

        <div className="atl-spacer" />

        <div className="atl-group">
          {tab === "days" && (
            <button
              type="button"
              className={showProposals ? "atl-btn is-on" : "atl-btn"}
              onClick={() => setShowProposals((v) => !v)}
              title="Znajdź sufity, których podniesienie faktycznie skraca plan"
            >
              <Wand2 size={13} style={{ marginRight: 6, verticalAlign: "-2px" }} />
              Propozycje sufitów
            </button>
          )}
          {tab === "days" && (
            <span
              className="cm-grand"
              title={
                totals.grandParked > 0
                  ? `${fmt(totals.grandPlanned)} dni nakładu w planie · ${fmt(totals.grandParked)} dni w projektach poza planem, których harmonogram nie liczy`
                  : `${fmt(totals.grandPlanned)} dni nakładu w planie`
              }
            >
              {fmt(totals.grandPlanned)} dni w planie
            </span>
          )}
          <div className="atl-seg">
            <button
              type="button"
              className={`atl-seg-text ${tab === "days" ? "is-active" : ""}`}
              onClick={() => setTab("days")}
            >
              dni nakładu
            </button>
            <button
              type="button"
              className={`atl-seg-text ${tab === "settings" ? "is-active" : ""}`}
              onClick={() => setTab("settings")}
            >
              ustawienia
            </button>
          </div>
          <div className="atl-rule" />
          <button type="button" className="atl-close" onClick={onClose} aria-label="Zamknij macierz">
            <X size={16} />
          </button>
        </div>
      </header>

      {tab === "settings" ? (
        <div className="atl-scroll cm-scroll">
          <div className="cm-settings">
            <section className="cm-settings-section">
              <h4>Wagi rozmiarów</h4>
              <p className="cm-settings-hint">
                Dni pracy projektu = waga rozmiaru × dni na jednostkę wagi.
              </p>
              <div className="cm-settings-weights">
                {ESTIMATE_ORDER.map((estimate) => (
                  <div className="cm-settings-row" key={estimate}>
                    <span className="cm-size" style={{ color: sizeColor(estimate), borderColor: sizeColor(estimate) }}>
                      {estimate}
                    </span>
                    <NumberField
                      key={`weight-${estimate}`}
                      initial={settings.estimateValues[estimate]}
                      label={`Waga rozmiaru ${estimate}`}
                      max={9999}
                      className="cm-input"
                      deferCommit
                      selectOnFocus
                      onCommit={(value) => setEstimateWeight(estimate as Estimate, value)}
                    />
                    <span className="cm-settings-preview">
                      = {fmt(settings.estimateValues[estimate] * settings.daysPerValue)} dni
                    </span>
                    <span style={{ flex: 1 }} />
                    {/* The scale is convex by design — each tier costs
                        disproportionately more than the last — and five numbers
                        in a column hide that. The bars show the curve. */}
                    <span className="cm-weight-track">
                      <span
                        className="cm-weight-fill"
                        style={{
                          width: `${(settings.estimateValues[estimate] / maxWeight) * 100}%`,
                          background: sizeColor(estimate),
                        }}
                      />
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="cm-settings-section">
              <h4>Parametry</h4>
              <div className="cm-settings-row">
                <span className="cm-settings-label">dni na jednostkę wagi</span>
                <NumberField
                  key="days-per-value"
                  initial={settings.daysPerValue}
                  label="Dni na jednostkę wagi"
                  max={999}
                  className="cm-input"
                  deferCommit
                  selectOnFocus
                  onCommit={(value) => patchSettings({ daysPerValue: value })}
                />
              </div>
              <div className="cm-settings-row">
                <span className="cm-settings-label">dni robocze w miesiącu</span>
                <NumberField
                  key="working-days"
                  initial={settings.workingDaysPerMonth}
                  label="Dni robocze w miesiącu"
                  max={31}
                  decimals={1}
                  className="cm-input"
                  deferCommit
                  selectOnFocus
                  onCommit={(value) => patchSettings({ workingDaysPerMonth: value })}
                />
              </div>
              <p className="cm-settings-hint cm-settings-note">
                Produktywność nie jest już jedną liczbą dla wszystkich — ustawiasz ją{" "}
                <b>osobno dla każdej osoby</b> w ekranie Zespół. Pula kompetencji nadal liczy
                osoby; produktywność zmienia <i>tempo</i>, w jakim jedno FTE przerabia nakład, i
                każda kompetencja ma własne — wyliczone z produktywności swoich ludzi. Tutaj
                zostaje sam kalendarz: <b>{fmt(settings.workingDaysPerMonth)}</b> dni roboczych na
                miesiąc.
              </p>
            </section>

            <section className="cm-settings-section">
              <h4>Minimalna obsada</h4>
              <p className="cm-settings-hint">
                Faza projektu nie startuje, dopóki <i>każda</i> potrzebna kompetencja nie ma wolnego
                co najmniej tego ułamka wyliczonej załogi — a gdy już wystartuje, cała załoga schodzi
                i wraca <i>razem</i>, jednym wspólnym współczynnikiem, więc strumienie nigdy się nie
                rozjeżdżają. Dzięki temu w projektach nie ma dziur.
              </p>
              <div className="cm-settings-row">
                <span className="cm-settings-label">minimalna obsada (0–1)</span>
                <NumberField
                  key="min-staffing-fraction"
                  initial={settings.minStaffingFraction}
                  label="Minimalna obsada jako ułamek wyliczonej załogi"
                  min={0.05}
                  max={1}
                  decimals={2}
                  className="cm-input"
                  deferCommit
                  selectOnFocus
                  onCommit={(value) => patchSettings({ minStaffingFraction: value })}
                />
                <span className="cm-settings-preview">
                  np. załoga 3 FTE → start od {fmt(3 * settings.minStaffingFraction)} FTE
                </span>
              </div>
              <p className="cm-settings-hint cm-settings-note">
                Im wyżej, tym uczciwsze daty i mniej projektów w toku — ale dłuższe kolejki i więcej
                bezczynnych FTE. <b>1</b> oznacza „nic nie startuje bez pełnej obsady”.
              </p>
            </section>

            <section className="cm-settings-section">
              <h4>Próg krótkiego zrywu</h4>
              <p className="cm-settings-hint">
                Kompetencja, której wyliczone FTE spadłoby poniżej tego progu, nie jest rozciągana na
                całą fazę — idzie krótkim zrywem i kończy wcześniej. 4 dni bezpieczeństwa rozmazane
                na pięciomiesięczną budowę to 0,06 FTE, czyli liczba, która niczego nie opisuje.
              </p>
              <div className="cm-settings-row">
                <span className="cm-settings-label">próg (FTE)</span>
                <NumberField
                  key="min-crew-fte"
                  initial={settings.minCrewFte}
                  label="Najmniejsze FTE, jakie wolno rozłożyć na całą fazę"
                  min={0.01}
                  max={1}
                  decimals={2}
                  className="cm-input"
                  deferCommit
                  selectOnFocus
                  onCommit={(value) => patchSettings({ minCrewFte: value })}
                />
                <span className="cm-settings-preview">
                  poniżej {fmt(settings.minCrewFte)} FTE → krótki zryw
                </span>
              </div>
              <p className="cm-settings-hint cm-settings-note">
                To jedyne miejsce, w którym strumień może skończyć przed swoją fazą.
              </p>
            </section>
          </div>
        </div>
      ) : (
        <div className="atl-scroll cm-scroll">
          <div
            className="cm-grid"
            style={{ gridTemplateColumns: GRID_TEMPLATE }}
            ref={gridRef}
            onKeyDown={handleGridKeyDown}
          >
            <div className="cm-cell cm-head cm-head-name">
              <span>projekt</span>
              <span className="cm-head-total">dni</span>
            </div>
            {CAPABILITY_ORDER.map((capability) => (
              <div
                key={capability}
                className="cm-cell cm-head cm-head-cap"
                title={
                  totals.parked[capability] > 0
                    ? `${CAPABILITY_LABELS[capability]} — ${fmt(totals.planned[capability])} dni nakładu w planie · ${fmt(totals.parked[capability])} dni poza planem`
                    : `${CAPABILITY_LABELS[capability]} — ${fmt(totals.planned[capability])} dni nakładu w planie`
                }
              >
                <b>{CAPABILITY_LABELS[capability]}</b>
                {/* The column total is the figure the pools have to absorb —
                    the one number that says whether this specialisation is
                    the bottleneck before the scheduler is even run. */}
                <span className="cm-head-sum">{fmt(totals.planned[capability])}</span>
              </div>
            ))}
            <div className="cm-cell cm-head">suma / ref</div>

            {byCategory.map(({ category, projects: catProjects }) => {
              const plannedRows = catProjects.filter(isIncludedInPlan);
              const categoryDays = plannedRows.reduce((sum, p) => sum + rowTotal(p.id), 0);
              return (
                <div className="cm-group" key={category} style={{ display: "contents" }}>
                  <div className="cm-cat-head">
                    <b>{category}</b>
                    <span>{plCount(catProjects.length, "projekt", "projekty", "projektów")}</span>
                    <span style={{ flex: 1 }} />
                    <span className="cm-cat-days">{fmt(categoryDays)} dni w planie</span>
                  </div>

                  {catProjects.map((project) => {
                    const row = cells[project.id];
                    const sum = rowTotal(project.id);
                    // Shown next to the sum as context, never compared against
                    // it: the T-shirt size is a rough guess made before anyone
                    // looked at the detail, and the detail is what gets
                    // scheduled. A row that disagrees with its size is the
                    // normal outcome of estimating properly, not a defect.
                    const reference = referenceEffortDays(project, settings);
                    const ratio = reference > 0 ? sum / reference : 0;
                    const noDemand = sum <= 0;
                    const inPlan = isIncludedInPlan(project);
                    // Worth calling out only while the project claims to be in
                    // the plan: an empty row there means it silently never
                    // reaches the timeline. On a parked row it is the expected
                    // state, and colouring it would flag the whole backlog.
                    const silentlyUnscheduled = noDemand && inPlan;
                    return (
                      <div className={`cm-row ${inPlan ? "" : "is-out-of-plan"}`} key={project.id}>
                        <div className="cm-cell cm-name" title={project.description || project.name}>
                          <button
                            type="button"
                            className="cm-plan-toggle"
                            aria-label={
                              inPlan ? `Wyjmij ${project.name} z planu` : `Dodaj ${project.name} do planu`
                            }
                            title={
                              inPlan
                                ? "W planie — kliknij, aby wyjąć z harmonogramu"
                                : "Poza planem — kliknij, aby przywrócić do harmonogramu"
                            }
                            onClick={() => setIncludeInPlan(project.id, !inPlan)}
                          >
                            {inPlan ? <Eye size={13} /> : <EyeOff size={13} />}
                          </button>
                          {/* The size the row is being checked against, kept
                              beside the name so the reference column at the far
                              end of the scroll isn't the only place it exists. */}
                          <span
                            className="cm-size"
                            style={{ color: sizeColor(project.estimate), borderColor: sizeColor(project.estimate) }}
                            title={`rozmiar ${project.estimate} — sugeruje ${fmt(reference)} dni`}
                          >
                            {project.estimate}
                          </span>
                          <span className="cm-name-text">{project.name}</span>
                          {/* The row's own total, mirrored into the pinned column
                              so it stays under the eye while you type — the
                              `suma` column sits past seven cells of scroll, which
                              is exactly where you can't see it. Deliberately the
                              bare sum and not a countdown against the T-shirt
                              size: same reasoning as `reference` above. */}
                          <span
                            className={`cm-row-total ${noDemand ? "is-empty" : ""} ${silentlyUnscheduled ? "is-unscheduled" : ""}`}
                            title={
                              noDemand
                                ? "brak przypisanych kompetencji — projekt nie trafia do harmonogramu"
                                : `suma wiersza: ${fmt(sum)} dni nakładu`
                            }
                          >
                            {fmt(sum)}
                          </span>
                        </div>
                        {CAPABILITY_ORDER.map((capability) => {
                          const cell = row?.[capability] ?? { days: 0, maxFte: 0 };
                          const days = cellDays(project.id, capability);
                          const flagged = days > 0 && cell.maxFte <= 0;
                          const alpha = heatAlpha(days, totals.maxDays);
                          const cp = cellPlan.get(`${project.id}:${capability}`);
                          // Slack is the normal state, not a fault: whichever
                          // capability hits its ceiling first sets the phase's
                          // length and everyone else is de-rated to land with
                          // it. Dimming those ceilings is the whole point —
                          // raising one is provably a no-op, and the grid used
                          // to give all seven the same weight.
                          const isPace = cp?.setsPace ?? false;
                          return (
                            <div
                              key={capability}
                              className={`cm-cell cm-input-cell ${flagged ? "is-flagged" : ""} ${days > 0 ? "is-live" : ""}`}
                              // The flagged wash is a state worth seeing; the
                              // heat is only a magnitude. Where they collide the
                              // state wins rather than being painted over.
                              style={
                                flagged || alpha === 0
                                  ? undefined
                                  : { background: `rgb(var(--heat) / ${alpha.toFixed(3)})` }
                              }
                              title={flagged ? "nakład > 0, ale brak sufitu — bez niego nie da się dobrać załogi" : undefined}
                            >
                              <div
                                className="cm-line"
                                data-cm-row={rowIndexById[project.id]}
                                data-cm-col={`${capability}:days`}
                              >
                                <span className="cm-line-k">dni</span>
                                {/* Deliberately not capped at the project's
                                    reference days: the T-shirt size is an estimate
                                    to compare against, not a budget to enforce. It
                                    used to be `max={total}`, which silently rewrote
                                    anything larger — and shrinking a project's size
                                    retroactively clamped every cell in its row. The
                                    row total is shown as context, never enforced. */}
                                <NumberField
                                  key={`${project.id}-${capability}-days`}
                                  initial={cell.days}
                                  label={`Dni nakładu ${CAPABILITY_LABELS[capability]} dla ${project.name}`}
                                  max={9999}
                                  className="cm-input"
                                  placeholder="0"
                                  blankZero
                                  deferCommit
                                  selectOnFocus
                                  onCommit={(value) => setCell(project.id, capability, { days: value })}
                                  onDraft={(value) =>
                                    setLiveDraft((current) =>
                                      value == null
                                        ? current?.projectId === project.id &&
                                          current.capability === capability
                                          ? null
                                          : current
                                        : { projectId: project.id, capability, days: value },
                                    )
                                  }
                                />
                              </div>

                              {days > 0 && (
                                <>
                                  <div
                                    className={`cm-line cm-line-ceil ${isPace ? "is-pace" : "is-slack"}`}
                                    data-cm-row={rowIndexById[project.id]}
                                    data-cm-col={`${capability}:ceil`}
                                    title={
                                      isPace
                                        ? "Ta kompetencja jest na swoim suficie i wyznacza długość fazy — jedyna komórka w tym wierszu, której podniesienie skróci projekt."
                                        : "Poniżej swojego sufitu — załoga jest zwolniona, żeby skończyć razem z resztą. Podniesienie tej liczby niczego nie zmieni."
                                    }
                                  >
                                    <span className="cm-line-k">
                                      sufit{isPace && <b className="cm-pace">▲</b>}
                                    </span>
                                    <NumberField
                                      key={`${project.id}-${capability}-max`}
                                      initial={cell.maxFte}
                                      label={`Maks. obsada ${CAPABILITY_LABELS[capability]} dla ${project.name}`}
                                      max={99}
                                      decimals={2}
                                      className="cm-input"
                                      placeholder="0"
                                      blankZero
                                      deferCommit
                                      selectOnFocus
                                      onCommit={(value) => setCell(project.id, capability, { maxFte: value })}
                                    />
                                  </div>

                                  <div
                                    className="cm-line cm-line-crew"
                                    title={
                                      cp
                                        ? `Załoga wyliczona przez model: ${fmt(cp.crewFte)} FTE${cp.phases.length > 1 ? " (największa z obu faz)" : ""}${cp.isBurst ? " — krótki zryw, kończy przed fazą" : ""}`
                                        : inPlan
                                          ? "Ta kompetencja nie trafiła do harmonogramu"
                                          : "Projekt poza planem — harmonogram go nie liczy"
                                    }
                                  >
                                    <span className="cm-line-k">załoga</span>
                                    <span className="cm-crew">
                                      {cp ? fmt(cp.crewFte) : "—"}
                                      {cp?.isBurst && <b className="cm-burst">*</b>}
                                    </span>
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })}
                        <div
                          className="cm-cell cm-ref"
                          title={
                            noDemand
                              ? "brak przypisanych kompetencji — projekt nie trafia do harmonogramu"
                              : `planowane jest ${fmt(sum)} dni — rozmiar ${project.estimate} sugerował ${fmt(reference)}`
                          }
                        >
                          <span className="cm-ref-nums">
                            <b className={silentlyUnscheduled ? "is-empty" : ""}>{fmt(sum)}</b>
                            <span className="cm-ref-of">/ {fmt(reference)}</span>
                          </span>
                          {/* Proportion only, never a verdict. The bar fills as
                              the row approaches the size it was given and stops
                              at full — it does not turn red past it, because a
                              row disagreeing with a T-shirt guess is the normal
                              result of estimating in detail. */}
                          <span className="cm-ref-track">
                            <span
                              className="cm-ref-fill"
                              style={{ width: `${Math.min(100, ratio * 100)}%` }}
                            />
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <footer className="atl-footer cm-footer" style={{ height: 34 }}>
        {tab === "settings" ? (
          <>
            <span>zmiany wpływają na wszystkie projekty i harmonogram od razu</span>
            <span style={{ flex: 1 }} />
            <span>esc zamyka okno</span>
          </>
        ) : (
          <>
            {/* The consequence, on the screen that causes it. Editing used to
                mean closing this window and opening the timeline to find out
                what happened. */}
            <span className="cm-horizon">
              <span className="atl-eyebrow">horyzont</span>
              <b>{fmt(schedule.horizonMonths)} mies.</b>
              {(() => {
                const delta = schedule.horizonMonths - (openingHorizon.current ?? 0);
                if (Math.abs(delta) < 0.05) return null;
                return (
                  <span
                    className={delta < 0 ? "cm-delta is-ok" : "cm-delta is-warn"}
                    title="zmiana od otwarcia tego ekranu"
                  >
                    {delta < 0 ? "−" : "+"}
                    {fmt(Math.abs(delta))}
                  </span>
                );
              })()}
            </span>
            <span className="cm-foot-rule" />
            <span className="cm-pace-tally" title="ile faz w planie ta kompetencja zatrzymuje na swoim suficie">
              tempo wyznacza:{" "}
              {paceTally.length
                ? paceTally.slice(0, 3).map(([capability, n], i) => (
                    <span key={capability}>
                      {i > 0 && " · "}
                      <b>{capability}</b>×{n}
                    </span>
                  ))
                : "—"}
            </span>
            <span className="cm-foot-rule" />
            <span title="tyle zajmie sam nakład najbardziej obciążonej kompetencji przy obecnej puli — żaden sufit tego nie przeskoczy">
              ściana <b>{fmt(floor.months)} mies.</b>
              {floor.capability ? ` (${floor.capability})` : ""}
            </span>
            <span style={{ flex: 1 }} />
            <span>tab i ↑↓ po komórkach · esc cofa zmianę, potem zamyka</span>
          </>
        )}
      </footer>

      {showProposals && tab === "days" && (
        <CeilingProposals
          api={proposal}
          projectById={projectById}
          floorMonths={floor.months}
          floorCapability={floor.capability}
          onApply={applyMoves}
          onClose={() => setShowProposals(false)}
        />
      )}
    </div>
  );
}
