import { useEffect, useMemo, useState } from "react";
import type { Project } from "../types";
import {
  CATEGORY_ORDER,
  TEAM_VARIANTS,
  buildCategoryBars,
  categoryCapacityPerMonth,
  gridlineMonths,
  monthsNeeded,
  totalEffortDaysByCategory,
  type TeamVariant,
} from "../lib/estimation";
import { computeCategorySchedule, type ScheduleSegment } from "../lib/scheduling";
import { useProjectAssignments } from "../hooks/useProjectAssignments";
import { GradePopover } from "./GradePopover";

interface TimelineViewProps {
  projects: Project[];
  variantId: string;
  onVariantChange: (id: string) => void;
  onClose: () => void;
}

const PX_PER_MONTH_BASE = 90;
const MIN_BAR_WIDTH = 5;
const LABEL_WITH_NAME_MIN_WIDTH = 72;
const LABEL_COUNT_ONLY_MIN_WIDTH = 20;
const SEGMENT_LABEL_MIN_WIDTH = 16;

const BASE_ROW_HEIGHT = 150;
// Advanced mode can stack many lanes at once — shrink each one and add a
// visible gap between concurrent bars so the lanes read as distinct tracks.
const ADVANCED_ROW_HEIGHT = 90;
const ADVANCED_LANE_GAP = 5;
const GRIDLINE_STEP = 6;

interface RenderItem {
  id: string;
  project: Project;
  startMonths: number;
  endMonths: number;
  peopleLabel: number;
  segments?: ScheduleSegment[];
  isImpossible?: boolean;
  isPending?: boolean;
}

interface CategoryRender {
  category: string;
  people: number;
  months: number;
  laneCount: number;
  lanes: RenderItem[][];
  hasSchedule: boolean;
}

