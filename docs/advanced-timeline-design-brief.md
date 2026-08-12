# Advanced timeline — design brief

A brief for redesigning one screen of an internal capacity-planning tool. It describes what the
screen is for, what it must communicate, and how it behaves. It deliberately contains no
measurements, colours, or type choices — those are yours to decide. The current implementation is
functional and unstyled; treat any "currently" note as the thing being replaced, not a target.

> **Updated for the specialised-FTE model.** This brief predates the migration from one integer
> headcount per project *category* to seven named capability pools (PM, UX, TL, BE, FE, QA, SEC)
> scheduled globally, with each project phase-gated (faza 1 inicjacja → faza 2 wytwarzanie). The
> **Vocabulary** and **Schedule** sections below have been corrected to match; the rest of the brief
> (structure, interaction, constraints) still holds with "category" read as "capability" wherever a
> pool or a queue is being described, and "category" kept only where it means the display grouping.
>
> **Updated again for absolute effort days.** A capability's share of a project used to be entered
> as a percentage of the whole that had to sum to 100 — that mix percentage, and the category
> presets that seeded it, are gone. A capability's share is now entered directly in effort days, and
> the row should sum to what the project's t-shirt size implies, not to 100. The **Mix** vocabulary
> entry below has been corrected to match.
>
> **Updated again for the scheduling model as it now stands.** Four changes, all of which alter what
> the screen has to show: TL joined PM in straddling both phases (20/80, not "all of TL in faza 1");
> a phase no longer starts under-strength and speeds up — it gang-starts and holds; initiation is
> deferred so a project's two phases run back to back, which moves waiting *in front of* the bar
> instead of inside it; and projects can now carry external calendar constraints. The **Phase**,
> **Schedule**, **Mix** and **Project** vocabulary entries, the exception states in *What has to be
> communicated*, and *Interaction* have been corrected. The rest of the brief still holds.

## The problem the screen solves

A team has a fixed number of people, split into a few permanent categories. There's an ordered
backlog of projects. The planner wants to answer two questions: **when does all this land**, and
**where are we wasting people**.

The screen is a full-window view opened from the main project list. It has a simple mode (one row
per category, projects queued end to end) and an **advanced mode**, which is what this brief covers.

## Vocabulary you need to read the screen

