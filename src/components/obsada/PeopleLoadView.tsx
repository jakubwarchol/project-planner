/**
 * Ludzie — one band per person, where the band's full height is 100% of that
 * person's availability, divided between whatever projects are live at that
 * moment, and the remainder is hatched as free capacity.
 *
 * That inversion is the whole point of the screen. A lane-per-project chart
 * answers "what is this person on"; a share-of-availability band answers "how
 * much of this person is left", which is the question you open a roster to
 * ask. An over-committed band is scaled to its own peak so the overflow is
 * visible rather than clipped, and the 100% line then sits *inside* the band.
 */
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { CAPABILITY_ORDER } from "../../lib/estimation";
import { addDays, isoOfIndex } from "../../lib/days";
import {
  MAX_PARALLEL_PROJECTS,
  buildPersonLoadRows,
  type PersonLoadRow,
} from "../../lib/staffing";
import type { Capability, Leave, Person, Team } from "../../types";
import type { StaffingApi } from "../../hooks/useStaffing";
import { fmt, fmt2, groupArrowNav, plCount, solid } from "../timelineChrome";
import { AxisBackdrop, AxisHeader, ObsadaToolbar } from "./ObsadaGrid";
import { AXIS_H, useTimelineScroll } from "./timelineScroll";
import { ActionButton, Field, FieldInput, Modal, OverlayGap } from "../../design";
import { buildObsadaAxis, focusLabel, shortDay, stepTo } from "./axis";
import type { ObsadaContext } from "./ObsadaWorkspace";

const LEFT_W = 230;
const HEAD_H = 22;
const BAND_H = 52;
const ROW_PAD = 6;
const GROUP_H = 24;
const CHIP_H = 15;
const EPS = 1e-6;

type Grouping = "team" | "capability";


const pct = (n: number) => `${Math.round(n * 100)}%`;

interface Box {
  key: string;
  left: number;
  width: number;
  bottom: number;
  height: number;
  color: string;
  title: string;
}

interface Chip {
  key: string;
  left: number;
  bottom: number;
  height: number;
  name: string;
  value: string;
  projectId: string;
  capability: Capability;
}

interface Painted {
  boxes: Box[];
  free: Box[];
  chips: Chip[];
  tags: Chip[];
  overMark: { left: number; title: string } | null;
  unitPx: number;
}

/**
 * Turns a row's slices into stacked boxes. `unitPx` is where 100% of the
 * person sits: a band that never exceeds capacity uses the whole height, and
 * one that does is scaled down so its peak still fits, which is what keeps an
 * overloaded person from painting over the row above.
 */
