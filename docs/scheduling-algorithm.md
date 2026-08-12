# Scheduling algorithm — how it works now

Reference for `src/lib/scheduling.ts` after the crew model, the hard contiguity invariant,
future-start reservation, and `blockedBy` cycle detection. Read alongside the file's own doc
comments — this is the map, the code is the territory.

## 1. The two-phase model

Every project's demand is split into two phases:

- **Faza 1 (inicjacja):** all of UX, plus 20% of PM and 20% of TL (`PHASE_1_SPLIT_SHARE = 0.2`).
- **Faza 2 (wytwarzanie):** all of BE/FE/QA/SEC, plus the remaining 80% of PM and TL.

`SPLIT_CAPABILITIES = [PM, TL]` — both straddle the phases 20/80. Both phase-2 shares are ordinary
crew streams: they join the crew test, are sticky, and release on completion like BE/FE/QA/SEC.

There used to be a `RESIDUE_CAPABILITIES = [TL]`, whose phase-2 share was exempt from the crew test
and from stickiness and was re-derived every slice to pace itself off the project's other live
phase-2 streams. The crew model (§1a) gives every capability that property by construction, so the
special case had nothing left to do — along with its corollary that a project with no phase-2 crew
for TL to pace against had to fold its residue back into phase 1 (`hasPhase2Demand`).

## 1a. The crew model — where a stream's FTE comes from

A cell carries `days` and `maxFte`. **`maxFte` is a ceiling, not a target**: the most people worth
putting on that capability at once, which is a property of the work rather than of the portfolio.

`src/lib/crew.ts` derives each phase's crew from it, per project, per phase (so PM's 20% up front and
its 80% during the build get different crews — a single figure could only be right for one of them):

```
months  = max over capabilities of  days[k] / (maxFte[k] * rate[k])     // the pace-setter
fte[k]  =                           days[k] / (months   * rate[k])      // everyone else de-rates
```

`fte[k] <= maxFte[k]` always, by construction. `DerivedCrew` also reports `paceIndex` (the capability
pinned at its ceiling — the only cell worth raising to go faster) and `burstIndexes`.

**The burst floor.** A capability whose derived FTE falls below `minCrewFte` is *not* de-rated — it
runs at the floor and finishes early. Four days of SEC across a five-month build derives to 0.06 FTE,
which is a fiction rather than a smoothing. This is the only case where a stream may end before its
phase does. A `maxFte` already below the floor is respected as a stated part-timer, not promoted.

Consequence for the simulation: `TGT1`/`TGT2` hold the derived crews and `tgt(j,k)`/`minOf(j,k)` read
whichever belongs to the phase `j` is currently in. Nothing downstream reads `maxFte` again.

Phase 2 for a project **cannot open until phase 1 is entirely done**, and — since the contiguity
change — **must open in the exact instant phase 1 ends** (§6).

## 2. Demand construction (`rem1`/`rem2`)

For each project × capability cell (`days`, `maxFte`), `rem1`/`rem2` hold the remaining days
still owed to each phase. This is the mutable state the simulation burns down (`R1`/`R2`).

## 3. Impossibility pre-pass (before simulation)

A project is excluded from the simulation (marked `isImpossible`) if any demanded capability has:

- `no-pool` — the pool for that capability is zero,
- `no-max` — `maxFte` is zero despite demand, so no crew can be derived at all,
- `min-above-pool` — the *derived crew* times `minStaffingFraction` exceeds the whole pool (can never
  gang-start). Judged on the derived crew rather than the ceiling: a capability capped at 2 that only
  ever runs at 0.3 because something else sets the pace is perfectly schedulable against a pool of 1,
  and checking the ceiling here would condemn projects the simulation handles without trouble,
- `dependency-cycle` — the project sits on a `blockedBy` cycle (§3a),
- `blocked-by-impossible` — its blocker (directly or transitively) is itself excluded.

Excluded projects get empty streams/phases and `endMonths = Infinity`, but are still returned in
`scheduled` (with zero-length segments) so the UI can render a row and explain why.

### 3a. `blockedBy` cycle detection

`blockedBy` forms a **functional graph** — every node has out-degree ≤ 1 (at most one blocker).
Such a graph is a forest of chains that either dangle (no blocker) or loop back on themselves.