- **Project** — has a name, belongs to exactly one category (display grouping only — see below),
  and carries a size estimate on a five-step t-shirt scale from smallest to largest (S–XXL). The size
  is a **reference only**: it suggests a total effort in days, but nothing is scheduled from it. What
  gets scheduled is the mix (below). A project may also carry calendar markers: an **earliest start**
  (hard — the scheduler gives the project nothing from any pool before it), a **deadline** (soft —
  purely a marker the scheduler ignores), and a **planned start** (soft, same spirit as the deadline
  — management's intended start, which the scheduler also ignores entirely). The gap between planned
  start and the scheduler's actual computed start is the **start drift** — see `lib/planning.ts` —
  drawn on the timeline so a conflict between intent and capacity is a visible fact, not something
  quietly absorbed.
- **Category** — a fixed, small set of groups (Projekty, Procesy/Procedury, Zespół, AI), used only
  to band rows together on screen. Categories own no capacity — see Capability.
- **Capability** — one of seven fixed specialisations: PM, UX, TL, BE, FE, QA, SEC. Each has its own
  **global pool**, summed from the availability of every person with that capability on the roster
  (Zespół screen). Pools are shared across the whole backlog, not owned by any category.
- **Mix** — the effort, in days, that belongs to each capability for a given project (Kompetencje
  screen, "dni nakładu"). 0 means that capability isn't needed. **This is the only effort the
  schedule is built from.** The row should sum to what the project's size implies; the screen warns,
  but does not block, when it has drifted materially from it. A new project starts with nothing
  assigned — there is no preset to seed it.
- **Target** — the concurrent FTE of a capability the scheduler tries to run on a project at once
  ("docelowe FTE"). Under-served when the pool is short, exactly like the old single-number
  assignment — except now there's one target per demanded capability, not one per project.
- **Variant** — a named staffing scenario: how much FTE each capability has. Several exist at once;
  the planner switches between them to compare, and can create, rename, edit and delete them. One
  variant ("obecny zespół") is derived live from the roster rather than entered by hand.
- **Phase** — every project runs through **faza 1 (inicjacja)** before **faza 2 (wytwarzanie)**, and
  phase 2 cannot start until every phase-1 stream has finished. PM and TL straddle both: 20% of each
  sits in faza 1, the remaining 80% is spent in faza 2. UX is entirely faza 1; BE/FE/QA/SEC entirely
  faza 2. So faza 1 is now a *short* head on most bars, not a substantial block. The 20/80 split only
  decides *where* PM's and TL's effort is performed — it carries no other special scheduling meaning
  for PM, whose faza-2 80% behaves exactly like BE/FE/QA/SEC (see **Schedule**). TL's faza-2 80% is
  the one exception — see **Residue**.
- **Residue** — the 80% of TL that lives in faza 2. It is not a crew: it doesn't have to be present
  for the phase to begin, it can run intermittently, and it paces itself off the project's other
  live phase-2 streams (BE/FE/QA/SEC and PM) so it lands alongside them. Worth distinguishing on
  screen from a real stream, because "0.27 FTE of TL smeared across five months" and "one TL for
  five months" are different things. PM's faza-2 80% is *not* a residue — it is a normal stream.
- **Schedule** — computed, not entered. Capacity is allocated in backlog order, but a phase is
  **all-or-nothing**: it doesn't open until every capability it needs can be staffed at its minimum
  simultaneously, and once open each stream **holds** its people until that stream finishes. A
  later, higher-ranked project cannot take them back. So a project no longer starts short-handed and
  speeds up — it waits, then runs steadily. PM's faza-2 share is a full participant in this: it joins
  the faza-2 crew check, is held once staffed, and releases its people when its own effort is done.
  Only the TL residue is exempt from both rules.
- **Contiguity** — a project's faza 2 always picks up in the exact instant its faza 1 ends. This is a
  hard rule, not a layout nicety: a project that cannot immediately follow initiation with a build
  crew does not start initiation yet at all — it waits, whole, until both phases can run back to
  back. So waiting always shows up as a **later start**, never as a hole partway through a bar. This
  matters for the design: bars are always solid, and *all* of the interesting empty space is to the
  *left* of a bar, never inside it — there is no "gap that survives" state to design for.

## What someone must be able to do here

1. See when each project runs and when it finishes.
2. See **why it doesn't start sooner** — barred by a date, held behind another project, or simply
   queued behind higher-ranked work. Since waiting now sits in front of bars rather than inside them,
   this is where most of the plan's meaning lives.
3. See which projects are running at the same time.
4. Tell, at a glance, whether a project is running with everyone it was promised or with fewer.
5. Spot people sitting idle, and know when and how many.
6. Follow the people released by a finishing project to the project that absorbs them.
7. Compare scenarios by switching variants and watching the whole chart respond.
8. Change a project's target FTE in place, and see the consequence immediately.
9. Check the arithmetic behind any bar without leaving the screen.

## Structure that exists today

- A header carrying the view's title, the variant switcher, an entry point to edit variants, the
  advanced-mode toggle, and a close action.
- A **time axis** in months running left to right, marked at every month with stronger marks at
  half-year intervals. It stays visible while scrolling down.
- **One row per project**, ordered by whichever starts first, grouped into bands by category. The
  vertical axis is not a quantity — it is simply an ordered list of projects.
- Two **pinned identity columns** on the left, which stay put while the chart scrolls sideways: the
  category (with its headcount, its total duration, and any warning) and the project (its name plus
  a short numeric id). The project column can be resized by dragging, and collapsed down to ids
  alone when the planner wants more room for the chart.
- A **bar per project**, positioned and sized along the time axis.

## What has to be communicated

Each item below is a requirement, followed by how it happens to be done now. Re-encode freely as
long as the information survives and the encodings stay distinguishable from one another.

1. **Position and duration in time.** Bar placement and length along a single shared axis. This one
   is fixed — it's a Gantt chart.
2. **How big the work is.** The five-step size estimate (S–XXL). Currently the bar's fill colour,
   stepping through a single ramp. Note this is the *reference* size, which the scheduled effort can
   legitimately have drifted from — see **Size drift** below.
3. **Staffing over time.** Whether a project has everyone assigned to it, or a fraction, and *when
   that changes*. Currently the bar's height: a project at full assigned strength fills its row, a
   project running with half its people stands half as tall, so a bar that gains people over its
   life is a staircase rising to full height. The moment of change is meaningful and should be
   legible. Note the staircase now only ever goes *up*: a stream cannot open below its minimum, and
   once open it never loses people again — so the encoding needs to express "short-handed, then
   topped up", never "short-handed, then robbed".
4. **The actual numbers.** The headcount currently working on each project, printed on each
   staffing step, and the category's total headcount.
5. **Idle capacity.** Stretches where a capability's pool is bigger than the running projects asked
   for, so people have nothing to do. It belongs to a *capability over a time range* (not to a
   category, and not to any one project), and it needs quantifying — when it starts, how much FTE,
   and how much is lost overall, per capability. This is what the "wykorzystanie zdolności" band
   answers.
6. **Capacity hand-off.** When a project finishes its use of a capability and that FTE joins a
   project that was running short on the *same* capability, show that it moved, how much, from
   where, to where, and at what moment. The arrival point matters: FTE can join at another project's
   start or partway through its run. Note it is deliberately *not* shown when a project simply
   starts at full strength — that's a project beginning, not a rescue.
7. **Exception states**, all of which need to be tellable apart from each other and from a normal
   bar:
   - **Over-committed** (`isOverTarget`) — some capability's target exceeds its pool, so that stream
     can never run at full strength; the project still finishes, just slower than its target implies.
   - **Impossible** (`isImpossible`) — some demanded capability has no pool at all, or a target of
     zero, so the project never finishes. Named per capability, not a single flag.
   - **Gated** — in faza 1, with faza-2 work waiting behind it. Intrinsic to the model, not a warning
     — draw it, don't flag it.
   - **Pool-waiting** — a live stream funded below its target this instant. This is the warning that
     replaces the old single "waiting" state, and it names which capabilities are responsible.
   - **Size drift** — the mix no longer sums to anything like what the project's size implies, so the
     bar is honest but the size label is not. A property of the row's identity, not of its position
     in time.
8. **External constraints on the time axis.** Two, and they must not read alike, because one is a
   fact about the world and the other is a wish:
   - **Earliest start** — the project cannot begin before this month. It is a wall the bar is behind;
     the space to its left is not the plan's fault and no amount of hiring shortens it.
   - **Deadline** — a marker only. Nothing schedules around it. It needs a clearly different state
     for "the plan lands past this", since that is the entire reason for drawing it.
9. **Why a project starts when it does.** With waiting moved in front of bars, the gap before a bar
   is now carrying most of the story, and it has three quite different causes that currently look
   identical: barred by an external constraint, held behind a blocking project, or simply queued
   behind higher-ranked work competing for the same people. Only the third is something the planner
   can act on by re-ordering; only the second by re-scoping. Distinguishing them is the single
   biggest gap in what the screen communicates today.

## Interaction

- **Click a bar** → a small popover appears near the pointer to set the target FTE per capability for
  that project. The chart updates underneath as soon as a number is picked.
- **Hover a bar** → a breakdown panel opens: two columns, faza 1 and faza 2, listing per capability
  the effort owed, the FTE on it, and the working days that therefore takes, plus the waiting in
  front of each phase. Everything is in **days and FTE** — never person-months — and every row is the
  same equation, `nakład ÷ (FTE × focus) = dni robocze`, so the chart can be checked by eye rather
  than taken on trust. It is read-only and must not intercept the pointer.
- **Hover a bar, or its row in the name column** → both highlight together. They can be far apart
  horizontally, and connecting them matters.
- **Resize or collapse** the project name column, by dragging its edge or via a control.
- **Switch variants** from the header; **edit them** in a modal holding the list of variants and,
  for the selected one, its name and per-capability FTE, plus create and delete.
- **Escape** backs out one layer at a time: popover, then modal, then the whole view.

## The shape of the data

Design against this, don't hardcode it:

- A handful of categories; on the order of fifty projects, so up to roughly fifty rows.
- A horizon of several years, with content many screens wide at a comfortable zoom.
- Capability pools are small — a single person up to a handful. One of them is usually *the*
  constraint on the whole plan, and the screen exists largely to make that obvious.
- **Bar durations vary by more than an order of magnitude.** At a zoom where the longest project is
  comfortable, the shortest is a sliver — it still has to be visible, identifiable and clickable.
- Some categories have no assignments at all: a plain queue with no staffing variation, no idle
  band, no hand-offs.
- Names range from two words to long ones that won't fit a sensible column width.

## Where it falls short today

This is why you're being asked. Specifics, so you know what to solve:

- It reads as a debug view. Everything is a flat rectangle of the same weight, and nothing
  establishes a hierarchy between a bar, its numbers, the idle band and the arrow — they all compete
  equally for attention.
- Too many unrelated meanings live in the same warm colour family: the size ramp, the idle hatch and
  the exception outline all shout at once, and a viewer has no reason to connect or separate them.
- The idle band spans the full height of a category, including rows where nothing is happening, so
  it reads as a blocked-out region rather than as spare people.
- Nothing explains any of it. There is no legend or key: a first-time viewer cannot know that height
  means staffing, that the hatch means idleness, or what the arrow is doing.
- The numbers are small and easy to miss, which leaves the viewer estimating staffing by eyeballing
  proportions.
- Vertical rhythm is loose. One project per row leaves the chart mostly empty, and the grouping into
  categories is carried by a hairline and nothing else.
- The header plus two pinned columns consume a lot of the window before any data appears.
- Edge cases are unconsidered: a category with nothing in it, a bar too narrow to hold its label, a
  name too long for its column, a plan with no assignments anywhere.

## Constraints

- React with plain CSS. **No external assets of any kind** — no CDN, no web fonts, no remote images.
  Everything must be self-contained: CSS, and inline SVG if you need drawing.
- Must work in **both light and dark**. The app follows the OS setting and already keeps a token set
  for each; a redesign should keep working through tokens rather than fixed values.
- The time axis must stay pinned while scrolling vertically, and the identity columns pinned while
  scrolling horizontally. Both directions are used constantly.
- Everything drawn on the chart is positioned from one pixels-per-month scale. Anything you add that
  sits on the time axis has to be placed from that same scale, so it stays aligned at any zoom.
- Performance is not a concern at this size — the design can afford per-element decoration.
- No additional data exists. Whatever you show has to come from what is listed above.

## What must not be lost

- One project per row, ordered by whichever starts first.
- Duration and overlap readable along a single shared time axis.
- External constraints placed on the same axis as the bars, so a project and its deadline can be
  compared without arithmetic.
- Staffing level, and the moments it changes, visible without opening anything.
- Idle capacity attributable to a specific category and time range, with numbers.
- Immediate feedback in the chart when an assignment changes.
