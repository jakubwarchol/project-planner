import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "./Controls";

/* The three ways v5 puts something on top of a screen, in order of how much
   they interrupt:

     Drawer   a panel down the right edge, scrimmed, for a task with its own
              footer of decisions.
     Modal    centred and strongly scrimmed, for one small thing to confirm.

   Both close on Escape and on a click outside; the modal also moves focus
   inside on open and hands it back on close. The third — an anchored,
   un-scrimmed panel — is the .ds-popover surface, worn by the plan's ceiling
   editor and its breakdown tip. Those two keep their own dismissal (one
   toggles from the bar that opened it, the other follows the pointer), so the
   popover is a style here rather than a component. */

/** Escape closes, while `active`. Stopped rather than merely handled, so the
 *  screen underneath does not also read it as "leave this view". */
function useEscape(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, onClose]);
}

/** A pointerdown that lands outside `ref` closes. */
function useClickOutside(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [ref, onClose]);
}

/** Focus in on open, back where it came from on close. */
function useFocusReturn(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    (first ?? ref.current)?.focus();
    return () => returnTo?.focus?.();
  }, [ref]);
}

interface DrawerProps {
  /** The drawer stays mounted and slides, so the transition can actually
   *  play and a half-finished computation inside it survives a peek. */
  open: boolean;
  onClose: () => void;
  title: string;
  /** The line under the title. */
  subtitle?: ReactNode;
  /** The row of decisions along the bottom. */
  footer?: ReactNode;
  /** Widths differ by contents; the design's 428px is the default. */
  width?: number;
  children: ReactNode;
}

/** The right-edge panel. Its header and footer are fixed; only the middle
 *  scrolls, so the decisions stay reachable however long the list is. */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  footer,
  width,
  children,
}: DrawerProps) {
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  // The scrim takes the clicks; only Escape needs wiring, and only while the
  // panel is actually out.
  useEscape(open, onClose);
  return (
    <>
      <div
        className={`ds-scrim${open ? " is-open" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={ref}
        className="ds-drawer"
        style={{ width, transform: open ? "translateX(0)" : "translateX(101%)" }}
        role="dialog"
        aria-labelledby={titleId}
        aria-hidden={!open}
        inert={!open}
      >
        <header className="ds-overlay-head">
          <div className="ds-overlay-title">
            <b id={titleId}>{title}</b>
            {subtitle && <span>{subtitle}</span>}
          </div>
          <IconButton label="Zamknij" size="lg" onClick={onClose}>
            <X size={14} />
          </IconButton>
        </header>
        <div className="ds-drawer-body">{children}</div>
        {footer && <div className="ds-overlay-foot">{footer}</div>}
      </aside>
    </>
  );
}

interface ModalProps {
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

/** Centred, strongly scrimmed — one small thing, answered and dismissed. */
export function Modal({ onClose, title, subtitle, footer, children }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEscape(true, onClose);
  useClickOutside(ref, onClose);
  useFocusReturn(ref);
  return (
    <>
      <div className="ds-scrim is-strong" />
      <div
        ref={ref}
        className="ds-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="ds-overlay-head">
          <div className="ds-overlay-title">
            <b id={titleId}>{title}</b>
            {subtitle && <span>{subtitle}</span>}
          </div>
          <IconButton label="Zamknij" size="lg" onClick={onClose}>
            <X size={14} />
          </IconButton>
        </div>
        {children}
        {footer && <div className="ds-overlay-foot">{footer}</div>}
      </div>
    </>
  );
}

/** Pushes the buttons after it to the right edge of an overlay footer. */
export function OverlayGap() {
  return <span className="ds-overlay-gap" />;
}
