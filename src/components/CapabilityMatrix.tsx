import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { Eye, EyeOff, GripVertical, HelpCircle, WandSparkles, X } from "lucide-react";
import { useCapabilityMatrix } from "../hooks/useCapabilityMatrix";
import { useCapabilitySchedule, earliestStartOffsets } from "../hooks/useCapabilitySchedule";
import { useCeilingProposal, type CeilingProposalApi } from "../hooks/useCeilingProposal";
import { useProjectCrud } from "../hooks/useProjectCrud";
import { useRoster } from "../hooks/useRoster";
import type { AutopilotInput, BlockedCandidate, CeilingMove } from "../lib/autopilot";
import { MAX_PROJECT_CEILING } from "../lib/planRules";
import { leaveFteByMonth } from "../lib/leaves";
import {
  CAPABILITY_LABELS,
  CAPABILITY_ORDER,
  CATEGORY_ORDER,
  CEILING_FTE_EPS as CEIL_EPS,
  CEILING_FTE_STEPS as CEIL_STEPS,
  ESTIMATE_ORDER,
  effectiveDaysByCapability,
  isIncludedInPlan,
  referenceEffortDays,
} from "../lib/estimation";
import { usePlanner } from "../state/plannerContext";
import type { Capability, CapabilityCell, Estimate, EstimationSettings, Project } from "../types";
import { NumberField } from "./NumberField";
import { MOD, SCREENS, fmt, fmt2, plCount } from "./timelineChrome";
import "./capabilityMatrix.css";
import {
  Gap,
  IconButton,
  Legend,
  PillButton,
  ScreenFooter,
  ScreenHeader,
  Toggle,
  UnderlineTabs,
  type ResolvedTheme,
} from "../design";

interface CapabilityMatrixProps {
  projects: Project[];
  theme: ResolvedTheme;
  /** The reverse link: when the autopilot is blocked on empty pools, the
   *  answer lives in Symulacje (transfers and hiring). */
  onOpenCompareOptimizer: () => void;
}

type Tab = "days" | "settings";

/** One colour per T-shirt size, warm as the size grows. Purely an identity
 *  aid for scanning the column — it ranks nothing the number doesn't. */
const sizeColor = (estimate: Estimate) => `var(--size-${estimate.toLowerCase()})`;

/** `fmt` renders Infinity literally, and an impossible plan produces exactly
 *  that — a dash reads as "no number to show", which is the truth. */
const fmtM = (n: number) => (Number.isFinite(n) ? fmt(n) : "—");

const signed = (n: number) => `${n >= 0 ? "+" : "−"}${fmt(Math.abs(n))}`;

/** What the scheduler made of one project × capability, folded across phases.
 *  PM and TL run in both, so the cell shows the larger crew and says so.
 *  `pacePhases` keeps WHICH phase this capability holds — inicjacja and
 *  budowa each have their own pace-setter, and the strip colours them apart. */
interface CellPlan {
  pacePhases: number[];
  crewFte: number;
  isBurst: boolean;
  phases: number[];
}

const HELP_ITEMS: { token: string; tone?: "accent" | "warn"; title: string; body: string }[] = [
  {
    token: "186",
    title: "Górna liczba: dni nakładu",
    body: "Ile dni pracy tej kompetencji wymaga projekt. To jedyna liczba, którą naprawdę szacujesz — reszta komórki z niej wynika.",
  },
  {
    token: "0,5–3",
    tone: "accent",
    title: "Pasek na dole: maksymalne obłożenie (FTE)",
    body: "Ile najwięcej osób tej kompetencji ma sens pracować równolegle. Jeden segment paska to pół etatu, zakres 0,5–3,0 — kliknij segment, aby ustawić sufit; pasek rozwija się pod kursorem i wtedy pokazuje podpisy wartości. Nie budżet, a granica sensownego zrównoleglenia: 60 dni przy max 2 FTE to około półtora miesiąca.",
  },
  {
    token: "1,4",
    title: "załoga — odpowiedź modelu",
    body: "Faktyczna liczba FTE, jaką harmonogram przydzielił. Włącz ją przełącznikiem „załoga” w nagłówku. Gwiazdka oznacza krótki zryw: strumień kończy przed fazą.",
  },
  {
    token: "▮",
    tone: "accent",
    title: "Kolor wypełnienia wyznacza tempo fazy",
    body: "Projekt biegnie w dwóch fazach: inicjacja (PM, UX, TL) i budowa (PM, TL, BE, FE, QA, SEC). W każdej dokładnie jedna kompetencja pracuje na swoim maksimum i wyznacza jej długość — fiolet oznacza tempo inicjacji, morski tempo budowy. Dlatego w jednym wierszu mogą świecić dwa paski: to dwie różne odpowiedzi. Pozostałe komórki mają zapas, ich pasek zostaje szary i jego podniesienie niczego nie zmieni.",
  },
  {
    token: "≡",
    title: "Uchwyt przy nazwie",
    body: "Przeciągnij wiersz, aby zmienić kolejność projektów w kategorii — to priorytet, w jakim harmonogram bierze projekty.",
  },
  {
    token: "0",
    tone: "warn",
    title: "Pomarańczowa komórka",
    body: "Są dni, ale maksymalne obłożenie wynosi 0 — pasek jest pusty i nie ma z czego dobrać załogi, więc ta praca nigdy nie trafi do harmonogramu. Kliknięcie segmentu paska to naprawia.",
  },
  {
    token: "⇧",
    title: "Shift + klik wyłącza komórkę",
    body: "Ustala, że kompetencja nie występuje w projekcie: komórka gaśnie na „nie dotyczy” i wypada ze wszystkich sum. Shift + klik ponownie przywraca poprzednie liczby.",
  },
  {
    token: "◉",
    tone: "accent",
    title: "Oko przy nazwie",
    body: "Wyjmuje projekt z planu. Zostaje w macierzy, ale nie liczy się do sum kolumn, horyzontu ani ściany.",
  },
  {
    token: "mies",
    title: "Stopka: horyzont",
    body: "Długość całego planu przy obecnych ustawieniach, z różnicą od momentu otwarcia ekranu — widzisz od razu, czy twoja zmiana skróciła, czy wydłużyła plan.",
  },
];

