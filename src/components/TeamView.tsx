import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { useRoster } from "../hooks/useRoster";
import {
  CAPABILITY_LABELS,
  CAPABILITY_ORDER,
  DEFAULT_PERSON_FOCUS_FACTOR,
  isOverAllocated,
  personAvailability,
  personEffectiveFte,
} from "../lib/estimation";
import type { Capability, Person, TeamCode } from "../types";
import { NumberField } from "./NumberField";
import { CAPABILITY_HUES, MOD, fmt, fmt2, plCount, solid } from "./timelineChrome";
import "./timeline.css";

interface TeamViewProps {
  theme: "auto" | "light" | "dark";
}

const TEAM_ORDER: TeamCode[] = ["ZWO", "ZP", "Inni"];

/** Below this share of the bar a segment has no room for its own label, and
 *  below the second one not even for the capability code — the tooltip carries
 *  it instead. Truncated text in a 12px slot is noise, not information. The
 *  label threshold sits just under a quarter so the smallest pickable
 *  allocation still shows its number. */
const SEGMENT_LABEL_MIN = 0.22;
const SEGMENT_CODE_MIN = 0.16;

const capColor = (capability: Capability) => solid(CAPABILITY_HUES[capability] ?? 232);

function emptyDraft(teamId: TeamCode): Omit<Person, "id"> {
  return {
    name: "",
    teamId,
    allocations: [{ capability: "PM", fte: 1 }],
    focusFactor: DEFAULT_PERSON_FOCUS_FACTOR,
  };
}

/** The quarter steps every staffing decision is quantized to — an allocation
 *  is picked, not typed, so nothing finer can even be entered. */
const FTE_OPTIONS = [0.25, 0.5, 0.75, 1];

/** Click-to-pick FTE: the value is a button, the choices are a small popover
 *  of quarters. Removal stays on the chip's own X, so the picker never needs
 *  a zero option. */
