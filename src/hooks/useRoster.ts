import { useCallback, useMemo } from "react";
import { derivePoolsFromPeople } from "../lib/estimation";
import { newId } from "../lib/id";
import { usePlanner } from "../state/plannerContext";
import type { Capability, CapabilityVector, Person, Team } from "../types";

export interface RosterApi {
  teams: Team[];
  people: Person[];
  pools: CapabilityVector;
  addPerson: (draft: Omit<Person, "id">) => void;
  updatePerson: (id: string, draft: Omit<Person, "id">) => void;
  removePerson: (id: string) => void;
  /** Set one capability's share of a person; 0 takes them off it. */
  setAllocation: (id: string, capability: Capability, fte: number) => void;
  /** Set how much of this person's working day reaches project work, 0..1. */
  setFocusFactor: (id: string, focusFactor: number) => void;
}

export function useRoster(): RosterApi {
  const { teams, people, addPerson, updatePerson, removePerson, setPersonAllocation } = usePlanner();

  const create = useCallback(
    (draft: Omit<Person, "id">) => addPerson({ id: newId("person"), ...draft }),
    [addPerson],
  );

  const setAllocation = useCallback(
    (id: string, capability: Capability, fte: number) => {
      // Clamped per capability, not across the person: someone mid-edit is
      // legitimately over 1.0 in total, and the Zespół screen flags that
      // rather than silently rewriting what was typed.
      const clamped = Math.min(Math.max(Math.round(fte * 100) / 100, 0), 1);
      setPersonAllocation(id, capability, clamped);
    },
    [setPersonAllocation],
  );

  const setFocusFactor = useCallback(
    (id: string, focusFactor: number) => {
      const person = people.find((p) => p.id === id);
      if (!person) return;
      // Floored above zero, not at it: the column is a CHECK-constrained
      // `> 0`, and a pool of zero productive FTE would read as "this
      // capability delivers nothing" and stall every project needing it.
      const clamped = Math.min(Math.max(focusFactor, 0.01), 1);
      updatePerson(id, { ...person, focusFactor: clamped });
    },
    [people, updatePerson],
  );

  // Memoised on `people` because the schedule cache is keyed on argument
  // *identity* — a fresh pool object every render made every consumer of
  // `useCapabilitySchedule(projects, pools)` miss the cache and re-simulate
  // the whole plan on each keystroke.
  const pools = useMemo(() => derivePoolsFromPeople(people), [people]);

  return {
    teams,
    people,
    pools,
    addPerson: create,
    updatePerson,
    removePerson,
    setAllocation,
    setFocusFactor,
  };
}
