import { useState } from "react";
import { X } from "lucide-react";
import { type TeamVariantsApi } from "../hooks/useTeamVariants";
import { CAPABILITY_LABELS, CAPABILITY_ORDER, type TeamVariant } from "../lib/estimation";
import { NumberField } from "./NumberField";
import { fmt } from "./timelineChrome";

interface VariantEditorProps {
  api: TeamVariantsApi;
  /** The variant the timeline is showing — also the one being edited, so
   *  changes land on the chart behind the dialog as they're typed. */
  activeId: string;
  onActivate: (id: string) => void;
  onClose: () => void;
}

function totalFte(variant: TeamVariant): number {
  return CAPABILITY_ORDER.reduce((sum, capability) => sum + (variant.fte[capability] ?? 0), 0);
}

export function VariantEditor({ api, activeId, onActivate, onClose }: VariantEditorProps) {
  const { variants, createVariant, renameVariant, setVariantFte, copyFromRoster, deleteVariant } = api;
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
      <div className="ve-dialog" role="dialog" aria-modal="true" aria-label="Edytuj warianty zespołu">
        <div className="ve-header">
          <h3>Warianty zespołu</h3>
          <button type="button" className="ve-close" onClick={onClose} aria-label="Zamknij">
            <X size={14} />
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
                <span className="ve-list-meta">{fmt(totalFte(v))} FTE</span>
              </button>
            ))}
            <button type="button" className="ve-add" onClick={handleCreate}>
              + Nowy wariant
            </button>
          </div>

          <div className="ve-form">
            <label className="ve-field">
              <span className="ve-field-label">Nazwa</span>
              <input
                className="ve-text"
                type="text"
                value={selected.label}
                onChange={(e) => renameVariant(selected.id, e.target.value)}
              />
            </label>

            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <p className="ve-field-label" style={{ margin: 0 }}>
                FTE na kompetencję
              </p>
              {!selected.isRosterDerived && (
                <button type="button" className="ve-copy" onClick={() => copyFromRoster(selected.id)}>
                  Skopiuj z obecnego zespołu
                </button>
              )}
            </div>
            {selected.isRosterDerived && (
              <p className="ve-field-label" style={{ margin: 0 }}>
                Wartości pochodzą z obecnego zespołu — edytuj zespół albo utwórz nowy wariant.
              </p>
            )}
            <div className="ve-rows">
              {CAPABILITY_ORDER.map((capability) => (
                <div className="ve-row" key={capability}>
                  <span className="ve-row-label">{CAPABILITY_LABELS[capability]}</span>
                  <NumberField
                    key={`${selected.id}-${capability}`}
                    initial={selected.fte[capability] ?? 0}
                    label={`FTE dla ${capability}`}
                    disabled={selected.isRosterDerived}
                    onCommit={(value) => setVariantFte(selected.id, capability, value)}
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
                title={canDelete ? undefined : "Nie można usunąć ostatniego wariantu"}
              >
                {confirmingDelete ? "Potwierdź usunięcie" : "Usuń wariant"}
              </button>
              <button type="button" className="ve-done" onClick={onClose}>
                Gotowe
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
