# Project Planner

A self-hosted project planning tool — a React app and a small Node API server over one SQLite file.
Forty-plus real backlog projects across four categories, T-shirt sized (S–XXL) on a convex effort
scale, scheduled against a real roster of named people split into seven specialised capabilities
(PM, UX, TL, BE, FE, QA, SEC).

## Features

- **Reorderable project list** — drag-and-drop (or arrow buttons) to set the one global backlog
  order every capability schedules against. A project can also carry an **earliest start** (a
  calendar date it cannot begin before, which the scheduler enforces) and a **deadline** (a marker
  the scheduler ignores and the timeline draws).
- **Zespół (team)** — the roster: people grouped into teams (ZWO, ZP, Inni), each splitting their
  FTE across one or more capabilities and carrying their own **productivity** (the share of a
  working day that reaches project work). Pools are the sum of FTE per capability across everyone —
  global, not owned by any project category — and each pool is paced at its own people's
  productivity.
- **Kompetencje (capability matrix)** — the 47×7 grid, three numbers per cell:
  **dni** (effort owed), **sufit** (`maks. obsada` — the most people you would ever usefully put on
  it at once) and **załoga**, the crew the model actually derived, read-only. Seeing `sufit 2` above
  `załoga 1.3` is the shortest explanation of the crew model there is. Whichever capability is pinned
  at its ceiling carries a **▲** and sets the phase's length; every other ceiling is dimmed, because
  raising one is provably a no-op. The footer carries the live horizon, its delta since you opened
  the screen, which capabilities set the most paces, and the capacity floor no ceiling can beat.
  **Propozycje sufitów** runs the ceiling autopilot — see below.
  A new project starts with nothing assigned; its size *suggests* a total, and the days are split
  across capabilities by hand. The row's sum is what actually gets scheduled.
- **Category timeline** — a summary card on the main page: each category's real span, derived from
  the full schedule, not a separate per-category queue.
- **Full-screen comparison timeline** — one row per capability plus a "cała praca" (whole plan) row
  run through the real phase-gated simulation, so multiple staffing variants (warianty) can be compared
  side by side.
- **Advanced timeline** — one bar per project, split visually into **faza 1 (inicjacja)** — 20% of PM
  and TL effort plus all UX — and **faza 2 (wytwarzanie)** — BE/FE/QA/SEC plus the remaining 80% of
  PM and TL, spread across phase 2. Phase 2 cannot start before phase 1 finishes, and initiation is
  deferred so the two run back to back rather than leaving a hole in the bar. Hovering a bar opens a
  breakdown of the effort/FTE/duration arithmetic per capability. A bottom band, **wykorzystanie
  zdolności**, shows per-capability utilisation and idle FTE across the whole timeline — the view
  that answers "which specialisation is actually the constraint".
- **Obsada** — three linked screens behind one button, layering *named people* over the
  capability-pool plan. **Ludzie**: one band per person whose full height is 100% of their
  availability, split between whatever projects are live and hatched where it is free, with leave
  drawn across it. **Projekty**: one row per project, a lane per assigned person and one hatched
  lane for whatever the plan still asks for and nobody covers. **Obsadzanie**: a queue of unstaffed
  demand and, for the selected item, the candidates ranked by fit — capability match, free capacity,
  leave in the window, and how many projects they already carry. Clicking any bar or gap on either
  timeline opens the panel on exactly that hole. See "Obsada is a layer, not an input" below.

## Scheduling model

Capacity is **global per capability**, not owned by a project category (categories are a display
grouping only). Every project draws from up to seven independent pools in one shared backlog order.
The whole thing is an event-driven simulation in `src/lib/scheduling.ts`
(`simulateCapabilitySchedule`), covered by `src/lib/scheduling.spec.ts`.

### Effort: one source of truth

A project's T-shirt size is a **reference figure only** (`referenceEffortDays`). Nothing in the
scheduler reads it — the plan is built entirely from the capability matrix, so the matrix is the
source of truth for effort. The size is how you arrive at a row and what you check it against
afterwards: `effortDrift` compares the two and the UI warns, without blocking, when they disagree by
more than a tenth of the reference. Blocking would make the matrix unusable, since a row is filled
one capability at a time and is legitimately short of its size while being edited.

