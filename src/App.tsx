import { useEffect, useMemo, useState } from "react";
import { AdvancedTimeline } from "./components/AdvancedTimeline";
import { BacklogScreen } from "./components/BacklogScreen";
import { CapabilityMatrix } from "./components/CapabilityMatrix";
import { ObsadaWorkspace } from "./components/obsada/ObsadaWorkspace";
import { NavRail } from "./components/NavRail";
import { TeamView } from "./components/TeamView";
import { TimelineView } from "./components/TimelineView";
import { UtilizationView } from "./components/UtilizationView";
import { SCREENS, buildHueMap, type Screen } from "./components/timelineChrome";
import { nextTheme, useResolvedTheme, type ThemeChoice } from "./design";
import { useOrderedProjects } from "./hooks/useOrderedProjects";
import { useRoster } from "./hooks/useRoster";
import "./components/timeline.css";

const THEME_KEY = "planner-theme";

function savedTheme(): ThemeChoice {
  const saved = localStorage.getItem(THEME_KEY);
  return saved === "auto" || saved === "light" || saved === "dark" ? saved : "dark";
}

/** The current screen lives in the URL hash — `#/team`, `#/matrix` — so a
 *  refresh stays where you were and the browser's back button walks screens. */
function screenFromHash(): Screen {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const match = SCREENS.find((s) => s.id === hash);
  return match ? match.id : "backlog";
}

function App() {
  const { projects, reorder } = useOrderedProjects();
  // Every screen here plans on the team we actually have; hypothetical
  // variants live only inside the projections view, which owns them itself.
  const { pools } = useRoster();
  const [showEstimates, setShowEstimates] = useState(true);
  const [addingProject, setAddingProject] = useState(false);
  const [screen, setScreen] = useState<Screen>(screenFromHash);
  const [theme, setTheme] = useState<ThemeChoice>(savedTheme);
  // "auto" is resolved here rather than in CSS, so the palette is written
  // once per theme instead of once per selector context.
  const resolved = useResolvedTheme(theme);

  useEffect(() => {
    const hash = `#/${screen}`;
    if (window.location.hash !== hash) window.location.hash = hash;
  }, [screen]);

  useEffect(() => {
    const onHashChange = () => setScreen(screenFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // One-shot cross-screen intent — "go there AND open its panel". When the
  // ceiling autopilot runs out of people to add, the answer is hiring, which
  // lives in Symulacje. The intent survives only while its target screen is
  // current, so a later manual visit opens the screen plain.
  const [compareOptimizerIntent, setCompareOptimizerIntent] = useState(false);

  useEffect(() => {
    if (screen !== "compare") setCompareOptimizerIntent(false);
  }, [screen]);

  // ⌘1…⌘7 follow the rail's tab order — the same places the rail shows.
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

  return (
    <div className="bv" data-theme={resolved}>
      <NavRail
        screen={screen}
        onSelect={setScreen}
        theme={theme}
        onCycleTheme={() => setTheme(nextTheme)}
      />

      {/* One screen at a time. The rail is the only thing that outlives a
          switch — keeping the others mounted meant every edit re-simulated
          plans nobody could see. */}
      {screen === "backlog" && (
        <BacklogScreen
          projects={projects}
          pools={pools}
          onReorder={reorder}
          hueById={hueById}
          showEstimates={showEstimates}
          onToggleEstimates={setShowEstimates}
          adding={addingProject}
          onAddingChange={setAddingProject}
        />
      )}

      {screen === "team" && <TeamView theme={resolved} />}

      {screen === "matrix" && (
        <CapabilityMatrix
          projects={projects}
          theme={resolved}
          onOpenCompareOptimizer={() => {
            setCompareOptimizerIntent(true);
            setScreen("compare");
          }}
        />
      )}

      {screen === "compare" && (
        <TimelineView
          projects={projects}
          theme={resolved}
          initialOptimizerOpen={compareOptimizerIntent}
        />
      )}

      {screen === "advanced" && (
        <AdvancedTimeline
          projects={projects}
          pools={pools}
          onOpenMatrix={() => setScreen("matrix")}
          theme={resolved}
        />
      )}

      {screen === "obsada" && <ObsadaWorkspace projects={projects} theme={resolved} />}

      {screen === "load" && <UtilizationView projects={projects} theme={resolved} />}
    </div>
  );
}

export default App;
