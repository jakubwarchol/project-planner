import { X } from "lucide-react";
import type { HiringLadderApi } from "../hooks/useHiringLadder";
import { CAPABILITY_HUES, fmt, fmt2, groupArrowNav, plCount, rungRoles, signed, solid, weeksOf } from "./timelineChrome";
import { CAPABILITY_LABELS, CAPABILITY_ORDER } from "../lib/estimation";
import type { CeilingMove } from "../lib/autopilot";
import type { LadderRung } from "../lib/hirePlusCeilings";
import type { BlockedHire, CapabilityCaps, PlanScore } from "../lib/hiringPlanner";
import type { Capability, CapabilityVector } from "../types";

/** Full names for the caps rows — everywhere else the app speaks in the short
 *  codes, but a headcount limit reads better against the job title. */
const CAPABILITY_FULL: Record<Capability, string> = {
  PM: "Kierownik projektu",
  UX: "Projektant UX",
  TL: "Lider techniczny",
  BE: "Backend",
  FE: "Frontend",
  QA: "Testy",
  SEC: "Bezpieczeństwo",
};

interface HiringPlanDrawerProps {
  ladder: HiringLadderApi;
  /** The drawer stays mounted and slides in and out, so the transition can
   *  actually play. */
  open: boolean;
  width: number;
  referenceLabel: string;
  referenceFte: CapabilityVector;
  /** Projects the reference lands inside the budget year — the number every
   *  option card's headline is measured against. */
  referenceWithin: number;
  referenceHorizon: number;
  /** Within-year counts per rung (keyed by hires), simulated by the screen. */
  rungWithin: Record<number, number>;
  yearLine: number;
  /** Horizon with unlimited people — hiring's hard floor. Null when it
   *  cannot be computed (empty plan, or something stays impossible). */
  hiringFloorMonths: number | null;
  caps: CapabilityCaps;
  onCapsChange: (caps: CapabilityCaps) => void;
  /** Id of the variant a rung was already turned into, or null. */
  appliedVariantIdOf: (rung: LadderRung) => string | null;
  onApplyRung: (rung: LadderRung) => void;
  onShowVariant: (variantId: string) => void;
  projectNameOf: (id: string) => string;
  onClose: () => void;
}

/**
 * "If we hired N people, what would it buy?"
 *
 * One list, one story: each card is a hire count with the work already re-cut
 * for that team (rung 0 is today's team, work re-cut, nobody hired). The
 * headline is what a budget conversation actually weighs — projects landed
 * inside the budget year — with the plan length as the small print.
 */
export function HiringPlanDrawer({
  ladder,
  open,
  width,
  referenceLabel,
  referenceFte,
  referenceWithin,
  referenceHorizon,
  rungWithin,
  yearLine,
  hiringFloorMonths,
  caps,
  onCapsChange,
  appliedVariantIdOf,
  onApplyRung,
  onShowVariant,
  projectNameOf,
  onClose,
}: HiringPlanDrawerProps) {
  return (
    <aside
      className="atl-drawer"
      style={{ width, transform: open ? "translateX(0)" : "translateX(101%)" }}
      aria-label="Plan zatrudnienia"
      inert={!open}
    >
      <header className="atl-drawer-head">
        <div className="atl-drawer-title">
          <b>Plan zatrudnienia</b>
          <span className="atl-drawer-sub">co kupi każdy kolejny etat · {referenceLabel}</span>
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

      <div className="sv-opt-body">
        {ladder.status === "idle" && (
          <>
            <p className="sv-opt-p">
              Policzę, co kupi każdy kolejny etat — od zera do siedmiu — razem z najlepszym
              pokrojeniem pracy dla każdego z tych zespołów. Każdy wiersz wyniku to policzony
              harmonogram całego portfela, nie przedłużenie trendu.
            </p>
            <FloorNote floor={hiringFloorMonths} />
            <p className="sv-opt-p is-dim">
              Nic się nie zapisze — wybrany wiersz trafia do nowego wariantu, obok obecnych.
            </p>
            <div>
              <button type="button" className="sim-btn-accent" onClick={ladder.run}>
                Policz
              </button>
            </div>
          </>
        )}

        {ladder.status === "running" && (
          <>
            <p className="sv-opt-p">
              Liczę… {plCount(ladder.solved, "wiersz gotowy", "wiersze gotowe", "wierszy gotowych")}{" "}
              · {ladder.simulations} symulacji
            </p>
            <div>
              <button type="button" className="sim-btn" onClick={ladder.cancel}>
                Przerwij
              </button>
            </div>
          </>
        )}

        {ladder.status === "ready" && ladder.result && (
          <>
            {ladder.stale && (
              <p className="sv-opt-stale">
                Dane zmieniły się od ostatniego liczenia — policz jeszcze raz.
              </p>
            )}

            <p className="sv-opt-p">
              Dziś, bez zmian: <b>{referenceWithin} projektów w {yearLine} mies.</b>, koniec planu{" "}
              {fmt(referenceHorizon)} mies. Każda karta to policzony harmonogram całego portfela,
              nie przedłużenie trendu.
            </p>
            <FloorNote floor={hiringFloorMonths} />

            <div className="sv-opt-cards">
              {worthwhileRungs(ladder.result.rungs, ladder.result.base.score).map((rung) => (
                <OptionCard
                  key={rung.hires}
                  rung={rung}
                  referenceWithin={referenceWithin}
                  referenceHorizon={referenceHorizon}
                  within={rungWithin[rung.hires]}
                  yearLine={yearLine}
                  appliedVariantId={appliedVariantIdOf(rung)}
                  disabled={ladder.stale}
                  projectNameOf={projectNameOf}
                  onApply={() => onApplyRung(rung)}
                  onShow={onShowVariant}
                />
              ))}
            </div>

            <BlockedReport blocked={ladder.result.blocked} caps={caps} />

            <div className="sv-opt-again">
              <button type="button" className="sim-btn" onClick={ladder.run}>
                Policz ponownie
              </button>
              <span>{plCount(ladder.simulations, "symulacja", "symulacje", "symulacji")}</span>
            </div>
          </>
        )}

        <CapsSection caps={caps} referenceFte={referenceFte} onCapsChange={onCapsChange} />
      </div>
    </aside>
  );
}

