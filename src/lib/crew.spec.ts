import { describe, expect, it } from "vitest";
import { CAPABILITY_ORDER } from "./estimation";
import { DEFAULT_MIN_CREW_FTE, deriveCrew } from "./crew";

const totalFte = (fte: number[]) => fte.reduce((total, f) => total + f, 0);
import type { Capability } from "../types";

const K = Object.fromEntries(CAPABILITY_ORDER.map((c, i) => [c, i])) as Record<Capability, number>;

/** Sparse literal → the dense arrays `deriveCrew` takes. */
function vec(values: Partial<Record<Capability, number>>, fill = 0): number[] {
  return CAPABILITY_ORDER.map((c) => values[c] ?? fill);
}

// 12.6 = 18 working days at 70% productivity, the default rate. Chosen for the
// ACMS case below because it makes the pace come out at exactly 30 days of
// estimate per FTE, so every derived figure is checkable by eye.
const RATE = vec({}, 12.6);

describe("deriveCrew", () => {
  // ACMS 2.0's build phase, the worked example from the design discussion.
  const days = vec({ PM: 24, TL: 8, BE: 60, FE: 25, QA: 10, SEC: 8 });
  const maxFte = vec({ PM: 1, TL: 0.5, BE: 2, FE: 1.5, QA: 1, SEC: 0.5 });

  it("takes its length from the capability pinned at its own ceiling", () => {
    // BE is the only one that can't go faster: 60 days across at most 2
    // people is 2.38 months, and everything else could have finished sooner.
    const crew = deriveCrew(days, maxFte, RATE, DEFAULT_MIN_CREW_FTE);
    expect(crew.months).toBeCloseTo(60 / (2 * 12.6), 10);
    expect(crew.paceIndex).toBe(K.BE);
  });

  it("de-rates everyone else onto that same finish", () => {
    const crew = deriveCrew(days, maxFte, RATE, DEFAULT_MIN_CREW_FTE);
    expect(crew.fte[K.BE]).toBeCloseTo(2, 10);
    expect(crew.fte[K.PM]).toBeCloseTo(0.8, 10);
    expect(crew.fte[K.FE]).toBeCloseTo(25 / 30, 10);
    expect(crew.fte[K.QA]).toBeCloseTo(1 / 3, 10);
    expect(crew.fte[K.SEC]).toBeCloseTo(8 / 30, 10);
    expect(crew.fte[K.TL]).toBeCloseTo(8 / 30, 10);
    expect(totalFte(crew.fte)).toBeCloseTo(4.5, 10);
  });

  it("conserves the work — de-rating changes the shape, never the total", () => {
    const crew = deriveCrew(days, maxFte, RATE, DEFAULT_MIN_CREW_FTE);
    for (const capability of CAPABILITY_ORDER) {
      const k = K[capability];
      expect(crew.fte[k] * crew.months * RATE[k]).toBeCloseTo(days[k], 8);
    }
  });

  it("never puts anyone above their ceiling", () => {
    const crew = deriveCrew(days, maxFte, RATE, DEFAULT_MIN_CREW_FTE);
    for (let k = 0; k < CAPABILITY_ORDER.length; k++) {
      expect(crew.fte[k]).toBeLessThanOrEqual(maxFte[k] + 1e-12);
    }
  });

  it("ignores a ceiling raised on anything but the pace-setter", () => {
    // FE could already have finished in 1.32 months and is only running at
    // 0.83 to keep the team together. Letting it go to 3 changes nothing.
    const crew = deriveCrew(days, vec({ PM: 1, TL: 0.5, BE: 2, FE: 3, QA: 1, SEC: 0.5 }), RATE, DEFAULT_MIN_CREW_FTE);
    expect(crew.months).toBeCloseTo(60 / (2 * 12.6), 10);
    expect(crew.paceIndex).toBe(K.BE);
  });

  it("hands the pace to the next capability once the constraint is lifted", () => {
    // The lever has a stop. Raising BE from 2 to 3 does shorten the phase,
    // but only as far as PM's own ceiling allows (1.90m) — not to BE's new
    // 1.59m. Keep raising BE past that and nothing happens at all, which is
    // exactly the moment to stop adding backend people.
    const crew = deriveCrew(days, vec({ PM: 1, TL: 0.5, BE: 3, FE: 1.5, QA: 1, SEC: 0.5 }), RATE, DEFAULT_MIN_CREW_FTE);
    expect(crew.months).toBeCloseTo(24 / (1 * 12.6), 10);
    expect(crew.paceIndex).toBe(K.PM);
    expect(crew.fte[K.BE]).toBeCloseTo(60 / (crew.months * 12.6), 10);
    expect(crew.fte[K.BE]).toBeLessThan(3);

    const evenHigher = deriveCrew(days, vec({ PM: 1, TL: 0.5, BE: 6, FE: 1.5, QA: 1, SEC: 0.5 }), RATE, DEFAULT_MIN_CREW_FTE);
    expect(evenHigher.months).toBeCloseTo(crew.months, 10);
  });
});

