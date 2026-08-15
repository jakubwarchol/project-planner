import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

interface NumberFieldProps {
  initial: number;
  onCommit: (value: number) => void;
  label: string;
  /** Grid cells sit borderless until hover; form fields carry their border.
   *  Both take geometry from the control tokens (--field-r). */
  variant?: "grid" | "form";
  /** Identity of the thing being edited (a row id, a capability). When it
   *  changes the field remounts itself, resetting the draft — callers no
   *  longer pass a `key` for that. */
  subject?: string;
  /** Out-of-range or rejected value → aria-invalid plus the warn border. */
  invalid?: boolean;
  /** Floor for the committed value — for knobs the database rejects at 0.
   *  Only the commit is clamped; the draft is left alone so a value can still
   *  be typed through "0" on its way to "0,5". */
  min?: number;
  max?: number;
  /** How many digits after the decimal separator are accepted while typing. */
  decimals?: number;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Hold the edit locally and commit once — on blur (which covers tabbing
   *  out, clicking away, and arrow-key navigation) or Enter — instead of on
   *  every keystroke. Every commit is a store dispatch, a network write and a
   *  full schedule re-simulation, so an eager field turns "114" into three of
   *  each and briefly plans the project as if it were one day of work. */
  deferCommit?: boolean;
  /** Select the current value on focus so typing replaces it rather than
   *  appending to it — grid convention, and the only sane behaviour when
   *  arrow keys land you in a populated cell. */
  selectOnFocus?: boolean;
  /** Render 0 as an empty field rather than a literal "0". */
  blankZero?: boolean;
  /** Reports the in-progress value on every keystroke, and `null` once the
   *  store has caught up (commit) or the edit was abandoned (Escape). Only
   *  useful together with `deferCommit`, where nothing else can see the draft:
   *  it lets a caller show a live derived figure — a running total, say —
   *  without a keystroke reaching the store. */
  onDraft?: (value: number | null) => void;
}

// Draft kept locally so the field can be emptied or hold a trailing "," while
// typing without the store snapping it back to "0" mid-edit. Remounting is how
// the draft resets when the edited subject changes — `subject` carries that
// key here, so callers don't each reinvent the convention.
export function NumberField(props: NumberFieldProps) {
  return <NumberFieldInner key={props.subject} {...props} />;
}

function NumberFieldInner({
  initial,
  onCommit,
  label,
  variant,
  invalid,
  min = 0,
  max = 99,
  decimals = 1,
  className,
  placeholder,
  disabled,
  deferCommit,
  selectOnFocus,
  blankZero,
  onDraft,
}: NumberFieldProps) {
  const [draft, setDraft] = useState(() => formatDraft(initial, blankZero));
  // What the store holds, as far as this instance knows. Two jobs: it keeps a
  // no-op edit (focus, tab straight out) from spending a write, and it is what
  // Escape restores. It only tracks writes made *here*, which is enough
  // because the `key` convention above remounts the field whenever the subject
  // it edits changes underneath it.
  const committed = useRef(initial);
  const pattern = new RegExp(`^\\d{0,4}([.,]\\d{0,${decimals}})?$`);

  // Something else changed the value under us — a bulk edit, an accepted
  // proposal — so show it. A `key` that changes with the subject is enough
  // when the only writer is the field itself, which stopped being true once
  // the ceiling autopilot could rewrite a dozen cells at once: the store and
  // the schedule moved while every input went on displaying the old number.
  //
  // This never fires mid-edit. With `deferCommit` nothing reaches the store
  // until blur or Enter, and a change that *did* originate here already left
  // `committed` equal to the incoming prop, so the comparison no-ops.
  useEffect(() => {
    if (initial === committed.current) return;
    committed.current = initial;
    setDraft(formatDraft(initial, blankZero));
  }, [initial, blankZero]);

  const clamp = (value: number) => Math.min(Math.max(value, min), max);

  // Reconciles what the field shows with what actually gets stored, and is the
  // only path that writes when `deferCommit` is set. Two ways display and
  // store used to drift apart, both of which read as "my edit didn't save"
  // once the view was reloaded:
  //   - an emptied field printed "0" without ever committing one, so the old
  //     value was still in the store;
  //   - a typed number above `max` was committed clamped, while the draft kept
  //     displaying what was typed.
  function commit(text: string) {
    const blank = text === "" || text === "," || text === ".";
    const parsed = blank ? 0 : Number(text.replace(",", "."));
    if (Number.isFinite(parsed)) {
      const clamped = clamp(parsed);
      setDraft(formatDraft(clamped, blankZero));
      if (clamped !== committed.current) {
        committed.current = clamped;
        onCommit(clamped);
      }
    }
    // The store now agrees with the field, so a live overlay standing in for
    // the uncommitted draft has nothing left to stand in for.
    onDraft?.(null);
  }

  function handleChange(next: string) {
    if (!pattern.test(next)) return;
    setDraft(next);
    // Blank reads as 0, not as "not editing" — clearing a cell should drop a
    // running total by that cell's worth immediately, not on blur.
    const blank = next === "" || next === "," || next === ".";
    const parsed = blank ? 0 : Number(next.replace(",", "."));
    if (!Number.isFinite(parsed)) return;
    const clamped = clamp(parsed);
    onDraft?.(clamped);
    if (deferCommit || blank) return;
    committed.current = clamped;
    onCommit(clamped);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Commit in place and let the event bubble — whatever owns the grid gets
    // to move focus off the back of the same keystroke.
    if (event.key === "Enter") {
      commit(draft);
      return;
    }
    if (event.key !== "Escape" || !deferCommit) return;
    const clean = formatDraft(committed.current, blankZero);
    // Nothing typed to throw away, so let Escape through to whatever closes
    // the surrounding pane. Dirty field: first Escape discards, second closes.
    if (draft === clean) return;
    // The pane's Escape handler is bound to `document`, which sits above the
    // React root the synthetic event is dispatched from — so only stopping the
    // *native* event keeps a discarded edit from also closing the window.
    event.nativeEvent.stopPropagation();
    setDraft(clean);
    onDraft?.(null);
  }

  // `variant` is the styling channel; `className` stays as the escape hatch
  // for the call sites the shared field classes don't cover yet.
  const classes = [variant && `nf-${variant}`, className ?? (variant ? undefined : "ve-number")]
    .filter(Boolean)
    .join(" ");

  return (
    <input
      className={classes}
      type="text"
      inputMode="decimal"
      aria-label={label}
      aria-invalid={invalid || undefined}
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => handleChange(e.target.value)}
      onFocus={selectOnFocus ? (e) => e.currentTarget.select() : undefined}
      onKeyDown={handleKeyDown}
      onBlur={() => commit(draft)}
    />
  );
}

function formatDraft(value: number, blankZero?: boolean): string {
  if (blankZero && value === 0) return "";
  const rounded = Math.round(value * 100) / 100;
  return String(rounded).replace(".", ",");
}