Detection is a three-state walk per node (`UNVISITED` / `IN_PROGRESS` / `SETTLED`), classic cycle
detection over a functional graph:

1. Walk each unvisited node's blocker chain, marking nodes `IN_PROGRESS` and recording the path.
2. If the walk reaches a node already `IN_PROGRESS`, everything from that node onward in the
   current path is a cycle — mark all of them `excluded` with `{ kind: "dependency-cycle", cycle: [...ids] }`,
   the same full id list on every member so any one of them can explain the whole loop.
3. If the walk reaches `-1` (no blocker) or a `SETTLED` node, none of this path's nodes are on a
   cycle — mark them `SETTLED` and move on.

A project blocking itself (`blockedBy` its own id) is a one-node cycle and is caught the same way.

**No edge is ever dropped, ignored, or reinterpreted** — this is the load-bearing change from the
old behavior, which used to silently break whichever edge closed a cycle and then schedule
everyone anyway. Now a cycle is invalid data: every member is unschedulable, permanently.

After cycle members are excluded, the ordinary transitive pass (`blocked-by-impossible`) walks
every other project's blocker chain and excludes it too if that chain leads to an excluded node
(a cycle member or an ordinary impossibility) — so a project *depending on* a cycle, but not on
it, is impossible for the ordinary reason, not lumped into the cycle's own reason.

## 4. The core simulation (`simulateOnce`)

