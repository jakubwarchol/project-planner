import { describe, expect, it } from "vitest";
import type { Capability, CapabilityCell, CapabilityVector, Project } from "../types";
import {
  CAPABILITY_ORDER,
  DEFAULT_ESTIMATION_SETTINGS,
  DEFAULT_PERSON_FOCUS_FACTOR,
  emptyCapabilityVector,
} from "./estimation";
import { simulateCapabilitySchedule, type PhaseSpan, type SimulateInput } from "./scheduling";

const EDPM = DEFAULT_ESTIMATION_SETTINGS.workingDaysPerMonth * DEFAULT_PERSON_FOCUS_FACTOR;
const RATE = uniformRate(EDPM);

// The scheduler takes a per-capability rate, since productivity is set per
// person. These tests plan a uniform team, so one rate covers every
// capability — the same figure the retired global focus factor produced,
// which keeps every expectation below in its original arithmetic.
function uniformRate(days: number): CapabilityVector {
  const rate = emptyCapabilityVector();
  for (const capability of CAPABILITY_ORDER) rate[capability] = days;
  return rate;
}

const MIN_FRACTION = DEFAULT_ESTIMATION_SETTINGS.minStaffingFraction;

function simulate(input: Omit<SimulateInput, "effectiveDaysPerMonth" | "minStaffingFraction">, minStaffingFraction = MIN_FRACTION) {
  return simulateCapabilitySchedule({ ...input, effectiveDaysPerMonth: RATE, minStaffingFraction });
}

describe("earliestStart", () => {
  it("holds a project until its month even with the whole pool idle", () => {
    const p = project("p1", "M");
    const result = simulate({
      projects: [p],
      cells: cellsFor({ p1: { BE: { days: 24, maxFte: 1 } } }),
      pools: pools({ BE: 5 }),
      earliestStart: { p1: 3 },
    });

    const sp = result.scheduled[0];
    expect(sp.earliestStartMonths).toBe(3);
    expect(sp.startMonths).toBeCloseTo(3, 6);
    expect(sp.endMonths).toBeCloseTo(3 + 24 / EDPM, 6);
    // Capacity it cannot use is idle, not quietly reassigned to it early.
    expect(result.idleFteMonths.BE).toBeGreaterThan(3 * 5 - 1e-6);
  });

  it("lets a lower-ranked project take the capacity while the constrained one waits", () => {
    const held = project("held", "M");
    const other = project("other", "M");
    const result = simulate({
      projects: [held, other],
      cells: cellsFor({
        held: { BE: { days: 24, maxFte: 1 } },
        other: { BE: { days: 24, maxFte: 1 } },
      }),
      pools: pools({ BE: 1 }),
      earliestStart: { held: 4 },
    });

    const [spHeld, spOther] = result.scheduled;
    // other outranks nothing, but it is allowed to start and held is not.
    expect(spOther.startMonths).toBeCloseTo(0, 6);
    expect(spOther.endMonths).toBeCloseTo(24 / EDPM, 6);
    expect(spHeld.startMonths).toBeCloseTo(4, 6);
  });

  it("gates a phase-2-only project too, not just initiation", () => {
    // No phase-1 work at all, so a gate that only covered faza 1 would let
    // this start immediately.
    const p = project("p1", "M");
    const result = simulate({
      projects: [p],
      cells: cellsFor({ p1: { BE: { days: 24, maxFte: 1 } } }),
      pools: pools({ BE: 2 }),
      earliestStart: { p1: 2.5 },
    });

    const sp = result.scheduled[0];
    expect(sp.phases.find((ph) => ph.phase === 1)).toBeUndefined();
    expect(sp.phases.find((ph) => ph.phase === 2)!.startMonths).toBeCloseTo(2.5, 6);
  });

  it("ignores a constraint that has already passed", () => {
    const p = project("p1", "M");
    const result = simulate({
      projects: [p],
      cells: cellsFor({ p1: { BE: { days: 24, maxFte: 1 } } }),
      pools: pools({ BE: 1 }),
      earliestStart: { p1: -6 },
    });
    expect(result.scheduled[0].earliestStartMonths).toBe(0);
    expect(result.scheduled[0].startMonths).toBeCloseTo(0, 6);
  });

  it("never lets the contiguity pass pull faza 1 back before the constraint", () => {
    // lead would like to defer initiation to meet BE at 24/EDPM, but it is
    // also barred until month 3 — the later of the two has to win.
    const lead = project("lead", "L");
    const follower = project("follower", "M");
    const result = simulate({
      projects: [lead, follower],
      cells: cellsFor({
        lead: { TL: { days: 12, maxFte: 1 }, BE: { days: 60, maxFte: 1 } },
        follower: { BE: { days: 24, maxFte: 1 } },
      }),
      pools: pools({ TL: 1, BE: 1 }),
      earliestStart: { lead: 3 },
    });

    const spLead = result.scheduled[0];
    const phase1 = spLead.phases.find((p) => p.phase === 1)!;
    expect(phase1.startMonths).toBeGreaterThanOrEqual(3 - 1e-9);
    expect(spLead.startMonths).toBeGreaterThanOrEqual(3 - 1e-9);
  });

  it("keeps a blocked project behind whichever bar falls later", () => {
    const blocker = project("blocker", "M");
    const waiter = project("waiter", "S", "blocker");
    const result = simulate({
      projects: [blocker, waiter],
      cells: cellsFor({
        blocker: { BE: { days: 24, maxFte: 1 } },
        waiter: { FE: { days: 6, maxFte: 1 } },
      }),
      pools: pools({ BE: 1, FE: 1 }),
      earliestStart: { waiter: 5 },
    });

    const [, spWaiter] = result.scheduled;
    const blockerEnd = 24 / EDPM; // ~1.9 months, well before the constraint
    expect(spWaiter.startMonths).toBeCloseTo(5, 6);
    expect(spWaiter.startMonths).toBeGreaterThan(blockerEnd);
  });
});

function project(id: string, estimate: Project["estimate"], blockedBy?: string): Project {
  return { id, name: id, category: "Projekty", estimate, blockedBy };
}

function cellsFor(
  rows: Record<string, Partial<Record<Capability, { days: number; maxFte: number }>>>,
): Record<string, Record<Capability, CapabilityCell>> {
  const out: Record<string, Record<Capability, CapabilityCell>> = {};
  for (const [projectId, row] of Object.entries(rows)) {
    const full = {} as Record<Capability, CapabilityCell>;
    for (const capability of CAPABILITY_ORDER) {
      const cell = row[capability];
      full[capability] = { days: cell?.days ?? 0, maxFte: cell?.maxFte ?? 0 };
    }
    out[projectId] = full;
  }
  return out;
}

function pools(overrides: Partial<CapabilityVector>): CapabilityVector {
  return { ...emptyCapabilityVector(), ...overrides };
}

