import { useMemo } from "react";
import type { Project } from "../types";
import {
  CATEGORY_ORDER,
  categoryCapacityPerMonth,
  effortDays,
  type TeamVariant,
} from "../lib/estimation";
import { fmt, solid } from "./timelineChrome";

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

  const { queues, ticks } = useMemo(() => {
    const queues = CATEGORY_ORDER.map((name) => {
      const list = projects.filter((p) => p.category === name);
      const people = variant.people[name] ?? 0;
      const capacity = categoryCapacityPerMonth(people);
      const days = list.reduce((sum, p) => sum + effortDays(p), 0);
      return { name, list, people, days, months: capacity > 0 ? days / capacity : Infinity };
    });

    const longest = queues.reduce(
      (max, q) => (Number.isFinite(q.months) ? Math.max(max, q.months) : max),
      0,
    );
    const horizon = Math.max(Math.ceil(longest / 6) * 6 + 6, 12);

    const ticks: { pct: number; label: string; atEnd: boolean }[] = [];
    for (let m = 6; m <= horizon; m += 6) {
      const pct = (m / horizon) * 100;
      ticks.push({ pct, label: `${m}mo`, atEnd: pct >= 99.9 });
    }

    return { queues: queues.map((q) => ({ ...q, horizon })), ticks };
  }, [projects, variant]);

  return (
    <section className="bv-card">
      <div className="bv-card-head">
        <div className="bv-card-title">
          <b>Timeline by category</b>
          <span className="bv-card-sub">one queue per category, end to end</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="atl-eyebrow">variant</span>
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
        <span style={{ width: LABEL_W, paddingBottom: 6 }}>category</span>
        <span style={{ width: 78, textAlign: "right", paddingBottom: 6 }}>people</span>
        <span style={{ width: 60, textAlign: "right", paddingBottom: 6 }}>queue</span>
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
              {queue.people} {queue.people === 1 ? "person" : "people"}
            </span>
            <span className="bv-num" style={{ width: 60 }}>
              {Number.isFinite(queue.months) ? `${fmt(queue.months)} mo` : "—"}
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
                {queue.list.map((project) => {
                  const days = effortDays(project);
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
                {queue.list.length} {queue.list.length === 1 ? "project" : "projects"}
              </span>
            </div>
          </div>
        );
      })}
    </section>
  );
}
