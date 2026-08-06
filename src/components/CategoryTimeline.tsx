import { useMemo } from "react";
import type { Project } from "../types";
import {
  CATEGORY_ORDER,
  TEAM_VARIANTS,
  monthsNeeded,
  totalEffortDaysByCategory,
  type TeamVariant,
} from "../lib/estimation";

interface CategoryTimelineProps {
  projects: Project[];
  variantId: string;
  onVariantChange: (id: string) => void;
}

export function CategoryTimeline({ projects, variantId, onVariantChange }: CategoryTimelineProps) {
  const variant: TeamVariant = TEAM_VARIANTS.find((v) => v.id === variantId) ?? TEAM_VARIANTS[0];

  const totalsByCategory = useMemo(() => totalEffortDaysByCategory(projects), [projects]);

  return (
    <section className="timeline">
      <div className="timeline-header">
        <h2>Timeline by category</h2>
        <div className="variant-tabs">
          {TEAM_VARIANTS.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`variant-tab ${v.id === variantId ? "is-active" : ""}`}
              onClick={() => onVariantChange(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
      <ul className="timeline-list">
        {CATEGORY_ORDER.map((category) => {
          const people = variant.people[category] ?? 0;
          const days = totalsByCategory[category] ?? 0;
          const months = monthsNeeded(days, people);
          return (
            <li key={category} className="timeline-row">
              <span className="timeline-category">{category}</span>
              <span className="timeline-people">
                {people} {people === 1 ? "person" : "people"}
              </span>
              <span className="timeline-months">{months.toFixed(1)} mo</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
