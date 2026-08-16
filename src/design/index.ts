/* The v5 design system.
 *
 * Import the pieces from here, not from the files behind it — the split
 * between Chrome/Controls/Overlay/Rail is an implementation detail, and
 * pulling everything through one door is what makes the set easy to see.
 *
 *   tokens.css      the palette, geometry and type — the configurable layer
 *   primitives.css  the styles behind the components below
 *
 * Both stylesheets are imported once, here, so a consumer only ever imports
 * the module.
 */

import "./tokens.css";
import "./primitives.css";

export {
  ScreenHeader,
  SectionRule,
  Gap,
  ScreenFooter,
  Legend,
  UnderlineTabs,
} from "./Chrome";
export type { TabItem } from "./Chrome";

export {
  PillButton,
  ActionButton,
  IconButton,
  Toggle,
  Field,
  FieldInput,
  Card,
} from "./Controls";

export { Drawer, Modal, OverlayGap } from "./Overlay";

export { Rail } from "./Rail";
export type { RailItem } from "./Rail";

export { useResolvedTheme, nextTheme, THEME_CYCLE, THEME_LABELS } from "./theme";
export type { ThemeChoice, ResolvedTheme } from "./theme";