### Phases

Each project runs **faza 1 (inicjacja)** before **faza 2 (wytwarzanie)**, and phase 2 cannot begin
until every phase-1 stream has finished.

PM and TL straddle both: 20% of their effort sits in faza 1, the remaining 80% in faza 2. UX belongs
entirely to faza 1, and BE/FE/QA/SEC entirely to faza 2.

### The crew model: a phase is a team, not a set of streams

A cell's FTE figure is a **ceiling** — the most people you would ever usefully put on that capability
at once, which is a property of the work and answerable while looking at one project. Nothing runs at
it unless it happens to be the constraint.

Each phase derives its own crew (`src/lib/crew.ts`). Whichever capability hits its ceiling first
cannot go faster, so it sets the phase's length; every other capability's FTE is then *derived* to
finish alongside it:

```
phase length   = max over capabilities of  days ÷ (ceiling × rate)
each crew FTE  =                           days ÷ (phase length × rate)
```

So the team starts together and finishes together. Nobody sprints ahead and trickles off, leaving one
capability holding a project open on its own — the "lonely tail" the previous stream-per-capability
model produced (6.7 project-months of it across a 12-project plan, all of it PM). Effort is conserved
exactly; only its shape is smoothed.

**The one exception** is a capability whose derived FTE would fall below `minCrewFte`: four days of
security review across a five-month build is 0.06 FTE, which describes nothing real. Those run as a
short burst at the floor and finish early — the only place a stream may end before its phase does.

The pace-setter is the honest answer to "why does this take this long", and the only cell worth
raising to go faster. Raise it far enough and the constraint moves to another capability, at which
point adding people stops helping — which is exactly when to stop.

*(This replaced a model where each capability ran flat out at a typed target and finished whenever
its own work ran out, with TL's phase-2 share a special-cased "residue" paced to trickle alongside
the build. Deriving every capability's crew from the phase does that job for all seven at once, so
the special case — and its corollary that a project with no phase-2 crew had to fold its residue back
into phase 1 — is gone.)*

### Allocation

Three rules shape it, and together they guarantee a phase runs without gaps once begun:

1. **Gang start.** A phase doesn't open until *every* capability it demands can be staffed at
   `crewFte × minStaffingFraction` simultaneously. A phase that can't be staffed takes nothing
   rather than starting a couple of streams and stalling; the capacity cascades to the next project
   that *can* open.
2. **The crew moves as one.** Short of capacity, the whole team scales by a single common factor and
   the phase simply takes proportionally longer. A well-supplied capability does not sprint ahead of
   a starved sibling — that would pull the phase's streams apart again, which is the exact thing the
   derivation exists to prevent. Top-ups are uniform too.
3. **Sticky, non-preemptive holds.** Once a phase opens, each stream holds its FTE until it
   completes. A higher-ranked project arriving later draws only on genuinely free capacity.

Rank still dominates — each slice walks the backlog in order — and the highest-ranked project that
fails its crew test reserves the minimum it needs, so it can't be starved forever by smaller projects
slipping in ahead of it.

### Contiguity: waiting happens *before* a project, not inside it

A project that must wait for a build crew would otherwise finish initiation early and stall
mid-flight, leaving a hole in its bar. Instead, initiation is deferred so it ends where phase 2
begins. The waiting is conserved — pools are finite, so finish dates barely move — but a bar with a
hole says "started, now stuck" while a later start says "not started yet", which is both easier to
read and the honest instruction: there's no point tying up PM, UX and TL months before anyone can
build on their output.

Deferring isn't free — initiation moved later lands in a different window, and deferring everything
at once piles several initiations together and pushes the plan out — so each attempt is re-simulated
in full. The search tries the whole set, then **bisects on failure**, adopting a batch only if it
reduces stalling and keeps the horizon inside `CONTIGUITY_HORIZON_TOLERANCE`. A surviving gap is
therefore information: that project's initiation genuinely cannot slide without delaying something
else.