function paintRow(
  row: PersonLoadRow,
  originIso: string,
  windowDays: number,
  X: (d: number) => number,
  hueById: Record<string, number>,
  nameOf: (projectId: string) => string,
): Painted {
  const scale = Math.max(1, row.peak / Math.max(0.01, row.capacity));
  const unitPx = Math.round(BAND_H / scale);
  const boxes: Box[] = [];
  const free: Box[] = [];
  const widest = new Map<string, { left: number; right: number; width: number; bottom: number; height: number; share: number }>();
  let overMark: Painted["overMark"] = null;

  for (const slice of row.slices) {
    const left = X(slice.start);
    const width = Math.max(1, X(slice.end) - left);
    let acc = 0;
    for (const s of slice.shares) {
      const h = Math.max(3, Math.round(Math.min(1, s.share) * unitPx));
      const a = s.assignment;
      boxes.push({
        key: `${a.id}-${slice.start}`,
        left,
        width,
        bottom: acc,
        // 1px shaved off the top separates stacked projects without drawing a
        // rule through every slice boundary.
        height: Math.max(2, h - 1),
        color: solid(hueById[a.projectId] ?? 232),
        title: `${nameOf(a.projectId)} · ${a.capability} · ${pct(s.share)} etatu (${fmt2(a.fte)} FTE) · ${shortDay(originIso, slice.start)}–${shortDay(originIso, slice.end - 1)}`,
      });
      const prev = widest.get(a.id);
      if (!prev || width > prev.width) {
        widest.set(a.id, { left, right: X(slice.end), width, bottom: acc, height: h, share: s.share });
      }
      acc += h;
    }
    if (acc > unitPx + 1 && !overMark) {
      overMark = {
        left,
        title: `przeciążenie od ${shortDay(originIso, slice.start)} · ${pct(acc / unitPx)} etatu`,
      };
    }
    const gap = unitPx - acc;
    if (gap > 3) {
      free.push({
        key: `f${slice.start}`,
        left,
        width,
        bottom: acc,
        height: gap,
        color: "",
        title: `wolne ${pct(Math.max(0, 1 - acc / unitPx))} etatu · ${shortDay(originIso, slice.start)}–${shortDay(originIso, slice.end - 1)}`,
      });
    }
  }

  // The whole span between and around the busy stretches is free capacity too,
  // right out to the end of the window — a person with nothing on in March is
  // *free* in March, and an empty row would leave you to infer that. This is
  // also the only thing that draws anything at all for someone with no
  // assignments yet, which is every person on a plan nobody has staffed.
  const covered = row.slices.map((s) => ({ start: s.start, end: s.end })).sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const s of covered) {
    if (s.start > cursor) free.push(emptyBox(cursor, s.start, unitPx, X, originIso));
    cursor = Math.max(cursor, s.end);
  }
  if (cursor < windowDays) free.push(emptyBox(cursor, windowDays, unitPx, X, originIso));

  // Labels slide along their own run to the first spot nothing else has taken;
  // a run too short or too thin for a chip drops a tag beside itself instead.
  const chips: Chip[] = [];
  const tags: Chip[] = [];
  const placed: { x: number; y: number; w: number }[] = [];
  const isFree = (x: number, y: number, w: number) =>
    !placed.some((p) => x < p.x + p.w && x + w > p.x && y < p.y + CHIP_H && y + CHIP_H > p.y);

  const byRun = new Map(row.runs.map((r) => [r.assignment.id, r]));
  for (const [id, r] of [...widest.entries()].sort((a, b) => b[1].width - a[1].width)) {
    const run = byRun.get(id);
    if (!run) continue;
    const name = nameOf(run.assignment.projectId);
    const value = pct(r.share);
    const chipW = 8.2 * name.length + 6.6 * value.length + 20;
    const y = r.bottom + Math.max(0, (r.height - CHIP_H) / 2);
    const common = {
      key: id,
      bottom: r.bottom,
      name,
      value,
      projectId: run.assignment.projectId,
      capability: run.assignment.capability,
    };
    if (r.height >= 12 && r.width >= chipW + 8) {
      let x: number | null = null;
      for (let cand = r.left + 5; cand <= r.left + r.width - chipW - 3; cand += 36) {
        if (isFree(cand, y, chipW)) {
          x = cand;
          break;
        }
      }
      if (x != null) {
        placed.push({ x, y, w: chipW });
        chips.push({ ...common, left: x, height: r.height });
        continue;
      }
    }
    const text = `${name} ${value}`;
    const tagW = 6.4 * text.length;
    const tagX = X(run.end) + 7;
    if (isFree(tagX, y, tagW)) {
      placed.push({ x: tagX, y, w: tagW });
      tags.push({ ...common, left: tagX, height: Math.max(CHIP_H, r.height) });
    }
  }

  return { boxes, free, chips, tags, overMark, unitPx };
}

function emptyBox(start: number, end: number, unitPx: number, X: (d: number) => number, originIso: string): Box {
  return {
    key: `e${start}`,
    left: X(start),
    width: Math.max(1, X(end) - X(start)),
    bottom: 0,
    height: unitPx,
    color: "",
    title: `wolne 100% etatu · ${shortDay(originIso, start)}–${shortDay(originIso, Math.max(start, end - 1))}`,
  };
}

