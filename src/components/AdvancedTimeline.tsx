import { useEffect, useMemo, useState } from "react";
import type { Project } from "../types";
import {
  CATEGORY_ORDER,
  EFFECTIVE_DAYS_PER_PERSON_PER_MONTH,
  ESTIMATE_VALUES,
  buildCategoryBars,
  categoryCapacityPerMonth,
  effortDays,
  type TeamVariant,
} from "../lib/estimation";
import {
  computeCategorySchedule,
  type CapacityTransfer,
  type IdleSegment,
  type ScheduleSegment,
} from "../lib/scheduling";
import { useProjectAssignments } from "../hooks/useProjectAssignments";
import type { TeamVariantsApi } from "../hooks/useTeamVariants";
import { VariantEditor } from "./VariantEditor";
import {
  DENSITIES,
  HUES,
  MON,
  ZOOMS,
  buildAxis,
  buildHueMap,
  envc,
  fmt,
  soft,
  solid,
  variantCaption,
  wash,
} from "./timelineChrome";
import "./timeline.css";

interface AdvancedTimelineProps {
  projects: Project[];
  variantId: string;
  variantsApi: TeamVariantsApi;
  onVariantChange: (id: string) => void;
  onExitAdvanced: () => void;
  theme: "auto" | "light" | "dark";
  onCycleTheme: () => void;
  onClose: () => void;
}

const ESTIMATE_ORDER = Object.keys(ESTIMATE_VALUES) as (keyof typeof ESTIMATE_VALUES)[];

type RowKind = "active" | "waiting" | "unstaffed";

interface RowModel {
  project: Project;
  kind: RowKind;
  start: number;
  end: number;
  segs: ScheduleSegment[];
  want: number;
  over: boolean;
}

interface BandModel {
  category: string;
  pool: number;
  rows: RowModel[];
  idle: IdleSegment[];
  transfers: CapacityTransfer[];
  activeCount: number;
  noCapacity: boolean;
}

