/**
 * Obsada: three screens over one set of facts, behind one button.
 *
 * The plan — who is needed, when, and how many — comes entirely from
 * `simulateCapabilitySchedule`. Nothing here writes back into it: assigning a
 * named person to a demand item cannot move a date, because dates come from
 * pools and the crew model (leaves reach it separately, as monthly pool dips
 * via `lib/leaves.ts`). What obsada adds is the layer the scheduler
 * deliberately doesn't model — *which* of the four PMs, and what their leave
 * that week does to this particular posting.
 *
 * The three views are the same data asked three different questions:
 *   Ludzie      — is anyone over-committed, and who has room?
 *   Projekty    — is every project's plan actually covered by real people?
 *   Obsadzanie  — close one specific hole, with the best candidate for it.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { useCapabilitySchedule } from "../../hooks/useCapabilitySchedule";
import { useRoster } from "../../hooks/useRoster";
import { useStaffing } from "../../hooks/useStaffing";
import { usePlanner } from "../../state/plannerContext";
import {
  buildDemandItems,
  computeStaffingWindow,
  coverageOf,
  type DemandItem,
  type ItemCoverage,
  type StaffingWindow,
} from "../../lib/staffing";
import type { Capability, Leave, Person, Project, StaffingAssignment } from "../../types";
import { buildHueMap, groupArrowNav } from "../timelineChrome";
import { PeopleLoadView } from "./PeopleLoadView";
import { ProjectStaffingView } from "./ProjectStaffingView";
import { StaffingPanelView } from "./StaffingPanelView";
import type { ObsadaUnit } from "./axis";
import "./obsada.css";

export type ObsadaTab = "people" | "projects" | "assign";

/** What Obsadzanie is focused on: one demand item, or a whole project's
 *  staffing at once (widok zbiorczy). Lives up here so a jump from either
 *  timeline can set it, and so it survives tab switches. */
export type ObsadaSelection =
  | { kind: "item"; id: string }
  | { kind: "project"; id: string };

const TABS: { id: ObsadaTab; label: string; chip: string }[] = [
  { id: "people", label: "Obciążenie ludzi", chip: "zaangażowanie osób" },
  { id: "projects", label: "Braki w projektach", chip: "kto i kiedy w projekcie" },
  { id: "assign", label: "Przydziel", chip: "obsadzanie zapotrzebowania" },
];

interface ObsadaWorkspaceProps {
  projects: Project[];
  theme: "auto" | "light" | "dark";
}

/** Everything the three views read, computed once at the top so they cannot
 *  disagree about what the plan says. */
export interface ObsadaContext {
  window: StaffingWindow;
  today: Date;
  /** The scheduler's month, in working days — the divisor behind every
   *  "osobomiesięcy" figure, so all three tabs quote the same month. */
  workingDaysPerMonth: number;
  items: DemandItem[];
  coverage: Map<string, ItemCoverage>;
  assignments: StaffingAssignment[];
  leaves: Leave[];
  projectById: Map<string, Project>;
  personById: Map<string, Person>;
  hueById: Record<string, number>;
  unit: ObsadaUnit;
  setUnit: (unit: ObsadaUnit) => void;
  /** Leftmost visible day, shared across tabs and unit switches; null until
   *  the first view has positioned itself on today. */
  anchorDayRef: React.MutableRefObject<number | null>;
  /** Jump to Obsadzanie with one demand item selected — the thread that ties
   *  a bar on either timeline to the panel that can actually change it. */
  openItem: (projectId: string, capability: Capability) => void;
}

export function ObsadaWorkspace({ projects, theme }: ObsadaWorkspaceProps) {
  const { people, teams, pools } = useRoster();
  const { settings } = usePlanner();
  const schedule = useCapabilitySchedule(projects, pools);
  const staffing = useStaffing();
  const { assignments, leaves } = staffing;
  const workingDaysPerMonth = settings.workingDaysPerMonth;

  const [tab, setTab] = useState<ObsadaTab>("people");
  const [unit, setUnit] = useState<ObsadaUnit>("months");
  const [selection, setSelection] = useState<ObsadaSelection | null>(null);
  const anchorDayRef = useRef<number | null>(null);

  const today = useMemo(() => new Date(), []);
  const window_ = useMemo(
    () => computeStaffingWindow(assignments, leaves, schedule, today, workingDaysPerMonth),
    [assignments, leaves, schedule, today, workingDaysPerMonth],
  );
  const items = useMemo(
    () => buildDemandItems(schedule, window_, workingDaysPerMonth),
    [schedule, window_, workingDaysPerMonth],
  );
  const coverage = useMemo(
    () => new Map(items.map((item) => [item.id, coverageOf(item, assignments, leaves, window_)])),
    [items, assignments, leaves, window_],
  );
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const hueById = useMemo(() => buildHueMap(projects), [projects]);

  const openItem = useCallback((projectId: string, capability: Capability) => {
    setSelection({ kind: "item", id: `${projectId}:${capability}` });
    setTab("assign");
  }, []);

  const ctx: ObsadaContext = {
    window: window_,
    today,
    workingDaysPerMonth,
    items,
    coverage,
    assignments,
    leaves,
    projectById,
    personById,
    hueById,
    unit,
    setUnit,
    anchorDayRef,
    openItem,
  };

  // One headline per tab, so the strip always answers "how bad is it" without
  // opening the view that would tell you.
  const openCount = items.filter((i) => (coverage.get(i.id)?.peakGap ?? 0) > 1e-6).length;
  const summary =
    tab === "people"
      ? `${people.length} osób · ${assignments.length} przypisań`
      : `${openCount} z ${items.length} pozycji z luką`;

  const chip = TABS.find((t) => t.id === tab)!.chip;

  return (
    <div className="atl obs" data-theme={theme === "auto" ? undefined : theme}>
      <div className="obs-strip">
        <div className="atl-title">
          <b>Obsada</b>
          <span className="atl-chip">{chip}</span>
        </div>

        <div className="atl-seg obs-tabs" role="tablist" aria-label="Widoki obsady" onKeyDown={groupArrowNav}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === tab}
              tabIndex={t.id === tab ? 0 : -1}
              className={t.id === tab ? "is-active" : undefined}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="atl-spacer" />
        <span className="obs-strip-sum">{summary}</span>
      </div>

      {tab === "people" && (
        <PeopleLoadView ctx={ctx} people={people} teams={teams} staffing={staffing} />
      )}

      {tab === "projects" && <ProjectStaffingView ctx={ctx} projects={projects} />}

      {tab === "assign" && (
        <StaffingPanelView
          ctx={ctx}
          people={people}
          staffing={staffing}
          selection={selection}
          onSelect={setSelection}
        />
      )}
    </div>
  );
}