export function TimelineView({ projects, variantId, onVariantChange, onClose }: TimelineViewProps) {
  const variant: TeamVariant = TEAM_VARIANTS.find((v) => v.id === variantId) ?? TEAM_VARIANTS[0];
  const { assignments, setAssignment, removeAssignment } = useProjectAssignments();
  const [advancedMode, setAdvancedMode] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ project: Project; anchor: { x: number; y: number } } | null>(
    null,
  );

  const ROW_HEIGHT = advancedMode ? ADVANCED_ROW_HEIGHT : BASE_ROW_HEIGHT;
  const LANE_GAP = advancedMode ? ADVANCED_LANE_GAP : 0;
  const BAR_V_PADDING = advancedMode ? 8 : 14;
  const BAR_TOP = BAR_V_PADDING;
  const BAR_HEIGHT = ROW_HEIGHT - BAR_V_PADDING * 2;

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (selected) setSelected(null);
        else onClose();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, selected]);

  const totalsByCategory = useMemo(() => totalEffortDaysByCategory(projects), [projects]);

  const categoryRenders: CategoryRender[] = useMemo(() => {
    return CATEGORY_ORDER.map((category) => {
      const people = variant.people[category] ?? 0;
      const categoryProjects = projects.filter((p) => p.category === category);
      const months = monthsNeeded(totalsByCategory[category] ?? 0, people);

      if (advancedMode) {
        const schedule = computeCategorySchedule(categoryProjects, assignments, people);
        if (schedule) {
          const lanes: RenderItem[][] = Array.from({ length: schedule.laneCount }, () => []);
          for (const g of schedule.graded) {
            lanes[g.lane]?.push({
              id: g.project.id,
              project: g.project,
              startMonths: g.startMonths,
              endMonths: g.endMonths,
              peopleLabel: g.target,
              segments: g.segments,
              isImpossible: g.isImpossible,
            });
          }
          for (const t of schedule.tail) {
            lanes[t.lane]?.push({
              id: t.project.id,
              project: t.project,
              startMonths: t.startMonths,
              endMonths: t.endMonths,
              peopleLabel: people,
              isPending: schedule.pendingIds.has(t.project.id),
            });
          }
          return { category, people, months, laneCount: schedule.laneCount, lanes, hasSchedule: true };
        }
      }

      const capacity = categoryCapacityPerMonth(people);
      const bars = buildCategoryBars(categoryProjects, capacity);
      const lane: RenderItem[] = bars.map((bar) => ({
        id: bar.project.id,
        project: bar.project,
        startMonths: bar.startMonths,
        endMonths: bar.endMonths,
        peopleLabel: people,
      }));
      return { category, people, months, laneCount: 1, lanes: [lane], hasSchedule: false };
    });
  }, [projects, variant, totalsByCategory, advancedMode, assignments]);

  const pxPerMonth = useMemo(() => {
    let shortestMonths = Infinity;
    for (const cat of categoryRenders) {
      for (const lane of cat.lanes) {
        for (const item of lane) {
          const duration = item.endMonths - item.startMonths;
          if (duration > 0 && duration < shortestMonths) shortestMonths = duration;
        }
      }
    }
    if (!Number.isFinite(shortestMonths)) return PX_PER_MONTH_BASE;
    return Math.max(PX_PER_MONTH_BASE, MIN_BAR_WIDTH / shortestMonths);
  }, [categoryRenders]);

  const horizonMonths = useMemo(() => {
    let longest = 0;
    for (const cat of categoryRenders) {
      for (const lane of cat.lanes) {
        for (const item of lane) {
          if (Number.isFinite(item.endMonths)) longest = Math.max(longest, item.endMonths);
        }
      }
    }
    const rounded = Math.ceil(longest / GRIDLINE_STEP) * GRIDLINE_STEP;
    return Math.max(rounded + GRIDLINE_STEP, GRIDLINE_STEP * 2);
  }, [categoryRenders]);

  const ticks = useMemo(() => gridlineMonths(horizonMonths), [horizonMonths]);
  const canvasWidth = horizonMonths * pxPerMonth;

  function renderLane(items: RenderItem[], key: string, marginBottom: number) {
    return (
      <div className="tv-row" key={key} style={{ height: ROW_HEIGHT, marginBottom }}>
        {items.map((item) => {
          const left = item.startMonths * pxPerMonth;
          const width = Math.max((item.endMonths - item.startMonths) * pxPerMonth, MIN_BAR_WIDTH);
          const sizeClass = `size-${item.project.estimate.toLowerCase()}`;

          let barLabel: string | null = null;
          if (width >= LABEL_WITH_NAME_MIN_WIDTH) barLabel = `${item.project.name} · ${item.peopleLabel}`;
          else if (width >= LABEL_COUNT_ONLY_MIN_WIDTH) barLabel = String(item.peopleLabel);

          const barClasses = [
            "tv-bar",
            sizeClass,
            advancedMode && "is-clickable",
            hoveredId === item.id && "is-hovered",
            item.isImpossible && "is-impossible",
            item.isPending && "is-pending",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <div
              key={item.id}
              className={barClasses}
              style={{ left, width, top: BAR_TOP, height: BAR_HEIGHT }}
              title={item.project.name}
              onMouseEnter={() => advancedMode && setHoveredId(item.id)}
              onMouseLeave={() => advancedMode && setHoveredId((h) => (h === item.id ? null : h))}
              onClick={(e) => {
                if (!advancedMode) return;
                setSelected({ project: item.project, anchor: { x: e.clientX, y: e.clientY } });
              }}
            >
              {item.segments &&
                item.segments
                  .filter((seg) => !seg.isFullyStaffed)
                  .map((seg, i) => {
                    const segLeft = (seg.startMonths - item.startMonths) * pxPerMonth;
                    const segWidth = (seg.endMonths - seg.startMonths) * pxPerMonth;
                    return (
                      <div key={i} className="tv-bar-understaffed" style={{ left: segLeft, width: segWidth }}>
                        {segWidth >= SEGMENT_LABEL_MIN_WIDTH && (
                          <span className="tv-bar-understaffed-label">{seg.peopleActive}</span>
                        )}
                      </div>
                    );
                  })}
              {barLabel && <span className="tv-bar-label">{barLabel}</span>}
            </div>
          );
        })}
      </div>
    );
  }

  const maxPeopleForSelected = selected ? variant.people[selected.project.category] ?? 0 : 0;

  // While a project is being graded, show how much of its category's pool is
  // already spoken for by other graded projects, so the free amount left to
  // hand out is visible right on the timeline.
  function freeCapacityFor(category: string, excludeProjectId: string) {
    const total = variant.people[category] ?? 0;
    let used = 0;
    for (const p of projects) {
      if (p.category !== category || p.id === excludeProjectId) continue;
      const value = assignments[p.id];
      if (value != null) used += value;
    }
    return { total, used, free: Math.max(total - used, 0) };
  }

  return (
    <div className="tv-overlay" role="dialog" aria-modal="true" aria-label="Project timeline">
      <header className="tv-header">
        <h2>Timeline</h2>
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
        <button
          type="button"
          className={`advanced-toggle ${advancedMode ? "is-active" : ""}`}
          onClick={() => setAdvancedMode((v) => !v)}
        >
          Advanced mode
        </button>
        <button type="button" className="tv-close" onClick={onClose} aria-label="Close timeline">
          Close ✕
        </button>
      </header>

      {advancedMode && (
        <p className="tv-advanced-hint">
          Click a project to assign how many people work on it. Grading only takes effect for a
          contiguous run starting from the first project in each category — anything after a gap
          stays in the default queue until it's filled in.
        </p>
      )}

      <div className="tv-body">
        <div className="tv-labels">
          <div className="tv-axis-spacer" />
          {categoryRenders.map((cat) => (
            <div
              className="tv-label-cell"
              key={cat.category}
              style={{ height: cat.laneCount * ROW_HEIGHT + Math.max(cat.laneCount - 1, 0) * LANE_GAP }}
            >
              <span className="tv-label-name">
                {cat.category}
                {cat.hasSchedule && <span className="tv-label-badge">multi</span>}
              </span>
              <span className="tv-label-meta">
                {cat.people} {cat.people === 1 ? "person" : "people"} · {cat.months.toFixed(1)} mo
              </span>
              {selected && selected.project.category === cat.category && (() => {
                const { total, free } = freeCapacityFor(cat.category, selected.project.id);
                const freeRatio = total > 0 ? free / total : 0;
                return (
                  <div className="tv-free-gauge">
                    <div className="tv-free-gauge-track">
                      <div className="tv-free-gauge-fill" style={{ width: `${freeRatio * 100}%` }} />
                    </div>
                    <span className="tv-free-gauge-text">
                      {free} free of {total}
                    </span>
                  </div>
                );
              })()}
            </div>
          ))}
        </div>

        <div className="tv-scroll">
          <div className="tv-canvas" style={{ width: canvasWidth }}>
            <div className="tv-axis">
              {ticks.map((tick) => (
                <span key={tick} className="tv-axis-label" style={{ left: tick * pxPerMonth }}>
                  {tick} mo
                </span>
              ))}
            </div>

            {ticks.map((tick) => (
              <div key={tick} className="tv-gridline" style={{ left: tick * pxPerMonth }} />
            ))}

            <div className="tv-rows">
              {categoryRenders.map((cat) =>
                cat.lanes.map((laneItems, laneIndex) =>
                  renderLane(
                    laneItems,
                    `${cat.category}-${laneIndex}`,
                    laneIndex < cat.laneCount - 1 ? LANE_GAP : 0,
                  ),
                ),
              )}
            </div>
          </div>
        </div>
      </div>

      {selected && (
        <GradePopover
          project={selected.project}
          currentValue={assignments[selected.project.id]}
          maxPeople={maxPeopleForSelected}
          anchor={selected.anchor}
          onSet={(value) => setAssignment(selected.project.id, value)}
          onClear={() => removeAssignment(selected.project.id)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