export function CapabilityMatrix({
  projects,
  theme,
  onOpenCompareOptimizer,
}: CapabilityMatrixProps) {
  const { cells, setCell } = useCapabilityMatrix();
  const { setIncludeInPlan } = useProjectCrud();
  const { settings, people, leaves, setProjects, updateEstimationSettings, setEstimateWeight } =
    usePlanner();
  const { pools } = useRoster();
  const [tab, setTab] = useState<Tab>("days");
  const [showCrew, setShowCrew] = useState(false);
  const [showProposals, setShowProposals] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

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
            pacePhases: stream.setsPace ? [stream.phase] : [],
            crewFte: stream.crewFte,
            isBurst: stream.isBurst,
            phases: [stream.phase],
          });
        } else {
          if (stream.setsPace) prev.pacePhases.push(stream.phase);
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
      // Innermost layer first: help sits above the proposals drawer.
      if (showHelp) setShowHelp(false);
      else if (showProposals) setShowProposals(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showProposals, showHelp]);

  const byCategory = useMemo(() => {
    return CATEGORY_ORDER.map((category) => ({
      category,
      projects: projects.filter((p) => p.category === category),
    })).filter((group) => group.projects.length > 0);
  }, [projects]);

  const outOfPlanCount = useMemo(
    () => projects.filter((p) => !isIncludedInPlan(p)).length,
    [projects],
  );

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
    for (const project of projects) {
      const bucket = isIncludedInPlan(project) ? planned : parked;
      for (const capability of CAPABILITY_ORDER) {
        bucket[capability] += cellDays(project.id, capability);
      }
    }
    return { planned, parked };
  }, [projects, cellDays]);

  // Months of pure demand per capability at its pool's own rate — the arithmetic
  // floor no ceiling can beat. The longest bar is the wall of the whole plan,
  // and the header wears it as a pressure gauge instead of a footer figure.
  const edpm = autopilotInput.effectiveDaysPerMonth;
  const pressure = useMemo(() => {
    const months = {} as Record<Capability, number>;
    let wall = 0;
    let wallCap: Capability | null = null;
    for (const c of CAPABILITY_ORDER) {
      const capacity = pools[c] * edpm[c];
      const m = totals.planned[c] <= 0 ? 0 : capacity > 0 ? totals.planned[c] / capacity : Infinity;
      months[c] = m;
      if (m > wall || (!Number.isFinite(m) && Number.isFinite(wall))) {
        wall = m;
        wallCap = c;
      }
    }
    const finiteMax = Math.max(1e-9, ...CAPABILITY_ORDER.map((c) => months[c]).filter(Number.isFinite));
    return { months, wall, wallCap, finiteMax };
  }, [totals, pools, edpm]);

  // "Nie dotyczy" — a capability switched off for a project. The store has no
  // notion of it beyond a zeroed cell, so the off/parked bookkeeping is this
  // session's: switching off zeroes the cell (which is what the scheduler and
  // the database mean by "off"), and the parked numbers let shift+klik bring
  // them back while the screen stays open.
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const parkedCells = useRef(new Map<string, CapabilityCell>());

  const toggleOff = useCallback(
    (projectId: string, capability: Capability) => {
      const key = `${projectId}:${capability}`;
      if (excluded.has(key)) {
        const restore = parkedCells.current.get(key);
        parkedCells.current.delete(key);
        if (restore && (restore.days > 0 || restore.maxFte > 0)) {
          setCell(projectId, capability, restore);
        }
        setExcluded((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      } else {
        const cell = cells[projectId]?.[capability] ?? { days: 0, maxFte: 0 };
        parkedCells.current.set(key, cell);
        if (cell.days !== 0 || cell.maxFte !== 0) {
          setCell(projectId, capability, { days: 0, maxFte: 0 });
        }
        setExcluded((prev) => new Set(prev).add(key));
      }
    },
    [cells, excluded, setCell],
  );

  // Drag reorder, gated on the grip: rows are full of inputs, and a row-level
  // draggable would turn every text selection into a drag. The grip arms it,
  // the row carries it, and a drop lands the project before its target within
  // the global order — the grid is grouped, so cross-category drops are
  // meaningless and refused.
  const dragArmed = useRef(false);
  const dragId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const moveBefore = useCallback(
    (fromId: string | null, targetId: string) => {
      if (!fromId || fromId === targetId) return;
      const from = projectById.get(fromId);
      const target = projectById.get(targetId);
      if (!from || !target || from.category !== target.category) return;
      const next = projects.filter((p) => p.id !== fromId);
      next.splice(next.findIndex((p) => p.id === targetId), 0, from);
      setProjects(next);
    },
    [projectById, projects, setProjects],
  );

  // Vertical movement, grid convention. Tab already walks a row correctly and
  // left/right stay with the caret, where a text input needs them. Moving
  // focus is what commits the field being left: see NumberField's deferCommit.
  // The walk keeps going past rows with no landing spot — a max column skips
  // rows whose cell has no effort, and any column skips a cell parked as
  // "nie dotyczy" — otherwise Enter silently stops at the first such row.
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
    const rowCount = Object.keys(rowIndexById).length;
    for (let row = Number(from.dataset.cmRow) + step; row >= 0 && row < rowCount; row += step) {
      // The days column lands on its input; the ceiling column lands on the
      // strip's one tabbable slot (the roving-tabindex current value).
      const next = gridRef.current?.querySelector<HTMLElement>(
        `[data-cm-row="${row}"][data-cm-col="${from.dataset.cmCol}"] :is(input, button[tabindex="0"])`,
      );
      if (next) {
        event.preventDefault();
        next.focus();
        return;
      }
    }
  }

  // Left/right walk the strip's six stops without committing anything — the
  // standard radio-group roving pattern. Space (or a click) commits; Enter
  // stays with the grid convention above and moves down a row.
  function handleSlotKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    const slots = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
    const index = slots.indexOf(event.target as HTMLButtonElement);
    const next = index === -1 ? undefined : slots[index + step];
    if (next) {
      event.preventDefault();
      next.focus();
    }
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
  const horizonDelta = schedule.horizonMonths - (openingHorizon.current ?? 0);
  const showHorizonDelta = Number.isFinite(horizonDelta) && Math.abs(horizonDelta) >= 0.05;
  const plannedDaysTotal = CAPABILITY_ORDER.reduce((sum, c) => sum + totals.planned[c], 0);

  return (
    <div className="cm2" data-theme={theme}>
      <ScreenHeader
        eyebrow="Wyceny"
        value={fmt(plannedDaysTotal)}
        unit="dni nakładu"
        actions={
          <>
            {tab === "days" && (
              <>
                <Toggle
                  checked={showCrew}
                  onChange={setShowCrew}
                  title="Pokaż wyliczoną przez model załogę pod każdym sufitem"
                >
                  załoga
                </Toggle>
                <PillButton
                  icon={<WandSparkles size={13} strokeWidth={1.75} />}
                  active={showProposals}
                  onClick={() => setShowProposals((v) => !v)}
                  title="Znajdź sufity, których podniesienie faktycznie skraca plan"
                  aria-expanded={showProposals}
                >
                  Propozycje sufitów
                </PillButton>
              </>
            )}
            <UnderlineTabs
              label="Zakładki wycen"
              value={tab}
              onChange={setTab}
              items={[
                { id: "days" as const, label: "dni nakładu" },
                { id: "settings" as const, label: "ustawienia" },
              ]}
            />
            <IconButton
              label="Jak czytać ten ekran"
              size="lg"
              filled
              active={showHelp}
              onClick={() => setShowHelp((v) => !v)}
              aria-expanded={showHelp}
            >
              <HelpCircle size={13} strokeWidth={1.75} />
            </IconButton>
          </>
        }
      >
        Jasność komórki niesie ciężar wyceny, więc wąskie gardła widać bez czytania liczb.
        Pasek pod liczbą to sufit obłożenia.{" "}
        {plCount(projects.length, "projekt", "projekty", "projektów")}, {outOfPlanCount} poza
        planem.
      </ScreenHeader>

      {tab === "settings" ? (
        <div className="cm2-settings">
          <section className="cm2-card">
            <h4>Wagi rozmiarów</h4>
            <p className="cm2-card-hint">Dni pracy projektu = waga rozmiaru × dni na jednostkę wagi.</p>
            {ESTIMATE_ORDER.map((estimate) => (
              <div
                className="cm2-card-row"
                key={estimate}
                style={{ "--pill": sizeColor(estimate) } as CSSProperties}
              >
                <span className="cm2-size">{estimate}</span>
                <NumberField
                  key={`weight-${estimate}`}
                  initial={settings.estimateValues[estimate]}
                  label={`Waga rozmiaru ${estimate}`}
                  max={9999}
                  variant="form"
                  className="cm2-field"
                  deferCommit
                  selectOnFocus
                  onCommit={(value) => setEstimateWeight(estimate as Estimate, value)}
                />
                <span className="cm2-card-preview">
                  = {fmt(settings.estimateValues[estimate] * settings.daysPerValue)} dni
                </span>
                <span style={{ flex: 1 }} />
                <span className="cm2-weight-track">
                  <span
                    className="cm2-weight-fill"
                    style={{ width: `${(settings.estimateValues[estimate] / maxWeight) * 100}%` }}
                  />
                </span>
              </div>
            ))}
          </section>

          <section className="cm2-card">
            <h4>Parametry</h4>
            <div className="cm2-card-row">
              <span className="cm2-card-label">dni na jednostkę wagi</span>
              <NumberField
                initial={settings.daysPerValue}
                label="Dni na jednostkę wagi"
                max={999}
                variant="form"
                className="cm2-field"
                deferCommit
                selectOnFocus
                onCommit={(value) => patchSettings({ daysPerValue: value })}
              />
            </div>
            <div className="cm2-card-row">
              <span className="cm2-card-label">dni robocze w miesiącu</span>
              <NumberField
                initial={settings.workingDaysPerMonth}
                label="Dni robocze w miesiącu"
                max={31}
                decimals={1}
                variant="form"
                className="cm2-field"
                deferCommit
                selectOnFocus
                onCommit={(value) => patchSettings({ workingDaysPerMonth: value })}
              />
            </div>
            <p className="cm2-card-note">
              Produktywność nie jest już jedną liczbą dla wszystkich — ustawiasz ją{" "}
              <b>osobno dla każdej osoby</b> w ekranie Zespół. Pula kompetencji nadal liczy osoby;
              produktywność zmienia <i>tempo</i>, w jakim jedno FTE przerabia nakład, i każda
              kompetencja ma własne. Tutaj zostaje sam kalendarz:{" "}
              <b>{fmt(settings.workingDaysPerMonth)}</b> dni roboczych na miesiąc.
            </p>
          </section>

          <section className="cm2-card">
            <h4>Minimalna obsada</h4>
            <p className="cm2-card-hint">
              Faza projektu nie startuje, dopóki <i>każda</i> potrzebna kompetencja nie ma wolnego co
              najmniej tego ułamka wyliczonej załogi — a gdy już wystartuje, cała załoga schodzi i
              wraca <i>razem</i>, jednym wspólnym współczynnikiem, więc strumienie nigdy się nie
              rozjeżdżają.
            </p>
            <div className="cm2-card-row">
              <span className="cm2-card-label">minimalna obsada (0–1)</span>
              <NumberField
                initial={settings.minStaffingFraction}
                label="Minimalna obsada jako ułamek wyliczonej załogi"
                min={0.05}
                max={1}
                decimals={2}
                variant="form"
                className="cm2-field"
                deferCommit
                selectOnFocus
                onCommit={(value) => patchSettings({ minStaffingFraction: value })}
              />
              <span className="cm2-card-preview">
                np. załoga 3 FTE → start od {fmt(3 * settings.minStaffingFraction)} FTE
              </span>
            </div>
            <p className="cm2-card-note">
              Im wyżej, tym uczciwsze daty i mniej projektów w toku — ale dłuższe kolejki i więcej
              bezczynnych FTE. <b>1</b> oznacza „nic nie startuje bez pełnej obsady".
            </p>
          </section>

          <section className="cm2-card">
            <h4>Próg krótkiego zrywu</h4>
            <p className="cm2-card-hint">
              Kompetencja, której wyliczone FTE spadłoby poniżej tego progu, nie jest rozciągana na
              całą fazę — idzie krótkim zrywem i kończy wcześniej. 4 dni bezpieczeństwa rozmazane na
              pięciomiesięczną budowę to 0,06 FTE, czyli liczba, która niczego nie opisuje.
            </p>
            <div className="cm2-card-row">
              <span className="cm2-card-label">próg (FTE)</span>
              <NumberField
                initial={settings.minCrewFte}
                label="Najmniejsze FTE, jakie wolno rozłożyć na całą fazę"
                min={0.01}
                max={1}
                decimals={2}
                variant="form"
                className="cm2-field"
                deferCommit
                selectOnFocus
                onCommit={(value) => patchSettings({ minCrewFte: value })}
              />
              <span className="cm2-card-preview">
                poniżej {fmt(settings.minCrewFte)} FTE → krótki zryw
              </span>
            </div>
            <p className="cm2-card-note">
              To jedyne miejsce, w którym strumień może skończyć przed swoją fazą. Zryw jest w
              macierzy oznaczony gwiazdką przy załodze.
            </p>
          </section>
        </div>
      ) : (
        <div className="cm2-scroll">
          <div className="cm2-canvas" ref={gridRef} onKeyDown={handleGridKeyDown}>
            <div className="cm2-cols">
              <div className="cm2-cols-name" />

              {CAPABILITY_ORDER.map((capability) => {
                const months = pressure.months[capability];
                const isWall = capability === pressure.wallCap;
                const poolNote = `pula ${fmt2(pools[capability])} FTE`;
                const parkedNote =
                  totals.parked[capability] > 0
                    ? ` · ${fmt(totals.parked[capability])} dni poza planem`
                    : "";
                return (
                  <div
                    key={capability}
                    className="cm2-col"
                    title={`${CAPABILITY_LABELS[capability]} — ${fmt(totals.planned[capability])} dni w planie · ${poolNote} → ${fmtM(months)} mies.${parkedNote}${isWall ? " · to jest ściana planu" : ""}`}
                  >
                    <div className="cm2-col-top">
                      <span className="cm2-col-cap">{CAPABILITY_LABELS[capability]}</span>
                      <span className={`cm2-col-months ${isWall ? "is-wall" : ""}`}>
                        {fmt(totals.planned[capability])}
                      </span>
                    </div>
                    <div
                      className="cm2-pressure"
                      title={`${fmtM(months)} mies. samego nakładu przy puli ${fmt2(pools[capability])} FTE`}
                    >
                      <div
                        className={`cm2-pressure-fill ${isWall ? "is-wall" : ""}`}
                        style={{
                          width: `${
                            Number.isFinite(months)
                              ? Math.min(100, (months / pressure.finiteMax) * 100)
                              : 100
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
              <div className="cm2-cols-ref">suma</div>
            </div>

            {byCategory.map(({ category, projects: catProjects }) => {
              const plannedRows = catProjects.filter(isIncludedInPlan);
              const categoryDays = plannedRows.reduce((sum, p) => sum + rowTotal(p.id), 0);
              return (
                <div key={category}>
                  <div className="cm2-band">
                    <b>{category}</b>
                    <span className="cm2-band-meta">
                      {plCount(catProjects.length, "projekt", "projekty", "projektów")}
                    </span>
                    <span style={{ flex: 1 }} />
                    <span className="cm2-band-meta">{fmt(categoryDays)} dni w planie</span>
                  </div>

                  {catProjects.map((project) => {
                    const row = cells[project.id];
                    const sum = rowTotal(project.id);
                    // Shown next to the sum as context, never compared against
                    // it: the T-shirt size is a rough guess made before anyone
                    // looked at the detail, and the detail is what gets
                    // scheduled.
                    const reference = referenceEffortDays(project, settings);
                    const ratio = reference > 0 ? sum / reference : 0;
                    const noDemand = sum <= 0;
                    const inPlan = isIncludedInPlan(project);
                    const silentlyUnscheduled = noDemand && inPlan;
                    return (
                      <div
                        className={`cm2-row ${inPlan ? "" : "is-out-of-plan"} ${
                          dragOverId === project.id ? "is-drop-target" : ""
                        }`}
                        key={project.id}
                        draggable
                        onDragStart={(e: DragEvent<HTMLDivElement>) => {
                          if (!dragArmed.current) {
                            e.preventDefault();
                            return;
                          }
                          if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
                          dragId.current = project.id;
                        }}
                        onDragOver={(e: DragEvent<HTMLDivElement>) => {
                          const from = dragId.current ? projectById.get(dragId.current) : null;
                          if (!from || from.category !== project.category) return;
                          e.preventDefault();
                          if (dragOverId !== project.id) setDragOverId(project.id);
                        }}
                        onDrop={(e: DragEvent<HTMLDivElement>) => {
                          e.preventDefault();
                          moveBefore(dragId.current, project.id);
                          dragId.current = null;
                          dragArmed.current = false;
                          setDragOverId(null);
                        }}
                        onDragEnd={() => {
                          dragId.current = null;
                          dragArmed.current = false;
                          setDragOverId(null);
                        }}
                      >
                        <div className="cm2-name" title={project.description || project.name}>
                          <span
                            className="cm2-grip"
                            title="Przeciągnij, aby zmienić kolejność projektów w kategorii"
                            onPointerDown={() => {
                              dragArmed.current = true;
                            }}
                            onPointerUp={() => {
                              dragArmed.current = false;
                            }}
                          >
                            <GripVertical size={12} />
                          </span>
                          <button
                            type="button"
                            className="cm2-plan-toggle"
                            aria-pressed={inPlan}
                            aria-label={
                              inPlan
                                ? `Wyjmij ${project.name} z planu`
                                : `Dodaj ${project.name} do planu`
                            }
                            title={
                              inPlan
                                ? "W planie — kliknij, aby wyjąć z harmonogramu"
                                : "Poza planem — kliknij, aby przywrócić do harmonogramu"
                            }
                            onClick={() => setIncludeInPlan(project.id, !inPlan)}
                          >
                            {inPlan ? <Eye size={14} /> : <EyeOff size={14} />}
                          </button>
                          <span
                            className="cm2-size"
                            style={{ "--pill": sizeColor(project.estimate) } as CSSProperties}
                            title={`rozmiar ${project.estimate} — sugeruje ${fmt(reference)} dni`}
                          >
                            {project.estimate}
                          </span>
                          <span className="cm2-name-text">{project.name}</span>
                        </div>

                        {CAPABILITY_ORDER.map((capability) => {
                          // A project parked outside the plan keeps only its
                          // name row — no numbers, no strip. The eye at the
                          // name brings it back, and everything reappears.
                          if (!inPlan) {
                            return (
                              <div
                                key={capability}
                                className="cm2-cell"
                                title={`${project.name} — poza planem. Kliknij oko przy nazwie, aby przywrócić do harmonogramu.`}
                              />
                            );
                          }
                          const cell = row?.[capability] ?? { days: 0, maxFte: 0 };
                          const days = cellDays(project.id, capability);
                          const off = excluded.has(`${project.id}:${capability}`);
                          const flagged = !off && days > 0 && cell.maxFte <= 0;
                          const cp = cellPlan.get(`${project.id}:${capability}`);
                          const isPace1 = cp?.pacePhases.includes(1) ?? false;
                          const isPace2 = cp?.pacePhases.includes(2) ?? false;
                          const isPace = isPace1 || isPace2;
                          // The strip's roving tabindex: the slot holding the
                          // current ceiling is the one Tab (and the grid walk)
                          // lands on; with no on-grid value, the first slot is.
                          const ceilCurrent = CEIL_STEPS.find(
                            (v) => Math.abs(cell.maxFte - v) < CEIL_EPS,
                          );
                          // v5 reads effort as a monochrome heat wash: the
                          // weight of the estimate as lightness, saturating
                          // around the heaviest single cells in the portfolio.
                          const heat =
                            !off && !flagged && days > 0
                              ? `rgba(var(--heat-ch), ${(0.022 + Math.min(0.18, (days / 420) * 0.18)).toFixed(3)})`
                              : undefined;
                          return (
                            <div
                              key={capability}
                              className={`cm2-cell ${off ? "is-off" : ""} ${flagged ? "is-flagged" : ""}`}
                              style={heat ? ({ "--heat": heat } as CSSProperties) : undefined}
                              onClick={(e) => {
                                if (e.shiftKey) {
                                  e.preventDefault();
                                  toggleOff(project.id, capability);
                                }
                              }}
                              title={
                                off
                                  ? `${project.name} · ${CAPABILITY_LABELS[capability]} — wyłączona (shift + klik przywraca)`
                                  : days > 0
                                    ? flagged
                                      ? `${project.name} · ${CAPABILITY_LABELS[capability]} — ${fmt(days)} dni, brak maksymalnego obłożenia: bez niego nie da się dobrać załogi. Shift + klik wyłącza tę kompetencję.`
                                      : `${project.name} · ${CAPABILITY_LABELS[capability]} — ${fmt(days)} dni nakładu. Shift + klik wyłącza tę kompetencję w projekcie.`
                                    : `${project.name} · ${CAPABILITY_LABELS[capability]} — brak nakładu. Shift + klik wyłącza tę kompetencję w projekcie.`
                              }
                            >
                              {off ? (
                                <div
                                  className="cm2-cell-off"
                                  title={`${project.name} · ${CAPABILITY_LABELS[capability]} — ta kompetencja nie występuje w projekcie. Shift + klik przywraca ją z poprzednimi liczbami.`}
                                >
                                  nie dotyczy
                                </div>
                              ) : (
                                <>
                                  <div
                                    className="cm2-days"
                                    data-cm-row={rowIndexById[project.id]}
                                    data-cm-col={`${capability}:days`}
                                  >
                                    <NumberField
                                      subject={`${project.id}-${capability}-days`}
                                      initial={cell.days}
                                      label={`Dni nakładu ${CAPABILITY_LABELS[capability]} dla ${project.name}`}
                                      max={9999}
                                      variant="grid"
                                      className="cm2-input"
                                      placeholder="0"
                                      blankZero
                                      deferCommit
                                      selectOnFocus
                                      onCommit={(value) =>
                                        setCell(project.id, capability, { days: value })
                                      }
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
                                    {days > 0 && <span className="cm2-days-unit">dni</span>}
                                  </div>

                                  {days > 0 && (
                                    <>
                                      {showCrew && (
                                        <div
                                          className="cm2-crew"
                                          title={
                                            cp
                                              ? `Załoga wyliczona przez model: ${fmt2(cp.crewFte)} FTE${cp.phases.length > 1 ? " (największa z obu faz)" : ""}${cp.isBurst ? " — krótki zryw, kończy przed fazą" : ""}`
                                              : inPlan
                                                ? "Ta kompetencja nie trafiła do harmonogramu"
                                                : "Projekt poza planem — harmonogram go nie liczy"
                                          }
                                        >
                                          <span className="cm2-crew-k">załoga</span>
                                          <span className={`cm2-crew-v ${isPace ? "is-pace" : ""}`}>
                                            {cp ? `${fmt2(cp.crewFte)}${cp.isBurst ? "*" : ""}` : "—"}
                                          </span>
                                        </div>
                                      )}

                                      <div
                                        className={`cm2-ceil ${isPace1 ? "is-pace1" : ""} ${isPace2 ? "is-pace2" : ""} ${flagged ? "is-flagged" : ""}`}
                                        data-cm-row={rowIndexById[project.id]}
                                        data-cm-col={`${capability}:ceil`}
                                        role="radiogroup"
                                        aria-label={`Maksymalne obłożenie ${CAPABILITY_LABELS[capability]} (FTE) dla ${project.name}`}
                                        onKeyDown={handleSlotKeyDown}
                                      >
                                        {CEIL_STEPS.map((v) => {
                                          const on = cell.maxFte >= v - CEIL_EPS;
                                          const current = ceilCurrent === v;
                                          return (
                                            <button
                                              key={v}
                                              type="button"
                                              role="radio"
                                              aria-checked={current}
                                              tabIndex={
                                                current ||
                                                (ceilCurrent === undefined && v === CEIL_STEPS[0])
                                                  ? 0
                                                  : -1
                                              }
                                              className={`cm2-slot ${on ? "is-on" : ""} ${current ? "is-current" : ""}`}
                                              title={`Ustaw maksymalne obłożenie ${CAPABILITY_LABELS[capability]} na ${fmt(v)} FTE.${
                                                isPace
                                                  ? ` Ta kompetencja pracuje na maksimum i wyznacza długość ${
                                                      isPace1 && isPace2
                                                        ? "obu faz"
                                                        : isPace1
                                                          ? "fazy inicjacji"
                                                          : "fazy budowy"
                                                    } — podniesienie jej sufitu skróci projekt.`
                                                  : ""
                                              }`}
                                              onClick={(e) => {
                                                // Shift + klik belongs to the cell: toggle off.
                                                if (e.shiftKey) return;
                                                setCell(project.id, capability, { maxFte: v });
                                              }}
                                            >
                                              {current ? fmt(v) : v % 1 === 0 ? v : ""}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </>
                                  )}
                                </>
                              )}
                            </div>
                          );
                        })}

                        {inPlan ? (
                          <div
                            className="cm2-ref"
                            title={
                              noDemand
                                ? "brak przypisanych kompetencji — projekt nie trafia do harmonogramu"
                                : `planowane jest ${fmt(sum)} dni — rozmiar ${project.estimate} sugerował ${fmt(reference)}`
                            }
                          >
                            <div className="cm2-ref-nums">
                              <b className={silentlyUnscheduled ? "is-warn" : ""}>{fmt(sum)}</b>
                            </div>
                            <div className="cm2-ref-track">
                              <div
                                className="cm2-ref-fill"
                                style={{ width: `${Math.min(100, ratio * 100)}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="cm2-ref" />
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "settings" ? (
        <ScreenFooter>
          <span>zmiany wpływają na wszystkie projekty i harmonogram od razu</span>
          <Gap />
          <span>
            {MOD}1…{MOD}{SCREENS.length} przeskakuje między widokami
          </span>
        </ScreenFooter>
      ) : (
        <ScreenFooter>
          <Legend color="rgba(var(--heat-ch), 0.04)">lekka wycena</Legend>
          <Legend color="rgba(var(--heat-ch), 0.20)">ciężka wycena</Legend>
          {/* Every project runs two phases and each has its own pace-setter,
              so a row can carry two coloured strips. The legend says which is
              which — otherwise "two purples" reads as a bug. */}
          <Legend color="var(--accent)">tempo inicjacji</Legend>
          <Legend color="var(--pace2)">tempo budowy</Legend>
          <span className="cm2-horizon" title="ile potrwa cały plan przy obecnych sufitach i puli">
            <span className="cm2-eyebrow">horyzont</span>
            <b>{fmtM(schedule.horizonMonths)} mies.</b>
            {showHorizonDelta && (
              <span
                className={`cm2-delta ${horizonDelta < 0 ? "is-ok" : "is-warn"}`}
                title="zmiana od otwarcia tego ekranu"
              >
                {signed(horizonDelta)}
              </span>
            )}
          </span>
          <Gap />
          <span
            className="cm2-tally"
            title="ile faz w planie ta kompetencja zatrzymuje na swoim maksymalnym obłożeniu"
          >
            <span>tempo wyznacza</span>
            {paceTally.length ? (
              paceTally.slice(0, 3).map(([capability, n]) => (
                <span className="cm2-tally-item" key={capability}>
                  <b>{capability}</b>
                  <span>×{n}</span>
                </span>
              ))
            ) : (
              <span>—</span>
            )}
          </span>
        </ScreenFooter>
      )}

      {showHelp && (
        <aside className="cm2-drawer is-help" aria-label="Jak czytać ten ekran">
          <header className="cm2-drawer-head">
            <div className="cm2-drawer-title">
              <b>Jak czytać ten ekran</b>
              <span className="cm2-drawer-sub">nakład · maksymalne obłożenie · załoga</span>
            </div>
            <button
              type="button"
              className="cm2-drawer-close"
              onClick={() => setShowHelp(false)}
              aria-label="Zamknij pomoc"
            >
              <X size={15} />
            </button>
          </header>
          <div className="cm2-drawer-body cm2-help-body">
            {HELP_ITEMS.map((item) => (
              <div className="cm2-help-item" key={item.token}>
                <span className={`cm2-help-token ${item.tone ? `is-${item.tone}` : ""}`}>
                  {item.token}
                </span>
                <div className="cm2-help-text">
                  <b>{item.title}</b>
                  <span>{item.body}</span>
                </div>
              </div>
            ))}
            <p className="cm2-help-outro">
              Kolejność jest zawsze ta sama: wpisujesz <b>dni</b>, ustawiasz <b>max</b>, a model
              odpowiada <b>załogą</b> i horyzontem w stopce. Nic tu nie liczy się „na boku" — każda
              zmiana od razu przelicza cały portfel.
            </p>
          </div>
        </aside>
      )}

      {showProposals && tab === "days" && (
        <ProposalsDrawer
          api={proposal}
          projectById={projectById}
          onApply={applyMoves}
          onClose={() => setShowProposals(false)}
          onOpenCompareOptimizer={onOpenCompareOptimizer}
        />
      )}
    </div>
  );
}

/**
 * The autopilot's output, as a list of claims you accept one at a time.
 *
 * Deliberately not a button that rewrites the matrix. Every move here is the
 * machine asserting that more people could usefully work on something — it has
 * not seen the codebase, the onboarding cost, or whether the work splits at
 * all. So it proposes, shows what each one buys, and waits.
 */
function ProposalsDrawer({
  api,
  projectById,
  onApply,
  onClose,
  onOpenCompareOptimizer,
}: {
  api: CeilingProposalApi;
  projectById: Map<string, Project>;
  onApply: (moves: CeilingMove[]) => void;
  onClose: () => void;
  onOpenCompareOptimizer: () => void;
}) {
  const { status, result, found, accepted, previewHorizon } = api;
  const nameOf = (id: string) => projectById.get(id)?.name ?? id;

  const before = result?.horizonBefore ?? 0;
  const preview = previewHorizon ?? before;
  // With an impossible project in the plan both horizons are Infinity and the
  // difference is NaN — a dash says more than either would.
  const finiteDelta = Number.isFinite(before) && Number.isFinite(preview);
  const delta = finiteDelta ? preview - before : 0;
  const improved = finiteDelta && delta < -0.005;

  return (
    <aside className="cm2-drawer is-proposals" aria-label="Propozycje sufitów">
      <header className="cm2-drawer-head">
        <div className="cm2-drawer-title">
          <b>Propozycje sufitów</b>
          <span className="cm2-drawer-sub">tylko kompetencje, które wyznaczają tempo</span>
        </div>
        <button
          type="button"
          className="cm2-drawer-close"
          onClick={onClose}
          aria-label="Zamknij propozycje"
        >
          <X size={15} />
        </button>
      </header>

      {status === "idle" && (
        <div className="cm2-drawer-body cm2-prop-intro">
          <p>
            Szukam sufitów, których podniesienie faktycznie coś zmienia. W fazie tylko jedna
            kompetencja jest na swoim suficie — reszta i tak zwalnia, żeby skończyć razem, więc
            podnoszenie ich niczego nie przyspieszy.
          </p>
          <p className="is-muted">
            Nic nie zostanie zapisane, dopóki sam nie zatwierdzisz. Każda propozycja to twierdzenie
            „tu da się sensownie dołożyć ludzi" — tego program nie jest w stanie sprawdzić.
          </p>
          <div>
            <button type="button" className="cm2-primary" onClick={api.run}>
              Szukaj propozycji
            </button>
          </div>
        </div>
      )}

      {status === "running" && (
        <div className="cm2-drawer-body cm2-prop-intro">
          <p>
            <span className="cm2-spinner" aria-hidden="true" />
            Przeliczam plan od nowa dla każdej kandydatki…
          </p>
          <p className="is-muted">
            {plCount(found, "ruch", "ruchy", "ruchów")} znalezione. Każda runda to pełna symulacja
            całego portfela.
          </p>
          <div>
            <button type="button" className="cm2-ghost" onClick={api.cancel}>
              Przerwij
            </button>
          </div>
        </div>
      )}

      {status === "ready" && result && (
        <>
          <div className="cm2-prop-summary">
            <div className="cm2-prop-fig">
              <span className="cm2-eyebrow">teraz</span>
              <b>{Number.isFinite(before) ? `${fmt(before)} mies.` : "—"}</b>
            </div>
            <div className="cm2-prop-arrow" aria-hidden="true">
              →
            </div>
            <div className="cm2-prop-fig">
              <span className="cm2-eyebrow">po przyjętych</span>
              <b className={improved ? "is-ok" : ""}>
                {Number.isFinite(preview) ? `${fmt(preview)} mies.` : "—"}
              </b>
            </div>
            <div className="cm2-prop-fig is-end">
              <span className="cm2-eyebrow">różnica</span>
              <b className={improved ? "is-ok" : ""}>
                {finiteDelta ? (Math.abs(delta) < 0.05 ? "0" : signed(delta)) : "—"}
              </b>
            </div>
          </div>

          <div className="cm2-drawer-body">
            {result.moves.length === 0 ? (
              <p className="cm2-prop-none">
                Nie ma czego podnosić — każda kompetencja wyznaczająca tempo albo nie ma już kogo
                dołożyć, albo dołożenie ludzi wydłużyłoby plan.
              </p>
            ) : (
              <div className="cm2-prop-list">
                {result.moves.map((move, index) => {
                  const on = accepted.has(index);
                  const planGain = move.deltaHorizon < -0.005;
                  return (
                    <div
                      className={`cm2-prop-row ${on ? "is-on" : ""}`}
                      key={`${move.projectId}-${move.capability}-${index}`}
                    >
                      <button
                        type="button"
                        className="cm2-prop-check"
                        onClick={() => api.toggle(index)}
                        aria-label={`Przyjmij podniesienie maksymalnego obłożenia ${move.capability} w ${nameOf(move.projectId)}`}
                        aria-pressed={on}
                      >
                        {on ? "✓" : ""}
                      </button>
                      <div className="cm2-prop-main">
                        <span className="cm2-prop-name" title={nameOf(move.projectId)}>
                          {nameOf(move.projectId)}
                        </span>
                        <div className="cm2-prop-move">
                          <b>{move.capability}</b>
                          <span>
                            max {fmt2(move.from)} → {fmt2(move.to)} FTE
                          </span>
                        </div>
                        <span className="cm2-prop-note">
                          projekt {signed(move.deltaProject)} mies. · pula {fmt2(move.pool)} FTE
                        </span>
                      </div>
                      <span
                        className="cm2-prop-gain"
                        title={
                          planGain
                            ? "o tyle skraca się cały portfel"
                            : "skraca sam projekt — horyzont portfela bez zmian"
                        }
                      >
                        {planGain ? `−${fmt(Math.abs(move.deltaHorizon))} mies.` : "±0 mies."}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {result.truncated && (
              <p className="cm2-prop-footnote">
                Zatrzymałem się po {result.moves.length} ruchach. Zatwierdź te i uruchom ponownie —
                po każdej zmianie tempo przechodzi gdzie indziej.
              </p>
            )}

            <BlockedRows blocked={result.blocked} nameOf={nameOf} />

            {result.blocked.some((b) => b.reason === "pool") && (
              <div className="cm2-prop-section">
                <button type="button" className="cm2-ghost" onClick={onOpenCompareOptimizer}>
                  <span className="cm2-spark">✦</span> Nie ma kogo dołożyć? Plan zatrudnienia —
                  Symulacje
                </button>
              </div>
            )}

            <p className="cm2-prop-footnote">
              {plCount(result.simulations, "symulacja", "symulacje", "symulacji")} całego portfela.
            </p>
          </div>

          {api.stale && (
            <p className="cm2-prop-stale">Macierz zmieniła się od wyliczenia — uruchom ponownie.</p>
          )}

          <footer className="cm2-prop-foot">
            <span className="cm2-prop-count">
              {accepted.size === 0
                ? "nic nie zostanie zapisane, dopóki nie zatwierdzisz"
                : `${plCount(accepted.size, "ruch", "ruchy", "ruchów")} do zapisania`}
            </span>
            <button type="button" className="cm2-ghost" onClick={onClose}>
              Odrzuć
            </button>
            <button
              type="button"
              className="cm2-primary"
              disabled={accepted.size === 0 || api.stale}
              onClick={() => onApply(api.acceptedMoves())}
            >
              Zastosuj
            </button>
          </footer>
        </>
      )}
    </aside>
  );
}

/** Why the search stopped, folded into the design's one-line-per-fact list.
 *  "pula UX = 1 — nie ma kogo dołożyć" is the actual answer to why the plan
 *  is not shorter, and no amount of searching will change it. */
function BlockedRows({
  blocked,
  nameOf,
}: {
  blocked: BlockedCandidate[];
  nameOf: (id: string) => string;
}) {
  const rows: { key: string; cap: string; reason: string; title?: string }[] = [];

  const pool = blocked.filter((b) => b.reason === "pool");
  const byCapability = new Map<string, BlockedCandidate[]>();
  for (const b of pool) {
    const list = byCapability.get(b.capability);
    if (list) list.push(b);
    else byCapability.set(b.capability, [b]);
  }
  for (const [capability, items] of [...byCapability.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    rows.push({
      key: `pool-${capability}`,
      cap: capability,
      reason: `pula ${fmt2(items[0].pool)} FTE — ${plCount(items.length, "projekt czeka", "projekty czekają", "projektów czeka")}, nie ma kogo dołożyć`,
      title: items.map((i) => nameOf(i.projectId)).join("\n"),
    });
  }

  const forbidden = blocked.filter((b) => b.reason === "forbidden");
  const forbiddenByCapability = new Map<string, BlockedCandidate[]>();
  for (const b of forbidden) {
    const list = forbiddenByCapability.get(b.capability);
    if (list) list.push(b);
    else forbiddenByCapability.set(b.capability, [b]);
  }
  for (const [capability, items] of forbiddenByCapability) {
    rows.push({
      key: `forbidden-${capability}`,
      cap: capability,
      reason: "najwyżej 1 osoba na projekt — zasada zespołu, sufitu nie podnosimy",
      title: items.map((i) => nameOf(i.projectId)).join("\n"),
    });
  }

  const atLimit = blocked.filter((b) => b.reason === "max-ceiling");
  if (atLimit.length > 0) {
    rows.push({
      key: "max-ceiling",
      cap: [...new Set(atLimit.map((b) => b.capability))].join(", "),
      reason: `sufit już na granicy ${fmt2(MAX_PROJECT_CEILING)} os. na projekt — więcej naraz nie ma sensu`,
      title: [...new Set(atLimit.map((b) => nameOf(b.projectId)))].join("\n"),
    });
  }

  const worse = blocked.filter((b) => b.reason === "worse");
  if (worse.length > 0) {
    rows.push({
      key: "worse",
      cap: "—",
      reason: `${plCount(worse.length, "kandydatka wydłużyłaby", "kandydatki wydłużyłyby", "kandydatek wydłużyłoby")} plan — projekt dłużej czeka na wolną załogę, niż zyskuje na budowie`,
    });
  }

  const impossibleNames = [
    ...new Set(blocked.filter((b) => b.reason === "impossible").map((b) => nameOf(b.projectId))),
  ];
  if (impossibleNames.length > 0) {
    rows.push({
      key: "impossible",
      cap: "—",
      reason: `${plCount(impossibleNames.length, "projekt nie domyka się", "projekty nie domykają się", "projektów nie domyka się")} przy obecnych pulach — pomoże dopiero większa pula`,
      title: impossibleNames.join("\n"),
    });
  }

  const noEffect = blocked.filter((b) => b.reason === "no-effect");
  if (noEffect.length > 0) {
    rows.push({
      key: "no-effect",
      cap: "—",
      reason: `${plCount(noEffect.length, "kandydatka bez efektu", "kandydatki bez efektu", "kandydatek bez efektu")} — tempo i tak wyznacza inna kompetencja`,
    });
  }

  if (rows.length === 0) return null;

  return (
    <div className="cm2-prop-section">
      <span className="cm2-eyebrow">zablokowane</span>
      {rows.map((row) => (
        <div className="cm2-blocked-row" key={row.key} title={row.title}>
          <b>{row.cap}</b>
          <span>{row.reason}</span>
        </div>
      ))}
    </div>
  );
}
