import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
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
import { CAPABILITY_HUES, fmt, fmt2, groupArrowNav, plCount, solid } from "./timelineChrome";
import "./timeline.css";
import {
  Gap,
  PillButton,
  ScreenFooter,
  ScreenHeader,
  SectionRule,
  type ResolvedTheme,
} from "../design";

interface TeamViewProps {
  theme: ResolvedTheme;
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

interface PickerOption {
  key: string;
  content: ReactNode;
  active?: boolean;
  /** The one option that takes something away. */
  danger?: boolean;
  onPick: () => void;
}

/** One anchored menu, two jobs: picking a capability's share of an etat, and
 *  picking which capability to add. Both open the same way and dismiss the
 *  same way, so the row has a single interaction to learn.
 *
 *  The trigger carries no border — the whole thing lights up on hover, which
 *  is how v5 says "this is clickable" without drawing a box around it. */
function Picker({
  label,
  title,
  className,
  style,
  triggerClass,
  triggerStyle,
  trigger,
  options,
  stack,
}: {
  label: string;
  title: string;
  /** Wrapper class and style — a bar segment carries its own width here. */
  className?: string;
  style?: CSSProperties;
  triggerClass?: string;
  triggerStyle?: CSSProperties;
  trigger: ReactNode;
  options: PickerOption[];
  /** A list rather than a row — for choices with names rather than numbers. */
  stack?: boolean;
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

  // Roving tabindex needs exactly one stop; when nothing is picked yet the
  // first option takes it.
  const activeIndex = options.findIndex((o) => o.active);

  return (
    <span className={`tw-picker ${className ?? ""}`} style={style} ref={ref}>
      <button
        type="button"
        className={`tw-picker-btn ${triggerClass ?? ""} ${open ? "is-on" : ""}`}
        style={triggerStyle}
        aria-label={label}
        aria-expanded={open}
        title={title}
        onClick={() => setOpen((v) => !v)}
      >
        {trigger}
      </button>
      {open && (
        <span
          className={`ds-popover is-menu tw-picker-pop ${stack ? "is-stack" : ""}`}
          role="radiogroup"
          aria-label={label}
          onKeyDown={groupArrowNav}
        >
          {options.map((option, i) => (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={Boolean(option.active)}
              tabIndex={i === (activeIndex === -1 ? 0 : activeIndex) ? 0 : -1}
              className={`ds-menu-opt ${option.active ? "is-active" : ""} ${
                option.danger ? "is-danger" : ""
              }`}
              onClick={() => {
                option.onPick();
                setOpen(false);
              }}
            >
              {option.content}
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
function SplitBar({
  person,
  over,
  onSet,
}: {
  person: Person;
  over: boolean;
  onSet: (capability: Capability, fte: number) => void;
}) {
  const total = personAvailability(person);
  const scale = Math.max(1, total);
  // Segments reach the bar's right edge only once the person is fully
  // committed; below that the track shows, and the last segment keeps its
  // square edge to say so.
  const full = total >= scale - 0.0001;
  return (
    <span className={`tw-split ${over ? "is-over" : ""} ${full ? "is-full" : ""}`}>
      {person.allocations.map((allocation) => {
        const share = allocation.fte / scale;
        const name = CAPABILITY_LABELS[allocation.capability];
        return (
          <Picker
            key={allocation.capability}
            className="tw-split-slot"
            style={{ width: `${share * 100}%` }}
            label={`${name} — FTE dla ${person.name}`}
            title={`${name} · ${fmt2(allocation.fte)} FTE — kliknij, aby zmienić`}
            triggerClass="tw-split-seg"
            triggerStyle={{ background: capColor(allocation.capability) }}
            trigger={
              share >= SEGMENT_LABEL_MIN
                ? `${name} ${fmt2(allocation.fte)}`
                : share >= SEGMENT_CODE_MIN
                  ? name
                  : ""
            }
            options={[
              ...FTE_OPTIONS.map((option) => ({
                key: String(option),
                content: fmt2(option),
                active: Math.abs(option - allocation.fte) < 0.005,
                onPick: () => onSet(allocation.capability, option),
              })),
              // With the chips gone this is the only way back out, so the
              // picker finally needs its zero.
              {
                key: "drop",
                content: "usuń",
                danger: true,
                onPick: () => onSet(allocation.capability, 0),
              },
            ]}
          />
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
    <div className="atl" data-theme={theme}>
      <ScreenHeader
        eyebrow="Zespół"
        value={fmt2(effectiveFte)}
        unit="FTE realnej mocy"
        actions={
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
        }
      >
        {plCount(people.length, "etat", "etaty", "etatów")} daje {fmt2(effectiveFte)} FTE po
        uwzględnieniu produktywności. Pasek pokazuje podział etatu każdej osoby między
        kompetencje.
      </ScreenHeader>

      <div className="atl-scroll tw-scroll">
        {TEAM_ORDER.map((teamId) => {
          const team = teams.find((t) => t.id === teamId);
          const members = people.filter((p) => p.teamId === teamId);
          const bandFte = members.reduce((sum, person) => sum + personAvailability(person), 0);
          return (
            <section className="tw-band" key={teamId}>
              <SectionRule
                label={team?.label ?? teamId}
                meta={`${plCount(members.length, "osoba", "osoby", "osób")} · ${fmt2(bandFte)} FTE`}
              />

              {/* Named columns: the bar is a fixed width now, so the numbers
                  to its right line up down the whole band and are worth
                  labelling. */}
              <div className="tw-colhead">
                <span className="tw-c-name" />
                <span className="tw-c-split ds-eyebrow">podział etatu</span>
                <span className="tw-c-prod ds-eyebrow">produkt.</span>
                <span className="tw-c-total ds-eyebrow">etat</span>
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
                      <SplitBar
                        person={person}
                        over={over}
                        onSet={(capability, fte) => setAllocation(person.id, capability, fte)}
                      />

                      {unused.length > 0 && (
                        <Picker
                          stack
                          label={`Dodaj kompetencję dla ${person.name}`}
                          title="Dodaj kompetencję"
                          triggerClass="tw-alloc-add"
                          trigger={<Plus size={13} strokeWidth={1.75} />}
                          options={unused.map((capability) => ({
                            key: capability,
                            content: (
                              <>
                                <i
                                  className="tw-alloc-dot"
                                  style={{ background: capColor(capability) }}
                                />
                                {CAPABILITY_LABELS[capability]}
                              </>
                            ),
                            // Whatever is left of them, in quarters, so the
                            // common "split the rest onto a second
                            // capability" needs no maths.
                            onPick: () =>
                              setAllocation(
                                person.id,
                                capability,
                                Math.max(0.25, Math.round((1 - total) * 4) / 4),
                              ),
                          }))}
                        />
                      )}
                    </span>

                    <span
                      className={`tw-prod tw-c-prod ${person.focusFactor < 1 ? "is-reduced" : ""}`}
                      title={`Produktywność ${fmt(person.focusFactor * 100)}% — z ${fmt2(total)} FTE zostaje ${fmt2(personEffectiveFte(person))} FTE pracy projektowej`}
                    >
                      <NumberField
                        subject={`${person.id}-focus`}
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
                <div className="tw-add-row">
                  <PillButton
                    icon={<Plus size={13} strokeWidth={1.75} />}
                    onClick={() => startAdd(teamId)}
                  >
                    Osoba
                  </PillButton>
                </div>
              )}
            </section>
          );
        })}
      </div>

      <ScreenFooter>
        <span>produktywność · suma etatów</span>
        <span>
          {fmt2(totalFte)} FTE łącznie · {fmt2(effectiveFte)} FTE po produktywności
        </span>
        <Gap />
        {overCount > 0 && (
          <span className="is-warn">
            {plCount(overCount, "osoba", "osoby", "osób")} ponad 100%
          </span>
        )}
      </ScreenFooter>
    </div>
  );
}
