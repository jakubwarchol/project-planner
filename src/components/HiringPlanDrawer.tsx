import { X } from "lucide-react";
import type { HiringLadderApi } from "../hooks/useHiringLadder";
import { CAPABILITY_LABELS, CAPABILITY_ORDER } from "../lib/estimation";
import type { CeilingMove } from "../lib/autopilot";
import type { LadderRung } from "../lib/hirePlusCeilings";
import type { BlockedHire, CapabilityCaps, PlanScore } from "../lib/hiringPlanner";
import type { Capability, CapabilityVector } from "../types";
import { fmt, fmt2, plCount, weeksOf } from "./timelineChrome";

interface HiringPlanDrawerProps {
  ladder: HiringLadderApi;
  baselineLabel: string;
  baselineFte: CapabilityVector;
  /** Horizon with unlimited people — hiring's hard floor. Null when it
   *  cannot be computed (empty plan, or something stays impossible). */
  hiringFloorMonths: number | null;
  /** Header/footer heights vary with the density control, unlike cm2's fixed
   *  chrome — so the drawer takes its vertical bounds from the screen. */
  insets: { top: number; bottom: number };
  caps: CapabilityCaps;
  onCapsChange: (caps: CapabilityCaps) => void;
  onApplyRung: (rung: LadderRung) => void;
  projectNameOf: (id: string) => string;
  onClose: () => void;
}

/**
 * "If we hired N people, what would it buy?"
 *
 * One list, one story: each row is a hire count with the work already re-cut
 * for that team (rung 0 is today's team, work re-cut, nobody hired). There
 * used to be a second, hires-only mode; it answered a question nobody asks —
 * when you hire, you let the new people onto the work — and having two tabs
 * of overlapping numbers cost more confusion than the conservative floor it
 * showed was worth. The details a PM does not need up front (which exact
 * ceilings move, team-size limits) live in tooltips and a collapsed section.
 */
