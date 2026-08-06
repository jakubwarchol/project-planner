import { useLayoutEffect, useRef, useState } from "react";
import type { Project } from "../types";

interface GradePopoverProps {
  project: Project;
  currentValue: number | undefined;
  maxPeople: number;
  anchor: { x: number; y: number };
  onSet: (value: number) => void;
  onClear: () => void;
  onClose: () => void;
}

function buildOptions(maxPeople: number): number[] {
  const options: number[] = [];
  for (let v = 1; v <= maxPeople; v += 1) {
    options.push(v);
  }
  return options;
}

export function GradePopover({
  project,
  currentValue,
  maxPeople,
  anchor,
  onSet,
  onClear,
  onClose,
}: GradePopoverProps) {
  const options = buildOptions(maxPeople);
  const [pos, setPos] = useState({ left: anchor.x, top: anchor.y });
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(Math.max(anchor.x, margin), window.innerWidth - rect.width - margin);
    const top = Math.min(Math.max(anchor.y, margin), window.innerHeight - rect.height - margin);
    setPos({ left, top });
  }, [anchor.x, anchor.y]);

  return (
    <>
      <div className="grade-backdrop" onClick={onClose} />
      <div
        className="grade-popover"
        ref={ref}
        style={{ left: pos.left, top: pos.top }}
        role="dialog"
        aria-label={`Assign people to ${project.name}`}
      >
        <div className="grade-popover-header">
          <span className="grade-popover-title">{project.name}</span>
          <button type="button" className="grade-popover-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="grade-popover-label">People assigned</p>
        {options.length > 0 ? (
          <div className="grade-popover-grid">
            {options.map((opt) => (
              <button
                key={opt}
                type="button"
                className={`grade-popover-option ${currentValue === opt ? "is-selected" : ""}`}
                onClick={() => onSet(opt)}
              >
                {opt}
              </button>
            ))}
          </div>
        ) : (
          <p className="grade-popover-hint">This category has no people assigned.</p>
        )}
        {currentValue != null && (
          <button type="button" className="grade-popover-clear" onClick={onClear}>
            Clear assignment
          </button>
        )}
      </div>
    </>
  );
}
