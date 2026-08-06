import { useState } from "react";
import type { Project } from "../types";

interface ProjectListProps {
  projects: Project[];
  onReorder: (fromIndex: number, toIndex: number) => void;
  showEstimates: boolean;
}

const CATEGORY_CLASS: Record<string, string> = {
  "Category 1": "cat-1",
  "Category 2": "cat-2",
  "Category 3": "cat-3",
  "Category 4": "cat-4",
};

const ESTIMATE_CLASS: Record<string, string> = {
  S: "size-s",
  M: "size-m",
  L: "size-l",
  XL: "size-xl",
  XXL: "size-xxl",
};

export function ProjectList({ projects, onReorder, showEstimates }: ProjectListProps) {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  function handleDragStart(index: number) {
    setDraggingIndex(index);
  }

  function handleDragOver(event: React.DragEvent, index: number) {
    event.preventDefault();
    if (index !== dragOverIndex) setDragOverIndex(index);
  }

  function handleDrop(index: number) {
    if (draggingIndex !== null) {
      onReorder(draggingIndex, index);
    }
    setDraggingIndex(null);
    setDragOverIndex(null);
  }

  function handleDragEnd() {
    setDraggingIndex(null);
    setDragOverIndex(null);
  }

  return (
    <ol className="project-list">
      {projects.map((project, index) => (
        <li
          key={project.id}
          className={[
            "project-item",
            draggingIndex === index ? "is-dragging" : "",
            dragOverIndex === index && draggingIndex !== index ? "is-drag-over" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          draggable
          onDragStart={() => handleDragStart(index)}
          onDragOver={(event) => handleDragOver(event, index)}
          onDrop={() => handleDrop(index)}
          onDragEnd={handleDragEnd}
        >
          <span className="drag-handle" aria-hidden="true">
            ⠿
          </span>
          <span className="project-name">{project.name}</span>
          {showEstimates && (
            <span className={`estimate-badge ${ESTIMATE_CLASS[project.estimate] ?? ""}`}>
              {project.estimate}
            </span>
          )}
          <span className={`category-badge ${CATEGORY_CLASS[project.category] ?? ""}`}>
            {project.category}
          </span>
          <span className="reorder-buttons">
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
        </li>
      ))}
    </ol>
  );
}