describe("simulateCapabilitySchedule", () => {
  it("schedules a single-capability, single-phase project with no contention", () => {
    // M = 24 days, all assigned to BE. Target 1 against a pool of 2.
    const p = project("p1", "M");
    const result = simulate({
      projects: [p],
      cells: cellsFor({ p1: { BE: { days: 24, maxFte: 1 } } }),
      pools: pools({ BE: 2 }),
    });

    const sp = result.scheduled[0];
    expect(sp.isImpossible).toBe(false);
    expect(sp.hasNoDemand).toBe(false);
    // No phase-1 demand at all, so the project starts straight in phase 2.
    expect(sp.phases).toEqual([{ phase: 2, startMonths: 0, endMonths: sp.endMonths }]);
    expect(sp.startMonths).toBeCloseTo(0, 6);
    expect(sp.endMonths).toBeCloseTo(24 / (1 * EDPM), 6);
    expect(sp.segments).toHaveLength(1);
    expect(sp.segments[0].fte).toBeCloseTo(1, 6);
    expect(sp.segments[0].isFullyStaffed).toBe(true);
    expect(sp.waits).toEqual([]);
    expect(sp.contiguityDelayMonths).toBe(0);
  });

  it("gates phase 2 behind phase 1 and lands every stream in a phase on the same day", () => {
    // L = 60 days, split PM 12d, TL 6d, BE 42d. Ample pools.
    const p = project("p1", "L");
    const result = simulate({
      projects: [p],
      cells: cellsFor({
        p1: {
          PM: { days: 12, maxFte: 1 },
          TL: { days: 6, maxFte: 1 },
          BE: { days: 42, maxFte: 1 },
        },
      }),
      pools: pools({ PM: 5, TL: 5, BE: 5 }),
    });

    const sp = result.scheduled[0];
    const pm1Days = 12 * 0.2; // 2.4 — PM and TL each put 20% into phase 1
    const expectedPhase1End = pm1Days / EDPM; // TL1 (1.2d) finishes first, PM1 (2.4d) is the gate
    const beDuration = 42 / EDPM;
    const expectedEnd = expectedPhase1End + beDuration;

    expect(sp.phases).toHaveLength(2);
    expect(sp.phases[0]).toMatchObject({ phase: 1, startMonths: 0 });
    expect(sp.phases[0].endMonths).toBeCloseTo(expectedPhase1End, 6);
    expect(sp.phases[1].phase).toBe(2);
    expect(sp.phases[1].startMonths).toBeCloseTo(expectedPhase1End, 6);
    expect(sp.phases[1].endMonths).toBeCloseTo(expectedEnd, 6);
    expect(sp.endMonths).toBeCloseTo(expectedEnd, 6);

    // BE is the only phase-2 capability that cannot go faster than its
    // ceiling allows, so it sets the phase's length and runs at its own 1.0.
    const beStream = sp.streams.find((s) => s.capability === "BE")!;
    expect(beStream.setsPace).toBe(true);
    expect(beStream.crewFte).toBeCloseTo(1, 6);
    expect(beStream.endMonths).toBeCloseTo(expectedEnd, 6);

    // PM's and TL's phase-2 shares are de-rated onto BE's finish rather than
    // sprinting at their own ceilings and leaving. Each crew figure is just
    // its work divided by the phase — 9.6 and 4.8 days across 42 days of BE.
    const pm2 = sp.streams.find((s) => s.capability === "PM" && s.phase === 2)!;
    const tl2 = sp.streams.find((s) => s.capability === "TL" && s.phase === 2)!;
    expect(pm2.crewFte).toBeCloseTo(9.6 / 42, 6);
    expect(tl2.crewFte).toBeCloseTo(4.8 / 42, 6);
    expect(pm2.setsPace).toBe(false);
    expect(tl2.setsPace).toBe(false);
    expect(pm2.minFte).toBeCloseTo((9.6 / 42) * MIN_FRACTION, 6);

    // The property the whole crew model exists for: one phase, one finish.
    for (const stream of sp.streams.filter((x) => x.phase === 2)) {
      expect(stream.endMonths).toBeCloseTo(expectedEnd, 5);
    }
    // And the same inside faza 1 — TL's 1.2 days stretch across PM's 2.4.
    for (const stream of sp.streams.filter((x) => x.phase === 1)) {
      expect(stream.endMonths).toBeCloseTo(expectedPhase1End, 5);
    }
    expect(sp.streams.find((x) => x.capability === "TL" && x.phase === 1)!.crewFte).toBeCloseTo(0.5, 6);
  });

  it("keeps a small capability on the project instead of letting the big one outlive it", () => {
    // TL's phase-2 share (80 days) dwarfs BE's 10. Under the old stream model
    // BE sprinted at 1.0, finished in 0.79 months and left TL running alone
    // for another five and a half. Now TL sets the pace and BE de-rates to
    // stay for the whole phase — same total work, same finish, no lonely tail.
    const p = project("p1", "XXL");
    const result = simulate({
      projects: [p],
      cells: cellsFor({
        p1: { TL: { days: 100, maxFte: 1 }, BE: { days: 10, maxFte: 1 } },
      }),
      pools: pools({ TL: 1, BE: 1 }),
    });

    const sp = result.scheduled[0];
    const phase1End = (100 * 0.2) / EDPM;
    // TL is pinned at its ceiling of 1.0, so it burns 80 days at that rate and
    // that is the phase.
    const expectedEnd = phase1End + 80 / EDPM;

    const tl2 = sp.streams.find((s) => s.capability === "TL" && s.phase === 2)!;
    const be = sp.streams.find((s) => s.capability === "BE")!;
    expect(tl2.setsPace).toBe(true);
    expect(tl2.crewFte).toBeCloseTo(1, 6);
    expect(be.setsPace).toBe(false);
    expect(be.crewFte).toBeCloseTo(10 / 80, 6);
    expect(be.endMonths).toBeCloseTo(expectedEnd, 5);
    expect(tl2.endMonths).toBeCloseTo(expectedEnd, 5);
    expect(sp.phases[1].endMonths).toBeCloseTo(expectedEnd, 5);
    expect(sp.endMonths).toBeCloseTo(expectedEnd, 5);
  });

  it("forms an ordinary two-member crew for a project with no BE/FE/QA/SEC work at all", () => {
    // Szkolenie-style: M = 24 days, split PM 18d / TL 6d, nothing else. This
    // used to be the awkward case — TL's residue had no crew stream to pace
    // against, so it folded back into phase 1. With every capability's FTE
    // derived from the phase there is nothing to pace against and nothing to
    // fold: PM and TL simply crew phase 2 together.
    const p = project("p1", "M");
    const result = simulate({
      projects: [p],
      cells: cellsFor({ p1: { PM: { days: 18, maxFte: 1 }, TL: { days: 6, maxFte: 1 } } }),
      pools: pools({ PM: 5, TL: 5 }),
    });

    const sp = result.scheduled[0];
    const phase1End = (18 * 0.2) / EDPM; // PM1 (3.6d) is the gate over TL1 (1.2d)
    const pm2Duration = (18 * 0.8) / EDPM;
    const expectedEnd = phase1End + pm2Duration;

    expect(sp.phases).toHaveLength(2);
    expect(sp.phases[0].phase).toBe(1);
    expect(sp.phases[0].endMonths).toBeCloseTo(phase1End, 6);
    expect(sp.phases[1].phase).toBe(2);
    expect(sp.phases[1].endMonths).toBeCloseTo(expectedEnd, 6);
    expect(sp.endMonths).toBeCloseTo(expectedEnd, 6);

    expect(sp.streams).toHaveLength(4);
    const pm2 = sp.streams.find((s) => s.capability === "PM" && s.phase === 2)!;
    expect(pm2.setsPace).toBe(true);
    expect(pm2.crewFte).toBeCloseTo(1, 6);
    expect(pm2.minFte).toBeCloseTo(1 * MIN_FRACTION, 6);
    expect(pm2.demandDays).toBeCloseTo(18 * 0.8, 6);
    expect(pm2.endMonths).toBeCloseTo(expectedEnd, 6);

    // TL's phase-2 share is a crew member like any other: de-rated onto PM's
    // finish, and — unlike the residue it replaced — carrying a real minimum.
    const tl2 = sp.streams.find((s) => s.capability === "TL" && s.phase === 2)!;
    expect(tl2.crewFte).toBeCloseTo((6 * 0.8) / (18 * 0.8), 6);
    expect(tl2.minFte).toBeGreaterThan(0);
    expect(tl2.demandDays).toBeCloseTo(6 * 0.8, 6);
    expect(tl2.endMonths).toBeCloseTo(expectedEnd, 5);
    expect(sp.phases).toHaveLength(2);
  });

  it("does not report a hand-off when a lower-ranked project simply starts at full strength", () => {
    const a = project("a", "S"); // 6 days
    const b = project("b", "S");
    const result = simulate({
      projects: [a, b],
      cells: cellsFor({
        a: { BE: { days: 6, maxFte: 1 } },
        b: { BE: { days: 6, maxFte: 1 } },
      }),
      pools: pools({ BE: 1 }),
    });

    const [spA, spB] = result.scheduled;
    const aEnd = 6 / EDPM;
    expect(spA.endMonths).toBeCloseTo(aEnd, 6);
    expect(spB.startMonths).toBeCloseTo(aEnd, 6);
    expect(spB.endMonths).toBeCloseTo(aEnd * 2, 6);
    expect(result.transfers).toHaveLength(0);

    // b never opened at all, so it's waiting on a crew rather than running
    // short-handed on the pool.
    const waits = spB.waits.filter((w) => w.reason === "crew");
    expect(waits).toHaveLength(1);
    expect(waits[0].capabilities).toEqual(["BE"]);
    expect(waits[0].endMonths).toBeCloseTo(aEnd, 6);
    expect(spB.waits.some((w) => w.reason === "pool")).toBe(false);
  });

  it("reports a hand-off when a partially-funded project gets topped up", () => {
    const a = project("a", "S");
    const b = project("b", "L");
    const c = project("c", "L");
    const result = simulate({
      projects: [a, b, c],
      cells: cellsFor({
        a: { BE: { days: 6, maxFte: 1 } },
        b: { BE: { days: 60, maxFte: 1 } },
        c: { BE: { days: 60, maxFte: 1 } },
      }),
      pools: pools({ BE: 1.5 }),
    });

    // a takes 1, b takes the remaining 0.5 (partial — a "pool" wait), c gets 0.
    // When a finishes, b ramps 0.5 -> 1: a genuine hand-off, not a fresh start.
    const transfer = result.transfers.find((t) => t.capability === "BE");
    expect(transfer).toBeDefined();
    expect(transfer!.fromProjectId).toBe("a");
    expect(transfer!.toProjectId).toBe("b");
    expect(transfer!.fte).toBeCloseTo(0.5, 6);
  });

  it("marks a target above its pool as over-target but still finishing", () => {
    const p = project("p1", "S"); // 6 days
    const result = simulate({
      projects: [p],
      cells: cellsFor({ p1: { BE: { days: 6, maxFte: 2 } } }),
      pools: pools({ BE: 1 }),
    });

    const sp = result.scheduled[0];
    expect(sp.isImpossible).toBe(false);
    expect(sp.isOverPool).toBe(true);
    expect(sp.overPoolCapabilities).toEqual(["BE"]);
    expect(sp.endMonths).toBeCloseTo(6 / (1 * EDPM), 6); // runs at the pool's rate, not the target's
    expect(sp.segments[0].fte).toBeCloseTo(1, 6);
    expect(sp.segments[0].isFullyStaffed).toBe(false);
  });

  it("excludes a project with no pool for a demanded capability, without affecting others", () => {
    const blocked = project("blocked", "S");
    const fine = project("fine", "S");
    const result = simulate({
      projects: [blocked, fine],
      cells: cellsFor({
        blocked: { SEC: { days: 6, maxFte: 1 } },
        fine: { BE: { days: 6, maxFte: 1 } },
      }),
      pools: pools({ SEC: 0, BE: 2 }),
    });

    const [spBlocked, spFine] = result.scheduled;
    expect(spBlocked.isImpossible).toBe(true);
    expect(spBlocked.impossibleReasons).toEqual([{ capability: "SEC", kind: "no-pool" }]);
    expect(spBlocked.endMonths).toBe(Infinity);

    expect(spFine.isImpossible).toBe(false);
    expect(Number.isFinite(spFine.endMonths)).toBe(true);
  });

  it("treats a row with nothing assigned as no demand, not an error", () => {
    const empty = project("empty", "M");
    const result = simulate({
      projects: [empty],
      cells: cellsFor({ empty: {} }),
      pools: pools({ BE: 2 }),
    });

    const sp = result.scheduled[0];
    expect(sp.hasNoDemand).toBe(true);
    expect(sp.isImpossible).toBe(false);
    expect(sp.streams).toEqual([]);
    expect(sp.endMonths).toBe(0);
  });

  it("flags a demanded capability with no target as impossible", () => {
    const p = project("p1", "M");
    const result = simulate({
      projects: [p],
      cells: cellsFor({ p1: { BE: { days: 12, maxFte: 0 } } }),
      pools: pools({ BE: 2 }),
    });

    const sp = result.scheduled[0];
    expect(sp.isImpossible).toBe(true);
    expect(sp.impossibleReasons).toEqual([{ capability: "BE", kind: "no-max" }]);
  });

  it("holds a blocked project until its blocker fully ends, even across an unrelated pool", () => {
    // The blocker uses TL only; the blocked project uses BE only, with an
    // ample BE pool — so without the blockedBy gate it would start at t=0.
    const blocker = project("blocker", "M"); // 24 days
    const blocked = project("blocked", "S", "blocker"); // 6 days
    const result = simulate({
      projects: [blocker, blocked],
      cells: cellsFor({
        blocker: { TL: { days: 24, maxFte: 1 } },
        blocked: { BE: { days: 6, maxFte: 1 } },
      }),
      pools: pools({ TL: 1, BE: 5 }),
    });

    const [spBlocker, spBlocked] = result.scheduled;
    const blockerEnd = 24 / EDPM;
    expect(spBlocker.endMonths).toBeCloseTo(blockerEnd, 6);
    expect(spBlocked.startMonths).toBeCloseTo(blockerEnd, 6);
    expect(spBlocked.endMonths).toBeCloseTo(blockerEnd + 6 / EDPM, 6);
    expect(spBlocked.waits.some((w) => w.reason === "blocked" && w.endMonths > 0)).toBe(true);
  });

  it("propagates impossibility through a blockedBy chain", () => {
    const neverFinishes = project("stuck", "S"); // demands a pool that doesn't exist
    const waitsOnIt = project("waits-on-it", "S", "stuck");
    const result = simulate({
      projects: [neverFinishes, waitsOnIt],
      cells: cellsFor({
        stuck: { SEC: { days: 6, maxFte: 1 } },
        "waits-on-it": { BE: { days: 6, maxFte: 1 } },
      }),
      pools: pools({ SEC: 0, BE: 2 }),
    });

    const [spStuck, spWaiting] = result.scheduled;
    expect(spStuck.isImpossible).toBe(true);
    expect(spWaiting.isImpossible).toBe(true);
    expect(spWaiting.impossibleReasons).toEqual([{ kind: "blocked-by-impossible" }]);
  });

  it("waits for its whole crew instead of starting the capabilities it can", () => {
    // p1 needs BE and FE together. BE is free from the start, FE is held by
    // the higher-ranked lead. Nothing of p1 may begin until both are there.
    const lead = project("lead", "M"); // 24 days of FE
    const p1 = project("p1", "M");
    const result = simulate({
      projects: [lead, p1],
      cells: cellsFor({
        lead: { FE: { days: 24, maxFte: 1 } },
        p1: { BE: { days: 24, maxFte: 1 }, FE: { days: 24, maxFte: 1 } },
      }),
      pools: pools({ BE: 5, FE: 1 }),
    });

    const [, sp] = result.scheduled;
    const leadEnd = 24 / EDPM;
    expect(sp.startMonths).toBeCloseTo(leadEnd, 6);
    expect(sp.endMonths).toBeCloseTo(leadEnd + 24 / EDPM, 6);

    // The old greedy model would have run BE across [0, leadEnd] and FE after
    // it — same finish, but half the project idle at any moment.
    for (const capability of ["BE", "FE"] as const) {
      const stream = sp.streams.find((s) => s.capability === capability)!;
      expect(stream.segments).toHaveLength(1);
      expect(stream.startMonths).toBeCloseTo(leadEnd, 6);
      expect(stream.minFte).toBeCloseTo(MIN_FRACTION, 6);
    }

    const crew = sp.waits.filter((w) => w.reason === "crew");
    expect(crew).toHaveLength(1);
    expect(crew[0].capabilities).toEqual(["FE"]);
    expect(crew[0].endMonths).toBeCloseTo(leadEnd, 6);
  });

  it("backfills a lower-ranked project with capacity the gated one cannot use", () => {
    // big can't open (FE is taken), so the BE pool it doesn't need cascades
    // down to small, which can open on its own.
    const hog = project("hog", "M");
    const big = project("big", "M");
    const small = project("small", "M");
    const result = simulate({
      projects: [hog, big, small],
      cells: cellsFor({
        hog: { FE: { days: 24, maxFte: 1 } },
        big: { FE: { days: 12, maxFte: 1 }, QA: { days: 12, maxFte: 1 } },
        small: { BE: { days: 24, maxFte: 1 } },
      }),
      pools: pools({ BE: 1, FE: 1, QA: 1 }),
    });

    const [, spBig, spSmall] = result.scheduled;
    expect(spSmall.startMonths).toBeCloseTo(0, 6);
    expect(spSmall.endMonths).toBeCloseTo(24 / EDPM, 6);
    expect(spSmall.streams[0].segments).toHaveLength(1);
    // big still had to wait for FE, and only for FE — QA was free the whole time.
    expect(spBig.startMonths).toBeCloseTo(24 / EDPM, 6);
    expect(spBig.waits.filter((w) => w.reason === "crew")[0].capabilities).toEqual(["FE"]);
  });

  it("reserves the top waiting project's future start instead of idling capacity it can't use yet", () => {
    // lead needs BE (min 2*0.4=0.8) and FE (min 1*0.4=0.4) at once. BE is
    // free from t=0, but FE is fully held by hog until hogEnd — so lead can't
    // open before hogEnd no matter what happens to BE. small only needs BE,
    // and its own 24-day run finishes in exactly hogEnd, right when lead's
    // reservation lands — so it's safe to let small use BE in the meantime
    // rather than leaving it idle for no reason.
    const hog = project("hog", "M");
    const lead = project("lead", "M");
    const small = project("small", "M");
    const result = simulate({
      projects: [hog, lead, small],
      cells: cellsFor({
        hog: { FE: { days: 24, maxFte: 1 } },
        lead: { BE: { days: 24, maxFte: 2 }, FE: { days: 24, maxFte: 1 } },
        small: { BE: { days: 24, maxFte: 1 } },
      }),
      pools: pools({ BE: 1, FE: 1 }),
    });

    const [, spLead, spSmall] = result.scheduled;
    const hogEnd = 24 / EDPM;
    // small gets to run BE now — its own reserved-future-start check comes
    // out safe because it releases BE exactly when lead needs it.
    expect(spSmall.startMonths).toBeCloseTo(0, 6);
    expect(spSmall.endMonths).toBeCloseTo(hogEnd, 6);
    expect(spLead.startMonths).toBeCloseTo(hogEnd, 6);
    // No idle BE at all — small's use of it was exactly what anti-starvation
    // is supposed to allow, not prevent.
    expect(result.idleFteMonths.BE).toBeCloseTo(0, 6);
  });

  it("does not let a lower-ranked project open if its own work would still be running at the reserved start", () => {
    // Same shape as above, but small now needs 40 days of BE instead of 24 —
    // long enough that it would still be mid-flight when lead's reservation
    // (hogEnd, driven by FE) lands. It must not be allowed to start at all
    // until BE is genuinely free with nothing else scheduled to still need it.
    const hog = project("hog", "M");
    const lead = project("lead", "M");
    const small = project("small", "L");
    const result = simulate({
      projects: [hog, lead, small],
      cells: cellsFor({
        hog: { FE: { days: 24, maxFte: 1 } },
        lead: { BE: { days: 24, maxFte: 2 }, FE: { days: 24, maxFte: 1 } },
        small: { BE: { days: 40, maxFte: 1 } },
      }),
      pools: pools({ BE: 1, FE: 1 }),
    });

    const [, spLead, spSmall] = result.scheduled;
    const hogEnd = 24 / EDPM;
    expect(spLead.startMonths).toBeCloseTo(hogEnd, 6);
    // small is refused the idle BE up front and instead waits for lead's own
    // BE run (target 2, but pool only ever gives it 1) to finish.
    expect(spSmall.startMonths).toBeCloseTo(hogEnd + 24 / EDPM, 6);
  });

  it("never preempts running work when a higher-ranked project clears its gate", () => {
    // lead outranks follower but spends its first stretch in phase 1. Under
    // the old rank-every-slice allocation it would rip BE away from follower
    // the moment phase 2 opened; now it waits for BE to come free.
    const lead = project("lead", "L");
    const follower = project("follower", "M");
    const result = simulate({
      projects: [lead, follower],
      cells: cellsFor({
        lead: { TL: { days: 12, maxFte: 1 }, BE: { days: 60, maxFte: 1 } },
        follower: { BE: { days: 24, maxFte: 1 } },
      }),
      pools: pools({ TL: 1, BE: 1 }),
    });

    const [spLead, spFollower] = result.scheduled;
    const followerEnd = 24 / EDPM;
    expect(spFollower.segments).toHaveLength(1);
    expect(spFollower.endMonths).toBeCloseTo(followerEnd, 6);
    expect(spFollower.waits).toEqual([]);

    // lead's phase 2 opens only once follower releases BE. Rather than
    // finishing phase 1 early and stalling, lead starts phase 1 late enough
    // to run straight into phase 2 — the wait sits in front of the project.
    const phase1 = spLead.phases.find((p) => p.phase === 1)!;
    const phase2 = spLead.phases.find((p) => p.phase === 2)!;
    const phase1Duration = (12 * 0.2) / EDPM;
    expect(phase2.startMonths).toBeCloseTo(followerEnd, 6);
    expect(phase1.endMonths).toBeCloseTo(followerEnd, 6);
    expect(phase1.startMonths).toBeCloseTo(followerEnd - phase1Duration, 6);
    expect(spLead.startMonths).toBeCloseTo(followerEnd - phase1Duration, 6);
    // Deferring is not preempting: the finish date is exactly what it was
    // when lead started at once and stalled in the middle.
    expect(spLead.endMonths).toBeCloseTo(followerEnd + 60 / EDPM, 6);
    expect(spLead.waits.filter((w) => w.reason === "crew")).toHaveLength(0);
  });

  it("slides faza 1 up against faza 2 rather than stalling mid-project", () => {
    // Three identical projects queue for a single BE. Their initiations could
    // all run at once (PM is plentiful), so there is nothing stopping each
    // one from being deferred until it runs straight into its own faza 2.
    const backlog = [project("a", "L"), project("b", "L"), project("c", "L")];
    const result = simulate({
      projects: backlog,
      cells: cellsFor({
        a: { PM: { days: 10, maxFte: 1 }, BE: { days: 30, maxFte: 1 } },
        b: { PM: { days: 10, maxFte: 1 }, BE: { days: 30, maxFte: 1 } },
        c: { PM: { days: 10, maxFte: 1 }, BE: { days: 30, maxFte: 1 } },
      }),
      pools: pools({ PM: 3, BE: 1 }),
    });

    const phase1 = (10 * 0.2) / EDPM;
    const beRun = 30 / EDPM;

    expect(result.truncated).toBe(false);
    for (const sp of result.scheduled) {
      const p1 = sp.phases.find((p) => p.phase === 1)!;
      const p2 = sp.phases.find((p) => p.phase === 2)!;
      expect(p2.startMonths).toBeCloseTo(p1.endMonths, 6);
      expect(p1.endMonths - p1.startMonths).toBeCloseTo(phase1, 6);
    }
    // b and c start later and later, exactly tracking when BE frees up —
    // the queue is visible in the start dates, not as holes in the bars.
    const starts = result.scheduled.map((sp) => sp.startMonths);
    expect(starts[0]).toBeCloseTo(0, 6);
    expect(starts[1]).toBeCloseTo(phase1 + beRun - phase1, 6);
    expect(starts[2]).toBeCloseTo(phase1 + 2 * beRun - phase1, 6);
    expect(result.horizonMonths).toBeCloseTo(phase1 + 3 * beRun, 6);

    // Without contiguity, PM is plentiful enough that a/b/c would all start
    // faza 1 at t=0 — so the whole of b's and c's push is attributable to
    // the fixed point, not to any capacity constraint of their own.
    const [spA, spB, spC] = result.scheduled;
    expect(spA.contiguityDelayMonths).toBeCloseTo(0, 6);
    expect(spB.contiguityDelayMonths).toBeCloseTo(beRun, 6);
    expect(spC.contiguityDelayMonths).toBeCloseTo(2 * beRun, 6);
  });

  it("delays initiation rather than tolerating any phase gap, however contended the pools", () => {
    // Same contended backlog as the stream-continuity test below. Under the
    // old heuristic this backlog was too contended to close every gap within
    // a horizon tolerance, so one project was left stalled. Contiguity is no
    // longer optional: every project must come out gap-free even if that
    // pushes the horizon out past the old no-deferral baseline.
    const backlog = [
      project("a", "L"),
      project("b", "XL"),
      project("c", "M"),
      project("d", "L"),
      project("e", "S"),
    ];
    const result = simulate({
      projects: backlog,
      cells: cellsFor({
        a: { PM: { days: 10, maxFte: 1 }, UX: { days: 8, maxFte: 1 }, BE: { days: 30, maxFte: 2 }, QA: { days: 12, maxFte: 1 } },
        b: { PM: { days: 14, maxFte: 1 }, TL: { days: 10, maxFte: 1 }, BE: { days: 50, maxFte: 2 }, FE: { days: 30, maxFte: 2 }, SEC: { days: 10, maxFte: 1 } },
        c: { UX: { days: 6, maxFte: 1 }, FE: { days: 18, maxFte: 1 } },
        d: { PM: { days: 12, maxFte: 1 }, BE: { days: 24, maxFte: 1 }, FE: { days: 24, maxFte: 1 }, QA: { days: 12, maxFte: 1 } },
        e: { TL: { days: 6, maxFte: 1 }, BE: { days: 18, maxFte: 1 } },
      }),
      pools: pools({ PM: 1.5, UX: 1, TL: 1, BE: 3, FE: 2, QA: 1, SEC: 0.5 }),
    });

    expect(result.truncated).toBe(false);

    // Zero tolerance: not even one project may keep a gap.
    for (const sp of result.scheduled) {
      const p1 = sp.phases.find((p) => p.phase === 1);
      const p2 = sp.phases.find((p) => p.phase === 2);
      if (!p1 || !p2 || !Number.isFinite(p2.startMonths)) continue;
      expect(p2.startMonths).toBeCloseTo(p1.endMonths, 6);
    }
  });

  it("leaves no gap inside any crew stream, however contended the pools", () => {
    const backlog = [
      project("a", "L"),
      project("b", "XL"),
      project("c", "M"),
      project("d", "L"),
      project("e", "M", "a"),
    ];
    const result = simulate({
      projects: backlog,
      cells: cellsFor({
        a: { PM: { days: 10, maxFte: 1 }, UX: { days: 8, maxFte: 1 }, BE: { days: 30, maxFte: 2 }, QA: { days: 12, maxFte: 1 } },
        b: { PM: { days: 14, maxFte: 1 }, TL: { days: 10, maxFte: 1 }, BE: { days: 50, maxFte: 2 }, FE: { days: 30, maxFte: 2 }, SEC: { days: 10, maxFte: 1 } },
        c: { UX: { days: 6, maxFte: 1 }, FE: { days: 18, maxFte: 1 } },
        d: { PM: { days: 12, maxFte: 1 }, BE: { days: 24, maxFte: 1 }, FE: { days: 24, maxFte: 1 }, QA: { days: 12, maxFte: 1 } },
        e: { TL: { days: 6, maxFte: 1 }, BE: { days: 18, maxFte: 1 } },
      }),
      pools: pools({ PM: 1.5, UX: 1, TL: 1, BE: 3, FE: 2, QA: 1, SEC: 0.5 }),
    });

    expect(result.truncated).toBe(false);
    for (const sp of result.scheduled) {
      expect(sp.isImpossible).toBe(false);
      for (const stream of sp.streams) {
        // Every stream now, with no exemptions: the residue that used to be
        // allowed to trickle with breaks is gone, so this is a strictly
        // stronger invariant than it was.
        expect(stream.segments.length).toBeGreaterThan(0);
        stream.segments.forEach((segment, index) => {
          expect(segment.fte).toBeGreaterThanOrEqual(stream.minFte - 1e-9);
          if (index > 0) {
            expect(segment.startMonths).toBeCloseTo(stream.segments[index - 1].endMonths, 9);
          }
        });
      }
    }
  });

  it("flags a minimum crew bigger than the pool as impossible", () => {
    // Target 3 at a 0.4 minimum needs 1.2 FTE to begin; the pool is 1.
    const doomed = project("doomed", "M");
    const fine = project("fine", "M");
    const result = simulate({
      projects: [doomed, fine],
      cells: cellsFor({
        doomed: { BE: { days: 24, maxFte: 3 } },
        fine: { FE: { days: 24, maxFte: 1 } },
      }),
      pools: pools({ BE: 1, FE: 1 }),
    });

    const [spDoomed, spFine] = result.scheduled;
    expect(spDoomed.isImpossible).toBe(true);
    expect(spDoomed.impossibleReasons).toEqual([{ capability: "BE", kind: "min-above-pool" }]);
    expect(spDoomed.endMonths).toBe(Infinity);
    expect(spFine.endMonths).toBeCloseTo(24 / EDPM, 6);
  });

  it("trades throughput for honest starts as the minimum staffing fraction rises", () => {
    const lead = project("lead", "M");
    const p1 = project("p1", "M");
    const input = {
      projects: [lead, p1],
      cells: cellsFor({
        lead: { BE: { days: 24, maxFte: 1 } },
        p1: { BE: { days: 24, maxFte: 1 } },
      }),
      pools: pools({ BE: 1.5 }),
    };

    // At 0.4, p1 opens immediately on the spare 0.5 FTE and ramps to 1 when
    // lead finishes. At 1.0 it refuses to start under-staffed and waits.
    const lenient = simulate(input, 0.4).scheduled[1];
    const strict = simulate(input, 1).scheduled[1];

    expect(lenient.startMonths).toBeCloseTo(0, 6);
    expect(strict.startMonths).toBeCloseTo(24 / EDPM, 6);
    expect(lenient.endMonths).toBeLessThan(strict.endMonths);
    // Both still run without gaps — the difference is when they begin.
    expect(strict.streams[0].segments).toHaveLength(1);
  });

});

