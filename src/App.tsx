import { useEffect, useState } from "react";
import { ProjectList } from "./components/ProjectList";
import { CategoryTimeline } from "./components/CategoryTimeline";
import { TimelineView } from "./components/TimelineView";
import { useOrderedProjects } from "./hooks/useOrderedProjects";
import { TEAM_VARIANTS } from "./lib/estimation";
import "./App.css";

function App() {
  const { projects, reorder, resetOrder } = useOrderedProjects();
  const [showEstimates, setShowEstimates] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [variantId, setVariantId] = useState(TEAM_VARIANTS[0].id);

  useEffect(() => {
    document.body.style.overflow = timelineOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [timelineOpen]);

  return (
    <div className="page">
      <div className="content-narrow">
        <header className="page-header">
          <h1>Projects</h1>
          <div className="header-actions">
            <button
              type="button"
              className={`estimate-toggle ${showEstimates ? "is-active" : ""}`}
              onClick={() => setShowEstimates((v) => !v)}
            >
              {showEstimates ? "Hide estimates" : "Show estimates"}
            </button>
            <button type="button" className="estimate-toggle" onClick={() => setTimelineOpen(true)}>
              Show timeline
            </button>
            <button type="button" className="reset-button" onClick={resetOrder}>
              Reset order
            </button>
          </div>
        </header>
        <p className="hint">Drag items by the handle, or use the arrow buttons, to reorder.</p>
        <ProjectList projects={projects} onReorder={reorder} showEstimates={showEstimates} />
        <CategoryTimeline
          projects={projects}
          variantId={variantId}
          onVariantChange={setVariantId}
        />
      </div>
      {timelineOpen && (
        <TimelineView
          projects={projects}
          variantId={variantId}
          onVariantChange={setVariantId}
          onClose={() => setTimelineOpen(false)}
        />
      )}
    </div>
  );
}

export default App;