export function HiringPlanDrawer({
  ladder,
  baselineLabel,
  baselineFte,
  hiringFloorMonths,
  insets,
  caps,
  onCapsChange,
  onApplyRung,
  projectNameOf,
  onClose,
}: HiringPlanDrawerProps) {
  return (
    <aside
      className="atl-drawer"
      style={{ top: insets.top, bottom: insets.bottom }}
      aria-label="Plan zatrudnienia"
    >
      <header className="atl-drawer-head">
        <div className="atl-drawer-title">
          <b>Plan zatrudnienia</b>
          <span className="atl-drawer-sub">co kupi każdy kolejny etat · {baselineLabel}</span>
        </div>
        <button
          type="button"
          className="atl-drawer-close"
          onClick={onClose}
          aria-label="Zamknij plan zatrudnienia"
        >
          <X size={15} />
        </button>
      </header>

      {ladder.status === "idle" && (
        <div className="atl-drawer-body atl-opt-intro">
          <p>
            Policzę, co kupi każdy kolejny etat — od zera do siedmiu — razem z najlepszym
            pokrojeniem pracy dla każdego z tych zespołów. Każdy wiersz wyniku to prawdziwy,
            policzony harmonogram całego portfela.
          </p>
          <FloorNote floor={hiringFloorMonths} />
          <div>
            <button type="button" className="atl-primary" onClick={ladder.run}>
              Policz
            </button>
          </div>
          <p className="is-muted">
            Nic się nie zapisze — wybrany wiersz trafia do nowego wariantu, obok obecnych.
          </p>
          <AdvancedCaps caps={caps} baselineFte={baselineFte} onCapsChange={onCapsChange} />
        </div>
      )}

      {ladder.status === "running" && (
        <div className="atl-drawer-body atl-opt-intro">
          <p>
            Liczę… {plCount(ladder.solved, "wiersz gotowy", "wiersze gotowe", "wierszy gotowych")} ·{" "}
            {ladder.simulations} symulacji
          </p>
          <div>
            <button type="button" className="atl-btn" onClick={ladder.cancel}>
              Przerwij
            </button>
          </div>
        </div>
      )}

      {ladder.status === "ready" && ladder.result && (
        <>
          <div className="atl-drawer-body">
            {ladder.stale && (
              <p className="atl-opt-stale">
                Dane zmieniły się od ostatniego liczenia — policz jeszcze raz.
              </p>
            )}

            <div className="atl-opt-summary">
              <div className="atl-opt-sum-row">
                <span>dziś, bez żadnych zmian</span>
                <b>{fmt(ladder.result.base.horizonMonths)} mies.</b>
              </div>
              {ladder.result.base.score.impossible > 0 && (
                <div className="atl-opt-sum-row is-warn">
                  <span>projekty bez końca</span>
                  <b>{ladder.result.base.score.impossible}</b>
                </div>
              )}
              <FloorRow floor={hiringFloorMonths} />
            </div>

            <div className="atl-opt-section">
              <span className="atl-eyebrow">ile etatów, tyle planu</span>
              {worthwhileRungs(ladder.result.rungs, ladder.result.base.score).map((rung) => (
                <RungRow
                  key={rung.hires}
                  rung={rung}
                  baseHorizon={ladder.result!.base.horizonMonths}
                  disabled={ladder.stale}
                  projectNameOf={projectNameOf}
                  onApply={() => onApplyRung(rung)}
                />
              ))}
            </div>

            <BlockedReport blocked={ladder.result.blocked} caps={caps} />
            <AdvancedCaps caps={caps} baselineFte={baselineFte} onCapsChange={onCapsChange} />
          </div>

          <footer className="atl-opt-foot">
            <span className="is-muted">{ladder.simulations} symulacji</span>
            <span style={{ flex: 1 }} />
            <button type="button" className="atl-btn" onClick={ladder.reset}>
              Zamknij
            </button>
            <button type="button" className="atl-btn" onClick={ladder.run}>
              Policz ponownie
            </button>
          </footer>
        </>
      )}
    </aside>
  );
}

/** Hiring's hard floor, spelled out before the search runs: the horizon with
 *  unlimited people. It reframes every row — a gain is a share of what
 *  hiring can ever buy, not of the whole plan. */
function FloorNote({ floor }: { floor: number | null }) {
  if (floor == null) return null;
  return (
    <p className="is-muted">
      Szybciej niż <b>{fmt(floor)} mies.</b> nie będzie przy żadnej liczbie ludzi — tyle trwa
      najdłuższy projekt. Niżej schodzi tylko inne pokrojenie pracy, a to liczę razem z etatami.
    </p>
  );
}

function FloorRow({ floor }: { floor: number | null }) {
  if (floor == null) return null;
  return (
    <div
      className="atl-opt-sum-row is-muted"
      title="Horyzont przy nieograniczonej liczbie ludzi — poniżej schodzi tylko inne pokrojenie pracy, nie etaty"
    >
      <span>szybciej się nie da żadną liczbą ludzi</span>
      <b>{fmt(floor)} mies.</b>
    </div>
  );
}

/** The ladder cut where it stops paying — with one twist: rung 0 earns its
 *  row only by actually moving something. */
function worthwhileRungs(rungs: LadderRung[], baseScore: PlanScore): LadderRung[] {
  let lastGain = -1;
  rungs.forEach((rung, index) => {
    const previous = index > 0 ? rungs[index - 1].score : baseScore;
    if (worthTaking(previous, rung.score)) lastGain = index;
  });
  const shown = rungs.slice(0, lastGain + 1);
  if (shown.length === 0) return rungs.slice(0, 1);
  return shown[0].hires === 0 && shown[0].ceilingMoves.length === 0 && shown.length > 1
    ? shown.slice(1)
    : shown;
}

/** Moves chain per cell (1→1.5, 1.5→2); the tooltip shows each cell once,
 *  first `from` to last `to`. */
