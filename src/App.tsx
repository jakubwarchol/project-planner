import { useEffect, useMemo, useState } from "react";
import { AdvancedTimeline } from "./components/AdvancedTimeline";
import { CapabilityMatrix } from "./components/CapabilityMatrix";
import { CategoryTimeline } from "./components/CategoryTimeline";
import { ProjectList } from "./components/ProjectList";
import { ObsadaWorkspace } from "./components/obsada/ObsadaWorkspace";
import { TeamView } from "./components/TeamView";
import { TimelineView } from "./components/TimelineView";
import { buildHueMap, fmt, plCount, variantCaption } from "./components/timelineChrome";
import { useCapabilitySchedule } from "./hooks/useCapabilitySchedule";
import { useOrderedProjects } from "./hooks/useOrderedProjects";
import { useTeamVariants } from "./hooks/useTeamVariants";
import { CATEGORY_ORDER, type TeamVariant } from "./lib/estimation";
import type { CapabilityVector, Project } from "./types";
import "./components/timeline.css";

export type ThemeChoice = "auto" | "light" | "dark";
type Screen = "backlog" | "team" | "matrix" | "compare" | "advanced" | "obsada";

/** The footer's one derived number. Its own component so the schedule is only
 *  simulated while the footer line is actually on screen — a hook cannot be
 *  called conditionally, but a component can be rendered conditionally. */
function PlanHorizon({ projects, pools }: { projects: Project[]; pools: CapabilityVector }) {
  const schedule = useCapabilitySchedule(projects, pools);
  return <span>cała praca kończy się po {fmt(schedule.horizonMonths)} mies.</span>;
}

function App() {
  const { projects, reorder } = useOrderedProjects();
  const variantsApi = useTeamVariants();
  const { variants } = variantsApi;
  const [showEstimates, setShowEstimates] = useState(true);
  const [screen, setScreen] = useState<Screen>("backlog");
  const [theme, setTheme] = useState<ThemeChoice>("dark");
  const [variantId, setVariantId] = useState(() => variants[0].id);

  // The shown variant can be deleted out from under us — fall back to the first.
  useEffect(() => {
    if (!variants.some((v) => v.id === variantId)) setVariantId(variants[0].id);
  }, [variants, variantId]);

  useEffect(() => {
    document.body.style.overflow = screen === "backlog" ? "" : "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [screen]);

  const hueById = useMemo(() => buildHueMap(projects), [projects]);
  const variant: TeamVariant = variants.find((v) => v.id === variantId) ?? variants[0];
  // Every other screen is a full-window overlay, so the backlog behind it is
  // not visible. Keeping it mounted meant editing in the matrix re-simulated
  // the whole plan for a footer nobody could see — the single biggest cost of
  // toggling a project in or out of the plan.
  const backlogVisible = screen === "backlog";

  const cycleTheme = () =>
    setTheme((t) => (t === "auto" ? "light" : t === "light" ? "dark" : "auto"));
  const themeLabel = theme === "auto" ? "AUTO" : theme === "dark" ? "CIEMNY" : "JASNY";

  return (
    <div className="bv" data-theme={theme === "auto" ? undefined : theme}>
      <header className="bv-header">
        <div className="atl-title">
          <b>Projekty</b>
          <span className="bv-count">{projects.length} w backlogu</span>
        </div>

        <div className="atl-spacer" />

        <div className="atl-group">
          <button type="button" className="atl-btn" onClick={() => setScreen("team")}>
            Zespół
          </button>
          <button type="button" className="atl-btn" onClick={() => setScreen("matrix")}>
            Kompetencje
          </button>
          <button type="button" className="atl-btn" onClick={() => setScreen("compare")}>
            Pokaż projekcje
          </button>
          <button type="button" className="bv-btn-accent" onClick={() => setScreen("advanced")}>
            Pokaż harmonogram
          </button>
          <button type="button" className="atl-btn" onClick={() => setScreen("obsada")}>
            Obsada
          </button>
          <div className="atl-rule" />
          <button type="button" className="atl-btn is-mono" onClick={cycleTheme}>
            {themeLabel}
          </button>
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
          <CategoryTimeline
            projects={projects}
            variants={variants}
            variantId={variantId}
            onVariantChange={setVariantId}
            hueById={hueById}
          />
        </div>
      </div>
      )}

      <footer className="bv-footer">
        <span>{variantCaption(variant.label)}</span>
        <span>
          {plCount(projects.length, "projekt", "projekty", "projektów")} ·{" "}
          {plCount(CATEGORY_ORDER.length, "kategoria", "kategorie", "kategorii")}
        </span>
        {backlogVisible && <PlanHorizon projects={projects} pools={variant.fte} />}
        <span style={{ flex: 1 }} />
        <span>tryb prosty · otwórz harmonogram, aby zobaczyć szczegóły obsady</span>
      </footer>

      {screen === "team" && (
        <TeamView theme={theme} onClose={() => setScreen("backlog")} />
      )}

      {screen === "matrix" && (
        <CapabilityMatrix projects={projects} theme={theme} onClose={() => setScreen("backlog")} />
      )}

      {screen === "compare" && (
        <TimelineView
          projects={projects}
          variantId={variantId}
          variantsApi={variantsApi}
          onVariantChange={setVariantId}
          theme={theme}
          onClose={() => setScreen("backlog")}
        />
      )}

      {screen === "advanced" && (
        <AdvancedTimeline
          projects={projects}
          variantId={variantId}
          variantsApi={variantsApi}
          onVariantChange={setVariantId}
          onOpenMatrix={() => setScreen("matrix")}
          theme={theme}
          onClose={() => setScreen("backlog")}
        />
      )}

      {screen === "obsada" && (
        <ObsadaWorkspace projects={projects} theme={theme} onClose={() => setScreen("backlog")} />
      )}
    </div>
  );
}

export default App;