describe("blockedBy dependency cycles", () => {
  it("marks a direct cycle (A -> B -> A) unschedulable on both sides, without dropping either edge", () => {
    const a = project("a", "S", "b");
    const b = project("b", "S", "a");
    const result = simulate({
      projects: [a, b],
      cells: cellsFor({
        a: { BE: { days: 6, maxFte: 1 } },
        b: { BE: { days: 6, maxFte: 1 } },
      }),
      pools: pools({ BE: 5 }),
    });

    expect(result.truncated).toBe(false);
    const [spA, spB] = result.scheduled;
    for (const sp of [spA, spB]) {
      expect(sp.isImpossible).toBe(true);
      expect(sp.endMonths).toBe(Infinity);
      expect(sp.phases).toHaveLength(0);
    }
    // Both reasons name the same full cycle, from either side.
    expect(spA.impossibleReasons).toEqual([{ kind: "dependency-cycle", cycle: ["a", "b"] }]);
    expect(spB.impossibleReasons).toEqual([{ kind: "dependency-cycle", cycle: ["a", "b"] }]);
  });

  it("marks every project on a longer cycle (A -> B -> C -> A) unschedulable", () => {
    const a = project("a", "S", "b");
    const b = project("b", "S", "c");
    const c = project("c", "S", "a");
    const result = simulate({
      projects: [a, b, c],
      cells: cellsFor({
        a: { BE: { days: 6, maxFte: 1 } },
        b: { BE: { days: 6, maxFte: 1 } },
        c: { BE: { days: 6, maxFte: 1 } },
      }),
      pools: pools({ BE: 5 }),
    });

    for (const sp of result.scheduled) {
      expect(sp.isImpossible).toBe(true);
      const reason = sp.impossibleReasons.find((r) => r.kind === "dependency-cycle");
      expect(reason).toBeDefined();
      expect(new Set(reason!.cycle)).toEqual(new Set(["a", "b", "c"]));
    }
  });

  it("marks a project that blocks itself unschedulable as a one-node cycle", () => {
    const a = project("a", "S", "a");
    const result = simulate({
      projects: [a],
      cells: cellsFor({ a: { BE: { days: 6, maxFte: 1 } } }),
      pools: pools({ BE: 5 }),
    });

    const spA = result.scheduled[0];
    expect(spA.isImpossible).toBe(true);
    expect(spA.impossibleReasons).toEqual([{ kind: "dependency-cycle", cycle: ["a"] }]);
  });

  it("still schedules a valid chain C -> B -> A normally", () => {
    const a = project("a", "S", "b");
    const b = project("b", "S", "c");
    const c = project("c", "S");
    const result = simulate({
      projects: [a, b, c],
      cells: cellsFor({
        a: { BE: { days: 6, maxFte: 1 } },
        b: { BE: { days: 6, maxFte: 1 } },
        c: { BE: { days: 6, maxFte: 1 } },
      }),
      pools: pools({ BE: 5 }),
    });

    const [spA, spB, spC] = result.scheduled;
    for (const sp of [spA, spB, spC]) expect(sp.isImpossible).toBe(false);
    const cEnd = 6 / EDPM;
    const bEnd = cEnd + 6 / EDPM;
    const aEnd = bEnd + 6 / EDPM;
    expect(spC.endMonths).toBeCloseTo(cEnd, 6);
    expect(spB.startMonths).toBeCloseTo(cEnd, 6);
    expect(spB.endMonths).toBeCloseTo(bEnd, 6);
    expect(spA.startMonths).toBeCloseTo(bEnd, 6);
    expect(spA.endMonths).toBeCloseTo(aEnd, 6);
  });

  it("propagates impossibility through a valid chain when the root is impossible for another reason, exactly as before", () => {
    const a = project("a", "S", "b");
    const b = project("b", "S", "c");
    const c = project("c", "S"); // demands BE, but BE has no pool at all
    const result = simulate({
      projects: [a, b, c],
      cells: cellsFor({
        a: { QA: { days: 6, maxFte: 1 } },
        b: { FE: { days: 6, maxFte: 1 } },
        c: { BE: { days: 6, maxFte: 1 } },
      }),
      pools: pools({ FE: 5, QA: 5 }),
    });

    const [spA, spB, spC] = result.scheduled;
    expect(spC.impossibleReasons).toEqual([{ capability: "BE", kind: "no-pool" }]);
    expect(spB.impossibleReasons).toEqual([{ kind: "blocked-by-impossible" }]);
    expect(spA.impossibleReasons).toEqual([{ kind: "blocked-by-impossible" }]);
  });

  it("makes a project outside the cycle unschedulable transitively, without putting it on the cycle itself", () => {
    const a = project("a", "S", "b");
    const b = project("b", "S", "a");
    const outside = project("outside", "S", "a");
    const result = simulate({
      projects: [a, b, outside],
      cells: cellsFor({
        a: { BE: { days: 6, maxFte: 1 } },
        b: { BE: { days: 6, maxFte: 1 } },
        outside: { BE: { days: 6, maxFte: 1 } },
      }),
      pools: pools({ BE: 5 }),
    });

    const [spA, spB, spOutside] = result.scheduled;
    expect(spA.impossibleReasons).toEqual([{ kind: "dependency-cycle", cycle: ["a", "b"] }]);
    expect(spB.impossibleReasons).toEqual([{ kind: "dependency-cycle", cycle: ["a", "b"] }]);
    // outside is impossible because its blocker never finishes, not because
    // it is itself part of the loop.
    expect(spOutside.isImpossible).toBe(true);
    expect(spOutside.impossibleReasons).toEqual([{ kind: "blocked-by-impossible" }]);
  });

  it("still schedules an unrelated group normally when another group contains a cycle", () => {
    const a = project("a", "S", "b");
    const b = project("b", "S", "a");
    const x = project("x", "S");
    const y = project("y", "S", "x");
    const result = simulate({
      projects: [a, b, x, y],
      cells: cellsFor({
        a: { BE: { days: 6, maxFte: 1 } },
        b: { BE: { days: 6, maxFte: 1 } },
        x: { FE: { days: 6, maxFte: 1 } },
        y: { FE: { days: 6, maxFte: 1 } },
      }),
      pools: pools({ BE: 5, FE: 5 }),
    });

    const spA = result.scheduled.find((sp) => sp.project.id === "a")!;
    const spB = result.scheduled.find((sp) => sp.project.id === "b")!;
    const spX = result.scheduled.find((sp) => sp.project.id === "x")!;
    const spY = result.scheduled.find((sp) => sp.project.id === "y")!;
    expect(spA.isImpossible).toBe(true);
    expect(spB.isImpossible).toBe(true);

    const xEnd = 6 / EDPM;
    expect(spX.isImpossible).toBe(false);
    expect(spX.endMonths).toBeCloseTo(xEnd, 6);
    expect(spY.isImpossible).toBe(false);
    expect(spY.startMonths).toBeCloseTo(xEnd, 6);
    expect(spY.endMonths).toBeCloseTo(xEnd + 6 / EDPM, 6);
  });
});

