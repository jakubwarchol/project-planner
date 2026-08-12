import { useCallback } from "react";
import { newId } from "../lib/id";
import { usePlanner } from "../state/plannerContext";
import type { Leave, StaffingAssignment } from "../types";

export interface StaffingApi {
  assignments: StaffingAssignment[];
  leaves: Leave[];
  addAssignment: (draft: Omit<StaffingAssignment, "id">) => void;
  updateAssignment: (id: string, fields: Omit<StaffingAssignment, "id">) => void;
  removeAssignment: (id: string) => void;
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
    (draft: Omit<StaffingAssignment, "id">) => addAssignment({ id: newId("assignment"), ...draft }),
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
    addLeave: createLeave,
    updateLeave,
    removeLeave,
  };
}
