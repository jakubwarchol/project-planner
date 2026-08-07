import { usePlanner } from "../state/plannerContext";

export function useOrderedProjects() {
  const { projects, setProjects, resetProjectOrder } = usePlanner();

  function reorder(fromIndex: number, toIndex: number) {
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= projects.length ||
      toIndex >= projects.length
    ) {
      return;
    }
    const next = projects.slice();
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setProjects(next);
  }

  return { projects, reorder, resetOrder: resetProjectOrder };
}
