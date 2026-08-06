import { useCallback, useEffect, useState } from "react";
import { clearAssignment, loadAllAssignments, saveAssignment } from "../lib/db";

export function useProjectAssignments() {
  const [assignments, setAssignments] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadAllAssignments().then((data) => {
      if (!cancelled) {
        setAssignments(data);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setAssignment = useCallback((projectId: string, people: number) => {
    setAssignments((prev) => ({ ...prev, [projectId]: people }));
    void saveAssignment(projectId, people);
  }, []);

  const removeAssignment = useCallback((projectId: string) => {
    setAssignments((prev) => {
      const next = { ...prev };
      delete next[projectId];
      return next;
    });
    void clearAssignment(projectId);
  }, []);

  return { assignments, loaded, setAssignment, removeAssignment };
}