function compressMoves(moves: CeilingMove[]) {
  const byCell = new Map<
    string,
    { projectId: string; capability: Capability; from: number; to: number }
  >();
  for (const move of moves) {
    const key = `${move.projectId}:${move.capability}`;
    const existing = byCell.get(key);
    if (existing) existing.to = move.to;
    else
      byCell.set(key, {
        projectId: move.projectId,
        capability: move.capability,
        from: move.from,
        to: move.to,
      });
  }
  return [...byCell.values()];
}

/** One row: who joins, what it buys, and the button that makes it a variant.
 *  The gain is stated against today's plan, because that is the number a
 *  budget conversation uses; which exact ceilings move lives in the tooltip. */
function RungRow({
  rung,
  baseHorizon,
  disabled,
  projectNameOf,
  onApply,
}: {
  rung: LadderRung;
  baseHorizon: number;
  disabled: boolean;
  projectNameOf: (id: string) => string;
  onApply: () => void;
}) {
  const hires = CAPABILITY_ORDER.filter((c) => (rung.byCapability[c] ?? 0) > 0).map((c) => {
    const n = rung.byCapability[c] ?? 0;
    return n > 1 ? `${CAPABILITY_LABELS[c]}×${n}` : CAPABILITY_LABELS[c];
  });
  const raises = compressMoves(rung.ceilingMoves);
  const raiseTooltip = raises
    .map(
      (r) =>
        `${projectNameOf(r.projectId)} — ${CAPABILITY_LABELS[r.capability]}: ${fmt2(r.from)} → ${fmt2(r.to)}`,
    )
    .join("\n");
  const gain = Number.isFinite(rung.deltaHorizon) ? -rung.deltaHorizon : 0;
  const pct = baseHorizon > 0 ? Math.round((gain / baseHorizon) * 100) : 0;
  const heals = rung.deltaImpossible < 0;

  return (
    <div className="atl-opt-scenario">
      <span className="atl-opt-hires">{rung.hires}</span>
      <div className="atl-opt-scenario-main">
        <div className="atl-opt-scenario-who">
          {hires.length > 0 ? (
            hires.map((label) => (
              <span className="atl-opt-tag" key={label}>
                {label}
              </span>
            ))
          ) : (
            <span className="atl-opt-added">nikt nowy — tylko pokrojenie pracy</span>
          )}
        </div>
        <div className="atl-opt-scenario-gain">
          <span className={gain > 0.05 ? "is-good" : "is-muted"}>
            {gain > 0.05
              ? `plan ${fmt(rung.horizonMonths)} mies. — krócej o ${plCount(
                  Math.round(weeksOf(gain)),
                  "tydzień",
                  "tygodnie",
                  "tygodni",
                )} (${pct}%)`
              : `plan ${fmt(rung.horizonMonths)} mies. — bez skrócenia`}
          </span>
          {heals && (
            <span className="atl-opt-badge is-good">
              ratuje {plCount(-rung.deltaImpossible, "projekt", "projekty", "projektów")}
            </span>
          )}
        </div>
        <div className="atl-opt-scenario-sub is-muted">
          zespół {fmt2(sumOf(rung.pools))} FTE
          {raises.length > 0 && (
            <span title={raiseTooltip} style={{ cursor: "help" }}>
              {" "}
              · praca pokrojona inaczej w{" "}
              {plCount(raises.length, "miejscu", "miejscach", "miejscach")} ⓘ
            </span>
          )}
        </div>
      </div>
      <button type="button" className="atl-btn" onClick={onApply} disabled={disabled}>
        Wariant
      </button>
    </div>
  );
}

/** Per-capability ceilings on team size — advanced, collapsed by default.
 *  Without them the search will happily staff four tech leads, because
 *  nothing in the model knows a team wants one. */
