/**
 * Obsadzanie — the one screen that writes. A queue of demand grouped by
 * project on the left; on the right everything needed to close the selected
 * hole: what the plan asks for, who already covers it, who could, and a wand
 * that proposes a full staffing the user accepts or rejects piece by piece.
 *
 * The queue's project rows are a second scope, not just headers: selecting one
 * opens the widok zbiorczy — the whole project's positions, people and gaps in
 * one place — and the wand then proposes across all of them at once.
 *
 * The three headline figures all read at the item's **thinnest moment**, so
 * `wymagane − obsadzone = brakuje` is true as arithmetic. A worst-instant gap
 * is the honest number here: a person covering half the window has not covered
 * the window, and averaging would say they had.
 *
 * Assigning never moves a date. An assignment always spans the demand item's
 * whole window; the plan's dates come from pools and the crew model, and this
 * layer only records which named person carries which slice of it. Every write
 * leaves a one-step "Cofnij" behind in the toast.
 */
import { useMemo, useState } from "react";
import { Briefcase, TreePalm, WandSparkles } from "lucide-react";
import { isoOfIndex } from "../../lib/days";
import { CAPABILITY_ORDER, allocationFor } from "../../lib/estimation";
import { etat, etatG, fmt2, fold } from "../../lib/etat";
import {
  candidateScore,
  personLoadIn,
  primaryCapability,
  proposeStaffing,
  type DemandItem,
  type ItemCoverage,
} from "../../lib/staffing";
import type { Capability, Person, StaffingAssignment } from "../../types";
import type { StaffingApi } from "../../hooks/useStaffing";
import { groupArrowNav, plCount } from "../timelineChrome";
import { longDay, shortDay } from "./axis";
import type { ObsadaContext, ObsadaSelection } from "./ObsadaWorkspace";

const EPS = 1e-6;
const MAX_ASSIGN_FTE = 2;
const MIN_ASSIGN_FTE = 0.1;

const round1 = (n: number) => Math.round(n * 10) / 10;
const clampFte = (n: number) => Math.min(MAX_ASSIGN_FTE, Math.max(MIN_ASSIGN_FTE, round1(n)));

type SortMode = "match" | "free" | "name";

interface Proposal {
  key: string;
  itemId: string;
  personId: string;
  fte: number;
}

/** One reversible step. `remove`/`removeMany` undo an assign; `add` undoes a
 *  removal by putting the exact record back; `restore` undoes an FTE change. */
type UndoState =
  | { text: string; kind: "remove"; id: string }
  | { text: string; kind: "removeMany"; ids: string[] }
  | { text: string; kind: "add"; assignment: StaffingAssignment }
  | { text: string; kind: "restore"; prev: StaffingAssignment };

interface Scored {
  person: Person;
  allocation: number;
  primary: boolean;
  load: ReturnType<typeof personLoadIn>;
  match: number;
  score: number;
}

interface StaffingPanelViewProps {
  ctx: ObsadaContext;
  people: Person[];
  staffing: StaffingApi;
  selection: ObsadaSelection | null;
  onSelect: (selection: ObsadaSelection) => void;
}

/** Palm-leaf marker with the leave-day count and a hover tooltip. */
function LeaveBadge({ days }: { days: number }) {
  return (
    <span className="obs-leavebadge obs-tipwrap">
      <TreePalm size={14} aria-hidden />
      <span className="obs-leave-days">{days}</span>
      <span className="obs-tip">{plCount(days, "dzień", "dni", "dni")} urlopu w okresie pozycji</span>
    </span>
  );
}

