import { useMemo } from "react";
import type { Project } from "../types";
import { CATEGORY_ORDER, isIncludedInPlan, type TeamVariant } from "../lib/estimation";
import { useCapabilitySchedule } from "../hooks/useCapabilitySchedule";
import { fmt, plCount, solid } from "./timelineChrome";

interface CategoryTimelineProps {
  projects: Project[];
  variants: TeamVariant[];
  variantId: string;
  onVariantChange: (id: string) => void;
  hueById: Record<string, number>;
}

const LABEL_W = 168;
const SEGMENT_LABEL_MIN_PCT = 9;

export function CategoryTimeline({
  projects,
  variants,
  variantId,
  onVariantChange,
  hueById,
}: CategoryTimelineProps) {
  const variant: TeamVariant = variants.find((v) => v.id === variantId) ?? variants[0];
  const schedule = useCapabilitySchedule(projects, variant.fte);

  const { queues, ticks } = useMemo(() => {
    const byId = new Map(schedule.scheduled.map((sp) => [sp.project.id, sp]));

    // Each category's span is derived from the real, phase-gated schedule —
    // not a separate per-category queue, since pools are global now.
    const queues = CATEGORY_ORDER.map((name) => {
      // Segment widths come from the effort the schedule was actually built
      // from, not from what the T-shirt size implies — otherwise this bar and
      // the duration beside it would be measuring two different projects.
      const list = projects
        .filter((p) => p.category === name && isIncludedInPlan(p))
        .map((project) => ({ project, days: byId.get(project.id)?.assignedEffortDays ?? 0 }));
      const days = list.reduce((sum, item) => sum + item.days, 0);
      let horizon = 0;
      let anyInfinite = false;
      let fteMonthsSum = 0;
      for (const { project } of list) {
        const sp = byId.get(project.id);
        if (!sp) continue;
        fteMonthsSum += sp.fteMonths;
        if (!Number.isFinite(sp.endMonths)) {
          anyInfinite = true;
          continue;
        }
        horizon = Math.max(horizon, sp.endMonths);
      }
      const months = anyInfinite ? Infinity : horizon;
      const avgFte = Number.isFinite(months) && months > 0 ? fteMonthsSum / months : 0;
      return { name, list, days, months, avgFte };
    });

    const longest = queues.reduce(
      (max, q) => (Number.isFinite(q.months) ? Math.max(max, q.months) : max),
      0,
    );
    const horizon = Math.max(Math.ceil(longest / 6) * 6 + 6, 12);

    const ticks: { pct: number; label: string; atEnd: boolean }[] = [];
    for (let m = 6; m <= horizon; m += 6) {
      const pct = (m / horizon) * 100;
      ticks.push({ pct, label: `${m}mies.`, atEnd: pct >= 99.9 });
    }

    return { queues: queues.map((q) => ({ ...q, horizon })), ticks };
  }, [projects, schedule]);

  return (
    <section className="bv-card">
      <div className="bv-card-head">
        <div className="bv-card-title">
          <b>Harmonogram według kategorii</b>
          <span className="bv-card-sub">zakres każdej kategorii, wyliczony z pełnego harmonogramu</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="atl-eyebrow">wariant</span>
          <div className="atl-seg">
            {variants.map((v) => (
              <button
                key={v.id}
                type="button"
                className={`atl-seg-text ${v.id === variantId ? "is-active" : ""}`}
                style={{ height: 24 }}
                onClick={() => onVariantChange(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bv-axis">
        <span style={{ width: LABEL_W, paddingBottom: 6 }}>kategoria</span>
        <span style={{ width: 78, textAlign: "right", paddingBottom: 6 }}>śr. FTE</span>
        <span style={{ width: 60, textAlign: "right", paddingBottom: 6 }}>koniec</span>
        <div style={{ position: "relative", flex: 1, height: 30 }}>
          {ticks.map((t) => (
            <div key={t.label}>
              <div
                style={{
                  position: "absolute",
                  left: `${t.pct}%`,
                  bottom: 0,
                  width: 1,
                  height: 8,
                  background: "var(--line-strong)",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: `${t.pct}%`,
                  bottom: 11,
                  transform: t.atEnd ? "translateX(-100%)" : "none",
                  paddingLeft: t.atEnd ? 0 : 4,
                  paddingRight: t.atEnd ? 4 : 0,
                  whiteSpace: "nowrap",
                }}
              >
                {t.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {queues.map((queue) => {
        const barPct = Number.isFinite(queue.months) ? (queue.months / queue.horizon) * 100 : 0;
        return (
          <div className="bv-cat-row" key={queue.name}>
            <span className="bv-cat-name" style={{ width: LABEL_W }}>
              <span
                style={{ flex: "none", width: 3, height: 20, background: "var(--ink-3)", opacity: 0.5 }}
              />
              <span>{queue.name}</span>
            </span>
            <span className="bv-num" style={{ width: 78 }}>
              {fmt(queue.avgFte)} FTE
            </span>
            <span className="bv-num" style={{ width: 60 }}>
              {Number.isFinite(queue.months) ? `${fmt(queue.months)} mies.` : "—"}
            </span>
            <div className="bv-track">
              {ticks.map((t) => (
                <div
                  key={t.label}
                  style={{
                    position: "absolute",
                    left: `${t.pct}%`,
                    top: 0,
                    width: 1,
                    height: 44,
                    background: "var(--line-soft)",
                  }}
                />
              ))}
              <div className="bv-bar" style={{ width: `${barPct}%` }}>
                {queue.list.map(({ project, days }) => {
                  const share = queue.days ? days / queue.days : 0;
                  return (
                    <div
                      key={project.id}
                      className="bv-seg"
                      style={{ flex: days, background: solid(hueById[project.id] ?? 232) }}
                      title={`${project.name} · ${project.estimate}`}
                    >
                      {share * barPct >= SEGMENT_LABEL_MIN_PCT && <span>{project.name}</span>}
                    </div>
                  );
                })}
              </div>
              <span className="bv-tail" style={{ left: `${barPct}%` }}>
                {plCount(queue.list.length, "projekt", "projekty", "projektów")}
              </span>
            </div>
          </div>
        );
      })}
    </section>
  );
}
