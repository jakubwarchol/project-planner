import { useEffect, useMemo, useState } from "react";
import { ProjectList } from "./components/ProjectList";
import { CategoryTimeline } from "./components/CategoryTimeline";
import { TimelineView } from "./components/TimelineView";
import { buildHueMap, fmt, variantCaption } from "./components/timelineChrome";
import { useOrderedProjects } from "./hooks/useOrderedProjects";
import { useTeamVariants } from "./hooks/useTeamVariants";
import { usePlanner } from "./state/plannerContext";
import {
  CATEGORY_ORDER,
  categoryCapacityPerMonth,
  effortDays,
  type TeamVariant,
} from "./lib/estimation";
import "./components/timeline.css";

export type ThemeChoice = "auto" | "light" | "dark";

function App() {
  const { projects, reorder, resetOrder } = useOrderedProjects();
  const { exportDatabase } = usePlanner();
  const variantsApi = useTeamVariants();
  const { variants } = variantsApi;
  const [showEstimates, setShowEstimates] = useState(true);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeChoice>("auto");
  const [variantId, setVariantId] = useState(() => variants[0].id);

  // The shown variant can be deleted out from under us — fall back to the first.
  useEffect(() => {
    if (!variants.some((v) => v.id === variantId)) setVariantId(variants[0].id);
  }, [variants, variantId]);

  useEffect(() => {
    document.body.style.overflow = timelineOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [timelineOpen]);

  const hueById = useMemo(() => buildHueMap(projects), [projects]);
  const variant: TeamVariant = variants.find((v) => v.id === variantId) ?? variants[0];

  const longestQueue = useMemo(() => {
    let max = 0;
    for (const category of CATEGORY_ORDER) {
      const days = projects
        .filter((p) => p.category === category)
        .reduce((sum, p) => sum + effortDays(p), 0);
      const capacity = categoryCapacityPerMonth(variant.people[category] ?? 0);
      if (capacity > 0) max = Math.max(max, days / capacity);
    }
    return max;
  }, [projects, variant]);

  const cycleTheme = () =>
    setTheme((t) => (t === "auto" ? "light" : t === "light" ? "dark" : "auto"));
  const themeLabel = theme === "auto" ? "AUTO" : theme === "dark" ? "DARK" : "LIGHT";

  async function downloadDatabase() {
    if (!exportDatabase) return;
    const bytes = await exportDatabase();
    const url = URL.createObjectURL(
      new Blob([bytes as BlobPart], { type: "application/vnd.sqlite3" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "planner.sqlite";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="bv" data-theme={theme === "auto" ? undefined : theme}>
      <header className="bv-header">
        <div className="atl-title">
          <b>Projects</b>
          <span className="bv-count">{projects.length} in backlog</span>
        </div>

        <div className="atl-spacer" />

        <div className="atl-group">
          <button
            type="button"
            className={`atl-btn ${showEstimates ? "is-on" : ""}`}
            onClick={() => setShowEstimates((v) => !v)}
          >
            {showEstimates ? "Hide estimates" : "Show estimates"}
          </button>
          <button type="button" className="bv-btn-accent" onClick={() => setTimelineOpen(true)}>
            Show timeline
          </button>
          <button type="button" className="atl-btn" onClick={resetOrder}>
            Reset order
          </button>
          {exportDatabase && (
            <button
              type="button"
              className="atl-btn is-mono"
              title="Download the SQLite file — the same schema the server will run"
              onClick={downloadDatabase}
            >
              .sqlite
            </button>
          )}
          <div className="atl-rule" />
          <button type="button" className="atl-btn is-mono" onClick={cycleTheme}>
            {themeLabel}
          </button>
        </div>
      </header>

      <div className="bv-body">
        <div className="bv-column">
          <ProjectList
            projects={projects}
            onReorder={reorder}
            showEstimates={showEstimates}
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

      <footer className="bv-footer">
        <span>{variantCaption(variant.label)}</span>
        <span>
          {projects.length} projects · {CATEGORY_ORDER.length} categories
        </span>
        <span>longest queue {fmt(longestQueue)} mo</span>
        <span style={{ flex: 1 }} />
        <span>simple mode · open the timeline for staffing detail</span>
      </footer>

      {timelineOpen && (
        <TimelineView
          projects={projects}
          variantId={variantId}
          variantsApi={variantsApi}
          onVariantChange={setVariantId}
          theme={theme}
          onCycleTheme={cycleTheme}
          onClose={() => setTimelineOpen(false)}
        />
      )}
    </div>
  );
}

export default App;