describe("deriveCrew — the burst floor", () => {
  it("refuses to smear a tiny job across a long phase", () => {
    // 4 days of SEC against a 5-month BE build derives to 0.06 FTE — "a
    // security specialist at 6% for five months" is a fiction. It runs at the
    // floor instead and finishes early.
    const days = vec({ BE: 126, SEC: 4 });
    const maxFte = vec({ BE: 2, SEC: 0.5 });
    const crew = deriveCrew(days, maxFte, RATE, DEFAULT_MIN_CREW_FTE);
    expect(crew.months).toBeCloseTo(5, 10);
    expect(4 / (crew.months * 12.6)).toBeLessThan(DEFAULT_MIN_CREW_FTE);
    expect(crew.fte[K.SEC]).toBeCloseTo(DEFAULT_MIN_CREW_FTE, 10);
    expect(crew.burstIndexes).toEqual([K.SEC]);
  });

  it("respects a ceiling that is itself below the floor", () => {
    // Someone deliberately capped at 0.05 is a stated part-timer, not a
    // rounding error — the floor must not promote them.
    const crew = deriveCrew(vec({ BE: 126, SEC: 4 }), vec({ BE: 2, SEC: 0.05 }), RATE, DEFAULT_MIN_CREW_FTE);
    expect(crew.fte[K.SEC]).toBeCloseTo(0.05, 10);
  });

  it("leaves a burst out of the pace calculation it would otherwise distort", () => {
    // The burst is a consequence of the phase's length, never a cause: SEC's
    // own fastest run is far shorter than BE's, so BE still sets the pace.
    const crew = deriveCrew(vec({ BE: 126, SEC: 4 }), vec({ BE: 2, SEC: 0.5 }), RATE, DEFAULT_MIN_CREW_FTE);
    expect(crew.paceIndex).toBe(K.BE);
  });
});

describe("deriveCrew — edges", () => {
  it("reports nothing for a phase with no work", () => {
    const crew = deriveCrew(vec({}), vec({}, 1), RATE, DEFAULT_MIN_CREW_FTE);
    expect(crew.months).toBe(0);
    expect(crew.paceIndex).toBe(-1);
    expect(totalFte(crew.fte)).toBe(0);
  });

  it("leaves work with no ceiling uncrewed, for the scheduler to condemn", () => {
    // A cell with days but no ceiling can never be staffed. Silently picking
    // a crew would hide a data error behind a plausible-looking bar.
    const crew = deriveCrew(vec({ BE: 60, QA: 10 }), vec({ BE: 2, QA: 0 }), RATE, DEFAULT_MIN_CREW_FTE);
    expect(crew.fte[K.QA]).toBe(0);
    expect(crew.fte[K.BE]).toBeCloseTo(2, 10);
  });

  it("paces each capability at its own rate, not a shared one", () => {
    // BE people at 90% productivity get through more per month than QA people
    // at 50%, so the same day counts imply different crews.
    const rate = vec({ BE: 18 * 0.9, QA: 18 * 0.5 });
    const crew = deriveCrew(vec({ BE: 60, QA: 10 }), vec({ BE: 2, QA: 1 }), rate, DEFAULT_MIN_CREW_FTE);
    expect(crew.months).toBeCloseTo(60 / (2 * 16.2), 10);
    expect(crew.fte[K.QA]).toBeCloseTo(10 / (crew.months * 9), 10);
  });

  it("gives a single-capability phase exactly its ceiling", () => {
    const crew = deriveCrew(vec({ UX: 10 }), vec({ UX: 0.6 }), RATE, DEFAULT_MIN_CREW_FTE);
    expect(crew.fte[K.UX]).toBeCloseTo(0.6, 10);
    expect(crew.months).toBeCloseTo(10 / (0.6 * 12.6), 10);
    expect(crew.paceIndex).toBe(K.UX);
  });
});
