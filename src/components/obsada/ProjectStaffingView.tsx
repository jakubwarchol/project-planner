/**
 * Projekty — one row per project: a lane per assigned person, coloured by the
 * capability they cover, plus one hatched lane on top for whatever the plan
 * still asks for and nobody carries.
 *
 * The shortfall is summed **per capability, positive parts only**. Netting a
 * spare backend against a missing PM would report a fully staffed project with
 * nobody managing it — the pools are separate in the scheduler, so they stay
 * separate here.
 */
import { useMemo, useState } from "react";
import { CATEGORY_ORDER } from "../../lib/estimation";
import { buildProjectStaffingRows, type ProjectStaffingRow } from "../../lib/staffing";
import type { Project } from "../../types";
import { CAPABILITY_HUES, fmt2, plCount, solid } from "../timelineChrome";
import { AxisBackdrop, AxisHeader, ObsadaToolbar } from "./ObsadaGrid";
import { AXIS_H, useTimelineScroll } from "./timelineScroll";
import { buildObsadaAxis, focusLabel, shortDay, stepTo } from "./axis";
import type { ObsadaContext } from "./ObsadaWorkspace";
import { UnderlineTabs } from "../../design";

const LEFT_W = 246;
const HEAD_H = 24;
const LANE_H = 24;
const LANE_GAP = 2;
const ROW_PAD = 8;
const GROUP_H = 24;
const CHIP_H = 15;
const EPS = 1e-6;


function bandHeight(row: ProjectStaffingRow): number {
  const lanes = Math.max(1, row.laneCount + (row.anyGap ? 1 : 0));
  return lanes * (LANE_H + LANE_GAP) - LANE_GAP;
}

interface ProjectStaffingViewProps {
  ctx: ObsadaContext;
  projects: Project[];
}

