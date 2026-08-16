import { Plus } from "lucide-react";
import { ProjectList } from "./ProjectList";
import { PillButton, ScreenFooter, ScreenHeader, Toggle, Gap } from "../design";
import { fmt, plCount } from "./timelineChrome";
import { useCapabilitySchedule } from "../hooks/useCapabilitySchedule";
import { CATEGORY_ORDER } from "../lib/estimation";
import type { CapabilityVector, Project } from "../types";

/* 01 · Projekty — the backlog in the order it will be worked.

   The screen's number is the horizon: how long the whole backlog takes at
   today's team. The list below it is what produces that number. */

interface BacklogScreenProps {
  projects: Project[];
  pools: CapabilityVector;
  onReorder: (fromIndex: number, toIndex: number) => void;
  hueById: Record<string, number>;
  showEstimates: boolean;
  onToggleEstimates: (next: boolean) => void;
  /** The header pill opens the new-project form the list owns. */
  adding: boolean;
  onAddingChange: (adding: boolean) => void;
}

export function BacklogScreen({
  projects,
  pools,
  onReorder,
  hueById,
  showEstimates,
  onToggleEstimates,
  adding,
  onAddingChange,
}: BacklogScreenProps) {
  const schedule = useCapabilitySchedule(projects, pools);

  return (
    <div className="ds-column">
      <ScreenHeader
        eyebrow="Backlog"
        value={fmt(schedule.horizonMonths)}
        unit="mies. do końca"
        actions={
          <>
            <Toggle checked={showEstimates} onChange={onToggleEstimates}>
              rozmiary
            </Toggle>
            <PillButton
              icon={<Plus size={13} strokeWidth={1.75} />}
              onClick={() => onAddingChange(true)}
            >
              Projekt
            </PillButton>
          </>
        }
      >
        Przy obecnym zespole cała praca w backlogu domyka się po{" "}
        {fmt(schedule.horizonMonths)} mies.
      </ScreenHeader>

      <div className="ds-body">
        <ProjectList
          projects={projects}
          onReorder={onReorder}
          showEstimates={showEstimates}
          hueById={hueById}
          adding={adding}
          onAddingChange={onAddingChange}
        />
      </div>

      <ScreenFooter>
        <span>obecny zespół</span>
        <span>
          {plCount(projects.length, "projekt", "projekty", "projektów")} ·{" "}
          {plCount(CATEGORY_ORDER.length, "kategoria", "kategorie", "kategorii")}
        </span>
        <Gap />
        <span>przeciągnij uchwyt lub użyj strzałek</span>
      </ScreenFooter>
    </div>
  );
}