### External constraints

- **`earliestStartDate`** is hard. The project draws from no pool until that calendar date — it
  gates both phases, not just initiation. Unlike every other wait in the model this one is not ours
  to optimise, so it is never traded away: where it and the contiguity deferral disagree, the later
  wins. `src/lib/calendar.ts` converts calendar dates to the scheduler's fractional month offsets at
  a single edge; the scheduler itself never sees a date.
- **`deadlineDate`** is purely a marker. Nothing in the scheduler reads it. The timeline draws it
  and flags a project that lands past it, so a date the plan cannot meet is visible rather than
  quietly planned around.
- **`blockedBy`** holds a project — both phases — until its blocker's overall end. A blocker that
  never finishes makes everything behind it impossible too, transitively.

### Reading the output

Effort and duration are expressed in **days and FTE**, never person-months. One equation carries the
whole model:

```
nakład ÷ (FTE × produktywność) = dni robocze
```

Productivity is the only conversion — a person on the job for one working day delivers only their
own share of a day of the estimate, the rest going to meetings, support duty and context switching.
It is set **per person** in Zespół, so it differs by capability: `effectiveDaysByCapability` takes
the FTE-weighted mean productivity of the people staffing each one, and that becomes the rate the
scheduler paces that pool against.

Note where the haircut lands. It scales the **rate**, never the pool: a pool is compared against each
phase's derived crew and both count people, so rescaling a pool of 2 BE into "1.4 productive BE"
would fail the crew test against a crew of 2 and stall the phase for a reason nobody modelled.
Slowing the rate says the honest thing instead — the same two people are on the job, getting through
less of it per month. Every FTE figure in the UI is therefore plain headcount.

Hovering a bar opens a two-column breakdown (faza 1 / faza 2) showing, per capability, the effort
owed, the FTE on it and the working days that therefore takes, so every row on the chart can be
checked by eye.

## The ceiling autopilot

`src/lib/autopilot.ts` finds the handful of `maks. obsada` cells worth raising. It is small for a
reason that falls out of the crew model rather than out of any cleverness: in a phase every
capability finishes on the same day, so only the one pinned at its ceiling is flat out. The rest are
deliberately de-rated to stay in formation, and raising a ceiling they are already under does
nothing. That leaves roughly **one live candidate per phase instead of one per cell** — and the
moment you raise it, the pace moves elsewhere, which is both the next candidate and the natural
stopping condition. On the real backlog it goes 15.6 → 10.6 months by changing twelve numbers out
of seventy-four, in about two hundred simulations.

Three things about it are deliberate:

- **It proposes, never applies.** Every move is the machine asserting "more people could usefully
  work on this" — a claim about the world it cannot check, having seen neither the codebase nor the
  onboarding cost nor whether the work splits at all. It only knows which cell the arithmetic is
  leaning on. Each move is accepted or rejected on its own, with a live preview, and nothing is
  written until you confirm.
- **It never proposes past the pool.** Beyond it the phase's minimum crew exceeds what exists, the
  project is judged `min-above-pool` and drops out of the plan entirely — a cliff, not a trade-off.
  The blocked list is the more useful half of the output once the easy moves are gone: *"UX — pula 1
  FTE, 7 projektów czeka i nie ma kogo dołożyć"* is the actual answer to why the plan is not shorter.
- **It reports moves that would make things worse**, rather than silently skipping them. Past a
  point a bigger crew needs more people simultaneously free before its phase may open, so it queues
  longer than it builds faster. Worth reading.

The objective is lexicographic: a move that shortens the whole plan always wins, and failing that
one that finishes its own project sooner at no cost to the horizon is still taken. Without that
second tier the search stalls the moment two projects are tied for last — which on a real backlog
is most of the time, since no *single* move shortens the plan and a horizon-only rule declares
victory with months still on the table.

`capacityFloor` is the backstop under any proposal: each capability's whole effort divided by its
own pool running flat out. Nothing about ceilings can beat it, so it is what turns "we got you to
10.6" into "…and 8.2 is a wall made of one UX person".