// Contiguity is asserted this way throughout: for every project with both
// phases that actually finishes, faza 2 must pick up in the exact instant
// faza 1 ends — never later. `expect(...).toBeCloseTo` (not "less than or
// equal") is deliberate: a gap of any size, in either direction, is a bug.
function expectContiguous(sp: { phases: PhaseSpan[] }) {
  const p1 = sp.phases.find((p) => p.phase === 1);
  const p2 = sp.phases.find((p) => p.phase === 2);
  if (!p1 || !p2 || !Number.isFinite(p2.startMonths)) return;
  expect(p2.startMonths).toBeCloseTo(p1.endMonths, 6);
}

describe("phase contiguity as a hard invariant", () => {
  it("never produces faza 1 -> gap -> faza 2 for any schedulable two-phase project", () => {
    // X's own faza 1 (UX) is uncontended, but its faza 2 (BE) is fully held
    // by higher-ranked Y until Y finishes. A gap-tolerant scheduler would let
    // X's UX run immediately and then sit idle waiting for BE; the invariant
    // instead holds X's whole faza 1 back so it lands flush against Y's end.
    const y = project("y", "L");
    const x = project("x", "M");
    const result = simulate({
      projects: [y, x],
      cells: cellsFor({
        y: { BE: { days: 30, maxFte: 1 } },
        x: { UX: { days: 5, maxFte: 1 }, BE: { days: 10, maxFte: 1 } },
      }),
      pools: pools({ UX: 1, BE: 1 }),
    });

    expect(result.truncated).toBe(false);
    for (const sp of result.scheduled) expectContiguous(sp);
  });

  it("holds the whole project back when phase-1 capacity is free now but phase-2 capacity only frees up later", () => {
    const y = project("y", "L");
    const x = project("x", "M");
    const result = simulate({
      projects: [y, x],
      cells: cellsFor({
        y: { BE: { days: 30, maxFte: 1 } },
        x: { UX: { days: 5, maxFte: 1 }, BE: { days: 10, maxFte: 1 } },
      }),
      pools: pools({ UX: 1, BE: 1 }),
    });

    const spX = result.scheduled[1];
    const yEnd = 30 / EDPM;
    const xPhase1Duration = 5 / EDPM;

    // Not "started immediately and then stalled" — never started at all until
    // the moment that lets it run straight through.
    expect(spX.phases[0].startMonths).toBeCloseTo(yEnd - xPhase1Duration, 6);
    expect(spX.phases[0].endMonths).toBeCloseTo(yEnd, 6);
    expectContiguous(spX);
  });

  it("keeps pushing initiation later when the delayed slot collides with new PM/UX/TL contention", () => {
    // y holds BE until 30/EDPM, same as above. But the UX slot x would need
    // to land its faza 1 flush against that (from 25/EDPM) is itself taken by
    // higher-ranked z, which occupies UX until 35/EDPM. x can't just defer to
    // 25/EDPM and go — it has to wait out z's UX hold too, and only then does
    // its faza 1 run, landing flush against BE (which has been idle since
    // y finished at 30/EDPM).
    const y = project("y", "L");
    const z = project("z", "M");
    const x = project("x", "M");
    const result = simulate({
      projects: [y, z, x],
      cells: cellsFor({
        y: { BE: { days: 30, maxFte: 1 } },
        z: { UX: { days: 35, maxFte: 1 } },
        x: { UX: { days: 5, maxFte: 1 }, BE: { days: 10, maxFte: 1 } },
      }),
      pools: pools({ UX: 1, BE: 1 }),
    });

    const zEnd = 35 / EDPM;
    const spX = result.scheduled[2];

    expect(result.truncated).toBe(false);
    // x's faza 1 could not start until z released UX...
    expect(spX.phases[0].startMonths).toBeCloseTo(zEnd, 6);
    // ...and still lands exactly on BE, which had been free since y finished.
    expectContiguous(spX);
  });

  it("holds contiguity when earliestStart pushes a project past where the gap would otherwise close", () => {
    // BE is held by y until 30/EDPM, same shape as above, but x is also
    // externally barred from starting before month 40/EDPM's worth of days —
    // well past the point contiguity alone would have picked. The later of
    // the two bars must win, and the phases must still be flush.
    const y = project("y", "L");
    const x = project("x", "M");
    const earliestStartMonths = 40 / EDPM;
    const result = simulate({
      projects: [y, x],
      cells: cellsFor({
        y: { BE: { days: 30, maxFte: 1 } },
        x: { UX: { days: 5, maxFte: 1 }, BE: { days: 10, maxFte: 1 } },
      }),
      pools: pools({ UX: 1, BE: 1 }),
      earliestStart: { x: earliestStartMonths },
    });

    const spX = result.scheduled[1];
    expect(spX.phases[0].startMonths).toBeCloseTo(earliestStartMonths, 6);
    expectContiguous(spX);
  });

  it("holds contiguity when blockedBy pushes a project past where the gap would otherwise close", () => {
    // Same BE contention from y, but x is also blocked by an unrelated
    // project on a completely different capability (FE) that finishes well
    // after y releases BE. blockedBy — not capacity — ends up being the
    // binding constraint, and the phases must still be flush.
    const y = project("y", "L");
    const blocker = project("blocker", "L");
    const x = project("x", "M", "blocker");
    const result = simulate({
      projects: [y, blocker, x],
      cells: cellsFor({
        y: { BE: { days: 30, maxFte: 1 } },
        blocker: { FE: { days: 60, maxFte: 1 } },
        x: { UX: { days: 5, maxFte: 1 }, BE: { days: 10, maxFte: 1 } },
      }),
      pools: pools({ UX: 1, BE: 1, FE: 1 }),
    });

    const blockerEnd = 60 / EDPM;
    const yEnd = 30 / EDPM;
    const spX = result.scheduled[2];

    // The blocker easily outlasts y's hold on BE, so blockedBy — not
    // capacity — is what's pushing x out.
    expect(blockerEnd).toBeGreaterThan(yEnd);
    expect(spX.phases[0].startMonths).toBeGreaterThanOrEqual(blockerEnd - 1e-9);
    expectContiguous(spX);
  });

  it("leaves an impossible project impossible instead of trying to make it contiguous", () => {
    const doomed = project("doomed", "M");
    const result = simulate({
      projects: [doomed],
      cells: cellsFor({ doomed: { UX: { days: 5, maxFte: 1 }, BE: { days: 10, maxFte: 1 } } }),
      pools: pools({ UX: 1, BE: 0 }),
    });

    const spDoomed = result.scheduled[0];
    expect(spDoomed.isImpossible).toBe(true);
    expect(spDoomed.endMonths).toBe(Infinity);
    expect(spDoomed.phases).toHaveLength(0);
  });

  it("handles a phase-1-only project without inventing a phase-2 gap", () => {
    const uxOnly = project("uxOnly", "S");
    const result = simulate({
      projects: [uxOnly],
      cells: cellsFor({ uxOnly: { UX: { days: 6, maxFte: 1 } } }),
      pools: pools({ UX: 1 }),
    });

    const sp = result.scheduled[0];
    expect(sp.phases).toHaveLength(1);
    expect(sp.phases[0].phase).toBe(1);
    expect(sp.endMonths).toBeCloseTo(6 / EDPM, 6);
  });

  it("handles a phase-2-only project without inventing a phase-1 gap", () => {
    const beOnly = project("beOnly", "S");
    const result = simulate({
      projects: [beOnly],
      cells: cellsFor({ beOnly: { BE: { days: 6, maxFte: 1 } } }),
      pools: pools({ BE: 1 }),
    });

    const sp = result.scheduled[0];
    expect(sp.phases).toHaveLength(1);
    expect(sp.phases[0].phase).toBe(2);
    expect(sp.startMonths).toBeCloseTo(0, 6);
    expect(sp.endMonths).toBeCloseTo(6 / EDPM, 6);
  });
});

