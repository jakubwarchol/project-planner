import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRightToLine,
  ChevronDown,
  ChevronsUp,
  ChevronUp,
  GripVertical,
  Pencil,
  X,
} from "lucide-react";
import type { Project } from "../types";
import { ESTIMATE_ORDER, CATEGORY_ORDER, referenceEffortDays } from "../lib/estimation";
import { useProjectCrud, type ProjectDraft } from "../hooks/useProjectCrud";
import { usePlanner } from "../state/plannerContext";
import { plCount, solid } from "./timelineChrome";
import { SectionRule } from "../design";

interface ProjectListProps {
  projects: Project[];
  onReorder: (fromIndex: number, toIndex: number) => void;
  showEstimates: boolean;
  hueById: Record<string, number>;
  /** The "new project" form is opened from the screen header's pill, so the
   *  flag that shows it lives up there with the button. */
  adding: boolean;
  onAddingChange: (adding: boolean) => void;
}

// Dependency arrows live in a left gutter whose width grows with however many
// lanes are in use — spacing between lanes, arrowhead length, and the two
// margins (outermost lane to the row edge, tip to the row's content).
const LANE_GAP = 9;
const ARROW_HEAD_LEN = 6;
const TIP_MARGIN = 4;
const LEFT_MARGIN = 4;

interface LinkPlan {
  /** The blocked project's id — also what a click on the arrow clears. */
  id: string;
  blockerId: string;
  startIndex: number;
  endIndex: number;
  lane: number;
}

// Index order is display order, so "overlap" reduces to plain interval
// overlap on the two endpoints' positions — classic minimum-track interval
// scheduling. A lane is reused once its last interval ends before this one
// starts; otherwise a new (further left) lane opens up.
function planLinks(projects: Project[]): LinkPlan[] {
  const indexOf = new Map(projects.map((p, i) => [p.id, i]));
  const raw = projects
    .map((p) => {
      if (!p.blockedBy) return null;
      const a = indexOf.get(p.blockedBy);
      const b = indexOf.get(p.id);
      if (a == null || b == null || a === b) return null;
      return { id: p.id, blockerId: p.blockedBy, startIndex: Math.min(a, b), endIndex: Math.max(a, b) };
    })
    .filter((link): link is Omit<LinkPlan, "lane"> => link !== null)
    .sort((x, y) => x.startIndex - y.startIndex);

  const laneEnds: number[] = [];
  return raw.map((link) => {
    let lane = laneEnds.findIndex((end) => end < link.startIndex);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(link.endIndex);
    } else {
      laneEnds[lane] = link.endIndex;
    }
    return { ...link, lane };
  });
}

interface LinkArrow extends LinkPlan {
  y1: number;
  y2: number;
}

function emptyDraft(): ProjectDraft {
  return {
    name: "",
    category: CATEGORY_ORDER[0],
    estimate: "M",
    description: "",
    earliestStartDate: "",
    deadlineDate: "",
    plannedStartDate: "",
  };
}

function draftOf(project: Project): ProjectDraft {
  return {
    name: project.name,
    category: project.category,
    estimate: project.estimate,
    description: project.description ?? "",
    earliestStartDate: project.earliestStartDate ?? "",
    deadlineDate: project.deadlineDate ?? "",
    plannedStartDate: project.plannedStartDate ?? "",
  };
}

/** A cleared month input hands back "", which must not be stored as a
 *  constraint that happens to be unparseable. */
function trimmedDraft(draft: ProjectDraft): ProjectDraft {
  return {
    ...draft,
    name: draft.name.trim(),
    earliestStartDate: draft.earliestStartDate?.trim() || undefined,
    deadlineDate: draft.deadlineDate?.trim() || undefined,
    plannedStartDate: draft.plannedStartDate?.trim() || undefined,
  };
}