/** Hiring's hard floor, spelled out next to the ladder: the horizon with
 *  unlimited people. It reframes every card — a gain is a share of what
 *  hiring can ever buy, not of the whole plan. */
function FloorNote({ floor }: { floor: number | null }) {
  if (floor == null) return null;
  return (
    <p className="sv-opt-p is-dim">
      Szybciej niż <b>{fmt(floor)} mies.</b> nie będzie przy żadnej liczbie ludzi — wąskim gardłem
      przestają być etaty. Niżej schodzi tylko inne pokrojenie pracy, a to liczę razem z etatami.
    </p>
  );
}

/** The ladder cut where it stops paying — with one twist: rung 0 earns its
 *  card only by actually moving something. */
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

/** One card: who joins, what it buys in budget-year projects, and the button
 *  that makes it a variant (or jumps to the one it already made). */
function OptionCard({
  rung,
  referenceWithin,
  referenceHorizon,
  within,
  yearLine,
  appliedVariantId,
  disabled,
  projectNameOf,
  onApply,
  onShow,
}: {
  rung: LadderRung;
  referenceWithin: number;
  referenceHorizon: number;
  within: number | undefined;
  yearLine: number;
  appliedVariantId: string | null;
  disabled: boolean;
  projectNameOf: (id: string) => string;
  onApply: () => void;
  onShow: (variantId: string) => void;
}) {
  const roles = rungRoles(rung);
  const raises = compressMoves(rung.ceilingMoves);
  const recutTitle =
    raises.length > 0
      ? `Inne pokrojenie pracy: ${plCount(new Set(raises.map((r) => r.projectId)).size, "projekt zmienia", "projekty zmieniają", "projektów zmienia")} obsadę faz, żeby nowi ludzie mieli co robić od pierwszego miesiąca.\n\n${raises
          .map(
            (r) =>
              `${projectNameOf(r.projectId)} — ${CAPABILITY_LABELS[r.capability]}: ${fmt2(r.from)} → ${fmt2(r.to)}`,
          )
          .join("\n")}`
      : undefined;

  const weeks = Math.round(weeksOf(rung.horizonMonths - referenceHorizon));
  const heals = rung.deltaImpossible < 0;
  const withinKnown = within !== undefined;
  const better = withinKnown && within > referenceWithin;

  return (
    <div className="sv-opt-card">
      <div className="sv-opt-card-top">
        <span className="sv-opt-hires">+{rung.hires}</span>
        <span className="sv-opt-roles">{roles || "nikt nowy — tylko pokrojenie pracy"}</span>
      </div>
      <div className="sv-opt-headline-row">
        <b className="sv-opt-headline" style={{ color: better ? "var(--win)" : "var(--ink-2)" }}>
          {withinKnown ? `${within} projektów w ${yearLine} mies.` : `plan ${fmt(rung.horizonMonths)} mies.`}
        </b>
        {withinKnown && <span className="sv-opt-base">{signed(within - referenceWithin)}</span>}
      </div>
      <span className="sv-opt-secondary" title={recutTitle}>
        plan {fmt(rung.horizonMonths)} mies. · {signed(weeks)} tyg.
        {heals && ` · ratuje ${plCount(-rung.deltaImpossible, "projekt", "projekty", "projektów")}`}
      </span>
      <div className="sv-opt-actions">
        {appliedVariantId ? (
          <>
            <button
              type="button"
              className="sv-opt-apply is-added"
              onClick={() => onShow(appliedVariantId)}
            >
              Dodany — pokaż
            </button>
            <span>jest na liście wariantów</span>
          </>
        ) : (
          <button type="button" className="sv-opt-apply" onClick={onApply} disabled={disabled}>
            Dodaj jako wariant
          </button>
        )}
      </div>
    </div>
  );
}

