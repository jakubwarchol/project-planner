import { usePlanner } from "../state/plannerContext";

export function useProjectAssignments() {
  const { assignments, setAssignment, clearAssignment } = usePlanner();
  return { assignments, loaded: true, setAssignment, removeAssignment: clearAssignment };
}