A discrete-event loop over `t`, advancing to the next moment something changes (a stream hits
zero, or a held-back project's gate opens). Every slice, in **backlog rank order**:

### 4a. Gang start
A phase (whichever of the project's two phases it's currently in) doesn't open until **every**
capability it demands can be staffed at `crewFte * minStaffingFraction` **simultaneously**. It
takes nothing at all rather than opening a couple of its streams and stalling on the rest.

### 4b. Sticky, non-preemptive holds
Once open, each stream holds its FTE until that specific capability's demand is exhausted. A
higher-ranked project arriving later can only draw on genuinely free capacity — it can never pull
people off work already under way. (Different capabilities within the same phase can finish at
different times and release independently, even though they opened together.)

### 4c. Backfill
Rank still dominates every slice: open streams are topped up toward target first, then closed
phases are tested for gang-start, all walking the backlog in order — so free capacity always
reaches the highest-ranked project that can currently use it.

### 4d. Future-start reservation (anti-starvation)

This replaced the old "reserve today's minimum out of the pool" behavior. When a closed project
fails its gang-start test in a slice:

1. It does **not** withhold any currently-free capacity — it can't use it yet.
2. Instead, `futureReadyAt(project, capability, minNeeded)` runs a small **lookahead simulation**
   of only currently-committed sticky holders of that capability (no new admissions): as each
   holder's bucket empties, its FTE returns to the pool and is redistributed to whoever's still
   running and under target — in rank order, exactly like the real top-up rule, so a holder ranked
   above the failing project gets first claim on newly-freed capacity, and only the remainder counts
   toward the failing project's own threshold. Because a committed holder can finish *earlier* than
   its current rate implies (it may get topped up and run faster), this predicts the true earliest
   release rather than a "nobody ever gets topped up" pessimistic one.
3. The **reservation time** is the max of `futureReadyAt` across all of that project's needed
   capabilities (gang start needs them all at once, so the latest one gates the rest — even a
   capability that's abundant *right now* is reserved from that same later instant).
4. A **lower-ranked** project considered afterward in the same slice may still open using
   currently-idle capacity a reservation also needs — but only if *its own* demand on that
   capability would finish (release) before **every** reservation that claims it. If not, it's
   refused this slice (reported as a `crew` wait) and retried automatically as the clock advances.
5. Already-open (sticky) streams are never touched by this — the check only gates *new*
   admissions, never revokes something already running.

This is what fixes the "BE and FE sit idle for six weeks because SEC won't be free until then"
problem: the six-week reservation is computed once, and any lower-priority work that can finish
inside that window is allowed to use BE/FE for free in the meantime.

**Every** failing project gets its own reservation this slice, not just the highest-ranked one —
so #2 failing on BE still protects itself even though #1 is failing on an unrelated capability
(SEC) and would otherwise be the only reservation in effect. Without this, #3 could freely take
BE for months on the strength of #1's SEC-only reservation never objecting, starving #2 exactly
the way the mechanism exists to prevent. A candidate is refused if it would overlap *any*
higher-ranked reservation sharing a capability with it, not just the first one found.

In principle a reservation computed this way can still be an *overestimate* in one specific
sense — it's a snapshot restricted to already-committed holders, so it can't see a project that
becomes eligible to open later (e.g. once its own `earliestStart` or `blockedBy` clears) and would
have out-prioritized someone the reservation let through. That gap is deliberate: modeling
not-yet-eligible admissions would mean re-deriving the whole schedule recursively. In exchange,
because reservations are recomputed fresh every slice from whatever is actually committed at that
moment (never cached across slices), the lookahead in step 2 has been verified to never actually
change a scheduled outcome for the two-holder-chain shape it targets in this specific greedy,
per-slice-fresh architecture — the moment idle capacity exists for a lower-ranked candidate to
exploit, every upstream holder is provably already at its own target with no pending top-up left
to model. It's kept anyway because it's the more principled computation and costs nothing.

### 4e. The crew moves as one
`crewScale(j, caps, freeFor)` returns the fraction of its own derived crew a project can field right
now — `min` over its capabilities of `(held + free) / crew`, capped at 1. Both the gang-start
allocation and the per-slice top-up multiply *every* capability by that one factor.

This is the crew model's allocation rule, and the reason deriving a target was not enough on its own.
Allocating per capability (`min(target, free)`, as the old model did) would let a well-supplied
stream sprint ahead of a starved sibling the moment a pool got tight, and the phase's streams would
drift apart again — the exact thing the derivation exists to prevent. Scaling uniformly says the
honest thing instead: short of capacity the whole team slows down together and the phase takes
proportionally longer.

The gang-start *test* is unchanged — `free >= crew * minFraction` for every capability is exactly
`scale >= minFraction` — so the reservation and lookahead machinery in §4d is unaffected.

### 4f. Termination
The loop advances by the smallest of: the next stream to hit zero, or the next `notBefore` gate
(external `earliestStart`, or the contiguity `releaseAt`, §6) becoming eligible. It's bounded by
`12 * n + 16` iterations as a truncation safety net (a real bug, not a slow plan, if ever hit).

## 5. `blockedBy` gating during simulation

A project with `blockedBy` set draws from no pool — not even phase 1 — until its blocker's
overall end (both phases, if it has two). This is enforced by simply excluding it from `notDone`
(the set of projects competing this slice) until its blocker reaches the terminal `DONE` phase.
Because the cycle pre-pass (§3a) already removed every cyclic or cycle-dependent project, the
remaining `blockerOf` graph is provably acyclic, so this can never deadlock.

## 6. Phase contiguity — a hard invariant, not an optimization

**Requirement:** for every project whose demand spans both phases, faza 2 must start in the exact
instant faza 1 ends. `faza 1 → gap → faza 2` must never appear in the output.

`simulateOnce` alone can't guarantee this — whether faza 2's crew is free the instant faza 1 ends
depends on every other project's schedule, which can itself depend on this one's. So
`simulateCapabilitySchedule` wraps `simulateOnce` in a **fixed-point loop**:

1. Run `simulateOnce` with an empty `releaseAt` map.
2. Find every project with a phase gap (`phaseGaps`): faza 2 started later than faza 1 ended.
3. If none, done — return the result.
4. Otherwise, for each gapped project, set `releaseAt[id] = phase1Start + gap` — i.e. push its
   faza-1 floor later by exactly the gap that followed it, so if it re-runs identically it would
   land flush.
5. Re-run `simulateOnce` with the updated `releaseAt` and repeat from step 2.

`releaseAt` is consumed inside `simulateOnce` as a floor on `notBefore()` for phase 1 only (phase
2 drops it — once phase 1 actually starts, contiguity is `simulateOnce`'s own job via gang start).
It is a **floor, not a directive** — gang start, stickiness, backfill, the anti-starvation
reservation, `blockedBy`, and `earliestStart` all still decide whether a phase actually opens, so
a project can end up opening later than its own pushed release if the rest of the backlog
requires it. That's why the loop re-measures the fresh result each round instead of assuming the
gap closed exactly as predicted.

Every push is **monotone** (a project's release only ever moves later), so the fixed point is
reached in a bounded number of rounds — capped at `MAX_CONTIGUITY_ROUNDS = 200` as a safety net;
hitting it marks the result `truncated` rather than returning a schedule with a forbidden gap.

### 6a. Relaxation — cleaning up overshoot after the forward pass

Monotone-only growth is simple to reason about but can overshoot: project A's push can change what
project B actually needs, and by the time that's visible B's own release was already set from an
earlier, since-stale measurement, with no mechanism in the forward pass alone to reconsider it. On
the real seeded backlog (47 projects) this was measured, not hypothetical — see
`contiguityDelayMonths` below — and the overshoot was substantial (hundreds of project-months
total, individual pushes up to ~38 months).

Once the forward pass settles, `relaxReleases` runs one cleanup sweep: for each project the forward
pass pushed, largest release first, it tries dropping the release to zero and re-simulating; if the
whole schedule is *still* fully gap-free, the reduction is kept outright. Otherwise it binary-searches
between "known good" (the original release) and "known bad" (zero) for the smallest value that keeps
every project gap-free, and keeps that. This is a **local** cleanup — order-dependent, not a
re-derivation of the true minimum, and not guaranteed globally optimal — but it directly targets the
overshoot rather than leaving every push exactly as large as its first, worst-case measurement.
Measured against the real backlog, one sweep cut total pushed time by roughly a third (595 → 405
project-months, 42 → 37 projects affected, worst single push 38.2 → 35.5 months). Further rounds of
relaxation, or a smarter (not just largest-first) ordering, would likely close more of the remaining
gap — left as a follow-up rather than done here, per the same "measure before optimizing further"
principle this section itself is an example of.

### 6b. `contiguityDelayMonths` — instrumentation, not a scheduling input

Each `ScheduledProject` carries `contiguityDelayMonths`: how much later its bar starts than in the
very first, `releaseAt`-free pass (the "baseline"). It's computed once, after relaxation, as
`finalStart - baselineStart` per project — a pure diagnostic for watching how much the contiguity
mechanism (forward pass net of relaxation) is actually costing on a given backlog, so a future
change to either can be justified by a before/after measurement instead of a hunch.

Consequences:
- A project whose faza-2 capacity won't be free until later doesn't start faza 1 early and then
  stall — it doesn't start faza 1 at all until doing so lands faza 2 flush.
- `earliestStart` and `blockedBy` can each push a project's feasible window later; contiguity
  still holds on top of whichever is binding.
- A project touching only one phase is never a candidate (`phaseGaps` requires both).
- An impossible project has no phases in the output at all, so it's never a candidate either.

## 7. Output assembly

For each project, per-capability `StreamSchedule`s are built from the merged segments the
simulation recorded, plus `PhaseSpan`s (only for phases with real demand), a rolled-up Gantt bar
(`segments`), and `WaitSpan`s explaining *why* a project isn't progressing at any given moment:

- `blocked` — waiting on `blockedBy`'s overall end,
- `gate` — faza 1 is running but faza 2 can't start yet (only ever spans faza 1's own duration,
  since contiguity now guarantees faza 2 starts the instant faza 1 ends),
- `crew` — the phase can't gang-start (missing minimum on the listed capabilities — this is also
  where a reservation-refused backfill attempt shows up),
- `pool` — the phase is running but under target on the listed capabilities.

## 8. What's deliberately *not* in the scheduler

`plannedStartDate` (management's intended start) and `deadlineDate` (intended finish) are pure
UI markers — the scheduler never reads either. `estimatedStart`/`estimatedFinish` are simply
`sp.startMonths`/`sp.endMonths` from the real simulation. `startDrift` (`lib/planning.ts`) is
computed after the fact, purely for display: `estimatedStart - plannedStart`, unclamped in both
directions, `null` when there's no planned start to compare against. Nothing about a drifted
project changes how it's scheduled — the point is to surface the conflict, not resolve it.