function AdvancedCaps({
  caps,
  baselineFte,
  onCapsChange,
}: {
  caps: CapabilityCaps;
  baselineFte: CapabilityVector;
  onCapsChange: (caps: CapabilityCaps) => void;
}) {
  return (
    <details className="atl-opt-advanced">
      <summary>Limity zespołu — ilu ludzi danej kompetencji najwyżej zatrudniamy</summary>
      <p className="atl-opt-caption">zmiana limitu wymaga ponownego policzenia</p>
      <CapsEditor caps={caps} baselineFte={baselineFte} onCapsChange={onCapsChange} />
    </details>
  );
}

function CapsEditor({
  caps,
  baselineFte,
  onCapsChange,
}: {
  caps: CapabilityCaps;
  baselineFte: CapabilityVector;
  onCapsChange: (caps: CapabilityCaps) => void;
}) {
  const setCap = (capability: Capability, value: number | undefined) => {
    const next = { ...caps };
    if (value === undefined) delete next[capability];
    else next[capability] = value;
    onCapsChange(next);
  };

  return (
    <div className="atl-caps">
      <div className="atl-caps-head">
        <span>kompetencja</span>
        <span>dziś</span>
        <span>maks. w zespole</span>
      </div>
      {CAPABILITY_ORDER.map((capability) => {
        const pool = baselineFte[capability] ?? 0;
        const cap = caps[capability];
        return (
          <div className="atl-caps-row" key={capability}>
            <span className="atl-caps-name">{CAPABILITY_LABELS[capability]}</span>
            <span className="atl-caps-pool">{fmt2(pool)}</span>
            <span className="atl-caps-input">
              <button
                type="button"
                className={`atl-caps-opt ${cap === undefined ? "is-on" : ""}`}
                onClick={() => setCap(capability, undefined)}
                title="bez limitu"
              >
                ∞
              </button>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`atl-caps-opt ${cap === n ? "is-on" : ""}`}
                  onClick={() => setCap(capability, n)}
                  title={`najwyżej ${n} FTE ${CAPABILITY_LABELS[capability]} w zespole`}
                >
                  {n}
                </button>
              ))}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function BlockedReport({ blocked, caps }: { blocked: BlockedHire[]; caps: CapabilityCaps }) {
  const capped = blocked.filter((b) => b.reason === "cap");
  const idle = blocked.filter((b) => b.reason === "no-demand");
  if (capped.length === 0 && idle.length === 0) return null;
  return (
    <div className="atl-opt-section">
      <span className="atl-eyebrow">pominięte kompetencje</span>
      {capped.map((b) => (
        <div className="atl-opt-blocked" key={b.capability}>
          <b>{CAPABILITY_LABELS[b.capability]}</b>
          <span>
            limit {fmt(caps[b.capability] ?? b.cap ?? 0)} FTE osiągnięty (dziś {fmt2(b.pool ?? 0)})
          </span>
        </div>
      ))}
      {idle.length > 0 && (
        <div className="atl-opt-blocked">
          <b>{idle.map((b) => CAPABILITY_LABELS[b.capability]).join(" · ")}</b>
          <span>portfel nie ma dla nich pracy</span>
        </div>
      )}
    </div>
  );
}

/** A week. Below this the extra person bought a rounding difference, and the
 *  ladder should stop rather than dress it up as a step. */
const MIN_GAIN_MONTHS = 0.25;

/** Did this step buy something a person would actually pay for? Healing a
 *  project always counts; months have to clear a week. */
function worthTaking(previous: PlanScore, next: PlanScore): boolean {
  if (next.impossible !== previous.impossible) return next.impossible < previous.impossible;
  const horizon = previous.horizonMonths - next.horizonMonths;
  if (horizon >= MIN_GAIN_MONTHS) return true;
  return previous.sumEndMonths - next.sumEndMonths >= MIN_GAIN_MONTHS;
}

function sumOf(vector: CapabilityVector): number {
  return CAPABILITY_ORDER.reduce((sum, capability) => sum + (vector[capability] ?? 0), 0);
}
