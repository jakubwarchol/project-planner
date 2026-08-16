import type { ReactNode } from "react";

/* The vertical rail. v5 moved navigation off the top edge and onto the left,
   which buys every screen its full height and lets the six destinations carry
   an icon each. The rail is chrome, so it is greyscale: the current screen is
   white ink and a 2px bar in the gutter, everything else is ink4. */

export interface RailItem<T extends string> {
  id: T;
  label: string;
  icon: ReactNode;
  /** Tooltip — what the screen is for, plus its shortcut. */
  hint?: string;
}

interface RailProps<T extends string> {
  items: RailItem<T>[];
  value: T;
  onSelect: (id: T) => void;
  label: string;
  /** Theme control and anything else that belongs at the bottom. */
  footer?: ReactNode;
}

export function Rail<T extends string>({ items, value, onSelect, label, footer }: RailProps<T>) {
  return (
    <nav className="ds-rail" aria-label={label}>
      <div
        role="tablist"
        aria-label={label}
        aria-orientation="vertical"
        style={{ display: "contents" }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          const at = items.findIndex((i) => i.id === value);
          if (at === -1 || items.length < 2) return;
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : items.length - 1;
          onSelect(items[(at + step) % items.length].id);
        }}
      >
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={item.id === value}
            tabIndex={item.id === value ? 0 : -1}
            title={item.hint}
            className={`ds-rail-tab${item.id === value ? " is-active" : ""}`}
            onClick={() => onSelect(item.id)}
          >
            {item.icon}
            <span className="ds-rail-label">{item.label}</span>
          </button>
        ))}
      </div>
      {footer && (
        <>
          <span className="ds-rail-spacer" />
          {footer}
        </>
      )}
    </nav>
  );
}