interface ProjectFormProps {
  draft: ProjectDraft;
  title: string;
  onChange: (draft: ProjectDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}

function ProjectForm({ draft, title, onChange, onSave, onCancel }: ProjectFormProps) {
  const saveDisabled = draft.name.trim() === "";
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Captured and stopped so Escape closes the dialog without also being
      // read as "leave this screen".
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  // Only a press that both starts and ends on the backdrop dismisses — otherwise
  // releasing a text selection outside the panel would throw the edit away.
  function onBackdropMouseDown(event: React.MouseEvent) {
    if (event.target === event.currentTarget) onCancel();
  }

  // Enter saves from the single-line fields only — the description is a
  // textarea, where Enter has to mean newline.
  function onFieldKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && !saveDisabled) {
      event.preventDefault();
      onSave();
    }
  }

  return (
    <div className="bv-modal-backdrop" onMouseDown={onBackdropMouseDown}>
      <div className="bv-modal" ref={panelRef} role="dialog" aria-modal="true" aria-label={title}>
        <div className="bv-modal-head">{title}</div>

        <div className="bv-modal-body">
          <label className="bv-pop-field">
            <span>nazwa</span>
            <input
              className="bv-input"
              type="text"
              placeholder="Nazwa projektu"
              value={draft.name}
              autoFocus
              onChange={(e) => onChange({ ...draft, name: e.target.value })}
              onKeyDown={onFieldKeyDown}
            />
          </label>

          <label className="bv-pop-field">
            <span>opis</span>
            <textarea
              className="bv-input bv-pop-textarea"
              rows={3}
              placeholder="Opcjonalnie"
              value={draft.description ?? ""}
              onChange={(e) => onChange({ ...draft, description: e.target.value })}
            />
          </label>

          <div className="bv-pop-cols">
            <label className="bv-pop-field">
              <span>rozmiar</span>
              <select
                className="bv-select"
                value={draft.estimate}
                onChange={(e) => onChange({ ...draft, estimate: e.target.value as ProjectDraft["estimate"] })}
              >
                {ESTIMATE_ORDER.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <label className="bv-pop-field">
              <span>kategoria</span>
              <select
                className="bv-select"
                value={draft.category}
                onChange={(e) => onChange({ ...draft, category: e.target.value })}
              >
                {CATEGORY_ORDER.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="bv-pop-cols-3">
            <label
              className="bv-pop-field"
              title="Projekt nie może ruszyć przed tym miesiącem (np. umowa, rok budżetowy). Harmonogram tego pilnuje."
            >
              <span>nie przed</span>
              <input
                className="bv-input"
                type="date"
                value={draft.earliestStartDate ?? ""}
                onChange={(e) => onChange({ ...draft, earliestStartDate: e.target.value })}
                onKeyDown={onFieldKeyDown}
              />
            </label>
            <label
              className="bv-pop-field"
              title="Planowany start — zamiar kierownictwa, wyłącznie znacznik. Harmonogram go nie uwzględnia i nigdy nie startuje wcześniej niż pozwala kolejka i zasoby."
            >
              <span>plan startu</span>
              <input
                className="bv-input"
                type="date"
                value={draft.plannedStartDate ?? ""}
                onChange={(e) => onChange({ ...draft, plannedStartDate: e.target.value })}
                onKeyDown={onFieldKeyDown}
              />
            </label>
            <label
              className="bv-pop-field"
              title="Termin — wyłącznie znacznik na osi czasu. Harmonogram go nie uwzględnia, pokazuje tylko, czy projekt się w nim mieści."
            >
              <span>termin</span>
              <input
                className="bv-input"
                type="date"
                value={draft.deadlineDate ?? ""}
                onChange={(e) => onChange({ ...draft, deadlineDate: e.target.value })}
                onKeyDown={onFieldKeyDown}
              />
            </label>
          </div>
        </div>

        <div className="bv-modal-actions">
          <span className="bv-pop-hint">enter zapisuje · esc anuluje</span>
          <button type="button" className="bv-cancel" onClick={onCancel}>
            Anuluj
          </button>
          <button type="button" className="bv-save" onClick={onSave} disabled={saveDisabled}>
            Zapisz
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProjectList({
  projects,
  onReorder,
  showEstimates,
  hueById,
  adding,
  onAddingChange,
}: ProjectListProps) {
  const { addProject, updateProject, removeProject, setBlockedBy } = useProjectCrud();
  const { settings } = usePlanner();
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ProjectDraft | null>(null);
  const [addDraft, setAddDraft] = useState<ProjectDraft>(emptyDraft);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [linkingFromId, setLinkingFromId] = useState<string | null>(null);

  const rowsRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const [links, setLinks] = useState<LinkArrow[]>([]);

  // Lane assignment only depends on list order, not on pixel layout, so it's
  // plain derived data — no need to wait for a measurement pass.
  const linkPlans = useMemo(() => planLinks(projects), [projects]);
  const laneCount = Math.max(1, ...linkPlans.map((l) => l.lane + 1));
  const gutterWidth = LEFT_MARGIN + LANE_GAP * laneCount + ARROW_HEAD_LEN + TIP_MARGIN;
  const tipX = gutterWidth - TIP_MARGIN;
  const headBackX = tipX - ARROW_HEAD_LEN;
  const cornerX = (lane: number) => headBackX - LANE_GAP * lane;

  // Esc backs out of "pick a row to block" mode.
  useEffect(() => {
    if (!linkingFromId) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setLinkingFromId(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [linkingFromId]);

  // Re-measure row centers whenever the list or its layout could have moved —
  // rows are refs, not index math, so this stays correct through edits too.
  useLayoutEffect(() => {
    const container = rowsRef.current;
    if (!container) return;
    const containerTop = container.getBoundingClientRect().top;
    const next: LinkArrow[] = [];
    for (const plan of linkPlans) {
      const fromEl = rowRefs.current.get(plan.blockerId);
      const toEl = rowRefs.current.get(plan.id);
      if (!fromEl || !toEl) continue;
      const r1 = fromEl.getBoundingClientRect();
      const r2 = toEl.getBoundingClientRect();
      next.push({
        ...plan,
        y1: r1.top - containerTop + r1.height / 2,
        y2: r2.top - containerTop + r2.height / 2,
      });
    }
    setLinks(next);
  }, [linkPlans, editingId, adding]);

  function handleDragOver(event: React.DragEvent, index: number) {
    event.preventDefault();
    if (index !== dragOverIndex) setDragOverIndex(index);
  }

  function handleDrop(index: number) {
    if (draggingIndex !== null) onReorder(draggingIndex, index);
    setDraggingIndex(null);
    setDragOverIndex(null);
  }

  // Opening the form is the header's job; clearing whatever else was open
  // and starting from a blank draft is still this component's.
  useEffect(() => {
    if (!adding) return;
    setConfirmDeleteId(null);
    setEditingId(null);
    setLinkingFromId(null);
    setAddDraft(emptyDraft());
  }, [adding]);

  function startEdit(project: Project) {
    setConfirmDeleteId(null);
    onAddingChange(false);
    setLinkingFromId(null);
    setEditingId(project.id);
    setEditDraft(draftOf(project));
  }

  function saveEdit() {
    if (!editingId || !editDraft || editDraft.name.trim() === "") return;
    updateProject(editingId, trimmedDraft(editDraft));
    setEditingId(null);
    setEditDraft(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft(null);
  }

  function saveAdd() {
    if (addDraft.name.trim() === "") return;
    addProject(trimmedDraft(addDraft));
    onAddingChange(false);
  }

  function handleDelete(id: string) {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    setConfirmDeleteId(null);
    if (editingId === id) cancelEdit();
    removeProject(id);
  }

  function toggleLinking(project: Project) {
    setConfirmDeleteId(null);
    setEditingId(null);
    setLinkingFromId((current) => (current === project.id ? null : project.id));
  }

  function handleRowClick(project: Project) {
    if (!linkingFromId) return;
    if (linkingFromId === project.id) {
      setLinkingFromId(null);
      return;
    }
    setBlockedBy(project.id, linkingFromId);
    setLinkingFromId(null);
  }

  return (
    <section className="bv-card">
      <SectionRule
        label="Kolejność backlogu"
        meta={
          linkingFromId
            ? "kliknij wiersz, który ma być zablokowany · esc anuluje"
            : plCount(projects.length, "projekt", "projekty", "projektów")
        }
        tone={linkingFromId ? "ok" : "muted"}
      />

      <div className={`bv-rows ${linkingFromId ? "is-linking" : ""}`} ref={rowsRef}>
        {projects.map((project, index) => {
          const hovered = hover === project.id;
          const isLinkingSource = linkingFromId === project.id;
          const isLinkingTarget = linkingFromId != null && !isLinkingSource;
          return (
            <div
              key={project.id}
              ref={(el) => {
                if (el) rowRefs.current.set(project.id, el);
                else rowRefs.current.delete(project.id);
              }}
              className={[
                "bv-row",
                project.id === editingId ? "is-editing" : "",
                draggingIndex === index ? "is-dragging" : "",
                dragOverIndex === index && draggingIndex !== index ? "is-drag-over" : "",
                isLinkingTarget ? "is-linking-target" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{
                background: isLinkingSource
                  ? "var(--accent-wash)"
                  : hovered
                    ? "var(--row-hover)"
                    : "transparent",
              }}
              draggable
              onDragStart={() => setDraggingIndex(index)}
              onDragOver={(event) => handleDragOver(event, index)}
              onDrop={() => handleDrop(index)}
              onDragEnd={() => {
                setDraggingIndex(null);
                setDragOverIndex(null);
              }}
              onMouseEnter={() => setHover(project.id)}
              onMouseLeave={() => setHover((h) => (h === project.id ? null : h))}
              onClick={() => handleRowClick(project)}
            >
              <span style={{ width: gutterWidth, flex: "none" }} />
              <span className="bv-ord">{String(index + 1).padStart(2, "0")}</span>
              <span className="bv-grip" aria-hidden="true">
                <GripVertical size={13} />
              </span>
              <span className="bv-row-hue" style={{ background: solid(hueById[project.id] ?? 232) }} />
              <span className="bv-row-name" title={project.description || project.name}>
                {project.name}
              </span>
              <span
                className="bv-size"
                title={
                  showEstimates
                    ? `${project.estimate} — orientacyjnie ${referenceEffortDays(project, settings)} dni pracy (harmonogram liczy z wycen)`
                    : undefined
                }
              >
                {showEstimates && (
                  <span
                    className="bv-size-label"
                    style={{ color: `var(--size-${project.estimate.toLowerCase()})` }}
                  >
                    {project.estimate}
                  </span>
                )}
              </span>
              <span className="bv-row-cat">{project.category}</span>
              <span className="bv-move">
                <button
                  type="button"
                  aria-label={`Przesuń ${project.name} na początek`}
                  title="Na początek"
                  disabled={index === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onReorder(index, 0);
                  }}
                >
                  <ChevronsUp size={12} />
                </button>
                <button
                  type="button"
                  aria-label={`Przesuń ${project.name} w górę`}
                  disabled={index === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onReorder(index, index - 1);
                  }}
                >
                  <ChevronUp size={12} />
                </button>
                <button
                  type="button"
                  aria-label={`Przesuń ${project.name} w dół`}
                  disabled={index === projects.length - 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    onReorder(index, index + 1);
                  }}
                >
                  <ChevronDown size={12} />
                </button>
              </span>
              <span className="bv-crud">
                <button
                  type="button"
                  className={`bv-link ${isLinkingSource ? "is-active" : ""}`}
                  aria-pressed={isLinkingSource}
                  aria-label={
                    isLinkingSource
                      ? `Anuluj blokowanie przez ${project.name}`
                      : `Zablokuj inny projekt projektem ${project.name}`
                  }
                  title={isLinkingSource ? "Kliknij wiersz do zablokowania · Esc anuluje" : "Zablokuj inny projekt"}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLinking(project);
                  }}
                >
                  <ArrowRightToLine size={13} />
                </button>
                <button
                  type="button"
                  className="bv-edit"
                  aria-label={`Edytuj ${project.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    startEdit(project);
                  }}
                >
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  className={`bv-delete ${confirmDeleteId === project.id ? "is-confirming" : ""}`}
                  aria-label={`Usuń ${project.name}`}
                  title={confirmDeleteId === project.id ? "Kliknij ponownie, aby potwierdzić" : "Usuń"}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(project.id);
                  }}
                >
                  {confirmDeleteId === project.id ? "potwierdź" : <X size={13} />}
                </button>
              </span>
            </div>
          );
        })}

        <svg className="bv-link-layer" style={{ width: gutterWidth + 2 }} aria-hidden="true">
          {links.map((link) => {
            const x = cornerX(link.lane);
            return (
              <g
                key={link.id}
                className="bv-link-arrow"
                onClick={(e) => {
                  e.stopPropagation();
                  setBlockedBy(link.id, null);
                }}
              >
                <title>Kliknij, aby usunąć blokadę</title>
                <path
                  className="bv-link-arrow-hit"
                  d={`M ${x} ${link.y1} L ${x} ${link.y2} L ${tipX} ${link.y2}`}
                />
                <path
                  className="bv-link-arrow-line"
                  d={`M ${x} ${link.y1} L ${x} ${link.y2} L ${headBackX} ${link.y2}`}
                />
                <circle className="bv-link-arrow-dot" cx={x} cy={link.y1} r={2.5} />
                <polygon
                  className="bv-link-arrow-head"
                  points={`${tipX},${link.y2} ${headBackX},${link.y2 - 3.2} ${headBackX},${link.y2 + 3.2}`}
                />
              </g>
            );
          })}
        </svg>
      </div>

      {editingId && editDraft && (
        <ProjectForm
          key={editingId}
          draft={editDraft}
          title="Edytuj projekt"
          onChange={setEditDraft}
          onSave={saveEdit}
          onCancel={cancelEdit}
        />
      )}

      {adding && (
        <ProjectForm
          key="add"
          draft={addDraft}
          title="Nowy projekt"
          onChange={setAddDraft}
          onSave={saveAdd}
          onCancel={() => onAddingChange(false)}
        />
      )}
    </section>
  );
}
