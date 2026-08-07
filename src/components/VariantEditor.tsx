import { useState } from "react";
import { CATEGORY_ORDER, type TeamVariant } from "../lib/estimation";
import { MAX_PEOPLE_PER_CATEGORY, type TeamVariantsApi } from "../hooks/useTeamVariants";

interface VariantEditorProps {
  api: TeamVariantsApi;
  /** The variant the timeline is showing — also the one being edited, so
   *  changes land on the chart behind the dialog as they're typed. */
  activeId: string;
  onActivate: (id: string) => void;
  onClose: () => void;
}

function totalPeople(variant: TeamVariant): number {
  return CATEGORY_ORDER.reduce((sum, category) => sum + (variant.people[category] ?? 0), 0);
}

// Digits-only draft kept locally so the field can be emptied while typing
// without the store snapping it back to "0" mid-edit.
function PeopleInput({
  initial,
  onCommit,
  label,
}: {
  initial: number;
  onCommit: (value: number) => void;
  label: string;
}) {
  const [draft, setDraft] = useState(String(initial));

  function handleChange(next: string) {
    if (!/^\d{0,2}$/.test(next)) return;
    setDraft(next);
    onCommit(next === "" ? 0 : Number(next));
  }

  return (
    <input
      className="ve-number"
      type="text"
      inputMode="numeric"
      aria-label={label}
      value={draft}
      max={MAX_PEOPLE_PER_CATEGORY}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={() => draft === "" && setDraft("0")}
    />
  );
}

export function VariantEditor({ api, activeId, onActivate, onClose }: VariantEditorProps) {
  const { variants, createVariant, renameVariant, setVariantPeople, deleteVariant } = api;
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const selected = variants.find((v) => v.id === activeId) ?? variants[0];
  const canDelete = variants.length > 1;

  function handleCreate() {
    setConfirmingDelete(false);
    onActivate(createVariant(selected));
  }

  function handleDelete() {
    if (!canDelete) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setConfirmingDelete(false);
    const fallback = variants.find((v) => v.id !== selected.id);
    deleteVariant(selected.id);
    if (fallback) onActivate(fallback.id);
  }

  return (
    <>
      <div className="ve-backdrop" onClick={onClose} />
      <div className="ve-dialog" role="dialog" aria-modal="true" aria-label="Edit team variants">
        <div className="ve-header">
          <h3>Team variants</h3>
          <button type="button" className="ve-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="ve-body">
          <div className="ve-list">
            {variants.map((v) => (
              <button
                key={v.id}
                type="button"
                className={`ve-list-item ${v.id === selected.id ? "is-selected" : ""}`}
                onClick={() => {
                  setConfirmingDelete(false);
                  onActivate(v.id);
                }}
              >
                <span className="ve-list-name">{v.label}</span>
                <span className="ve-list-meta">{totalPeople(v)} people</span>
              </button>
            ))}
            <button type="button" className="ve-add" onClick={handleCreate}>
              + New variant
            </button>
          </div>

          <div className="ve-form">
            <label className="ve-field">
              <span className="ve-field-label">Name</span>
              <input
                className="ve-text"
                type="text"
                value={selected.label}
                onChange={(e) => renameVariant(selected.id, e.target.value)}
              />
            </label>

            <p className="ve-field-label">People per category</p>
            <div className="ve-rows">
              {CATEGORY_ORDER.map((category) => (
                <div className="ve-row" key={category}>
                  <span className="ve-row-label">{category}</span>
                  <PeopleInput
                    key={`${selected.id}-${category}`}
                    initial={selected.people[category] ?? 0}
                    label={`People in ${category}`}
                    onCommit={(value) => setVariantPeople(selected.id, category, value)}
                  />
                </div>
              ))}
            </div>

            <div className="ve-footer">
              <button
                type="button"
                className={`ve-delete ${confirmingDelete ? "is-confirming" : ""}`}
                onClick={handleDelete}
                disabled={!canDelete}
                title={canDelete ? undefined : "The last variant can't be deleted"}
              >
                {confirmingDelete ? "Confirm delete" : "Delete variant"}
              </button>
              <button type="button" className="ve-done" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