describe("future-start reservation for anti-starvation", () => {
  it("reserves the future instant a single missing capability frees up, leaving other capabilities free now", () => {
    // j needs BE (free now) and FE (held by hog until hogEnd). BE must not
    // sit idle for the whole wait — only FE actually blocks j.
    const hog = project("hog", "M");
    const j = project("j", "S");
    const result = simulate({
      projects: [hog, j],
      cells: cellsFor({
        hog: { FE: { days: 24, maxFte: 1 } },
        j: { BE: { days: 5, maxFte: 1 }, FE: { days: 5, maxFte: 1 } },
      }),
      pools: pools({ BE: 1, FE: 1 }),
    });

    const hogEnd = 24 / EDPM;
    expect(result.scheduled[1].startMonths).toBeCloseTo(hogEnd, 6);
    // BE was free the entire time nobody could have used it in this backlog,
    // but nothing here forces j to grab it before it can use FE too — the
    // point is idle-but-usable BE elsewhere is not blocked by this project.
  });

  it("lets a lower-priority project use the idle capacity when its own work finishes before the reservation", () => {
    const hog = project("hog", "M");
    const lead = project("lead", "M");
    const small = project("small", "M");
    const result = simulate({
      projects: [hog, lead, small],
      cells: cellsFor({
        hog: { FE: { days: 24, maxFte: 1 } },
        lead: { BE: { days: 24, maxFte: 2 }, FE: { days: 24, maxFte: 1 } },
        small: { BE: { days: 24, maxFte: 1 } },
      }),
      pools: pools({ BE: 1, FE: 1 }),
    });

    const hogEnd = 24 / EDPM;
    const [, spLead, spSmall] = result.scheduled;
    expect(spSmall.startMonths).toBeCloseTo(0, 6);
    expect(spSmall.endMonths).toBeCloseTo(hogEnd, 6);
    expect(spLead.startMonths).toBeCloseTo(hogEnd, 6);
  });

  it("refuses a lower-priority project whose own work would still overlap the reserved start", () => {
    const hog = project("hog", "M");
    const lead = project("lead", "M");
    const small = project("small", "L");
    const result = simulate({
      projects: [hog, lead, small],
      cells: cellsFor({
        hog: { FE: { days: 24, maxFte: 1 } },
        lead: { BE: { days: 24, maxFte: 2 }, FE: { days: 24, maxFte: 1 } },
        small: { BE: { days: 40, maxFte: 1 } },
      }),
      pools: pools({ BE: 1, FE: 1 }),
    });

    const hogEnd = 24 / EDPM;
    const [, spLead, spSmall] = result.scheduled;
    // small is refused the idle BE up front (40 days would still be running
    // at hogEnd) and instead waits for lead's own BE run to finish.
    expect(spLead.startMonths).toBeCloseTo(hogEnd, 6);
    expect(spSmall.startMonths).toBeCloseTo(hogEnd + 24 / EDPM, 6);
  });

  it("takes the later of several capabilities that each free up at a different time", () => {
    // hog1 holds BE until T_BE, hog2 holds FE until T_FE (T_FE later). j
    // needs both, so its reservation — and its actual start — is T_FE, not
    // the earlier T_BE.
    const hog1 = project("hog1", "S");
    const hog2 = project("hog2", "S");
    const j = project("j", "S");
    const result = simulate({
      projects: [hog1, hog2, j],
      cells: cellsFor({
        hog1: { BE: { days: 10, maxFte: 1 } },
        hog2: { FE: { days: 20, maxFte: 1 } },
        j: { BE: { days: 5, maxFte: 1 }, FE: { days: 5, maxFte: 1 } },
      }),
      pools: pools({ BE: 1, FE: 1 }),
    });

    const tBE = 10 / EDPM;
    const tFE = 20 / EDPM;
    expect(tFE).toBeGreaterThan(tBE);
    expect(result.scheduled[2].startMonths).toBeCloseTo(tFE, 6);
  });

  it("does not let anything compete on the top project's behalf before its earliestStart — but accounts for what's already running once it does", () => {
    // l is free to use BE from t=0 since j (ranked above it) isn't even
    // eligible to compete yet. Once j's earliestStart arrives, its
    // reservation is computed from l's *remaining* bucket, not a fresh one.
    const j = project("j", "S");
    const l = project("l", "S");
    const earliestJ = 10 / EDPM;
    const result = simulate({
      projects: [j, l],
      cells: cellsFor({
        j: { BE: { days: 10, maxFte: 1 } },
        l: { BE: { days: 30, maxFte: 1 } },
      }),
      pools: pools({ BE: 1 }),
      earliestStart: { j: earliestJ },
    });

    const [spJ, spL] = result.scheduled;
    // l ran freely from t=0 — j's future priority claimed nothing yet.
    expect(spL.startMonths).toBeCloseTo(0, 6);
    // l's true finish (accounting for the 10 days it already burned before j
    // became eligible) is what j actually waits for.
    const lFinish = 30 / EDPM;
    expect(spJ.startMonths).toBeCloseTo(lFinish, 6);
    expect(spJ.startMonths).toBeGreaterThan(earliestJ);
  });

  it("does not let anything compete on the top project's behalf while it is blockedBy-gated — but resumes its priority the instant it clears", () => {
    // j outranks l but is blocked by k. l is free to grab BE while j is
    // blocked. The moment k finishes, j (still higher-ranked than l) takes
    // priority over l immediately — blockedBy only delayed *when* j could
    // compete, not its rank once it can.
    const k = project("k", "S");
    const j = project("j", "S", "k");
    const l = project("l", "S");
    const result = simulate({
      projects: [k, j, l],
      cells: cellsFor({
        k: { BE: { days: 5, maxFte: 1 } },
        j: { BE: { days: 10, maxFte: 1 } },
        l: { BE: { days: 30, maxFte: 1 } },
      }),
      pools: pools({ BE: 1 }),
    });

    const tk = 5 / EDPM;
    const [spK, spJ, spL] = result.scheduled;
    expect(spK.endMonths).toBeCloseTo(tk, 6);
    // j opens the instant k clears — l does not get to keep the capacity.
    expect(spJ.startMonths).toBeCloseTo(tk, 6);
    // l, in turn, only gets BE once j is done with it.
    expect(spL.startMonths).toBeCloseTo(tk + 10 / EDPM, 6);
  });

  it("keeps faza 1 and faza 2 strictly contiguous even when the reservation lands well into the future", () => {
    const hog = project("hog", "M");
    const j = project("j", "M");
    const result = simulate({
      projects: [hog, j],
      cells: cellsFor({
        hog: { BE: { days: 20, maxFte: 1 } },
        j: { UX: { days: 5, maxFte: 1 }, BE: { days: 10, maxFte: 1 } },
      }),
      pools: pools({ UX: 1, BE: 1 }),
    });

    const hogEnd = 20 / EDPM;
    const spJ = result.scheduled[1];
    const p1 = spJ.phases.find((p) => p.phase === 1)!;
    const p2 = spJ.phases.find((p) => p.phase === 2)!;
    // BE (faza 2) isn't free until hogEnd, so faza 1 is held back — even
    // though UX itself is free the whole time — until it lands flush.
    expect(p2.startMonths).toBeCloseTo(hogEnd, 6);
    expect(p2.startMonths).toBeCloseTo(p1.endMonths, 6);
  });

  it("is not pushed later by admitting backfill work into its own idle window", () => {
    // Two lower-priority projects (small, extra) split the two units of idle
    // BE while lead waits on FE. lead's start must land on hogEnd regardless
    // of how many backfill projects used the capacity in the meantime.
    const hog = project("hog", "S");
    const lead = project("lead", "S");
    const small = project("small", "S");
    const extra = project("extra", "S");
    const result = simulate({
      projects: [hog, lead, small, extra],
      cells: cellsFor({
        hog: { FE: { days: 24, maxFte: 1 } },
        lead: { BE: { days: 10, maxFte: 1 }, FE: { days: 10, maxFte: 1 } },
        small: { BE: { days: 24, maxFte: 1 } },
        extra: { BE: { days: 24, maxFte: 1 } },
      }),
      pools: pools({ BE: 2, FE: 1 }),
    });

    const hogEnd = 24 / EDPM;
    const [, spLead, spSmall, spExtra] = result.scheduled;
    expect(spSmall.startMonths).toBeCloseTo(0, 6);
    expect(spExtra.startMonths).toBeCloseTo(0, 6);
    expect(spLead.startMonths).toBeCloseTo(hogEnd, 6);
  });

  it("gives every failing project its own reservation, not just the highest-ranked one", () => {
    // secHog and beHog are already-committed, unrelated holders: secHog ties
    // up all of SEC for 6 months, beHog ties up 1 of BE's 2 units for a
    // short while. a (#1) only needs SEC — it fails and reserves month 6.
    // b (#2) needs more BE than is free right now (only 1 of 2 units free
    // until beHog releases its share) — it fails too and must get its own
    // reservation. c (#3) only needs 1 BE unit, which is free right now, so
    // its own crew test passes immediately — but admitting it for 3 months
    // would still be running when b's reservation lands, so it must be
    // refused despite never touching a's reservation (SEC) at all.
    const secHog = project("secHog", "S");
    const beHog = project("beHog", "S");
    const a = project("a", "S");
    const b = project("b", "S");
    const c = project("c", "S");
    const result = simulate({
      projects: [secHog, beHog, a, b, c],
      cells: cellsFor({
        secHog: { SEC: { days: 6 * EDPM, maxFte: 1 } },
        beHog: { BE: { days: 0.25 * EDPM, maxFte: 1 } },
        a: { SEC: { days: 6, maxFte: 1 } },
        b: { BE: { days: 6, maxFte: 3 } },
        c: { BE: { days: 3 * EDPM, maxFte: 1 } },
      }),
      pools: pools({ SEC: 1, BE: 2 }),
    });

    const [, , spA, spB, spC] = result.scheduled;
    const beHogEnd = 0.25;
    expect(spA.startMonths).toBeCloseTo(6, 6);
    // b opens the moment beHog frees its share...
    expect(spB.startMonths).toBeCloseTo(beHogEnd, 6);
    // ...and c — despite being able to pass its own crew test immediately —
    // must wait for b, not just for a, since it would otherwise still be
    // running when b's reservation comes due.
    expect(spC.startMonths).toBeCloseTo(spB.endMonths, 6);
    expect(spC.startMonths).toBeGreaterThan(beHogEnd);
  });

  it("lets a committed holder's own top-up shorten a project's actual wait, ahead of a stale extrapolation", () => {
    // Pool BE = 4. h1 (target 2) finishes quickly; h2 (target 3, but only
    // 2 free once h1 has taken its share) runs under target until then. j
    // (target 10, needing the whole pool) fails immediately.
    //
    // A prediction that freezes h2 at its pre-top-up rate would put j's
    // wait at 100/(2*EDPM) — as if h2 never sped up. The real schedule (and
    // any correct forecast of committed work) has h2 jump to rate 3 the
    // moment h1 releases its share, finishing — and so freeing the whole
    // pool for j — noticeably sooner than that stale extrapolation.
    const h1 = project("h1", "S");
    const h2 = project("h2", "S");
    const j = project("j", "M");
    const result = simulate({
      projects: [h1, h2, j],
      cells: cellsFor({
        h1: { BE: { days: 8, maxFte: 2 } },
        h2: { BE: { days: 100, maxFte: 3 } },
        j: { BE: { days: 1, maxFte: 10 } },
      }),
      pools: pools({ BE: 4 }),
    });

    const h1End = 8 / (2 * EDPM);
    const h2RemainingAtTopUp = 100 - 2 * EDPM * h1End;
    const trueH2End = h1End + h2RemainingAtTopUp / (3 * EDPM);
    const staleEstimate = 100 / (2 * EDPM); // ignores the top-up entirely
    expect(trueH2End).toBeLessThan(staleEstimate - 1e-6);

    const spJ = result.scheduled[2];
    expect(spJ.startMonths).toBeCloseTo(trueH2End, 6);
    expect(spJ.startMonths).toBeLessThan(staleEstimate - 1e-6);
  });
});

