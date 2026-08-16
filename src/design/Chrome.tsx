import type { ReactNode } from "react";

/* The parts of a v5 screen that are not its data: the header with one big
   number, the rules that open its sections, and the footer legend. Six
   screens, one vocabulary — a screen that needs a seventh shape should get it
   added here rather than styling its own. */

interface ScreenHeaderProps {
  /** Mono, wide-tracked, uppercase — what the number below is. */
  eyebrow: string;
  /** The screen's single headline figure. */
  value: ReactNode;
  /** What the figure counts: "mies. do końca", "FTE realnej mocy". */
  unit?: ReactNode;
  /** One or two sentences on how to read the screen. */
  children?: ReactNode;
  /** Tabs, toggles, and the screen's pill — right-aligned, baseline-matched. */
  actions?: ReactNode;
}

/** Every screen opens the same way: what this is, the one number that answers
 *  it, a sentence of orientation, and the controls that change it. */
export function ScreenHeader({ eyebrow, value, unit, children, actions }: ScreenHeaderProps) {
  return (
    <header className="ds-header">
      <div className="ds-header-metric">
        <span className="ds-eyebrow">{eyebrow}</span>
        <span className="ds-metric">
          <b>{value}</b>
          {unit && <span className="ds-metric-unit">{unit}</span>}
        </span>
      </div>
      {children ? <span className="ds-prose">{children}</span> : <span style={{ flex: 1 }} />}
      {actions && <div className="ds-header-actions">{actions}</div>}
    </header>
  );
}

interface SectionRuleProps {
  /** The band's name. */
  label: string;
  /** Sits next to the label, before the hairline — a count, usually. */
  lead?: ReactNode;
  /** The band's summary, at the far right. */
  meta?: ReactNode;
  /** Colours `meta`: a section that is fine says so in grey. */
  tone?: "muted" | "loud" | "warn" | "ok";
  /** Tighter above/below, for rules stacked between rows rather than
   *  opening the screen. */
  tight?: boolean;
}

/** Opens a band of rows. The hairline carries the eye from the label to the
 *  summary; it is not a divider, which is why nothing else in v5 has one. */
export function SectionRule({ label, lead, meta, tone = "muted", tight }: SectionRuleProps) {
  return (
    <div className={`ds-rule${tight ? " is-tight" : ""}`}>
      <span className="ds-eyebrow">{label}</span>
      {lead != null && <span className="ds-rule-meta">{lead}</span>}
      <span className="ds-rule-line" />
      {meta != null && <span className={`ds-rule-meta is-${tone}`}>{meta}</span>}
    </div>
  );
}

/** Pushes whatever follows it to the far end of a footer or a card row. */
export function Gap() {
  return <span className="ds-foot-gap" />;
}

/** The bottom line of a screen: what the colours mean on the left, what the
 *  screen totals on the right. */
export function ScreenFooter({ children }: { children: ReactNode }) {
  return <div className="ds-foot">{children}</div>;
}

/** One swatch and its meaning. The swatch is a bar, so it samples the thing
 *  it labels rather than merely pointing at it. */
export function Legend({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="ds-legend">
      <i style={{ background: color }} />
      {children}
    </span>
  );
}

export interface TabItem<T extends string> {
  id: T;
  label: string;
  /** Tooltip — the hint the rail used to carry. */
  hint?: string;
  disabled?: boolean;
}

interface UnderlineTabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Larger and looser, for tabs that lead a screen instead of sitting in
   *  its header. */
  lead?: boolean;
  label: string;
}

/** v5's only mode switch: a word, underlined when it is the one you are
 *  looking at. Arrow keys move within the group, so the whole strip costs a
 *  single Tab stop. */
export function UnderlineTabs<T extends string>({
  items,
  value,
  onChange,
  lead,
  label,
}: UnderlineTabsProps<T>) {
  return (
    <span
      className={`ds-tabs${lead ? " is-lead" : ""}`}
      role="tablist"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        const usable = items.filter((i) => !i.disabled);
        const at = usable.findIndex((i) => i.id === value);
        if (at === -1 || usable.length < 2) return;
        event.preventDefault();
        const step = event.key === "ArrowRight" ? 1 : usable.length - 1;
        onChange(usable[(at + step) % usable.length].id);
      }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={item.id === value}
          tabIndex={item.id === value ? 0 : -1}
          disabled={item.disabled}
          title={item.hint}
          className={`ds-tab${item.id === value ? " is-active" : ""}`}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </span>
  );
}
