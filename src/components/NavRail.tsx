import { useEffect, useRef, useState } from "react";
import { HelpCircle, Moon } from "lucide-react";
import { MOD, SCREENS, groupArrowNav, type Screen } from "./timelineChrome";

const THEME_LABELS = { auto: "auto", light: "jasny", dark: "ciemny" } as const;

interface NavRailProps {
  screen: Screen;
  onSelect: (screen: Screen) => void;
  theme: "auto" | "light" | "dark";
  onCycleTheme: () => void;
}

export function NavRail({ screen, onSelect, theme, onCycleTheme }: NavRailProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const helpRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!helpOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setHelpOpen(false);
    }
    function onPointerDown(event: PointerEvent) {
      if (helpRef.current && !helpRef.current.contains(event.target as Node)) setHelpOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [helpOpen]);

  return (
    <nav className="rail" aria-label="Widoki">
      <span className="rail-logo" />
      <div className="rail-tabs" role="tablist" aria-label="Ekrany" onKeyDown={groupArrowNav}>
        {SCREENS.map((s, i) => (
          <div className="rail-slot" key={s.id}>
            {i > 0 && s.group !== SCREENS[i - 1].group && <span className="rail-divider" />}
            <button
              type="button"
              role="tab"
              aria-selected={s.id === screen}
              tabIndex={s.id === screen ? 0 : -1}
              className={`rail-tab ${s.id === screen ? "is-active" : ""}`}
              onClick={() => onSelect(s.id)}
              title={`${s.label} — ${s.hint} · ${MOD}${i + 1}`}
            >
              {s.label}
            </button>
          </div>
        ))}
      </div>
      <div className="rail-actions" ref={helpRef}>
        <button
          type="button"
          className={`rail-icon ${helpOpen ? "is-on" : ""}`}
          onClick={() => setHelpOpen((v) => !v)}
          title="Widoki i skróty"
          aria-label="Widoki i skróty"
          aria-expanded={helpOpen}
        >
          <HelpCircle size={12} />
        </button>
        <button
          type="button"
          className="rail-icon"
          onClick={onCycleTheme}
          title={`Motyw: ${THEME_LABELS[theme]}`}
          aria-label={`Motyw: ${THEME_LABELS[theme]}`}
        >
          <Moon size={12} />
        </button>
        {helpOpen && (
          <div className="rail-help">
            {SCREENS.map((s, i) => (
              <div className="rail-help-row" key={s.id}>
                <b>{s.label}</b>
                <span>{s.hint}</span>
                <kbd>
                  {MOD}
                  {i + 1}
                </kbd>
              </div>
            ))}
            <p className="rail-help-foot">
              {MOD}1…{MOD}
              {SCREENS.length} przeskakuje między widokami
            </p>
          </div>
        )}
      </div>
    </nav>
  );
}
