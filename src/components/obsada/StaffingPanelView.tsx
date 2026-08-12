/**
 * Obsadzanie — the one screen that writes. A queue of demand items on the
 * left, and on the right everything you need to close the selected one: what
 * the plan asks for, who already covers it, and who could.
 *
 * The three headline figures all read at the item's **thinnest moment**, so
 * `wymagane − obsadzone = brakuje` is true as arithmetic. A worst-instant gap
 * is the honest number here: a person covering half the window has not covered
 * the window, and averaging would say they had.
 *
 * Assigning never moves a date. The plan's dates come from pools and the crew
 * model; this layer only records which named person carries which slice of it.
 */
import { useCallback, useMemo, useState } from "react";
import { isoOfIndex } from "../../lib/days";
import { CAPABILITY_ORDER } from "../../lib/estimation";
import {
  MAX_PARALLEL_PROJECTS,
  personLoadIn,
  type DemandItem,
  type ItemCoverage,
  type PersonLoad,
} from "../../lib/staffing";
import type { Capability, Person, StaffingAssignment } from "../../types";
import type { StaffingApi } from "../../hooks/useStaffing";
import { plCount } from "../timelineChrome";
import { longDay, shortDay } from "./axis";
import type { ObsadaContext } from "./ObsadaWorkspace";

const EPS = 1e-6;
const MAX_ASSIGN_FTE = 2;
const MIN_ASSIGN_FTE = 0.1;