function FtePicker({
  value,
  label,
  onPick,
}: {
  value: number;
  label: string;
  onPick: (fte: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onPointerDown(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <span className="tw-fte" ref={ref}>
      <button
        type="button"
        className={`tw-fte-btn ${open ? "is-on" : ""}`}
        aria-label={label}
        aria-expanded={open}
        title="Kliknij, aby wybrać część etatu"
        onClick={() => setOpen((v) => !v)}
      >
        {fmt2(value)}
      </button>
      {open && (
        <span className="tw-fte-pop">
          {FTE_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className={`tw-fte-opt ${Math.abs(option - value) < 0.005 ? "is-active" : ""}`}
              onClick={() => {
                onPick(option);
                setOpen(false);
              }}
            >
              {fmt2(option)}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

/**
 * How one person's time is split, as a single bar.
 *
 * Scaled against `max(1, total)` rather than against the total, so the bar
 * reads as "of one person" and someone under-allocated leaves visible track
 * behind their segments instead of stretching to fill it. Over-allocation then
 * shows up as the bar running full with a warning envelope, which is the
 * honest picture: there is no more person to give.
 */
function SplitBar({ person, over }: { person: Person; over: boolean }) {
  const scale = Math.max(1, personAvailability(person));
  return (
    <span className={`tw-split ${over ? "is-over" : ""}`}>
      {person.allocations.map((allocation) => {
        const share = allocation.fte / scale;
        return (
          <span
            key={allocation.capability}
            className="tw-split-seg"
            style={{ width: `${share * 100}%`, background: capColor(allocation.capability) }}
            title={`${CAPABILITY_LABELS[allocation.capability]} · ${fmt2(allocation.fte)} FTE`}
          >
            {share >= SEGMENT_LABEL_MIN
              ? `${CAPABILITY_LABELS[allocation.capability]} ${fmt2(allocation.fte)}`
              : share >= SEGMENT_CODE_MIN
                ? CAPABILITY_LABELS[allocation.capability]
                : ""}
          </span>
        );
      })}
    </span>
  );
}

export function TeamView({ theme }: TeamViewProps) {
  const {
    teams,
    people,
    pools,
    addPerson,
    updatePerson,
    removePerson,
    setAllocation,
    setFocusFactor,
  } = useRoster();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [addingTeam, setAddingTeam] = useState<TeamCode | null>(null);
  const [addDraft, setAddDraft] = useState<Omit<Person, "id">>(() => emptyDraft("ZWO"));

  function startAdd(teamId: TeamCode) {
    setConfirmDeleteId(null);
    setAddDraft(emptyDraft(teamId));
    setAddingTeam(teamId);
  }

  function saveAdd() {
    if (addDraft.name.trim() === "") return;
    addPerson({ ...addDraft, name: addDraft.name.trim() });
    setAddingTeam(null);
  }

  function handleDelete(id: string) {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    setConfirmDeleteId(null);
    removePerson(id);
  }

  // Headcount and productive FTE side by side: the gap between them is the
  // whole point of per-person productivity, and burying it would leave the
  // roster looking like it has more capacity than the plan can spend.
  const totalFte = people.reduce((sum, person) => sum + personAvailability(person), 0);
  const effectiveFte = people.reduce((sum, person) => sum + personEffectiveFte(person), 0);
  const overCount = people.filter(isOverAllocated).length;
  const maxPool = Math.max(1, ...CAPABILITY_ORDER.map((capability) => pools[capability]));

  return (
    <div className="atl" data-theme={theme === "auto" ? undefined : theme}>
      <header className="atl-header" style={{ height: 56 }}>
        <div className="atl-title">
          <b>Zespół</b>
          <span className="atl-chip">{plCount(people.length, "osoba", "osoby", "osób")}</span>
        </div>
        <div className="atl-spacer" />
        <div className="tw-pools">
          {CAPABILITY_ORDER.map((capability) => (
            <span
              key={capability}
              className="tw-pool"
              title={`${CAPABILITY_LABELS[capability]} — ${fmt2(pools[capability])} FTE w puli`}
            >
              <span className="tw-pool-head">
                <span className="tw-pool-label">{CAPABILITY_LABELS[capability]}</span>
                <b>{fmt2(pools[capability])}</b>
              </span>
              <span className="tw-pool-track">
                <span
                  className="tw-pool-fill"
                  style={{
                    width: `${(pools[capability] / maxPool) * 100}%`,
                    background: capColor(capability),
                  }}
                />
              </span>
            </span>
          ))}
        </div>
      </header>

      <div className="atl-scroll tw-scroll">
        {TEAM_ORDER.map((teamId) => {
          const team = teams.find((t) => t.id === teamId);
          const members = people.filter((p) => p.teamId === teamId);
          const bandFte = members.reduce((sum, person) => sum + personAvailability(person), 0);
          return (
            <section className="tw-band" key={teamId}>
              <div className="tw-band-head">
                <b>{team?.label ?? teamId}</b>
                <span className="tw-band-count">
                  {plCount(members.length, "osoba", "osoby", "osób")}
                </span>
                <span style={{ flex: 1 }} />
                <span className="tw-band-fte">{fmt2(bandFte)} FTE</span>
              </div>

              <div className="tw-colhead">
                <span className="tw-c-name">osoba</span>
                <span className="tw-c-split">podział etatu</span>
                <span className="tw-c-prod">produktywność</span>
                <span className="tw-c-total">razem</span>
                <span className="tw-c-act" />
              </div>

              {members.map((person) => {
                const total = personAvailability(person);
                const over = isOverAllocated(person);
                const unused = CAPABILITY_ORDER.filter(
                  (c) => !person.allocations.some((a) => a.capability === c),
                );
                return (
                  <div className="tw-row" key={person.id}>
                    <input
                      className="ve-text tw-name tw-c-name"
                      type="text"
                      aria-label={`Imię i nazwisko — ${person.name}`}
                      value={person.name}
                      onChange={(e) => updatePerson(person.id, { ...person, name: e.target.value })}
                    />

                    <span className="tw-c-split tw-split-cell">
                      <SplitBar person={person} over={over} />

                      <span className="tw-allocs">
                        {person.allocations.map((allocation) => (
                          <span className="tw-alloc" key={allocation.capability}>
                            <i
                              className="tw-alloc-dot"
                              style={{ background: capColor(allocation.capability) }}
                            />
                            <b>{CAPABILITY_LABELS[allocation.capability]}</b>
                            <FtePicker
                              key={`${person.id}-${allocation.capability}`}
                              value={allocation.fte}
                              label={`${CAPABILITY_LABELS[allocation.capability]} — FTE dla ${person.name}`}
                              onPick={(value) =>
                                setAllocation(person.id, allocation.capability, value)
                              }
                            />
                            <button
                              type="button"
                              className="tw-alloc-drop"
                              aria-label={`Usuń ${CAPABILITY_LABELS[allocation.capability]} z ${person.name}`}
                              title="Usuń kompetencję"
                              onClick={() => setAllocation(person.id, allocation.capability, 0)}
                            >
                              <X size={10} />
                            </button>
                          </span>
                        ))}

                        {unused.length > 0 && (
                          <select
                            className="bv-select tw-alloc-add"
                            value=""
                            aria-label={`Dodaj kompetencję dla ${person.name}`}
                            onChange={(e) => {
                              if (!e.target.value) return;
                              // Whatever is left of them, in quarters, so the
                              // common "split the rest onto a second
                              // capability" needs no maths.
                              const rest = Math.max(0.25, Math.round((1 - total) * 4) / 4);
                              setAllocation(person.id, e.target.value as Capability, rest);
                            }}
                          >
                            <option value="">+ kompetencja</option>
                            {unused.map((capability) => (
                              <option key={capability} value={capability}>
                                {CAPABILITY_LABELS[capability]}
                              </option>
                            ))}
                          </select>
                        )}
                      </span>
                    </span>

                    <span
                      className={`tw-prod tw-c-prod ${person.focusFactor < 1 ? "is-reduced" : ""}`}
                      title={`Produktywność ${fmt(person.focusFactor * 100)}% — z ${fmt2(total)} FTE zostaje ${fmt2(personEffectiveFte(person))} FTE pracy projektowej`}
                    >
                      <NumberField
                        key={`${person.id}-focus`}
                        initial={person.focusFactor * 100}
                        label={`Produktywność — ${person.name}`}
                        min={5}
                        max={100}
                        decimals={0}
                        selectOnFocus
                        deferCommit
                        onCommit={(value) => setFocusFactor(person.id, value / 100)}
                      />
                      <span className="tw-prod-unit">%</span>
                    </span>

                    <span
                      className={`tw-total tw-c-total ${over ? "is-over" : ""}`}
                      title={
                        over
                          ? `${fmt2(total)} FTE — więcej niż jedna osoba; rozdziel na mniejsze części`
                          : `${fmt2(total)} FTE łącznie · ${fmt2(personEffectiveFte(person))} FTE po produktywności`
                      }
                    >
                      {fmt2(total)}
                    </span>

                    <span className="bv-crud tw-c-act">
                      <button
                        type="button"
                        className={`bv-delete ${confirmDeleteId === person.id ? "is-confirming" : ""}`}
                        aria-label={`Usuń ${person.name}`}
                        title={
                          confirmDeleteId === person.id
                            ? "Kliknij ponownie, aby potwierdzić"
                            : "Usuń"
                        }
                        onClick={() => handleDelete(person.id)}
                      >
                        {confirmDeleteId === person.id ? "potwierdź" : <X size={13} />}
                      </button>
                    </span>
                  </div>
                );
              })}

              {addingTeam === teamId ? (
                <div className="tw-row tw-row-form">
                  <input
                    className="ve-text tw-c-name"
                    type="text"
                    placeholder="Imię i nazwisko"
                    autoFocus
                    value={addDraft.name}
                    onChange={(e) => setAddDraft({ ...addDraft, name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveAdd();
                      if (e.key === "Escape") setAddingTeam(null);
                    }}
                  />
                  <select
                    className="bv-select"
                    style={{ width: 96 }}
                    aria-label="Kompetencja"
                    value={addDraft.allocations[0]?.capability ?? "PM"}
                    onChange={(e) =>
                      setAddDraft({
                        ...addDraft,
                        allocations: [{ capability: e.target.value as Capability, fte: 1 }],
                      })
                    }
                  >
                    {CAPABILITY_ORDER.map((capability) => (
                      <option key={capability} value={capability}>
                        {CAPABILITY_LABELS[capability]}
                      </option>
                    ))}
                  </select>
                  <span style={{ flex: 1 }} />
                  <button
                    type="button"
                    className="bv-save"
                    onClick={saveAdd}
                    disabled={addDraft.name.trim() === ""}
                  >
                    Zapisz
                  </button>
                  <button type="button" className="bv-cancel" onClick={() => setAddingTeam(null)}>
                    Anuluj
                  </button>
                </div>
              ) : (
                <button type="button" className="tw-add" onClick={() => startAdd(teamId)}>
                  <Plus size={13} /> Dodaj osobę
                </button>
              )}
            </section>
          );
        })}
      </div>

      <footer className="atl-footer" style={{ height: 32 }}>
        <span>{plCount(people.length, "osoba", "osoby", "osób")} w zespole</span>
        <span>
          {fmt2(totalFte)} FTE łącznie · {fmt2(effectiveFte)} FTE po produktywności
        </span>
        {overCount > 0 && (
          <span style={{ color: "var(--warn)" }}>
            {plCount(overCount, "przeciążona osoba", "przeciążone osoby", "przeciążonych osób")}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span>
          {MOD}1…{MOD}6 przeskakuje między widokami
        </span>
      </footer>
    </div>
  );
}
