import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

/* Controls. v5 draws no borders, so state is carried by fill and by ink
   weight: a control at rest is the surface it sits on, a control that is on
   inverts. Geometry comes from tokens (--ctl-h, --ctl-r) so retuning the
   height moves every control together. */

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className">;

interface PillButtonProps extends ButtonProps {
  /** 13px lucide glyph, to the left of the label. */
  icon?: ReactNode;
  /** Inverted — a pill that is currently doing something. */
  active?: boolean;
  children: ReactNode;
}

/** The header's affordance: "Projekt", "Optymalizuj", "Propozycje sufitów".
 *  One per screen, in the top right, and never more than two. */
export function PillButton({ icon, active, children, ...rest }: PillButtonProps) {
  return (
    <button type="button" className={`ds-pill${active ? " is-on" : ""}`} {...rest}>
      {icon}
      <span>{children}</span>
    </button>
  );
}

interface ActionButtonProps extends ButtonProps {
  /** `primary` confirms and inverts; `danger` destroys and is the only
   *  place warn appears on chrome rather than on data. */
  variant?: "ghost" | "primary" | "danger";
  children: ReactNode;
}

/** The taller pill an overlay closes with — Zapisz / Anuluj / Usuń. */
export function ActionButton({ variant = "ghost", children, ...rest }: ActionButtonProps) {
  const tone = variant === "ghost" ? "" : ` is-${variant}`;
  return (
    <button type="button" className={`ds-btn${tone}`} {...rest}>
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonProps {
  /** Required: an icon button has no text to fall back on. */
  label: string;
  size?: "sm" | "lg";
  /** Gives the button the lifted ground headers and overlay corners use. */
  filled?: boolean;
  active?: boolean;
  children: ReactNode;
}

/** Bare in rows, filled in headers. `label` becomes both the tooltip and the
 *  accessible name, because there is no visible text. */
export function IconButton({
  label,
  size = "sm",
  filled,
  active,
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`ds-icon-btn${size === "lg" ? " is-lg" : ""}${filled ? " is-filled" : ""}${
        active ? " is-on" : ""
      }`}
      {...rest}
    >
      {children}
    </button>
  );
}

interface ToggleProps extends Omit<ButtonProps, "onChange"> {
  checked: boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
}

/** A switch with its label to the right — the one control in v5 that is a
 *  shape rather than a word, because it reads as on/off at a glance. */
export function Toggle({ checked, onChange, children, ...rest }: ToggleProps) {
  return (
    <button
      type="button"
      className="ds-toggle"
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      {...rest}
    >
      <span className="ds-toggle-track">
        <span className="ds-toggle-knob" />
      </span>
      {children}
    </button>
  );
}

interface FieldProps {
  label: string;
  children: ReactNode;
}

/** Label above, well below. The label is the same eyebrow the headers and
 *  rules use, which is what keeps a form looking like the rest of the app. */
export function Field({ label, children }: FieldProps) {
  return (
    <label className="ds-field">
      <span className="ds-eyebrow">{label}</span>
      {children}
    </label>
  );
}

/** The filled well itself — borderless, brightening on focus. */
export function FieldInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "className">) {
  return <input className="ds-field-input" {...props} />;
}

interface CardProps extends ButtonProps {
  label: ReactNode;
  /** Top-right of the card — an FTE count, a badge. */
  meta?: ReactNode;
  /** The card's own headline number. */
  figure?: ReactNode;
  /** Colours the figure. */
  tone?: "plain" | "ok" | "warn";
  /** Sits beside the figure, smaller. */
  note?: ReactNode;
  active?: boolean;
  children?: ReactNode;
}

/** A pickable summary: a staffing variant, a rung of the hiring ladder. Flat
 *  until chosen, then lifted — never outlined. */
export function Card({
  label,
  meta,
  figure,
  tone = "plain",
  note,
  active,
  children,
  ...rest
}: CardProps) {
  return (
    <button type="button" className={`ds-card${active ? " is-active" : ""}`} {...rest}>
      <span className="ds-card-head">
        <span className="ds-card-label">{label}</span>
        {meta != null && <span className="ds-card-meta">{meta}</span>}
      </span>
      {figure != null && (
        <span className="ds-card-figure">
          <b className={tone === "plain" ? undefined : `is-${tone}`}>{figure}</b>
          {note != null && <span>{note}</span>}
        </span>
      )}
      {children}
    </button>
  );
}