export function StaffingPanelView({ ctx, people, staffing, selection, onSelect }: StaffingPanelViewProps) {
  const [openOnly, setOpenOnly] = useState(true);
  const [capFilter, setCapFilter] = useState<Capability | null>(null);
  const [allPeople, setAllPeople] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("match");
  const [query, setQuery] = useState("");
  const [fteDraft, setFteDraft] = useState<Record<string, number>>({});
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [undo, setUndo] = useState<UndoState | null>(null);

  const { items, coverage, window: win } = ctx;
  // `coverage` is rebuilt whenever assignments change, so everything derived
  // from it re-runs then — which is exactly when a closed hole should leave
  // the "Do obsadzenia" queue.
  const gapOf = (item: DemandItem) => coverage.get(item.id)?.peakGap ?? 0;
  const statOf = (item: DemandItem) => coverage.get(item.id)!;

  // Moving focus drops everything tied to the previous one: drafts, the wand's
  // proposals, and the undo of a step the user has visibly moved on from.
  const select = (next: ObsadaSelection) => {
    onSelect(next);
    setFteDraft({});
    setProposals([]);
    setUndo(null);
  };

  const openItems = useMemo(
    () => items.filter((i) => (coverage.get(i.id)?.missingFteDays ?? 0) > EPS),
    [items, coverage],
  );
  const visible = useMemo(() => {
    let list = openOnly ? openItems : items;
    if (capFilter) list = list.filter((i) => i.capability === capFilter);
    return list;
  }, [items, openItems, openOnly, capFilter]);

  // Selection is sticky: it survives filtering and its own staffing, so
  // closing a hole doesn't yank the screen out from under the user.
  const selected =
    (selection?.kind === "item" ? items.find((i) => i.id === selection.id) : undefined) ??
    visible[0] ??
    openItems[0] ??
    items[0];

  const isProject =
    selection?.kind === "project" && items.some((i) => i.projectId === selection.id);
  const scopeProjectId = isProject ? selection.id : selected?.projectId;

  const totals = useMemo(() => {
    const required = items.reduce((sum, i) => sum + i.requiredFteDays, 0);
    const missing = items.reduce((sum, i) => sum + (coverage.get(i.id)?.missingFteDays ?? 0), 0);
    const closed = items.filter((i) => (coverage.get(i.id)?.coveredPct ?? 0) >= 100).length;
    const requiredPeak = items.reduce((sum, i) => sum + i.peakFte, 0);
    return {
      coveredPct: Math.round((1 - missing / Math.max(1, required)) * 100),
      missing,
      closed,
      requiredPeak,
    };
  }, [items, coverage]);

  if (!selected) {
    return (
      <>
        <div className="obs-panel-empty">
          <p>Plan nie zgłasza jeszcze żadnego zapotrzebowania — uzupełnij dni nakładu w Wycenach.</p>
        </div>
        <footer className="obs-foot">
          <span>0 pozycji zapotrzebowania</span>
        </footer>
      </>
    );
  }

  const stat: ItemCoverage = statOf(selected);
  const outsideFilter = !visible.includes(selected);
  const listed = !isProject && outsideFilter ? [selected, ...visible] : visible;

  // ── scope: one item, or the whole project (widok zbiorczy) ─────────────
  const scopeItems = isProject ? items.filter((i) => i.projectId === scopeProjectId) : [selected];
  const scopeStats = scopeItems.map((item) => ({ item, stx: statOf(item) }));
  const scopeRequired = scopeItems.reduce((sum, i) => sum + i.peakFte, 0);
  const scopeAssigned = scopeStats.reduce((sum, x) => sum + x.stx.minAssigned, 0);
  const scopeGap = scopeStats.reduce((sum, x) => sum + x.stx.peakGap, 0);
  const scopePeople = new Set(scopeStats.flatMap((x) => x.stx.runs.map((r) => r.assignment.personId))).size;
  const scopeStart = scopeItems.reduce((min, i) => Math.min(min, i.start), scopeItems[0].start);
  const scopeEnd = scopeItems.reduce((max, i) => Math.max(max, i.end), scopeItems[0].end);
  const openScopeItems = scopeItems.filter((i) => gapOf(i) > EPS);

  const headRequired = isProject ? scopeRequired : selected.peakFte;
  const headAssigned = isProject ? scopeAssigned : stat.minAssigned;
  const headGap = isProject ? scopeGap : stat.peakGap;

  // ── kolejka ────────────────────────────────────────────────────────────
  const byProject = new Map<string, DemandItem[]>();
  for (const item of listed) {
    const list = byProject.get(item.projectId);
    if (list) list.push(item);
    else byProject.set(item.projectId, [item]);
  }
  // Plan order, not "biggest hole first": `projectById` is built from the
  // ordered projects array, so key position IS the project's rank — the same
  // priority the scheduler honours. You staff what the plan wants done first;
  // each row's gap still shows where it hurts.
  const projectRank = new Map([...ctx.projectById.keys()].map((id, i) => [id, i] as const));
  const queue = [...byProject.entries()]
    .map(([projectId, groupItems]) => {
      const gap = groupItems.reduce((sum, i) => sum + gapOf(i), 0);
      const expanded = projectId === scopeProjectId;
      // The counter always reads the project's full demand, not the filtered
      // list — "3/6" is a fact about the project, not about the filter.
      const allProjectItems = items.filter((i) => i.projectId === projectId);
      const coveredCount = allProjectItems.filter((i) => gapOf(i) < EPS).length;
      return {
        projectId,
        name: ctx.projectById.get(projectId)?.name ?? projectId,
        gap,
        ratio: `${coveredCount}/${allProjectItems.length}`,
        expanded,
        items: expanded ? groupItems.slice().sort((a, b) => gapOf(b) - gapOf(a)) : [],
      };
    })
    .sort(
      (a, b) =>
        (projectRank.get(a.projectId) ?? Infinity) - (projectRank.get(b.projectId) ?? Infinity),
    );

  // Flat render order, for the arrow keys — a project row counts as one stop.
  const flat: ObsadaSelection[] = queue.flatMap((group) => [
    { kind: "project" as const, id: group.projectId },
    ...group.items.map((i) => ({ kind: "item" as const, id: i.id })),
  ]);
  const onQueueKey = (e: React.KeyboardEvent) => {
    const current = isProject
      ? flat.findIndex((f) => f.kind === "project" && f.id === scopeProjectId)
      : flat.findIndex((f) => f.kind === "item" && f.id === selected.id);
    const go = (entry: ObsadaSelection | undefined) => entry && select(entry);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      go(flat[Math.min(flat.length - 1, (current < 0 ? 0 : current) + 1)]);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      go(flat[Math.max(0, (current < 0 ? 0 : current) - 1)]);
    } else if (e.key === "Home") {
      e.preventDefault();
      go(flat[0]);
    } else if (e.key === "End") {
      e.preventDefault();
      go(flat[flat.length - 1]);
    }
  };

  // ── writes, each leaving its undo behind ───────────────────────────────
  const setFte = (assignment: StaffingAssignment, next: number) => {
    staffing.updateAssignment(assignment.id, { ...assignment, fte: clampFte(next) });
    setUndo({ text: "Zmieniono wielkość etatu w przypisaniu.", kind: "restore", prev: assignment });
  };

  const removeOne = (assignment: StaffingAssignment, person: Person) => {
    staffing.removeAssignment(assignment.id);
    setUndo({ text: `Usunięto ${person.name} z ${assignment.capability}.`, kind: "add", assignment });
  };

  const assignTo = (item: DemandItem, person: Person, fte: number, label: string) => {
    const created = staffing.addAssignment({
      personId: person.id,
      projectId: item.projectId,
      capability: item.capability,
      startDate: isoOfIndex(win.originIso, item.start),
      endDate: isoOfIndex(win.originIso, item.end),
      fte,
    });
    setFteDraft({});
    setUndo({ text: label, kind: "remove", id: created.id });
  };

  const runUndo = () => {
    if (!undo) return;
    if (undo.kind === "remove") staffing.removeAssignment(undo.id);
    else if (undo.kind === "removeMany") undo.ids.forEach((id) => staffing.removeAssignment(id));
    else if (undo.kind === "add") staffing.restoreAssignment(undo.assignment);
    else staffing.updateAssignment(undo.prev.id, undo.prev);
    setUndo(null);
  };

  // ── przypisani ─────────────────────────────────────────────────────────
  const assignedRows = scopeStats.flatMap(({ item, stx }) =>
    stx.runs.map((run) => {
      const person = ctx.personById.get(run.assignment.personId);
      if (!person) return null;
      const load = personLoadIn(person, staffing.assignments, staffing.leaves, win, run.start, run.end);
      const over = load.peak > load.capacity + EPS;
      const notes: string[] = [];
      if (over) notes.push(`przeciążony o ${etat(load.peak - load.capacity)}`);
      if (allocationFor(person, item.capability) <= EPS) notes.push("poza swoją kompetencją");
      return { item, run, person, load, over, notes };
    }),
  ).filter((r) => r !== null);

  // ── propozycje rózdżki ─────────────────────────────────────────────────
  const scopeIds = new Set(scopeItems.map((i) => i.id));
  const liveProposals = proposals.filter((p) => scopeIds.has(p.itemId));

  const propose = () =>
    setProposals(
      proposeStaffing(openScopeItems, people, staffing.assignments, staffing.leaves, win).map((p) => ({
        ...p,
        key: `${p.itemId}|${p.personId}`,
      })),
    );

  const acceptProposal = (p: Proposal) => {
    const item = items.find((i) => i.id === p.itemId);
    const person = ctx.personById.get(p.personId);
    if (!item || !person) return;
    const created = staffing.addAssignment({
      personId: p.personId,
      projectId: item.projectId,
      capability: item.capability,
      startDate: isoOfIndex(win.originIso, item.start),
      endDate: isoOfIndex(win.originIso, item.end),
      fte: p.fte,
    });
    setProposals((prev) => prev.filter((x) => x.key !== p.key));
    setUndo({
      text: `Przypisano ${person.name} · ${item.capability} · ${etat(p.fte)}.`,
      kind: "remove",
      id: created.id,
    });
  };

  const acceptAllProposals = () => {
    const ids: string[] = [];
    for (const p of liveProposals) {
      const item = items.find((i) => i.id === p.itemId);
      if (!item) continue;
      ids.push(
        staffing.addAssignment({
          personId: p.personId,
          projectId: item.projectId,
          capability: item.capability,
          startDate: isoOfIndex(win.originIso, item.start),
          endDate: isoOfIndex(win.originIso, item.end),
          fte: p.fte,
        }).id,
      );
    }
    setProposals((prev) => prev.filter((p) => !scopeIds.has(p.itemId)));
    setUndo({ text: `Przyjęto ${plCount(ids.length, "propozycję", "propozycje", "propozycji")}.`, kind: "removeMany", ids });
  };

  // ── kandydaci ──────────────────────────────────────────────────────────
  // What a newcomer has to cover for the whole window is set by its thinnest
  // moment, not its average — that is the figure the "Przypisz" button
  // pre-fills, so accepting the suggestion actually closes the hole.
  const gapNow = stat.peakGap;
  const q = fold(query);
  const assignedHere = new Set(stat.runs.map((r) => r.assignment.personId));
  const scored: Scored[] = people
    .map((person) => {
      const allocation = allocationFor(person, selected.capability);
      const primary = primaryCapability(person) === selected.capability;
      const load = personLoadIn(person, staffing.assignments, staffing.leaves, win, selected.start, selected.end);
      const match = allocation > EPS ? (primary ? 2 : 1) : 0;
      return {
        person,
        allocation,
        primary,
        load,
        match,
        score: candidateScore({
          match,
          free: load.free,
          focusFactor: person.focusFactor,
          leaveDays: load.leaveDays,
          projects: load.projects,
        }),
      };
    })
    .filter(
      (c) =>
        !assignedHere.has(c.person.id) &&
        (allPeople || c.match > 0) &&
        (!q || fold(c.person.name).includes(q) || fold(c.person.teamId).includes(q)),
    )
    .sort((a, b) =>
      sortMode === "free"
        ? b.load.free - a.load.free || b.score - a.score
        : sortMode === "name"
          ? a.person.name.localeCompare(b.person.name, "pl")
          : b.score - a.score,
    );

  const emptyText = query
    ? `Brak osób pasujących do „${query}”.`
    : stat.peakGap < EPS
      ? "Ta pozycja jest w pełni obsadzona — wybierz kolejną z kolejki."
      : allPeople
        ? "Nikt z zespołu nie ma wolnej dostępności na cały okres tej pozycji."
        : `Nikt poza obsadzonymi nie ma kompetencji ${selected.capability}. Przełącz na „wszyscy w zespole”, żeby zobaczyć pozostałych.`;

  const positions = scopeStats
    .slice()
    .sort((a, b) => a.item.capability.localeCompare(b.item.capability))
    .map(({ item, stx }) => ({ item, stx }));

  return (
    <>
      <header className="obs-bar">
        <div className="obs-cover">
          <span className="obs-cover-track">
            <i style={{ width: `${Math.max(0, Math.min(100, totals.coveredPct))}%` }} />
          </span>
          <span className="obs-cover-text">
            {totals.coveredPct}% zapotrzebowania pokryte · {totals.closed} z {items.length} pozycji domkniętych
          </span>
        </div>

        <div className="atl-seg" role="tablist" aria-label="Filtr pozycji" onKeyDown={groupArrowNav}>
          <button
            type="button"
            role="tab"
            aria-selected={openOnly}
            tabIndex={openOnly ? 0 : -1}
            className={openOnly ? "is-active" : undefined}
            onClick={() => setOpenOnly(true)}
          >
            Do obsadzenia
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={!openOnly}
            tabIndex={openOnly ? -1 : 0}
            className={openOnly ? undefined : "is-active"}
            onClick={() => setOpenOnly(false)}
          >
            Wszystkie
          </button>
        </div>

        {/* Not a tablist: each capability toggles back off, so the group is a
            set of pressed-state filters rather than pick-one tabs. */}
        <div className="obs-capfilter">
          <button
            type="button"
            aria-pressed={capFilter === null}
            className={capFilter === null ? "is-active" : undefined}
            onClick={() => setCapFilter(null)}
          >
            wszystkie
          </button>
          {CAPABILITY_ORDER.map((cap) => (
            <button
              key={cap}
              type="button"
              aria-pressed={capFilter === cap}
              className={capFilter === cap ? "is-active" : undefined}
              onClick={() => setCapFilter(capFilter === cap ? null : cap)}
            >
              {cap}
            </button>
          ))}
        </div>
      </header>

      <div className="obs-panel">
        <div className="obs-queue">
          <div className="obs-queue-head">
            <span className="atl-eyebrow">kolejka</span>
            <span className="obs-queue-count">{plCount(listed.length, "pozycja", "pozycje", "pozycji")}</span>
          </div>
          <div
            className="obs-queue-list"
            role="listbox"
            aria-label="Kolejka zapotrzebowania"
            tabIndex={0}
            onKeyDown={onQueueKey}
          >
            {queue.map((group) => {
              const groupSelected = isProject && group.projectId === scopeProjectId;
              return (
                <div key={group.projectId}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={groupSelected}
                    className={`obs-qproj${groupSelected ? " is-selected" : ""}`}
                    onClick={() => select({ kind: "project", id: group.projectId })}
                  >
                    <span className="obs-qcaret">{group.expanded ? "–" : "+"}</span>
                    <span className="obs-qname" title={group.name}>
                      {group.name}
                    </span>
                    <span className="obs-qmeta">
                      <span className="obs-qratio">{group.ratio}</span>
                      <span className={group.gap > EPS ? "obs-qgap is-warn" : "obs-qgap is-ok"}>
                        {group.gap > EPS ? `−${fmt2(group.gap)}` : "pełne"}
                      </span>
                    </span>
                  </button>
                  {group.items.map((item) => {
                    const stx = statOf(item);
                    const itemSelected = !isProject && item.id === selected.id;
                    const fillPct = Math.min(100, (stx.minAssigned / Math.max(0.01, item.peakFte)) * 100);
                    const fillClass =
                      stx.peakGap < EPS ? "is-ok" : stx.minAssigned < EPS ? "is-warn" : "is-meter";
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="option"
                        aria-selected={itemSelected}
                        className={`obs-qitem${itemSelected ? " is-selected" : ""}`}
                        onClick={() => select({ kind: "item", id: item.id })}
                      >
                        <span />
                        <span className="obs-qcap">{item.capability}</span>
                        <span className="obs-qbar">
                          <i className={fillClass} style={{ width: `${fillPct}%` }} />
                        </span>
                        <span className={stx.peakGap > EPS ? "obs-qgap is-warn" : "obs-qgap is-ok"}>
                          {stx.peakGap > EPS ? `−${fmt2(stx.peakGap)}` : "pełne"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
            {!listed.length && <p className="obs-queue-none">Nic nie czeka na obsadzenie w tym filtrze.</p>}
          </div>
          <div className="obs-queue-foot">↑ ↓ nawiguje · projekt = widok zbiorczy</div>
        </div>

        <div className="obs-detail">
          <div className="obs-detail-head">
            <div className="obs-detail-title">
              <b>{ctx.projectById.get(scopeProjectId!)?.name ?? scopeProjectId}</b>
              <span className={isProject ? "obs-title-chip is-accent" : "obs-title-chip"}>
                {isProject ? plCount(scopeItems.length, "pozycja", "pozycje", "pozycji") : selected.capability}
              </span>
              <span className="obs-detail-window">
                {longDay(isoOfIndex(win.originIso, isProject ? scopeStart : selected.start))} –{" "}
                {longDay(isoOfIndex(win.originIso, isProject ? scopeEnd : selected.end))}
              </span>
              {!isProject && outsideFilter && (
                <span className="obs-detail-note">poza aktywnym filtrem — pozostaje otwarta</span>
              )}
            </div>

            <div className="obs-stats">
              <span className="obs-stat">
                <em>wymagane etaty</em>
                <b>{fmt2(headRequired)}</b>
              </span>
              <span className="obs-stat">
                <em>obsadzone</em>
                <b className={headAssigned > EPS ? undefined : "is-warn"}>{fmt2(headAssigned)}</b>
              </span>
              <span className="obs-stat">
                <em>brakuje</em>
                <b className={headGap > EPS ? "is-warn" : "is-ok"}>{headGap > EPS ? fmt2(headGap) : "0"}</b>
              </span>
              <span className="obs-stat">
                <em>{isProject ? "osoby w projekcie" : "osoby na pozycji"}</em>
                <b className="is-dim">{isProject ? scopePeople : stat.peopleCount}</b>
              </span>
            </div>
          </div>

          <div className="obs-body">
            <div className="obs-section">
              <div className="obs-section-head">
                <span className="atl-eyebrow">przypisani</span>
                <span className="obs-rule" />
              </div>
              <div className="obs-cards">
                {assignedRows.map(({ item, run, person, load, over, notes }) => (
                  <div
                    key={run.assignment.id}
                    className={`obs-row ${isProject ? "is-assigned-proj" : "is-assigned"}`}
                  >
                    {isProject && <span className="obs-cap">{item.capability}</span>}
                    <span className="obs-who">
                      <span className="obs-person" title={person.name}>
                        {person.name}
                      </span>
                      <span className="obs-team">{person.teamId}</span>
                      {load.leaveDays > 0 && <LeaveBadge days={load.leaveDays} />}
                    </span>
                    <span className="obs-load">
                      <span className="obs-loadbar">
                        <i
                          className={over ? "is-warn" : load.free >= 0.5 ? "is-ok" : "is-meter"}
                          style={{ width: `${Math.min(100, Math.round((load.peak / Math.max(0.01, load.capacity)) * 100))}%` }}
                        />
                      </span>
                      <span className="obs-load-caption">
                        <span className="obs-load-text">
                          obciążenie {fmt2(load.peak)} z {etatG(load.capacity)}
                        </span>
                        {notes.length > 0 && <span className="is-warn">{notes.join(" · ")}</span>}
                      </span>
                    </span>
                    <span className="obs-actions">
                      <span className="obs-stepper">
                        <button type="button" aria-label="Zmniejsz FTE" onClick={() => setFte(run.assignment, run.assignment.fte - 0.1)}>
                          −
                        </button>
                        <b>{fmt2(run.assignment.fte)}</b>
                        <button type="button" aria-label="Zwiększ FTE" onClick={() => setFte(run.assignment, run.assignment.fte + 0.1)}>
                          +
                        </button>
                      </span>
                      <button type="button" className="obs-ghost" onClick={() => removeOne(run.assignment, person)}>
                        Usuń
                      </button>
                    </span>
                  </div>
                ))}
                {!assignedRows.length && (
                  <span className="obs-none">
                    {isProject ? "Ten projekt nie ma jeszcze żadnej obsady." : "Nikt jeszcze nie obsadza tej kompetencji."}
                  </span>
                )}
              </div>
            </div>

            <div className="obs-section">
              <div className="obs-section-head">
                <span className="atl-eyebrow">propozycje obsady</span>
                <span className="obs-rule" />
                {liveProposals.length > 0 && (
                  <span className="obs-section-actions">
                    <button type="button" className="obs-primary" onClick={acceptAllProposals}>
                      Przypisz wszystkie ({liveProposals.length})
                    </button>
                    <button
                      type="button"
                      className="obs-ghost"
                      onClick={() => setProposals((prev) => prev.filter((p) => !scopeIds.has(p.itemId)))}
                    >
                      Odrzuć wszystkie
                    </button>
                  </span>
                )}
                <button type="button" className="obs-wand" onClick={propose}>
                  <WandSparkles size={14} aria-hidden />
                  {liveProposals.length ? "Przelicz" : "Zaproponuj obsadę"}
                </button>
              </div>

              {liveProposals.length === 0 && (
                <div className="obs-empty">
                  {openScopeItems.length === 0
                    ? "Wszystko w tym zakresie jest obsadzone."
                    : "Rózdżka dobierze osoby z pasującą kompetencją i wolnym etatem, bez przekraczania dostępności. Propozycje możesz przyjąć pojedynczo albo wszystkie."}
                </div>
              )}

              <div className="obs-cards">
                {liveProposals.map((p) => {
                  const item = items.find((i) => i.id === p.itemId);
                  const person = ctx.personById.get(p.personId);
                  if (!item || !person) return null;
                  return (
                    <div key={p.key} className="obs-row is-proposal">
                      <span className="obs-cap">{item.capability}</span>
                      <span className="obs-who">
                        <span className="obs-person" title={person.name}>
                          {person.name}
                        </span>
                        <span className="obs-team">{person.teamId}</span>
                      </span>
                      <span className="obs-fte-text">{etat(p.fte)}</span>
                      <span className="obs-actions">
                        <button type="button" className="obs-primary" onClick={() => acceptProposal(p)}>
                          Przypisz
                        </button>
                        <button
                          type="button"
                          className="obs-ghost"
                          onClick={() => setProposals((prev) => prev.filter((x) => x.key !== p.key))}
                        >
                          Odrzuć
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="obs-section is-last">
              {isProject ? (
                <>
                  <div className="obs-section-head">
                    <span className="atl-eyebrow">pozycje projektu</span>
                    <span className="obs-rule" />
                  </div>
                  <div className="obs-cards">
                    {positions.map(({ item, stx }) => (
                      <button
                        key={item.id}
                        type="button"
                        className="obs-row is-position"
                        onClick={() => select({ kind: "item", id: item.id })}
                      >
                        <span className="obs-cap">{item.capability}</span>
                        <span className="obs-pos-window">
                          {shortDay(win.originIso, item.start)} – {shortDay(win.originIso, item.end)}
                        </span>
                        <span className={stx.peakGap > EPS ? "obs-fte-text is-warn" : "obs-fte-text is-ok"}>
                          {stx.peakGap > EPS ? `−${fmt2(stx.peakGap)}` : "pełne"}
                        </span>
                        <span className="obs-pos-people">
                          {stx.peopleCount === 0
                            ? "bez obsady"
                            : `${plCount(stx.peopleCount, "osoba", "osoby", "osób")} · wymagane ${etatG(item.peakFte)}`}
                        </span>
                        <span className="obs-pos-go">Obsadź →</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="obs-section-head">
                    <span className="atl-eyebrow">kandydaci</span>
                    <span className="obs-rule" />
                    <input
                      type="search"
                      className="obs-search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="szukaj osoby"
                    />
                    <label className="obs-sort">
                      sortuj
                      <select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}>
                        <option value="match">dopasowanie</option>
                        <option value="free">wolne FTE</option>
                        <option value="name">nazwisko</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      aria-pressed={allPeople}
                      className={allPeople ? "obs-toggle is-on" : "obs-toggle"}
                      onClick={() => setAllPeople((v) => !v)}
                    >
                      {allPeople ? "wszyscy w zespole" : "tylko pasujący"}
                    </button>
                  </div>
                  <p className="obs-hint">
                    Przypisanie obejmuje cały okres zapotrzebowania. Obsadzanie nie zmienia dat zapotrzebowania
                    ani portfela.
                  </p>

                  {!scored.length && <div className="obs-empty">{emptyText}</div>}

                  <div className="obs-cards">
                    {scored.map((c, index) => {
                      const key = `${selected.id}|${c.person.id}`;
                      const want = gapNow > EPS ? gapNow : MIN_ASSIGN_FTE;
                      const suggested = clampFte(c.load.free > EPS ? Math.min(c.load.free, want) : want);
                      const fte = fteDraft[key] ?? suggested;
                      const wouldOver = c.load.peak + fte > c.load.capacity + EPS;
                      const risk: string[] = [];
                      if (wouldOver) risk.push(`przekroczy dostępność o ${etat(c.load.peak + fte - c.load.capacity)}`);
                      if (c.allocation <= EPS) risk.push("poza swoją kompetencją");
                      const barScale = Math.max(c.load.capacity, c.load.peak + fte, 0.01);
                      const addFte = Math.max(0, Math.min(c.load.capacity - c.load.peak, fte));
                      const overFte = Math.max(0, c.load.peak + fte - c.load.capacity);
                      return (
                        <div key={key} className="obs-row is-candidate">
                          <span className="obs-rank">{index + 1}</span>
                          <span className="obs-who">
                            <span className="obs-person" title={c.person.name}>
                              {c.person.name}
                            </span>
                            <span className="obs-team">{c.person.teamId}</span>
                          </span>
                          <span className="obs-badges">
                            <span className="obs-projcount obs-tipwrap">
                              <Briefcase size={13} aria-hidden />
                              {c.load.projects}
                              <span className="obs-tip is-list">
                                {c.load.projectFte.length ? (
                                  c.load.projectFte.map(({ projectId, fte: projectFte }) => (
                                    <span key={projectId} className="obs-tip-row">
                                      <span>{ctx.projectById.get(projectId)?.name ?? projectId}</span>
                                      <span>{etat(projectFte)}</span>
                                    </span>
                                  ))
                                ) : (
                                  <span className="obs-tip-row">
                                    <span>Brak innych przypisań w tym okresie</span>
                                  </span>
                                )}
                              </span>
                            </span>
                            {c.load.leaveDays > 0 && <LeaveBadge days={c.load.leaveDays} />}
                          </span>
                          <span className="obs-load">
                            <span
                              className="obs-loadbar is-stacked"
                              title={`obciążenie ${fmt2(c.load.peak)} z ${etatG(c.load.capacity)} · dokładasz ${fmt2(fte)} · razem ${fmt2(c.load.peak + fte)}`}
                            >
                              <i className="is-meter" style={{ width: `${(Math.min(c.load.peak, barScale) / barScale) * 100}%` }} />
                              <i className="is-add" style={{ width: `${(addFte / barScale) * 100}%` }} />
                              <i className="is-warn" style={{ width: `${(overFte / barScale) * 100}%` }} />
                              {wouldOver && (
                                <i className="obs-loadtick" style={{ left: `${(c.load.capacity / barScale) * 100}%` }} />
                              )}
                            </span>
                            <span className="obs-load-caption">
                              <span className="obs-load-text">
                                {fmt2(c.load.peak)} z {etatG(c.load.capacity)}
                              </span>
                              {risk.length > 0 && <span className="is-warn">{risk.join(" · ")}</span>}
                            </span>
                          </span>
                          <span className="obs-actions">
                            <span className="obs-stepper">
                              <button
                                type="button"
                                aria-label="Zmniejsz FTE"
                                onClick={() => setFteDraft((d) => ({ ...d, [key]: clampFte(fte - 0.1) }))}
                              >
                                −
                              </button>
                              <b>{fmt2(fte)}</b>
                              <button
                                type="button"
                                aria-label="Zwiększ FTE"
                                onClick={() => setFteDraft((d) => ({ ...d, [key]: clampFte(fte + 0.1) }))}
                              >
                                +
                              </button>
                            </span>
                            <button
                              type="button"
                              className={wouldOver ? "obs-assign is-risky" : "obs-assign obs-primary"}
                              onClick={() =>
                                assignTo(
                                  selected,
                                  c.person,
                                  fte,
                                  `Przypisano ${c.person.name} · ${etat(fte)} · ${shortDay(win.originIso, selected.start)} – ${shortDay(win.originIso, selected.end)}.`,
                                )
                              }
                            >
                              {wouldOver ? "Przypisz mimo to" : "Przypisz"}
                            </button>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>

          {undo && (
            <div className="obs-toast" role="status">
              <span className="obs-toast-text">{undo.text}</span>
              <button type="button" className="obs-primary" onClick={runUndo}>
                Cofnij
              </button>
              <button type="button" className="obs-x" aria-label="Zamknij" onClick={() => setUndo(null)}>
                ✕
              </button>
            </div>
          )}
        </div>
      </div>

      <footer className="obs-foot">
        <span>
          {plCount(items.length, "pozycja", "pozycje", "pozycji")} zapotrzebowania ·{" "}
          {plCount(staffing.assignments.length, "przypisanie", "przypisania", "przypisań")}
        </span>
        <span>
          zapotrzebowanie {etat(totals.requiredPeak)} w szczycie · nieobsadzone{" "}
          {fmt2(totals.missing / ctx.workingDaysPerMonth)} osobomiesięcy
        </span>
      </footer>
    </>
  );
}
