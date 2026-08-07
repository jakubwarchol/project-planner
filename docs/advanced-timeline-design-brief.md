# Advanced timeline — design brief

A brief for redesigning one screen of an internal capacity-planning tool. It describes what the
screen is for, what it must communicate, and how it behaves. It deliberately contains no
measurements, colours, or type choices — those are yours to decide. The current implementation is
functional and unstyled; treat any "currently" note as the thing being replaced, not a target.

## The problem the screen solves

A team has a fixed number of people, split into a few permanent categories. There's an ordered
backlog of projects. The planner wants to answer two questions: **when does all this land**, and
**where are we wasting people**.

The screen is a full-window view opened from the main project list. It has a simple mode (one row
per category, projects queued end to end) and an **advanced mode**, which is what this brief covers.

## Vocabulary you need to read the screen

- **Project** — has a name, belongs to exactly one category, and carries a size estimate on a
  five-step t-shirt scale from smallest to largest. The estimate is the only measure of how big the
  work is; everything else is derived from it.
- **Category** — a fixed, small set of groups. Each has its own pool of people. People never move
  between categories.
- **Variant** — a named staffing scenario: how many people each category has. Several exist at once;
  the planner switches between them to compare, and can create, rename, edit and delete them.
- **Assignment** — how many people the planner puts on a specific project. Set per project, and the
  same number applies across every variant.
- **Schedule** — computed, not entered. Projects in a category compete for that category's people in
  backlog order: the first takes what it asked for, the next takes what's left, and so on. A project
  can therefore start short-handed and speed up later, when an earlier project finishes and releases
  people. Only an unbroken run of assigned projects at the front of a category's queue takes part;
  an assigned project sitting behind an unassigned one waits its turn instead.

## What someone must be able to do here

1. See when each project runs and when it finishes.
2. See which projects are running at the same time.
3. Tell, at a glance, whether a project is running with everyone it was promised or with fewer.
4. Spot people sitting idle, and know when and how many.
5. Follow the people released by a finishing project to the project that absorbs them.
6. Compare scenarios by switching variants and watching the whole chart respond.
7. Change a project's people count in place, and see the consequence immediately.

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
2. **How big the work is.** The five-step size estimate. Currently the bar's fill colour, stepping
   through a single ramp.
3. **Staffing over time.** Whether a project has everyone assigned to it, or a fraction, and *when
   that changes*. Currently the bar's height: a project at full assigned strength fills its row, a
   project running with half its people stands half as tall, so a bar that gains people over its
   life is a staircase rising to full height. The moment of change is meaningful and should be
   legible.
4. **The actual numbers.** The headcount currently working on each project, printed on each
   staffing step, and the category's total headcount.
5. **Idle capacity.** Stretches where a category has more people than the running projects asked
   for, so people have nothing to do. It belongs to a *category over a time range*, not to any one
   project, and it needs quantifying — when it starts, how many people, and how much is lost
   overall. Currently a hatched band across the category plus a warning line in the category column.
6. **Capacity hand-off.** When a project finishes and its people join a project that was running
   short-handed, show that people moved, how many, from where, to where, and at what moment. The
   arrival point matters: people can join at another project's start or partway through its run.
   Currently a plain arrow. Note it is deliberately *not* drawn when a project simply starts at full
   strength — that's a project beginning, not a rescue.
7. **Exception states**, all of which need to be tellable apart from each other and from a normal
   bar:
   - **Over-committed** — assigned more people than its category actually has, so it can never run
     at full strength. Arises when a variant's headcount is lowered, or when an assignment made
     under a larger variant is viewed under a smaller one.
   - **Waiting** — assigned, but queued behind an unassigned project, so the assignment isn't in
     force yet.
   - **Category running the multi-project schedule at all** — as opposed to a plain queue.

## Interaction

- **Click a bar** → a small popover appears near the pointer to set how many people work on that
  project, or clear it. The choices are bounded by the category's headcount. The chart updates
  underneath as soon as a number is picked.
- **Hover a bar, or its row in the name column** → both highlight together. They can be far apart
  horizontally, and connecting them matters.
- **Resize or collapse** the project name column, by dragging its edge or via a control.
- **Switch variants** from the header; **edit them** in a modal holding the list of variants and,
  for the selected one, its name and per-category headcounts, plus create and delete.
- **Escape** backs out one layer at a time: popover, then modal, then the whole view.

## The shape of the data

Design against this, don't hardcode it:

- A handful of categories; on the order of twenty projects, so up to roughly twenty rows.
- A horizon of a couple of years, with content several screens wide at a comfortable zoom.
- Category pools range from a single person to low double digits.
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
- Staffing level, and the moments it changes, visible without opening anything.
- Idle capacity attributable to a specific category and time range, with numbers.
- Immediate feedback in the chart when an assignment changes.
