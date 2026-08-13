import { useCallback } from "react";
import { newId } from "../lib/id";
import { usePlanner } from "../state/plannerContext";
import type { Leave, StaffingAssignment } from "../types";

export interface StaffingApi {
  assignments: StaffingAssignment[];
  leaves: Leave[];
  /** Returns the created record so the caller can offer "Cofnij" on it. */
  addAssignment: (draft: Omit<StaffingAssignment, "id">) => StaffingAssignment;
  updateAssignment: (id: string, fields: Omit<StaffingAssignment, "id">) => void;
  removeAssignment: (id: string) => void;
  /** Re-adds a removed assignment verbatim, id included — the undo of remove. */
  restoreAssignment: (assignment: StaffingAssignment) => void;
  addLeave: (draft: Omit<Leave, "id">) => void;
  updateLeave: (id: string, fields: Omit<Leave, "id">) => void;
  removeLeave: (id: string) => void;
}

export function useStaffing(): StaffingApi {
  const {
    assignments,
    leaves,
    addAssignment,
    updateAssignment,
    removeAssignment,
    addLeave,
    updateLeave,
    removeLeave,
  } = usePlanner();

  const createAssignment = useCallback(
    (draft: Omit<StaffingAssignment, "id">) => {
      const assignment = { id: newId("assignment"), ...draft };
      addAssignment(assignment);
      return assignment;
    },
    [addAssignment],
  );

  const createLeave = useCallback(
    (draft: Omit<Leave, "id">) => addLeave({ id: newId("leave"), ...draft }),
    [addLeave],
  );

  return {
    assignments,
    leaves,
    addAssignment: createAssignment,
    updateAssignment,
    removeAssignment,
    restoreAssignment: addAssignment,
    addLeave: createLeave,
    updateLeave,
    removeLeave,
  };
}
