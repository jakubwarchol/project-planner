import {
  Calculator,
  ChartGantt,
  FlaskConical,
  Grid3x3,
  ListOrdered,
  Moon,
  UserCheck,
  Users,
} from "lucide-react";
import { Rail, THEME_LABELS, nextTheme, type RailItem, type ThemeChoice } from "../design";
import { IconButton } from "../design";
import { MOD, SCREENS, type Screen } from "./timelineChrome";

/* The app's binding of its screens to the design system's rail. One icon per
   destination, in the order SCREENS declares — which is also the order the
   ⌘-number shortcuts follow. */

const ICONS: Record<Screen, typeof ListOrdered> = {
  backlog: ListOrdered,
  team: Users,
  matrix: Calculator,
  advanced: ChartGantt,
  obsada: UserCheck,
  load: Grid3x3,
  compare: FlaskConical,
};

const ITEMS: RailItem<Screen>[] = SCREENS.map((s, i) => {
  const Icon = ICONS[s.id];
  return {
    id: s.id,
    label: s.label,
    icon: <Icon size={17} strokeWidth={1.75} />,
    hint: `${s.label} — ${s.hint} · ${MOD}${i + 1}`,
  };
});

interface NavRailProps {
  screen: Screen;
  onSelect: (screen: Screen) => void;
  theme: ThemeChoice;
  onCycleTheme: () => void;
}

export function NavRail({ screen, onSelect, theme, onCycleTheme }: NavRailProps) {
  return (
    <Rail
      items={ITEMS}
      value={screen}
      onSelect={onSelect}
      label="Widoki"
      footer={
        <div style={{ display: "flex", justifyContent: "center", paddingBottom: 4 }}>
          <IconButton
            label={`Motyw: ${THEME_LABELS[theme]} — kliknij, by przełączyć na ${
              THEME_LABELS[nextTheme(theme)]
            }`}
            size="lg"
            onClick={onCycleTheme}
          >
            <Moon size={13} strokeWidth={1.75} />
          </IconButton>
        </div>
      }
    />
  );
}