/** Per-capability ceilings on team size — collapsed by default. Without them
 *  the search will happily staff four tech leads, because nothing in the
 *  model knows a team wants one. */
function CapsSection({
  caps,
  referenceFte,
  onCapsChange,
}: {
  caps: CapabilityCaps;
  referenceFte: CapabilityVector;
  onCapsChange: (caps: CapabilityCaps) => void;
}) {
  const anySet = CAPABILITY_ORDER.some((c) => caps[c] !== undefined);

  const setCap = (capability: Capability, value: number | undefined) => {
    const next = { ...caps };
    if (value === undefined) delete next[capability];
    else next[capability] = value;
    onCapsChange(next);
  };

  return (
    <details className="sv-caps">
      <summary>limity kompetencji</summary>
      <div className="sv-caps-body">
        <span className="sv-opt-p is-dim">
          Ilu ludzi danej kompetencji najwyżej zatrudniamy — klik zmienia limit, zmiana wymaga
          ponownego policzenia.
        </span>
        <div className="sv-caps-rows">
          {CAPABILITY_ORDER.map((capability) => {
            const limit = caps[capability];
            return (
              <div className="sv-caps-row" key={capability}>
                <span
                  className="sv-caps-dot"
                  style={{ background: solid(CAPABILITY_HUES[capability]) }}
                />
                <span className="sv-caps-name">{CAPABILITY_FULL[capability]}</span>
                <span className="sv-caps-now" title="w wariancie bazowym">
                  teraz {fmt(referenceFte[capability] ?? 0)}
                </span>
                <div
                  className="sv-steps"
                  role="radiogroup"
                  aria-label={`Limit etatów — ${CAPABILITY_FULL[capability]}`}
                  onKeyDown={groupArrowNav}
                >
                  {[undefined, 1, 2, 3, 4, 5, 6, 7].map((v, i) => {
                    const current = v === undefined ? limit === undefined : limit === v;
                    return (
                      <button
                        key={i}
                        type="button"
                        role="radio"
                        aria-checked={current}
                        tabIndex={current ? 0 : -1}
                        className={current ? "is-active" : ""}
                        title={v === undefined ? "bez limitu" : `najwyżej ${v}`}
                        onClick={() => setCap(capability, v)}
                      >
                        {v === undefined ? "∞" : v}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <span className="sv-caps-note">
          {anySet ? "limity zmienione — policz scenariusze ponownie" : "bez limitu = ile trzeba"}
        </span>
      </div>
    </details>
  );
}

function BlockedReport({ blocked, caps }: { blocked: BlockedHire[]; caps: CapabilityCaps }) {
  const capped = blocked.filter((b) => b.reason === "cap");
  const idle = blocked.filter((b) => b.reason === "no-demand");
  if (capped.length === 0 && idle.length === 0) return null;
  return (
    <p className="sv-opt-p is-dim">
      Pominięte:{" "}
      {[
        ...capped.map(
          (b) =>
            `${CAPABILITY_FULL[b.capability]} (limit ${fmt(caps[b.capability] ?? b.cap ?? 0)} osiągnięty, dziś ${fmt2(b.pool ?? 0)})`,
        ),
        ...(idle.length > 0
          ? [`${idle.map((b) => CAPABILITY_FULL[b.capability]).join(", ")} — portfel nie ma dla nich pracy`]
          : []),
      ].join(" · ")}
    </p>
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