function fmt2(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Math.abs(r - Math.round(r)) < 0.005 ? String(Math.round(r)) : r.toFixed(2);
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const clampFte = (n: number) => Math.min(MAX_ASSIGN_FTE, Math.max(MIN_ASSIGN_FTE, round1(n)));

/** Their largest allocation — what someone is, as opposed to what they can
 *  also do. A 0.6 TL / 0.4 BE is a tech lead who writes backend, and a
 *  candidate list that ranked those two equally would be useless. */
function primaryCapability(person: Person): Capability | undefined {
  return person.allocations.slice().sort((a, b) => b.fte - a.fte)[0]?.capability;
}

interface Scored {
  person: Person;
  allocation: number;
  primary: boolean;
  load: PersonLoad;
  already: boolean;
  match: number;
  score: number;
}

interface StaffingPanelViewProps {
  ctx: ObsadaContext;
  people: Person[];
  staffing: StaffingApi;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function StaffingPanelView({ ctx, people, staffing, selectedId, onSelect }: StaffingPanelViewProps) {
  const [openOnly, setOpenOnly] = useState(true);
  const [capFilter, setCapFilter] = useState<Capability | null>(null);
  const [allPeople, setAllPeople] = useState(false);
  const [fteDraft, setFteDraft] = useState<Record<string, number>>({});

  const { items, coverage, window: win } = ctx;
  // `coverage` is rebuilt whenever assignments change, so everything derived
  // from it re-runs then — which is exactly when a closed hole should leave
  // the "Do obsadzenia" queue.
  const gapOf = useCallback((item: DemandItem) => coverage.get(item.id)?.peakGap ?? 0, [coverage]);

  const visible = useMemo(() => {
    let list = openOnly ? items.filter((i) => gapOf(i) > EPS) : items;
    if (capFilter) list = list.filter((i) => i.capability === capFilter);
    return list;
  }, [items, gapOf, openOnly, capFilter]);

  const selected =
    visible.find((i) => i.id === selectedId) ??
    items.find((i) => i.id === selectedId) ??
    visible[0] ??
    items[0];

  const stat: ItemCoverage | undefined = selected ? coverage.get(selected.id) : undefined;

  const totals = useMemo(() => {
    const required = items.reduce((sum, i) => sum + i.requiredFteDays, 0);
    const missing = items.reduce((sum, i) => sum + (coverage.get(i.id)?.missingFteDays ?? 0), 0);
    const closed = items.filter((i) => (coverage.get(i.id)?.coveredPct ?? 0) >= 100).length;
    return {
      coveredPct: Math.round((1 - missing / Math.max(1, required)) * 100),
      missing,
      closed,
    };
  }, [items, coverage]);

  const queue = useMemo(() => {
    const byProject = new Map<string, DemandItem[]>();
    for (const item of visible) {
      const list = byProject.get(item.projectId);
      if (list) list.push(item);
      else byProject.set(item.projectId, [item]);
    }
    return [...byProject.entries()]
      .map(([projectId, list]) => ({
        projectId,
        name: ctx.projectById.get(projectId)?.name ?? projectId,
        gap: list.reduce((sum, i) => sum + gapOf(i), 0),
        items: list.slice().sort((a, b) => gapOf(b) - gapOf(a) || a.start - b.start),
      }))
      .sort((a, b) => b.gap - a.gap || a.name.localeCompare(b.name));
  }, [visible, gapOf, ctx.projectById]);

  // What a newcomer has to cover for the whole window is set by its thinnest
  // moment, not its average — that is the figure the "Przypisz" button
  // pre-fills, so accepting the suggestion actually closes the hole.
  const gapNow = stat ? stat.peakGap : 0;
  const windowStart = selected?.start ?? 0;
  const windowEnd = selected?.end ?? 0;

  const scored = useMemo(() => {
    if (!selected) return [] as Scored[];
    const assignedHere = new Set((stat?.runs ?? []).map((r) => r.assignment.personId));
    return people
      .map((person) => {
        const allocation = person.allocations.find((a) => a.capability === selected.capability)?.fte ?? 0;
        const primary = primaryCapability(person) === selected.capability;
        const load = personLoadIn(person, staffing.assignments, staffing.leaves, win, windowStart, windowEnd);
        const match = allocation > EPS ? (primary ? 2 : 1) : 0;
        return {
          person,
          allocation,
          primary,
          load,
          already: assignedHere.has(person.id),
          match,
          score:
            match * 100 +
            load.free * 40 -
            load.leaveDays * 0.3 -
            load.projects * 3 -
            (load.projects >= MAX_PARALLEL_PROJECTS ? 40 : 0),
        };
      })
      .filter((c) => !c.already && (allPeople || c.match > 0))
      .sort((a, b) => b.score - a.score);
  }, [selected, stat, people, staffing.assignments, staffing.leaves, win, windowStart, windowEnd, allPeople]);

  if (!selected || !stat) {
    return (
      <>
        <div className="obs-panel-empty">
          <p>Plan nie zgłasza jeszcze żadnego zapotrzebowania — uzupełnij dni nakładu w Kompetencjach.</p>
        </div>
        <footer className="obs-foot">
          <span>0 pozycji zapotrzebowania</span>
        </footer>
      </>
    );
  }

  const startIso = isoOfIndex(win.originIso, selected.start);
  const endIso = isoOfIndex(win.originIso, selected.end);

  const assign = (person: Person, fte: number) => {
    staffing.addAssignment({
      personId: person.id,
      projectId: selected.projectId,
      capability: selected.capability,
      startDate: startIso,
      endDate: endIso,
      fte,
    });
    setFteDraft({});
  };

  const setFte = (assignment: StaffingAssignment, next: number) =>
    staffing.updateAssignment(assignment.id, { ...assignment, fte: clampFte(next) });

  const setRange = (assignment: StaffingAssignment, field: "startDate" | "endDate", value: string) => {
    if (!value) return;
    const next = { ...assignment, [field]: value };
    // An inverted range draws nothing and covers nothing, so it is never saved
    // — the other end moves out of the way instead.
    if (next.endDate <= next.startDate) {
      if (field === "startDate") next.endDate = isoOfIndex(next.startDate, 1);
      else next.startDate = isoOfIndex(next.endDate, -1);
    }
    staffing.updateAssignment(assignment.id, next);
  };

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

        <div className="atl-seg">
          <button type="button" className={openOnly ? "is-active" : undefined} onClick={() => setOpenOnly(true)}>
            Do obsadzenia
          </button>
          <button type="button" className={openOnly ? undefined : "is-active"} onClick={() => setOpenOnly(false)}>
            Wszystkie
          </button>
        </div>

        <div className="obs-capfilter">
          <button
            type="button"
            className={capFilter === null ? "is-active" : undefined}
            onClick={() => setCapFilter(null)}
          >
            wszystkie
          </button>
          {CAPABILITY_ORDER.map((cap) => (
            <button
              key={cap}
              type="button"
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
            <span className="atl-eyebrow">kolejka zapotrzebowania</span>
            <span>{plCount(visible.length, "pozycja", "pozycje", "pozycji")}</span>
          </div>
          <div className="obs-queue-list">
            {queue.map((group) => (
              <div key={group.projectId}>
                <div className="obs-queue-group">
                  <b title={group.name}>{group.name}</b>
                  <span className={group.gap > EPS ? "is-warn" : "is-ok"}>
                    {group.gap > EPS ? `brakuje ${fmt2(group.gap)} FTE` : "obsadzone"}
                  </span>
                </div>
                {group.items.map((item) => {
                  const c = coverage.get(item.id)!;
                  const none = c.peopleCount === 0;
                  const isSelected = item.id === selected.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`obs-queue-item${isSelected ? " is-selected" : ""}${none ? " is-empty" : ""}`}
                      onClick={() => onSelect(item.id)}
                    >
                      <span className="obs-queue-row">
                        <span className="obs-cap">{item.capability}</span>
                        <span className="obs-queue-window">
                          {shortDay(win.originIso, item.start)} – {shortDay(win.originIso, item.end)}
                        </span>
                        <span className={c.peakGap > EPS ? "obs-queue-gap is-warn" : "obs-queue-gap is-ok"}>
                          {c.peakGap > EPS ? `−${fmt2(c.peakGap)}` : "✓"}
                        </span>
                      </span>
                      <span className="obs-queue-row">
                        <span className="obs-meter">
                          <i
                            className={c.peakGap > EPS ? "is-warn" : "is-ok"}
                            style={{ width: `${Math.max(0, Math.min(100, c.coveredPct))}%` }}
                          />
                        </span>
                        <span className="obs-queue-people">
                          {none ? "bez obsady" : plCount(c.peopleCount, "osoba", "osoby", "osób")}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
            {!visible.length && <p className="obs-queue-none">Nic nie czeka na obsadzenie w tym filtrze.</p>}
          </div>
        </div>

        <div className="obs-detail">
          <div className="obs-detail-head">
            <div className="obs-detail-title">
              <b>{ctx.projectById.get(selected.projectId)?.name ?? selected.projectId}</b>
              <span className="obs-cap is-accent">{selected.capability}</span>
              <span className="obs-detail-window">
                {longDay(startIso)} – {longDay(endIso)}
              </span>
              {selected.setsPace && (
                <span className="obs-flag" title="Ta kompetencja jest na swoim suficie i wyznacza długość fazy — jedyna komórka, której podniesienie skraca projekt.">
                  ▲ wyznacza tempo
                </span>
              )}
              {selected.isBurst && (
                <span className="obs-flag" title="Za mało pracy, by rozłożyć ją na całą fazę — biegnie krótkim zrywem na progu i kończy się wcześniej.">
                  * krótki zryw
                </span>
              )}
            </div>

            <div className="obs-figures">
              <span>
                <em>wymagane</em>
                <b>{fmt2(selected.peakFte)} FTE</b>
              </span>
              <span>
                <em>obsadzone</em>
                <b className={stat.minAssigned > EPS ? undefined : "is-warn"}>{fmt2(stat.minAssigned)} FTE</b>
              </span>
              <span>
                <em>brakuje</em>
                <b className={stat.peakGap > EPS ? "is-warn" : "is-ok"}>
                  {stat.peakGap > EPS ? `${fmt2(stat.peakGap)} FTE` : "—"}
                </b>
              </span>
              <span>
                <em>sufit</em>
                <b>{fmt2(selected.maxFte)} FTE</b>
              </span>
            </div>

            <div className="obs-coverage">
              <div className="obs-coverage-strip">
                {stat.slices.map((slice) => {
                  const span = Math.max(1, selected.end - selected.start);
                  const kind = slice.gap <= EPS ? "is-ok" : slice.assigned <= EPS ? "is-none" : "is-partial";
                  return (
                    <div
                      key={slice.start}
                      className={`obs-coverage-seg ${kind}`}
                      style={{ width: `${((slice.end - slice.start) / span) * 100}%` }}
                      title={`${shortDay(win.originIso, slice.start)}–${shortDay(win.originIso, slice.end - 1)} · obsadzone ${fmt2(slice.assigned)} z ${fmt2(slice.required)} FTE`}
                    />
                  );
                })}
              </div>
              <div className="obs-coverage-legend">
                <span>{shortDay(win.originIso, selected.start)}</span>
                <span>{stat.coveredPct}% okresu w pełni pokryte</span>
                <span>{shortDay(win.originIso, selected.end)}</span>
              </div>
            </div>
          </div>

          <div className="obs-section">
            <div className="obs-section-head">
              <span className="atl-eyebrow">przypisani</span>
              <span className="obs-rule" />
            </div>
            <div className="obs-cards">
              {stat.runs.map(({ assignment }) => {
                const person = ctx.personById.get(assignment.personId);
                if (!person) return null;
                const load = personLoadIn(
                  person,
                  staffing.assignments,
                  staffing.leaves,
                  win,
                  windowStart,
                  windowEnd,
                );
                const allocation = person.allocations.find((a) => a.capability === selected.capability)?.fte ?? 0;
                const over = load.peak > load.capacity + EPS;
                const notes: string[] = [];
                if (load.leaveDays > 0) notes.push(`${plCount(load.leaveDays, "dzień", "dni", "dni")} urlopu w oknie`);
                if (over) notes.push(`przeciążony o ${fmt2(load.peak - load.capacity)}`);
                if (allocation <= EPS) notes.push("poza swoją kompetencją");
                else if (assignment.fte > allocation + EPS)
                  notes.push(`ponad swój przydział w ${selected.capability} (${fmt2(allocation)})`);
                return (
                  <div key={assignment.id} className="obs-card is-assigned">
                    <span className="obs-card-who">
                      <span className="obs-card-name" title={person.name}>
                        {person.name}
                      </span>
                      <span className={allocation > EPS && primaryCapability(person) === selected.capability ? "obs-card-match is-primary" : "obs-card-match"}>
                        {allocation > EPS
                          ? `${selected.capability} ${fmt2(allocation)} · ${primaryCapability(person) === selected.capability ? "główna" : "dodatkowa"}`
                          : `${person.allocations.map((a) => a.capability).join("/")} · inna kompetencja`}
                      </span>
                    </span>

                    <span className="obs-card-load">
                      <span className="obs-meter">
                        <i
                          className={over ? "is-warn" : load.free >= 0.5 ? "is-ok" : "is-accent"}
                          style={{ width: `${Math.min(100, Math.round((load.peak / Math.max(0.01, load.capacity)) * 100))}%` }}
                        />
                      </span>
                      <em>
                        obciążenie {fmt2(load.peak)} z {fmt2(load.capacity)} FTE
                      </em>
                    </span>

                    <span className="obs-card-range">
                      <input
                        type="date"
                        value={assignment.startDate}
                        aria-label="Początek przypisania"
                        onChange={(e) => setRange(assignment, "startDate", e.target.value)}
                      />
                      <input
                        type="date"
                        value={assignment.endDate}
                        aria-label="Koniec przypisania"
                        onChange={(e) => setRange(assignment, "endDate", e.target.value)}
                      />
                    </span>

                    <span className={notes.length ? "obs-card-note is-warn" : "obs-card-note"} title={notes.join(" · ")}>
                      {notes.join(" · ")}
                    </span>

                    <span className="obs-card-actions">
                      <span className="obs-stepper">
                        <button type="button" onClick={() => setFte(assignment, assignment.fte - 0.1)} aria-label="Mniej">
                          −
                        </button>
                        <b>{fmt2(assignment.fte)}</b>
                        <button type="button" onClick={() => setFte(assignment, assignment.fte + 0.1)} aria-label="Więcej">
                          +
                        </button>
                      </span>
                      <button
                        type="button"
                        className="obs-danger"
                        onClick={() => staffing.removeAssignment(assignment.id)}
                      >
                        Usuń
                      </button>
                    </span>
                  </div>
                );
              })}
              {!stat.runs.length && (
                <p className="obs-none">Nikt jeszcze nie obsadza tej kompetencji.</p>
              )}
            </div>
          </div>

          <div className="obs-section">
            <div className="obs-section-head">
              <span className="atl-eyebrow">kandydaci</span>
              <span className="obs-rule" />
              <button
                type="button"
                className={allPeople ? "atl-btn is-on" : "atl-btn"}
                onClick={() => setAllPeople((v) => !v)}
              >
                {allPeople ? "wszyscy w zespole" : "tylko pasujący"}
              </button>
            </div>

            {!scored.length && (
              <div className="obs-empty-card">
                <span>
                  {stat.peakGap <= EPS
                    ? "Ta pozycja jest w pełni obsadzona."
                    : allPeople
                      ? "Nikt z zespołu nie jest jeszcze wolny na tę pozycję."
                      : `Nikt poza obsadzonymi nie ma kompetencji ${selected.capability}.`}
                </span>
                {stat.peakGap > EPS && !allPeople && (
                  <button type="button" className="obs-primary" onClick={() => setAllPeople(true)}>
                    Pokaż wszystkich w zespole
                  </button>
                )}
              </div>
            )}

            <div className="obs-cards">
              {scored.map((c) => {
                const key = `${selected.id}|${c.person.id}`;
                const want = gapNow > EPS ? gapNow : MIN_ASSIGN_FTE;
                const suggested = clampFte(c.load.free > EPS ? Math.min(c.load.free, want) : want);
                const fte = fteDraft[key] ?? suggested;
                const wouldOver = c.load.peak + fte > c.load.capacity + EPS;
                const notes: string[] = [];
                if (c.load.leaveDays > 0)
                  notes.push(`${plCount(c.load.leaveDays, "dzień", "dni", "dni")} urlopu w oknie`);
                if (wouldOver) notes.push(`przekroczy dostępność o ${fmt2(c.load.peak + fte - c.load.capacity)}`);
                if (c.load.projects >= MAX_PARALLEL_PROJECTS)
                  notes.push(`już ${c.load.projects} równoległych projektów`);
                if (c.allocation <= EPS) notes.push("poza swoją kompetencją");
                return (
                  <div key={key} className="obs-card">
                    <span className="obs-card-who">
                      <span className="obs-card-name" title={c.person.name}>
                        {c.person.name}
                      </span>
                      <span className={c.primary ? "obs-card-match is-primary" : "obs-card-match"}>
                        {c.allocation > EPS
                          ? `${selected.capability} ${fmt2(c.allocation)} · ${c.primary ? "główna" : "dodatkowa"}`
                          : `${c.person.allocations.map((a) => a.capability).join("/")} · inna kompetencja`}
                      </span>
                    </span>

                    <span className="obs-card-load">
                      <span className="obs-meter">
                        <i
                          className={c.load.free < 0.05 ? "is-warn" : c.load.free >= 0.5 ? "is-ok" : "is-accent"}
                          style={{ width: `${Math.min(100, Math.round((c.load.peak / Math.max(0.01, c.load.capacity)) * 100))}%` }}
                        />
                      </span>
                      <em>
                        wolne {fmt2(c.load.free)} z {fmt2(c.load.capacity)} FTE
                      </em>
                    </span>

                    <span className={notes.length ? "obs-card-note is-warn" : "obs-card-note"} title={notes.join(" · ")}>
                      {notes.join(" · ")}
                    </span>

                    <span className="obs-card-actions">
                      <span className="obs-stepper">
                        <button
                          type="button"
                          aria-label="Mniej"
                          onClick={() => setFteDraft((d) => ({ ...d, [key]: clampFte(fte - 0.1) }))}
                        >
                          −
                        </button>
                        <b>{fmt2(fte)}</b>
                        <button
                          type="button"
                          aria-label="Więcej"
                          onClick={() => setFteDraft((d) => ({ ...d, [key]: clampFte(fte + 0.1) }))}
                        >
                          +
                        </button>
                      </span>
                      <button type="button" className="obs-primary" onClick={() => assign(c.person, fte)}>
                        Przypisz
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <footer className="obs-foot">
        <span>
          {plCount(items.length, "pozycja", "pozycje", "pozycji")} zapotrzebowania ·{" "}
          {plCount(staffing.assignments.length, "przypisanie", "przypisania", "przypisań")}
        </span>
        <span>
          {totals.missing > EPS ? `nieobsadzone ${fmt2(totals.missing / 30)} osobomiesięcy` : "wszystko obsadzone"}
        </span>
        <span className="atl-spacer" />
        <span>obsadzanie nie przesuwa dat portfela</span>
      </footer>
    </>
  );
}