interface PeopleLoadViewProps {
  ctx: ObsadaContext;
  people: Person[];
  teams: Team[];
  staffing: StaffingApi;
}

export function PeopleLoadView({ ctx, people, teams, staffing }: PeopleLoadViewProps) {
  const [grouping, setGrouping] = useState<Grouping>("team");
  const [leaveDraft, setLeaveDraft] = useState<{ personId: string; leave?: Leave } | null>(null);

  const axis = useMemo(() => buildObsadaAxis(ctx.window, ctx.unit), [ctx.window, ctx.unit]);
  const scroll = useTimelineScroll(ctx.anchorDayRef, axis);
  const X = useMemo(() => (d: number) => Math.round(d * axis.pxPerDay), [axis.pxPerDay]);

  const rows = useMemo(
    () => buildPersonLoadRows(people, staffing.assignments, staffing.leaves, ctx.window),
    [people, staffing.assignments, staffing.leaves, ctx.window],
  );

  const nameOf = useMemo(
    () => (projectId: string) => ctx.projectById.get(projectId)?.name ?? projectId,
    [ctx.projectById],
  );

  const painted = useMemo(
    () =>
      new Map(
        rows.map((row) => [
          row.person.id,
          paintRow(row, ctx.window.originIso, ctx.window.windowDays, X, ctx.hueById, nameOf),
        ]),
      ),
    [rows, ctx.window, X, ctx.hueById, nameOf],
  );

  const byId = useMemo(() => new Map(rows.map((r) => [r.person.id, r])), [rows]);
  const groups = useMemo(() => {
    const built =
      grouping === "team"
        ? teams.map((team) => ({
            key: team.id,
            label: team.label,
            rows: people.filter((p) => p.teamId === team.id).map((p) => byId.get(p.id)!),
          }))
        : CAPABILITY_ORDER.map((cap) => ({
            key: cap,
            label: cap,
            rows: people
              .filter((p) => p.allocations.some((a) => a.capability === cap && a.fte > EPS))
              .map((p) => byId.get(p.id)!),
          }));
    return built.filter((g) => g.rows.length);
  }, [grouping, teams, people, byId]);

  const rowH = (row: PersonLoadRow) =>
    HEAD_H + BAND_H + ROW_PAD + ((painted.get(row.person.id)?.overMark ? 2 : 0));

  const overCount = rows.filter((r) => r.peak > r.capacity + EPS).length;
  const meanUtil =
    rows.length > 0
      ? rows.reduce((sum, r) => sum + r.util / Math.max(0.01, r.capacity), 0) / rows.length
      : 0;

  return (
    <>
      <ObsadaToolbar
        focusLabel={focusLabel(ctx.window, ctx.unit, scroll.scrollLeft)}
        onPrev={() => scroll.goTo(stepTo(axis, scroll.scrollLeft, -1))}
        onNext={() => scroll.goTo(stepTo(axis, scroll.scrollLeft, 1))}
        onToday={scroll.goToday}
        unit={ctx.unit}
        onUnit={ctx.setUnit}
        summary={
          <span className="obs-sum">
            <span>średnie obłożenie {pct(meanUtil)}</span>
            <span className={overCount ? "is-warn" : undefined}>{overCount} powyżej 100%</span>
          </span>
        }
      >
        <div className="atl-seg" role="tablist" aria-label="Grupowanie osób" onKeyDown={groupArrowNav}>
          <button
            type="button"
            role="tab"
            aria-selected={grouping === "team"}
            tabIndex={grouping === "team" ? 0 : -1}
            className={grouping === "team" ? "is-active" : undefined}
            onClick={() => setGrouping("team")}
          >
            Zespoły
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={grouping === "capability"}
            tabIndex={grouping === "capability" ? 0 : -1}
            className={grouping === "capability" ? "is-active" : undefined}
            onClick={() => setGrouping("capability")}
          >
            Kompetencje
          </button>
        </div>
      </ObsadaToolbar>

      <div className="obs-scroll" ref={scroll.ref} onScroll={scroll.onScroll}>
        <div className="obs-canvas">
          <div className="obs-left" style={{ width: LEFT_W }}>
            <div className="obs-left-head" style={{ height: AXIS_H }}>
              <span className="atl-eyebrow">osoba</span>
            </div>
            {groups.map((g) => (
              <div key={g.key}>
                <div className="obs-group" style={{ height: GROUP_H }}>
                  <b>{g.label}</b>
                </div>
                {g.rows.map((row) => {
                  const p = painted.get(row.person.id);
                  const over = row.peak > row.capacity + EPS;
                  const crowded = row.maxProjects > MAX_PARALLEL_PROJECTS;
                  return (
                    <div key={row.person.id} className="obs-name" style={{ height: rowH(row) }}>
                      <div className="obs-name-head" style={{ height: HEAD_H }}>
                        <span className="obs-name-title" title={row.person.name}>
                          {row.person.name}
                        </span>
                        <span
                          className="obs-name-slots"
                          title={`${row.maxProjects} równoległych projektów w szczycie · przyjęty limit ${MAX_PARALLEL_PROJECTS}`}
                          style={crowded ? { color: "var(--warn)" } : undefined}
                        >
                          {Math.min(MAX_PARALLEL_PROJECTS, row.maxProjects)}/{MAX_PARALLEL_PROJECTS}
                          {crowded ? ` +${row.maxProjects - MAX_PARALLEL_PROJECTS}` : ""}
                        </span>
                        <span
                          className="obs-name-warn"
                          title={
                            over
                              ? p?.overMark?.title ?? `szczyt ${pct(row.peak / Math.max(0.01, row.capacity))} etatu`
                              : ""
                          }
                        >
                          {over ? "!" : ""}
                        </span>
                        <button
                          type="button"
                          className="obs-name-add"
                          title="Dodaj nieobecność"
                          aria-label={`Dodaj nieobecność — ${row.person.name}`}
                          onClick={() => setLeaveDraft({ personId: row.person.id })}
                        >
                          <Plus size={12} />
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
                  {g.rows.map((row) => {
                    const p = painted.get(row.person.id)!;
                    return (
                      <div key={row.person.id} className="obs-track" style={{ height: rowH(row) }}>
                        {row.leaveBands.map((band) => (
                          <button
                            key={band.leave.id}
                            type="button"
                            className="obs-leave"
                            title={`${band.leave.kind} · ${shortDay(ctx.window.originIso, band.start)}–${shortDay(ctx.window.originIso, band.end - 1)}`}
                            onClick={() => setLeaveDraft({ personId: row.person.id, leave: band.leave })}
                            style={{
                              left: X(band.start),
                              width: Math.max(3, X(band.end) - X(band.start)),
                              top: HEAD_H,
                              height: BAND_H,
                            }}
                          />
                        ))}
                        {p.overMark && (
                          <span
                            className="obs-mark"
                            title={p.overMark.title}
                            style={{ left: Math.max(0, p.overMark.left - 7), top: Math.max(0, HEAD_H - 16) }}
                          >
                            !
                          </span>
                        )}
                        <div className="obs-band" style={{ top: HEAD_H, height: BAND_H }}>
                          {p.free.map((b) => (
                            <div
                              key={b.key}
                              className="obs-free"
                              title={b.title}
                              style={{ left: b.left, width: b.width, bottom: b.bottom, height: b.height }}
                            />
                          ))}
                          {p.boxes.map((b) => (
                            <div
                              key={b.key}
                              className="obs-box"
                              title={b.title}
                              style={{
                                left: b.left,
                                width: b.width,
                                bottom: b.bottom,
                                height: b.height,
                                background: b.color,
                              }}
                            />
                          ))}
                          <div className="obs-hundred" style={{ bottom: p.unitPx }} />
                          {p.chips.map((c) => (
                            <button
                              key={c.key}
                              type="button"
                              className="obs-chip"
                              style={{ left: c.left, bottom: c.bottom, height: c.height }}
                              onClick={() => ctx.openItem(c.projectId, c.capability)}
                              title={`${c.name} · ${c.capability} — otwórz obsadzanie`}
                            >
                              <span>{c.name}</span>
                              <em>{c.value}</em>
                            </button>
                          ))}
                          {p.tags.map((c) => (
                            <button
                              key={c.key}
                              type="button"
                              className="obs-tag"
                              style={{ left: c.left, bottom: c.bottom, height: c.height }}
                              onClick={() => ctx.openItem(c.projectId, c.capability)}
                              title={`${c.name} · ${c.capability} — otwórz obsadzanie`}
                            >
                              {c.name} {c.value}
                            </button>
                          ))}
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
          {plCount(people.length, "osoba", "osoby", "osób")} ·{" "}
          {plCount(staffing.assignments.length, "przypisanie", "przypisania", "przypisań")}
        </span>
        <span>wolne łącznie {fmt(rows.reduce((s, r) => s + r.freeFte, 0))} FTE</span>
        <span className="atl-spacer" />
        <span>pasek = 100% dostępności osoby · kreskowane = wolne · ! = początek przeciążenia</span>
      </footer>

      {leaveDraft && (
        <LeaveEditor
          personId={leaveDraft.personId}
          personName={people.find((p) => p.id === leaveDraft.personId)?.name ?? ""}
          leave={leaveDraft.leave}
          originIso={ctx.window.originIso}
          todayIndex={ctx.window.todayIndex}
          staffing={staffing}
          onClose={() => setLeaveDraft(null)}
        />
      )}
    </>
  );
}

interface LeaveEditorProps {
  personId: string;
  personName: string;
  leave?: Leave;
  originIso: string;
  todayIndex: number;
  staffing: StaffingApi;
  onClose: () => void;
}

const LEAVE_KINDS = ["urlop", "L4", "szkolenie", "delegacja"];

function LeaveEditor({
  personId,
  personName,
  leave,
  originIso,
  todayIndex,
  staffing,
  onClose,
}: LeaveEditorProps) {
  const [kind, setKind] = useState(leave?.kind ?? "urlop");
  const [start, setStart] = useState(leave?.startDate ?? isoOfIndex(originIso, todayIndex));
  const [end, setEnd] = useState(leave?.endDate ?? addDays(isoOfIndex(originIso, todayIndex), 7));

  const save = () => {
    // `endDate` is exclusive throughout obsada, so a one-day absence is
    // start + 1 — a saved range that ends before it starts would draw nothing
    // and silently lose the record.
    const safeEnd = end > start ? end : addDays(start, 1);
    const fields = { personId, kind: kind.trim() || "urlop", startDate: start, endDate: safeEnd };
    if (leave) staffing.updateLeave(leave.id, fields);
    else staffing.addLeave(fields);
    onClose();
  };

  return (
    <Modal
      onClose={onClose}
      title={leave ? "Nieobecność" : "Nowa nieobecność"}
      subtitle={personName}
      footer={
        <>
          {leave && (
            <ActionButton
              variant="danger"
              onClick={() => {
                staffing.removeLeave(leave.id);
                onClose();
              }}
            >
              Usuń
            </ActionButton>
          )}
          <OverlayGap />
          <ActionButton onClick={onClose}>Anuluj</ActionButton>
          <ActionButton variant="primary" onClick={save}>
            Zapisz
          </ActionButton>
        </>
      }
    >
      <div className="obs-modal-fields">
        <Field label="rodzaj">
          <FieldInput
            list="obs-leave-kinds"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          />
        </Field>
        <datalist id="obs-leave-kinds">
          {LEAVE_KINDS.map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
        <div className="obs-modal-cols">
          <Field label="od">
            <FieldInput type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="do (wyłącznie)">
            <FieldInput type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