export function AdvancedTimeline({
  projects,
  variantId,
  variantsApi,
  onVariantChange,
  onExitAdvanced,
  theme,
  onCycleTheme,
  onClose,
}: AdvancedTimelineProps) {
  const { variants } = variantsApi;
  const variant: TeamVariant = variants.find((v) => v.id === variantId) ?? variants[0];
  const { assignments, setAssignment, removeAssignment } = useProjectAssignments();

  const [zoomId, setZoomId] = useState("m");
  const [densityId, setDensityId] = useState("m");
  const [keyOpen, setKeyOpen] = useState(true);
  const [nameCollapsed, setNameCollapsed] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [popover, setPopover] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (popover) setPopover(null);
      else if (editorOpen) setEditorOpen(false);
      else onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [popover, editorOpen, onClose]);

  const hueById = useMemo(() => buildHueMap(projects), [projects]);

  // Time-domain model first; pixels only once the horizon is known.
  const bands: BandModel[] = useMemo(() => {
    return CATEGORY_ORDER.map((category) => {
      const pool = variant.people[category] ?? 0;
      const catProjects = projects.filter((p) => p.category === category);

      // Without people nothing can be scheduled — the queue would run forever.
      if (pool <= 0) {
        return {
          category,
          pool,
          rows: catProjects.map((project) => ({
            project,
            kind: "unstaffed" as RowKind,
            start: 0,
            end: 0,
            segs: [],
            want: assignments[project.id] ?? 0,
            over: false,
          })),
          idle: [],
          transfers: [],
          activeCount: 0,
          noCapacity: catProjects.length > 0,
        };
      }

      const schedule = computeCategorySchedule(catProjects, assignments, pool);
      const rows: RowModel[] = [];

      if (schedule) {
        for (const g of schedule.graded) {
          rows.push({
            project: g.project,
            kind: "active",
            start: g.startMonths,
            end: g.endMonths,
            segs: g.segments,
            want: g.target,
            over: g.isImpossible,
          });
        }
        for (const t of schedule.tail) {
          rows.push({
            project: t.project,
            kind: schedule.pendingIds.has(t.project.id) ? "waiting" : "unstaffed",
            start: t.startMonths,
            end: t.endMonths,
            segs: [],
            want: assignments[t.project.id] ?? 0,
            over: false,
          });
        }
      } else {
        for (const bar of buildCategoryBars(catProjects, categoryCapacityPerMonth(pool))) {
          rows.push({
            project: bar.project,
            kind: assignments[bar.project.id] != null ? "waiting" : "unstaffed",
            start: bar.startMonths,
            end: bar.endMonths,
            segs: [],
            want: assignments[bar.project.id] ?? 0,
            over: false,
          });
        }
      }

      rows.sort((a, b) => a.start - b.start || a.project.id.localeCompare(b.project.id));

      return {
        category,
        pool,
        rows,
        idle: schedule?.idleSegments ?? [],
        transfers: schedule?.transfers ?? [],
        activeCount: schedule?.graded.length ?? 0,
        noCapacity: false,
      };
    });
  }, [projects, variant, assignments]);

  const D = DENSITIES.find((d) => d.id === densityId) ?? DENSITIES[1];
  const ppm = (ZOOMS.find((z) => z.id === zoomId) ?? ZOOMS[1]).ppm;
  const nameW = nameCollapsed ? D.nameCol : D.name;
  const barTop = Math.round((D.row - D.bar) / 2);
  const showNames = !nameCollapsed;

  const landing = useMemo(() => {
    let max = 0;
    for (const band of bands) {
      for (const row of band.rows) {
        if (Number.isFinite(row.end)) max = Math.max(max, row.end);
      }
    }
    return max;
  }, [bands]);

  const months = Math.max(12, Math.ceil(landing / 6) * 6 + 6);
  const totalW = months * ppm;

  const now = useMemo(() => new Date(), []);
  const startYear = now.getFullYear();
  const startMonth = now.getMonth();

  const { ticks, tickLabels, gridlines } = useMemo(
    () => buildAxis(months, ppm, startYear, startMonth),
    [months, ppm, startYear, startMonth],
  );

  const landMonth = startMonth + Math.round(landing);
  const landLabel = `${MON[landMonth % 12]} ${startYear + Math.floor(landMonth / 12)}`;
  const totalIdle = bands.reduce(
    (sum, b) => sum + b.idle.reduce((s, i) => s + i.idlePeople * (i.endMonths - i.startMonths), 0),
    0,
  );
  const warnCount = bands.reduce((sum, b) => sum + b.rows.filter((r) => r.over).length, 0);

  function sizeIndex(project: Project) {
    return ESTIMATE_ORDER.indexOf(project.estimate) + 1;
  }

  function renderRow(band: BandModel, row: RowModel) {
    const hue = hueById[row.project.id] ?? HUES[0];
    const hovered = hover === row.project.id;
    const promised = Math.max(1, row.want || 1);
    const ceiling = Math.min(promised, band.pool);
    const left = Math.round(row.start * ppm);
    const width = band.noCapacity ? 0 : Math.max(4, Math.round((row.end - row.start) * ppm));

    let envStyle = "dashed";
    let envColor = envc(hue);
    let envFill = "transparent";
    let outLabel = "";
    let outLabelColor = "var(--ink-3)";
    let hasOutLabel = false;
    let segs: {
      left: number;
      w: number;
      h: number;
      color: string;
      edge: string;
      inside: boolean;
      labelY: number;
      labelColor: string;
      people: number;
    }[] = [];

    if (band.noCapacity) {
      envStyle = "dotted";
      envColor = "var(--line-strong)";
      hasOutLabel = true;
      outLabel = "no people in this category";
      outLabelColor = "var(--warn)";
    } else if (row.kind === "active") {
      envFill = wash(hue, 0.09);
      if (row.over) {
        envColor = "var(--warn)";
        envFill = "var(--warn-wash)";
      }
      segs = row.segs.map((s) => {
        const sw = Math.max(2, Math.round((s.endMonths - s.startMonths) * ppm));
        const ratio = Math.min(1, s.peopleActive / promised);
        const h = Math.max(3, Math.round(ratio * D.bar));
        const full = s.peopleActive >= ceiling && !row.over;
        return {
          left: Math.round((s.startMonths - row.start) * ppm),
          w: sw,
          h,
          color: full ? solid(hue) : soft(hue),
          edge: row.segs.length > 1 ? "var(--band)" : "transparent",
          inside: sw >= 20 && h >= 12,
          labelY: Math.max(2, Math.round((h - 10) / 2)),
          labelColor: full ? "var(--on-bar)" : "var(--ink)",
          people: Math.round(s.peopleActive),
        };
      });
      const tiny = row.segs.filter(
        (s) =>
          (s.endMonths - s.startMonths) * ppm < 20 ||
          Math.round(Math.min(1, s.peopleActive / promised) * D.bar) < 12,
      );
      if (row.segs.length > 0 && tiny.length === row.segs.length) {
        hasOutLabel = true;
        outLabel = `${row.segs.map((s) => Math.round(s.peopleActive)).join("→")} of ${promised}`;
        outLabelColor = "var(--ink-2)";
      } else if (row.over) {
        hasOutLabel = true;
        outLabel = `${row.want} asked · ${band.pool} exist`;
        outLabelColor = "var(--warn)";
      }
    } else if (row.kind === "waiting") {
      envFill = `repeating-linear-gradient(90deg, ${wash(hue, 0.22)} 0 3px, transparent 3px 6px)`;
      hasOutLabel = true;
      outLabel = `waiting · ${row.want} held`;
      outLabelColor = envc(hue);
    } else {
      envStyle = "dotted";
      envColor = "var(--line-strong)";
      envFill = "repeating-linear-gradient(90deg, var(--line-soft) 0 4px, transparent 4px 8px)";
      hasOutLabel = true;
      outLabel = "unstaffed";
      outLabelColor = "var(--ink-4)";
    }

    const optionMax = Math.max(band.pool, row.want);
    const options = [];
    for (let n = 1; n <= optionMax; n++) {
      const selected = n === row.want;
      options.push({
        n,
        selected,
        bg: selected ? solid(hue) : n > band.pool ? "transparent" : "var(--surface-2)",
        fg: selected ? "var(--on-bar)" : n > band.pool ? "var(--warn)" : "var(--ink)",
        border: selected ? solid(hue) : n > band.pool ? "var(--warn)" : "var(--line-strong)",
      });
    }

    const size = sizeIndex(row.project);
    const personMonths = effortDays(row.project) / EFFECTIVE_DAYS_PER_PERSON_PER_MONTH;

    return (
      <div
        key={row.project.id}
        className="atl-row"
        style={{ height: D.row, background: hovered ? "var(--row-hover)" : "transparent" }}
        onMouseEnter={() => setHover(row.project.id)}
        onMouseLeave={() => setHover((h) => (h === row.project.id ? null : h))}
      >
        <div
          className="atl-row-name"
          style={{ width: nameW, background: hovered ? "var(--name-hover)" : "var(--band)" }}
          title={row.project.name}
        >
          <span className="atl-hue" style={{ height: D.bar, background: solid(hue), opacity: 0.9 }} />
          <span className="atl-row-id" style={{ fontSize: D.fsMono }}>
            {row.project.id.toUpperCase()}
          </span>
          {showNames && (
            <span className="atl-row-title" style={{ fontSize: D.fsName }}>
              {row.project.name}
            </span>
          )}
          <span
            className="atl-size"
            title={`${row.project.estimate} — ${fmt(personMonths)} person-months`}
          >
            <span className="atl-size-ticks">
              {[0, 1, 2, 3, 4].map((k) => (
                <i
                  key={k}
                  style={{
                    height: 4 + k * 2,
                    background: k < size ? "var(--ink-3)" : "var(--line-strong)",
                  }}
                />
              ))}
            </span>
            <span className="atl-size-label">{row.project.estimate}</span>
          </span>
        </div>

        <div className="atl-row-track" style={{ width: totalW, height: D.row }}>
          {gridlines.map((x) => (
            <div key={x} className="atl-grid" style={{ left: x, height: D.row, background: "var(--line)" }} />
          ))}

          {width > 0 && (
            <div
              className="atl-bar"
              style={{
                left,
                top: barTop,
                width,
                height: D.bar,
                border: `1px ${envStyle} ${envColor}`,
                background: envFill,
                boxShadow: hovered ? "0 0 0 2px var(--band), 0 0 0 3.5px var(--ink-2)" : "none",
              }}
              onClick={(e) => {
                e.stopPropagation();
                setPopover((p) => (p === row.project.id ? null : row.project.id));
              }}
            >
              {segs.map((s, i) => (
                <div
                  key={i}
                  className="atl-seg-fill"
                  style={{
                    left: s.left,
                    width: s.w,
                    height: s.h,
                    background: s.color,
                    borderRight: `1px solid ${s.edge}`,
                  }}
                >
                  {s.inside && (
                    <span className="atl-seg-people" style={{ bottom: s.labelY, color: s.labelColor }}>
                      {s.people}
                    </span>
                  )}
                </div>
              ))}
              {row.over && <div className="atl-bar-over" />}
            </div>
          )}

          {hasOutLabel && (
            <div
              className="atl-out-label"
              style={{ left: left + width, top: barTop, height: D.bar, color: outLabelColor }}
            >
              {outLabel}
            </div>
          )}

          {popover === row.project.id && (
            <div
              className="atl-pop"
              style={{ left: Math.max(0, left + 8), top: barTop + D.bar + 6 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="atl-pop-head">
                <span>People on {row.project.id.toUpperCase()}</span>
                <span className="atl-pop-max">max {band.pool}</span>
              </div>
              {options.length > 0 ? (
                <div className="atl-pop-grid">
                  {options.map((o) => (
                    <button
                      key={o.n}
                      type="button"
                      style={{ background: o.bg, color: o.fg, border: `1px solid ${o.border}` }}
                      onClick={() => {
                        setAssignment(row.project.id, o.n);
                        setPopover(null);
                      }}
                    >
                      {o.n}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="atl-pop-note">This category has nobody to assign.</p>
              )}
              {/* Picking a number applies it and closes — nothing to confirm. */}
              <div className="atl-pop-foot">
                <button
                  type="button"
                  className="atl-pop-clear"
                  onClick={() => {
                    removeAssignment(row.project.id);
                    setPopover(null);
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderBand(band: BandModel) {
    const rowIndex: Record<string, number> = {};
    band.rows.forEach((r, i) => {
      rowIndex[r.project.id] = i;
    });

    const spanEnd = band.rows.reduce(
      (max, r) => (Number.isFinite(r.end) ? Math.max(max, r.end) : max),
      0,
    );
    const spanPx = Math.round(spanEnd * ppm);
    const rowsH = band.rows.length * D.row;
    const idlePM = band.idle.reduce((s, i) => s + i.idlePeople * (i.endMonths - i.startMonths), 0);

    const overs = band.rows.filter((r) => r.over).length;
    const waits = band.rows.filter((r) => r.kind === "waiting").length;
    const warnBits: string[] = [];
    if (overs) warnBits.push(`▲ ${overs} over-committed`);
    if (waits) warnBits.push(`◷ ${waits} waiting`);

    const handoffs = band.transfers
      .map((t) => {
        const fromRow = rowIndex[t.fromProjectId];
        const toRow = rowIndex[t.toProjectId];
        if (fromRow == null || toRow == null) return null;
        const xi = t.atMonths * ppm;
        const y1 = fromRow * D.row + D.row / 2;
        const y2 = toRow * D.row + D.row / 2;
        const x0 = Math.max(6, xi - 11);
        const label = `+${Math.round(t.people)}`;
        const chipW = 10 + label.length * 6;
        return {
          d: `M ${xi.toFixed(1)} ${y1} L ${x0.toFixed(1)} ${y1} L ${x0.toFixed(1)} ${y2} L ${(xi - 6).toFixed(1)} ${y2}`,
          head: `${xi.toFixed(1)},${y2} ${(xi - 6).toFixed(1)},${y2 - 3.4} ${(xi - 6).toFixed(1)},${y2 + 3.4}`,
          label,
          color: solid(hueById[t.fromProjectId] ?? HUES[0]),
          chipLeft: Math.round(Math.max(0, x0 - chipW - 3)),
          chipTop: Math.round((y1 + y2) / 2 - 7.5),
        };
      })
      .filter((h): h is NonNullable<typeof h> => h !== null);

    // Idle labels sit inside a wide block, otherwise just past its end — and
    // drop out entirely when the previous one would collide.
    let labelGuard = -1e9;
    const idleBlocks = band.idle.map((i, index) => {
      const w = Math.max(3, Math.round((i.endMonths - i.startMonths) * ppm));
      const left = Math.round(i.startMonths * ppm);
      let label = `${Math.round(i.idlePeople)} idle · ${fmt(i.endMonths - i.startMonths)}mo`;
      const inside = w >= 96;
      const labelX = inside ? left + 4 : left + w + 6;
      const show = labelX >= labelGuard;
      if (show) labelGuard = labelX + label.length * 6.3 + 8;
      else label = "";
      return {
        key: index,
        left,
        w,
        label,
        labelX,
        h: Math.max(4, Math.round((i.idlePeople / Math.max(1, band.pool)) * (D.lane - 20))),
      };
    });

    return (
      <section className="atl-band" key={band.category}>
        <div className="atl-band-head" style={{ height: D.band }}>
          <div className="atl-band-name" style={{ width: nameW }}>
            <div style={{ flex: "none", width: 3, height: D.bar, background: "var(--ink-3)", opacity: 0.6 }} />
            <b>{band.category}</b>
            {/* the collapsed column has no room for both — the name wins */}
            {showNames && (
              <span className="atl-band-people">
                {band.pool} {band.pool === 1 ? "person" : "people"}
              </span>
            )}
          </div>
          <div className="atl-band-track" style={{ width: totalW }}>
            <div
              style={{
                position: "absolute",
                left: 0,
                top: Math.round(D.band / 2),
                width: spanPx,
                height: 1,
                background: "var(--line-strong)",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 0,
                top: Math.round(D.band / 2 - 5),
                width: 1,
                height: 11,
                background: "var(--line-strong)",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: spanPx,
                top: Math.round(D.band / 2 - 5),
                width: 1,
                height: 11,
                background: "var(--line-strong)",
              }}
            />
            <div className="atl-band-chips" style={{ left: spanPx, height: D.band }}>
              <span style={{ color: "var(--ink-2)" }}>{spanEnd ? `${fmt(spanEnd)} mo` : "—"}</span>
              {idleBlocks.length > 0 && (
                <span style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--idle)" }}>
                  <span
                    style={{
                      width: 9,
                      height: 9,
                      background:
                        "repeating-linear-gradient(45deg, var(--idle) 0 1px, transparent 1px 4px)",
                      border: "1px solid var(--idle)",
                    }}
                  />
                  {fmt(idlePM)} person-months spare
                </span>
              )}
              {warnBits.length > 0 && <span style={{ color: "var(--warn)" }}>{warnBits.join("   ")}</span>}
              {band.activeCount > 1 && <span className="atl-band-badge">shared pool</span>}
            </div>
          </div>
        </div>

        <div className="atl-rows">
          {band.rows.map((row) => renderRow(band, row))}

          {band.rows.length === 0 && (
            <div className="atl-row" style={{ height: D.row }}>
              <div className="atl-empty-name" style={{ width: nameW }}>
                — empty
              </div>
              <div className="atl-empty-note" style={{ width: totalW }}>
                No projects in this category. {band.pool} {band.pool === 1 ? "person" : "people"}{" "}
                unallocated for the whole horizon.
              </div>
            </div>
          )}

          {handoffs.length > 0 && (
            <>
              <svg
                className="atl-flow"
                width={totalW}
                height={rowsH}
                viewBox={`0 0 ${totalW} ${rowsH}`}
                style={{ left: nameW }}
                aria-hidden="true"
              >
                {handoffs.map((h, i) => (
                  <g key={i}>
                    <path d={h.d} fill="none" stroke={h.color} strokeWidth="1.3" strokeLinejoin="round" />
                    <polygon points={h.head} fill={h.color} />
                  </g>
                ))}
              </svg>
              <div className="atl-flow-chips" style={{ left: nameW, width: totalW, height: rowsH }}>
                {handoffs.map((h, i) => (
                  <div
                    key={i}
                    className="atl-flow-chip"
                    style={{ left: h.chipLeft, top: h.chipTop, border: `1px solid ${h.color}`, color: h.color }}
                  >
                    {h.label}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {idleBlocks.length > 0 && (
          <div className="atl-spare" style={{ height: D.lane }}>
            <div className="atl-spare-name" style={{ width: nameW }}>
              spare
            </div>
            <div style={{ position: "relative", flex: "none", width: totalW, height: D.lane }}>
              {idleBlocks.map((b) => (
                <div key={b.key}>
                  <div className="atl-spare-block" style={{ left: b.left, width: b.w, height: b.h }} />
                  {b.label && (
                    <span className="atl-spare-label" style={{ left: b.labelX }}>
                      {b.label}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    );
  }

  const projectCount = bands.reduce((sum, b) => sum + b.rows.length, 0);
  const themeLabel = theme === "auto" ? "AUTO" : theme === "dark" ? "DARK" : "LIGHT";

  return (
    <div
      className="atl"
      data-theme={theme === "auto" ? undefined : theme}
      role="dialog"
      aria-modal="true"
      aria-label="Capacity timeline"
    >
      <header className="atl-header" style={{ height: D.hdr }}>
        <div className="atl-title">
          <b>Capacity timeline</b>
          <span className="atl-chip">advanced</span>
        </div>

        <div className="atl-group is-divided">
          <span className="atl-eyebrow" style={{ paddingLeft: 10 }}>
            variant
          </span>
          <div className="atl-seg">
            {variants.map((v) => (
              <button
                key={v.id}
                type="button"
                className={`atl-seg-text ${v.id === variantId ? "is-active" : ""}`}
                onClick={() => {
                  onVariantChange(v.id);
                  setPopover(null);
                }}
              >
                {v.label}
              </button>
            ))}
          </div>
          <button type="button" className="atl-btn" onClick={() => setEditorOpen(true)}>
            Edit…
          </button>
        </div>

        <div className="atl-spacer" />

        <div className="atl-group">
          <span className="atl-eyebrow" title="row density">
            den
          </span>
          <div className="atl-seg">
            {DENSITIES.map((d) => (
              <button
                key={d.id}
                type="button"
                className={`atl-seg-icon ${d.id === D.id ? "is-active" : ""}`}
                onClick={() => setDensityId(d.id)}
              >
                {d.label}
              </button>
            ))}
          </div>
          <span className="atl-eyebrow" title="months per screen" style={{ paddingLeft: 3 }}>
            zoom
          </span>
          <div className="atl-seg">
            {ZOOMS.map((z) => (
              <button
                key={z.id}
                type="button"
                className={`atl-seg-icon ${z.id === zoomId ? "is-active" : ""}`}
                onClick={() => setZoomId(z.id)}
              >
                {z.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`atl-btn ${keyOpen ? "is-on" : ""}`}
            onClick={() => setKeyOpen((v) => !v)}
          >
            Key
          </button>
          <button
            type="button"
            className="atl-btn is-mono"
            onClick={onCycleTheme}
          >
            {themeLabel}
          </button>
          <button type="button" className="atl-btn" onClick={onExitAdvanced}>
            Simple
          </button>
          <div className="atl-rule" />
          <button type="button" className="atl-close" onClick={onClose} aria-label="Close timeline">
            ×
          </button>
        </div>
      </header>

      {keyOpen && (
        <div className="atl-key">
          <div className="atl-key-item">
            <div className="atl-key-bar">
              <i style={{ left: 0, width: 16, height: 13, background: "var(--accent)", borderRadius: 1 }} />
              <i style={{ left: 16, width: 18, height: 7, background: "var(--accent-soft)" }} />
            </div>
            <span>bar height = share of promised people · dashed envelope = full strength · hue = the project</span>
          </div>
          <div className="atl-key-item">
            <div className="atl-key-hatch" />
            <span>spare people in a category, over a time range</span>
          </div>
          <div className="atl-key-item">
            <svg width="30" height="15" viewBox="0 0 30 15" aria-hidden="true">
              <path d="M26 3 L18 3 L18 11 L25 11" fill="none" stroke="var(--accent)" strokeWidth="1.2" />
              <polygon points="25,11 20,8.8 20,13.2" fill="var(--accent)" />
            </svg>
            <span>people handed off from a finishing project</span>
          </div>
          <div className="atl-key-item">
            <div className="atl-key-warn" />
            <span>over-committed — asked for more than the pool holds</span>
          </div>
          <div className="atl-key-item">
            <div className="atl-key-wait" />
            <span>waiting — queued behind unstaffed work</span>
          </div>
          <div className="atl-key-item">
            <span className="atl-key-num">4</span>
            <span>people on the work, at that moment</span>
          </div>
        </div>
      )}

      <div className="atl-scroll" onClick={() => popover && setPopover(null)}>
        <div className="atl-axis" style={{ height: D.axis }}>
          <div className="atl-axis-corner" style={{ width: nameW }}>
            <span className="atl-eyebrow">{nameCollapsed ? "id" : "project"}</span>
            <button
              type="button"
              className="atl-collapse"
              title="collapse project column"
              onClick={() => setNameCollapsed((v) => !v)}
            >
              {nameCollapsed ? "»" : "«"}
            </button>
          </div>
          <div className="atl-track" style={{ width: totalW, height: D.axis }}>
            {ticks.map((t, i) => (
              <div key={i} className="atl-tick" style={{ left: t.x, height: t.h, background: t.color }} />
            ))}
            {tickLabels.map((t, i) => (
              <div key={i} className="atl-tick-label" style={{ left: t.x, color: t.color }}>
                {t.label}
              </div>
            ))}
          </div>
        </div>

        {bands.map((band) => renderBand(band))}

        <div style={{ display: "flex", height: D.axis }}>
          <div
            style={{
              position: "sticky",
              left: 0,
              zIndex: 4,
              flex: "none",
              width: nameW,
              background: "var(--surface)",
              borderRight: "1px solid var(--line-strong)",
            }}
          />
          <div style={{ flex: "none", width: totalW }} />
        </div>
      </div>

      <footer className="atl-footer" style={{ height: D.foot }}>
        <span>{variantCaption(variant.label)}</span>
        <span>
          {projectCount} projects · {CATEGORY_ORDER.length} categories
        </span>
        <span>all work lands {landLabel}</span>
        <span style={{ color: "var(--idle)" }}>{fmt(totalIdle)} person-months idle</span>
        {warnCount > 0 && <span style={{ color: "var(--warn)" }}>{warnCount} over-committed</span>}
        <span style={{ flex: 1 }} />
        <span>esc closes popover · then variants · then view</span>
      </footer>

      {editorOpen && (
        <VariantEditor
          api={variantsApi}
          activeId={variant.id}
          onActivate={onVariantChange}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </div>
  );
}
