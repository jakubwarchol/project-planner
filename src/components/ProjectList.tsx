import { useState } from "react";
import type { Project } from "../types";
import { ESTIMATE_VALUES, effortDays } from "../lib/estimation";
import { solid } from "./timelineChrome";

interface ProjectListProps {
  projects: Project[];
  onReorder: (fromIndex: number, toIndex: number) => void;
  showEstimates: boolean;
  hueById: Record<string, number>;
}

const ESTIMATE_ORDER = Object.keys(ESTIMATE_VALUES) as (keyof typeof ESTIMATE_VALUES)[];

export function ProjectList({ projects, onReorder, showEstimates, hueById }: ProjectListProps) {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  function handleDragOver(event: React.DragEvent, index: number) {
    event.preventDefault();
    if (index !== dragOverIndex) setDragOverIndex(index);
  }

  function handleDrop(index: number) {
    if (draggingIndex !== null) onReorder(draggingIndex, index);
    setDraggingIndex(null);
    setDragOverIndex(null);
  }

  return (
    <section className="bv-card">
      <div className="bv-card-head">
        <div className="bv-card-title">
          <b>Backlog order</b>
          <span className="bv-card-sub">first in the queue takes capacity first</span>
        </div>
        <span className="bv-card-hint">drag the handle, or use ▲▼</span>
      </div>

      <div className="bv-colhead">
        <span style={{ width: 22, textAlign: "right" }}>#</span>
        <span style={{ width: 14 }} />
        <span style={{ width: 3 }} />
        <span style={{ flex: 1 }}>project</span>
        {showEstimates && <span style={{ width: 78 }}>size</span>}
        <span style={{ width: 104 }}>category</span>
        <span style={{ width: 48 }} />
      </div>

      {projects.map((project, index) => {
        const rank = ESTIMATE_ORDER.indexOf(project.estimate) + 1;
        const hovered = hover === project.id;
        return (
          <div
            key={project.id}
            className={[
              "bv-row",
              draggingIndex === index ? "is-dragging" : "",
              dragOverIndex === index && draggingIndex !== index ? "is-drag-over" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{ background: hovered ? "var(--row-hover)" : "transparent" }}
            draggable
            onDragStart={() => setDraggingIndex(index)}
            onDragOver={(event) => handleDragOver(event, index)}
            onDrop={() => handleDrop(index)}
            onDragEnd={() => {
              setDraggingIndex(null);
              setDragOverIndex(null);
            }}
            onMouseEnter={() => setHover(project.id)}
            onMouseLeave={() => setHover((h) => (h === project.id ? null : h))}
          >
            <span className="bv-ord">{String(index + 1).padStart(2, "0")}</span>
            <span className="bv-grip" aria-hidden="true">
              ⠿
            </span>
            <span className="bv-row-hue" style={{ background: solid(hueById[project.id] ?? 232) }} />
            <span className="bv-row-name">{project.name}</span>
            {showEstimates && (
              <span
                className="bv-size"
                title={`${project.estimate} — ${effortDays(project)} effort days`}
              >
                <span className="bv-size-ticks">
                  {[0, 1, 2, 3, 4].map((k) => (
                    <i
                      key={k}
                      style={{
                        height: 4 + k * 2,
                        background: k < rank ? "var(--ink-3)" : "var(--line-strong)",
                      }}
                    />
                  ))}
                </span>
                <span className="bv-size-label">{project.estimate}</span>
              </span>
            )}
            <span className="bv-row-cat">{project.category}</span>
            <span className="bv-move">
              <button
                type="button"
                aria-label={`Move ${project.name} up`}
                disabled={index === 0}
                onClick={() => onReorder(index, index - 1)}
              >
                ▲
              </button>
              <button
                type="button"
                aria-label={`Move ${project.name} down`}
                disabled={index === projects.length - 1}
                onClick={() => onReorder(index, index + 1)}
              >
                ▼
              </button>
            </span>
          </div>
        );
      })}
    </section>
  );
}