The search runs a couple of hundred full re-simulations and takes seconds, so it is stepped one
round at a time with the frame handed back in between (`createSearch` / `stepSearch`). Run in a
single burst it freezes the tab hard enough that the spinner announcing the wait never paints.

## Obsada is a layer, not an input

The scheduler plans in **pools**: two BE, one UX, four PM. It never asks which two backends, and
that is deliberate — a plan that depended on named individuals would be re-derived every time
somebody changed team. Obsada (`src/lib/staffing.ts`, `src/components/obsada/`) is the layer on
top that answers *which*, and the arrow only points one way: it reads `simulateCapabilitySchedule`'s
output and never feeds back into it. **Assigning a person cannot move a date.**

That constraint is what makes the screens honest. A gap in Obsada does not mean the plan is wrong;
it means the plan has capacity nobody has put a name against yet.

- A **demand item** is one project × one capability — the same key a `StaffingAssignment` carries.
  PM and TL straddle both phases at different crews, and those are unioned into one item rather
  than split: an assignment has no phase, the phases run back to back, and "Tomasz on PM for ACMS"
  is one decision. The FTE step between the phases survives as a step in the item's required curve.
- **Coverage reads at the thinnest moment.** Somebody covering half the window has not covered the
  window, and an average would report them as "a bit short throughout" rather than "gone from
  October". So `wymagane − obsadzone = brakuje` holds as arithmetic, all three taken at the worst
  instant.
- **Shortfall never nets across capabilities.** A spare backend does not fill a missing PM. The
  pools are separate in the scheduler, so the per-project gap sums only the positive part of each
  capability's own shortfall.
- **A person's band is scaled to their availability**, not to a whole person: someone at 0.5 FTE
  carrying 0.25 is half spoken for. An over-committed band is scaled to its own peak so the
  overflow shows instead of clipping, and the 100% line then sits inside the band.
- **Leave crosses assignments rather than shortening them** — the bar stays whole, so a holiday in
  the middle of a posting stays visible as a risk. But it is not only ink: on leave days the person
  counts as absent, so coverage drops, a gap opens under the crossed bar, and their free capacity
  shrinks by the days away. The plan itself feels it too — `lib/leaves.ts` folds leaves into the
  monthly pool the scheduler draws from, so a team's absences genuinely push project ends out.
- `MAX_PARALLEL_PROJECTS` (4) is **flagged, never enforced**. A real week sometimes has five, and a
  tool that refuses to record that has stopped describing the team.

## Stack

React + TypeScript + Vite on the front, and a small Node API server (`server/`) that owns a SQLite
file via better-sqlite3. The frontend holds no database of its own: `src/db/httpRepo.ts` is the only
implementation of `PlannerRepository`, and `src/db/repository.ts` is the contract between the two.

## Getting started

```bash
npm install
npm run dev      # API on :5174, app on :5173 (Vite proxies /api to the API)
```

## The database

One file: **`data/planner.sqlite`**, gitignored, created and migrated on first boot. It is the whole
persistence story — no in-memory copy to write back, nothing keyed to a browser origin or profile.
Two people pointing at the same server see the same plan, and clearing browser data does nothing.

Inspect it with the normal tools, no export step:

```bash
sqlite3 data/planner.sqlite "SELECT name, category FROM projects LIMIT 5;"
cp data/planner.sqlite backup.sqlite     # a backup is a file copy
```

Schema lives in `server/schema/`, applied in order by `server/migrations.ts` and tracked with
`PRAGMA user_version`. **Never edit a migration that has run** — append `schema_v12.sql` and add it
to the list, or the change silently won't apply to a database already past that version.

Reseeding is deliberate and never happens on boot, so a restart cannot cost you work:

```bash
npm run db:reset          # prompts before deleting
npm run db:reset -- -f    # no prompt
```

Point a throwaway server at a scratch file with `PLANNER_DB=/tmp/x.sqlite npm start`.

## Build

```bash
npm run build
npm start        # one process: serves dist/ and the API on :5174
```

## Test

```bash
npm run test
```
