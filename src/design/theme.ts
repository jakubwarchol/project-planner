import { useEffect, useState } from "react";

/** What the user picks. */
export type ThemeChoice = "auto" | "light" | "dark";

/** What the shells are actually stamped with. `auto` never reaches the DOM. */
export type ResolvedTheme = "light" | "dark";

const MEDIA = "(prefers-color-scheme: dark)";

/** v5 is authored dark, so an environment that cannot answer the question
 *  gets dark rather than a light fallback. */
function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia(MEDIA).matches ? "dark" : "light";
}

/** Resolves "auto" here rather than in CSS.
 *
 *  The alternative — a `prefers-color-scheme` block alongside the explicit
 *  `[data-theme]` one — means writing the light palette twice and keeping the
 *  copies in step forever. Watching the query costs one listener and lets
 *  tokens.css state each palette exactly once. */
export function useResolvedTheme(choice: ThemeChoice): ResolvedTheme {
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);

  useEffect(() => {
    if (choice !== "auto" || typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia(MEDIA);
    const onChange = () => setSystem(query.matches ? "dark" : "light");
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [choice]);

  return choice === "auto" ? system : choice;
}

/** The order the theme control cycles through. */
export const THEME_CYCLE: ThemeChoice[] = ["auto", "light", "dark"];

export const THEME_LABELS: Record<ThemeChoice, string> = {
  auto: "auto",
  light: "jasny",
  dark: "ciemny",
};

export function nextTheme(current: ThemeChoice): ThemeChoice {
  return THEME_CYCLE[(THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length];
}