describe("the crew moves as one", () => {
  // The crew model's allocation rule, and the reason it is not just "derive a
  // target and reuse the old per-capability loop": short of capacity the whole
  // team scales by one common factor. Allocating per capability would let a
  // well-supplied stream sprint ahead of a starved sibling, and the phase's
  // streams would drift apart again — which is the exact thing the derivation
  // exists to prevent.
  it("de-rates every capability by the same factor when one of them is short", () => {
    const p1 = project("p1", "L");
    const p2 = project("p2", "M");
    const result = simulate({
      projects: [p1, p2],
      cells: cellsFor({
        p1: { BE: { days: 60, maxFte: 1 } },
        p2: { BE: { days: 20, maxFte: 1 }, FE: { days: 20, maxFte: 1 } },
      }),
      // BE is the scarce one: p1 takes 1.0 of the 1.5, leaving p2 half of what
      // it wants. FE is abundant — five people for a job needing one.
      pools: pools({ BE: 1.5, FE: 5 }),
    });

    const sp2 = result.scheduled[1];
    const be = sp2.streams.find((s) => s.capability === "BE")!;
    const fe = sp2.streams.find((s) => s.capability === "FE")!;

    // Both cells derive a crew of 1.0 — equal work, equal ceiling.
    expect(be.crewFte).toBeCloseTo(1, 6);
    expect(fe.crewFte).toBeCloseTo(1, 6);

    // But p2 opens on the half-crew its backend can manage, and takes only
    // half a front-ender to match — despite four spare ones sitting idle.
    expect(be.segments[0].fte).toBeCloseTo(0.5, 6);
    expect(fe.segments[0].fte).toBeCloseTo(0.5, 6);
    expect(fe.segments[0].isFullyStaffed).toBe(false);
  });

  it("tops a running crew back up together rather than one capability at a time", () => {
    const p1 = project("p1", "L");
    const p2 = project("p2", "M");
    const result = simulate({
      projects: [p1, p2],
      cells: cellsFor({
        // Short, so p1 hands its backend back while p2 is still running.
        p1: { BE: { days: 20, maxFte: 1 } },
        p2: { BE: { days: 30, maxFte: 1 }, FE: { days: 30, maxFte: 1 } },
      }),
      pools: pools({ BE: 1.5, FE: 5 }),
    });

    const sp2 = result.scheduled[1];
    const be = sp2.streams.find((s) => s.capability === "BE")!;
    const fe = sp2.streams.find((s) => s.capability === "FE")!;

    // p1 releases its 1.0 of BE partway through, and both of p2's streams step
    // up at the same moment to the same figure.
    expect(be.segments.length).toBeGreaterThan(1);
    expect(fe.segments.length).toBe(be.segments.length);
    fe.segments.forEach((segment, i) => {
      expect(segment.fte).toBeCloseTo(be.segments[i].fte, 6);
      expect(segment.startMonths).toBeCloseTo(be.segments[i].startMonths, 6);
    });
    expect(be.segments.at(-1)!.fte).toBeCloseTo(1, 6);

    // And the whole point: they still finish together.
    expect(fe.endMonths).toBeCloseTo(be.endMonths, 6);
  });

  it("holds a burst at the floor instead of smearing it across a long phase", () => {
    // 2 days of SEC against 126 days of BE derives to 0.03 FTE. That is a
    // fiction, so it runs at the floor and finishes early — the one place a
    // stream is allowed to end before its phase does.
    const p = project("p1", "XXL");
    const result = simulate({
      projects: [p],
      cells: cellsFor({ p1: { BE: { days: 126, maxFte: 1 }, SEC: { days: 2, maxFte: 1 } } }),
      pools: pools({ BE: 5, SEC: 5 }),
    });

    const sp = result.scheduled[0];
    const be = sp.streams.find((s) => s.capability === "BE")!;
    const sec = sp.streams.find((s) => s.capability === "SEC")!;
    expect(sec.isBurst).toBe(true);
    expect(sec.crewFte).toBeCloseTo(DEFAULT_ESTIMATION_SETTINGS.minCrewFte, 6);
    expect(be.isBurst).toBe(false);
    expect(sec.endMonths).toBeLessThan(be.endMonths);
    // It is still the *phase* that ends last, not the burst.
    expect(sp.endMonths).toBeCloseTo(be.endMonths, 6);
  });
});
