import { useEffect, useMemo, useState } from "react";
import { AdvancedTimeline } from "./components/AdvancedTimeline";
import { CapabilityMatrix } from "./components/CapabilityMatrix";
import { CategoryTimeline } from "./components/CategoryTimeline";
import { ProjectList } from "./components/ProjectList";
import { ObsadaWorkspace } from "./components/obsada/ObsadaWorkspace";
import { NavRail } from "./components/NavRail";
import { TeamView } from "./components/TeamView";
import { TimelineView } from "./components/TimelineView";
import { MOD, SCREENS, buildHueMap, fmt, plCount, type Screen } from "./components/timelineChrome";
import { useCapabilitySchedule } from "./hooks/useCapabilitySchedule";
import { useOrderedProjects } from "./hooks/useOrderedProjects";
import { useRoster } from "./hooks/useRoster";
import { CATEGORY_ORDER } from "./lib/estimation";
import type { CapabilityVector, Project } from "./types";
import "./components/timeline.css";

export type ThemeChoice = "auto" | "light" | "dark";

/** The footer's one derived number. Its own component so the schedule is only
 *  simulated while the footer line is actually on screen — a hook cannot be
 *  called conditionally, but a component can be rendered conditionally. */
function PlanHorizon({ projects, pools }: { projects: Project[]; pools: CapabilityVector }) {
  const schedule = useCapabilitySchedule(projects, pools);
  return <span>cała praca kończy się po {fmt(schedule.horizonMonths)} mies.</span>;
}

function App() {
  const { projects, reorder } = useOrderedProjects();
  // Every screen here plans on the team we actually have; hypothetical
  // variants live only inside the projections view, which owns them itself.
  const { pools } = useRoster();
  const [showEstimates, setShowEstimates] = useState(true);
  const [screen, setScreen] = useState<Screen>("backlog");
  const [theme, setTheme] = useState<ThemeChoice>("dark");
  // One-shot cross-screen intents — "go there AND open its proposals panel".
  // The two optimizer drawers are halves of one question, so each one's
  // saturation point links to the other with the panel already open. An
  // intent survives only while its target screen is current, so a later
  // manual visit opens the screen plain.
  const [matrixProposalsIntent, setMatrixProposalsIntent] = useState(false);
  const [compareOptimizerIntent, setCompareOptimizerIntent] = useState(false);

  useEffect(() => {
    if (screen !== "matrix") setMatrixProposalsIntent(false);
    if (screen !== "compare") setCompareOptimizerIntent(false);
  }, [screen]);

  useEffect(() => {
    document.body.style.overflow = screen === "backlog" ? "" : "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [screen]);

  // ⌘1…⌘6 follow the rail's tab order — the same six places the rail shows.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      const n = Number(event.key);
      if (!Number.isInteger(n) || n < 1 || n > SCREENS.length) return;
      event.preventDefault();
      setScreen(SCREENS[n - 1].id);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const hueById = useMemo(() => buildHueMap(projects), [projects]);
  // Screens are full-window panels below the rail, so the backlog behind them
  // is not visible. Keeping it mounted meant editing in the matrix re-simulated
  // the whole plan for a footer nobody could see — the single biggest cost of
  // toggling a project in or out of the plan.
  const backlogVisible = screen === "backlog";

  const cycleTheme = () =>
    setTheme((t) => (t === "auto" ? "light" : t === "light" ? "dark" : "auto"));

  return (
    <div className="bv" data-theme={theme === "auto" ? undefined : theme}>
      <NavRail screen={screen} onSelect={setScreen} theme={theme} onCycleTheme={cycleTheme} />

      <header className="bv-header">
        <div className="atl-title">
          <b>Projekty</b>
          <span className="bv-count">{projects.length} w backlogu</span>
        </div>
      </header>

      {backlogVisible && (
      <div className="bv-body">
        <div className="bv-column">
          <ProjectList
            projects={projects}
            onReorder={reorder}
            showEstimates={showEstimates}
            onToggleEstimates={() => setShowEstimates((v) => !v)}
            hueById={hueById}
          />
          <CategoryTimeline projects={projects} pools={pools} hueById={hueById} />
        </div>
      </div>
      )}

      <footer className="bv-footer">
        <span>obecny zespół</span>
        <span>
          {plCount(projects.length, "projekt", "projekty", "projektów")} ·{" "}
          {plCount(CATEGORY_ORDER.length, "kategoria", "kategorie", "kategorii")}
        </span>
        {backlogVisible && <PlanHorizon projects={projects} pools={pools} />}
        <span style={{ flex: 1 }} />
        <span>
          {MOD}1…{MOD}
          {SCREENS.length} przeskakuje między widokami
        </span>
      </footer>

      {screen === "team" && <TeamView theme={theme} />}

      {screen === "matrix" && (
        <CapabilityMatrix
          projects={projects}
          theme={theme}
          initialShowProposals={matrixProposalsIntent}
          onOpenCompareOptimizer={() => {
            setCompareOptimizerIntent(true);
            setScreen("compare");
          }}
        />
      )}

      {screen === "compare" && (
        <TimelineView
          projects={projects}
          theme={theme}
          initialOptimizerOpen={compareOptimizerIntent}
          onOpenMatrixProposals={() => {
            setMatrixProposalsIntent(true);
            setScreen("matrix");
          }}
        />
      )}

      {screen === "advanced" && (
        <AdvancedTimeline
          projects={projects}
          pools={pools}
          onOpenMatrix={() => setScreen("matrix")}
          theme={theme}
        />
      )}

      {screen === "obsada" && <ObsadaWorkspace projects={projects} theme={theme} />}
    </div>
  );
}

export default App;