export function ProjectStaffingView({ ctx, projects }: ProjectStaffingViewProps) {
  const [gapsOnly, setGapsOnly] = useState(false);

  const axis = useMemo(() => buildObsadaAxis(ctx.window, ctx.unit), [ctx.window, ctx.unit]);
  const scroll = useTimelineScroll(ctx.anchorDayRef, axis);
  const X = useMemo(() => (d: number) => Math.round(d * axis.pxPerDay), [axis.pxPerDay]);

  const rowById = useMemo(() => {
    const built = buildProjectStaffingRows(ctx.items, ctx.assignments, ctx.leaves, ctx.window);
    return new Map(built.map((r) => [r.projectId, r]));
  }, [ctx.items, ctx.assignments, ctx.leaves, ctx.window]);

  const personName = useMemo(
    () => (personId: string) => ctx.personById.get(personId)?.name ?? personId,
    [ctx.personById],
  );

  const groups = useMemo(() => {
    const visible = projects.filter((p) => {
      const row = rowById.get(p.id);
      return row && (!gapsOnly || row.anyGap);
    });
    return CATEGORY_ORDER.map((category) => ({
      key: category,
      label: category,
      rows: visible.filter((p) => p.category === category),
    })).filter((g) => g.rows.length);
  }, [projects, rowById, gapsOnly]);

  const rowH = (row: ProjectStaffingRow) => HEAD_H + bandHeight(row) + ROW_PAD;

  const gapProjects = [...rowById.values()].filter((r) => r.anyGap).length;
  const requiredFteDays = ctx.items.reduce((sum, i) => sum + i.requiredFteDays, 0);
  const missingFteDays = [...rowById.values()].reduce((sum, r) => sum + r.missingFteDays, 0);
  const coveredPct = Math.round((1 - missingFteDays / Math.max(1, requiredFteDays)) * 100);

  /** Opens the panel on this project's worst hole — the reason you clicked. */
  const openWorstGap = (projectId: string) => {
    const items = ctx.items.filter((i) => i.projectId === projectId);
    const worst = items
      .map((i) => ({ item: i, gap: ctx.coverage.get(i.id)?.peakGap ?? 0 }))
      .sort((a, b) => b.gap - a.gap)[0];
    if (worst) ctx.openItem(projectId, worst.item.capability);
  };

  return (
    <>
      <ObsadaToolbar
        eyebrow="kto i kiedy w projekcie"
        value={String(coveredPct)}
        unit="% zapotrzebowania obsadzone"
        prose={
          <>
            Każda pozycja planu obok tego, kto ją realnie obsadza. Luka to zapotrzebowanie bez
            człowieka — kliknij wiersz, aby ją domknąć.{" "}
            {plCount(gapProjects, "projekt z luką", "projekty z luką", "projektów z luką")}.
          </>
        }
        focusLabel={focusLabel(ctx.window, ctx.unit, scroll.scrollLeft)}
        onPrev={() => scroll.goTo(stepTo(axis, scroll.scrollLeft, -1))}
        onNext={() => scroll.goTo(stepTo(axis, scroll.scrollLeft, 1))}
        onToday={scroll.goToday}
        timeUnit={ctx.unit}
        onUnit={ctx.setUnit}
      >
        <UnderlineTabs
          label="Filtr projektów"
          value={gapsOnly ? "gaps" : "all"}
          onChange={(id) => setGapsOnly(id === "gaps")}
          items={[
            { id: "all" as const, label: "Wszystkie" },
            { id: "gaps" as const, label: "Z lukami" },
          ]}
        />
      </ObsadaToolbar>

      <div className="obs-scroll" ref={scroll.ref} onScroll={scroll.onScroll}>
        <div className="obs-canvas">
          <div className="obs-left" style={{ width: LEFT_W }}>
            <div className="obs-left-head" style={{ height: AXIS_H }}>
              <span className="atl-eyebrow">projekt</span>
            </div>
            {groups.map((g) => (
              <div key={g.key}>
                <div className="obs-group" style={{ height: GROUP_H }}>
                  <b>{g.label}</b>
                </div>
                {g.rows.map((project) => {
                  const row = rowById.get(project.id)!;
                  return (
                    <div key={project.id} className="obs-name" style={{ height: rowH(row) }}>
                      <div className="obs-name-head" style={{ height: HEAD_H }}>
                        <span
                          className="obs-hue"
                          style={{ background: solid(ctx.hueById[project.id] ?? 232) }}
                        />
                        <span className="obs-name-title" title={project.name}>
                          {project.name}
                        </span>
                        <span className="obs-name-slots">
                          {row.peopleCount ? plCount(row.peopleCount, "osoba", "osoby", "osób") : "—"}
                        </span>
                        <button
                          type="button"
                          className="obs-name-warn is-button"
                          title={
                            row.anyGap
                              ? `brakuje ${fmt2(row.gapRuns.reduce((m, r) => Math.max(m, r.gap), 0))} FTE — otwórz obsadzanie`
                              : "obsadzone"
                          }
                          aria-label={
                            row.anyGap
                              ? `Otwórz obsadzanie — ${project.name} ma lukę`
                              : `${project.name} — obsadzone`
                          }
                          onClick={() => openWorstGap(project.id)}
                        >
                          {row.anyGap ? "!" : ""}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="obs-grid" style={{ width: axis.gridW }}>
            <AxisHeader axis={axis} />
            <AxisBackdrop axis={axis} />
            <div className="obs-rows">
              {groups.map((g) => (
                <div key={g.key}>
                  <div className="obs-group-strip" style={{ height: GROUP_H }} />
                  {g.rows.map((project) => {
                    const row = rowById.get(project.id)!;
                    const gapBottom = row.laneCount * (LANE_H + LANE_GAP);
                    const widestGap = row.gapRuns
                      .slice()
                      .sort((a, b) => b.end - b.start - (a.end - a.start))[0];
                    const firstGap = row.gapRuns[0];
                    return (
                      <div key={project.id} className="obs-track" style={{ height: rowH(row) }}>
                        {firstGap && (
                          <span
                            className="obs-mark"
                            title={`luka od ${shortDay(ctx.window.originIso, firstGap.start)} · brakuje ${fmt2(firstGap.gap)} FTE`}
                            style={{ left: Math.max(0, X(firstGap.start) - 7), top: Math.max(0, HEAD_H - 16) }}
                          >
                            !
                          </span>
                        )}
                        <div className="obs-band" style={{ top: HEAD_H, height: bandHeight(row) }}>
                          {row.gapRuns.map((gap) => {
                            const left = X(gap.start);
                            const width = Math.max(2, X(gap.end) - left);
                            return (
                              <button
                                key={`g${gap.start}`}
                                type="button"
                                className="obs-gap"
                                title={`bez obsady: brakuje ${fmt2(gap.gap)} FTE · ${shortDay(ctx.window.originIso, gap.start)}–${shortDay(ctx.window.originIso, gap.end - 1)} — otwórz obsadzanie`}
                                onClick={() => openWorstGap(project.id)}
                                style={{ left, width, bottom: gapBottom, height: LANE_H }}
                              >
                                {widestGap && gap.start === widestGap.start && width >= 88 && (
                                  <span>brakuje {fmt2(gap.gap)} FTE</span>
                                )}
                              </button>
                            );
                          })}
                          {row.bars.map((bar) => {
                            const left = X(bar.start);
                            const width = Math.max(2, X(bar.end) - left);
                            const name = personName(bar.assignment.personId);
                            const value = `${bar.assignment.capability} ${fmt2(bar.assignment.fte)}`;
                            const chipW = 8.2 * name.length + 6.6 * value.length + 20;
                            const inside = width >= chipW + 8;
                            return (
                              <button
                                key={bar.assignment.id}
                                type="button"
                                className="obs-lane"
                                title={`${name} · ${bar.assignment.capability} · ${fmt2(bar.assignment.fte)} FTE · ${shortDay(ctx.window.originIso, bar.start)}–${shortDay(ctx.window.originIso, bar.end - 1)} — otwórz obsadzanie`}
                                onClick={() => ctx.openItem(project.id, bar.assignment.capability)}
                                style={{
                                  left,
                                  width,
                                  bottom: bar.lane * (LANE_H + LANE_GAP),
                                  height: LANE_H,
                                  background: solid(CAPABILITY_HUES[bar.assignment.capability] ?? 232),
                                }}
                              >
                                {inside && (
                                  <span className="obs-lane-chip" style={{ height: CHIP_H }}>
                                    <span>{name}</span>
                                    <em>{value}</em>
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <footer className="obs-foot">
        <span>
          {plCount(groups.reduce((n, g) => n + g.rows.length, 0), "projekt", "projekty", "projektów")} ·{" "}
          {plCount(ctx.assignments.length, "przypisanie", "przypisania", "przypisań")}
        </span>
        <span>
          {missingFteDays > EPS
            ? `nieobsadzone ${fmt2(missingFteDays / ctx.workingDaysPerMonth)} osobomiesięcy`
            : "wszystko obsadzone"}
        </span>
        <span className="atl-spacer" />
        <span>pasek = przypisana osoba · kreskowane = bez obsady · ! = początek luki</span>
      </footer>
    </>
  );
}
