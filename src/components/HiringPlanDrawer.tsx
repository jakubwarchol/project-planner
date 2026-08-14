import { X } from "lucide-react";
import type { HiringPlanApi } from "../hooks/useHiringPlan";
import { CAPABILITY_LABELS, CAPABILITY_ORDER } from "../lib/estimation";
import type {
  BlockedHire,
  CapabilityCaps,
  HiringScenario,
  PlanScore,
} from "../lib/hiringPlanner";
import type { Capability, CapabilityVector } from "../types";
import { fmt, fmt2, plCount, weeksOf } from "./timelineChrome";

interface HiringPlanDrawerProps {
  api: HiringPlanApi;
  baselineLabel: string;
  baselineFte: CapabilityVector;
  /** Header/footer heights vary with the density control, unlike cm2's fixed
   *  chrome — so the drawer takes its vertical bounds from the screen. */
  insets: { top: number; bottom: number };
  caps: CapabilityCaps;
  onCapsChange: (caps: CapabilityCaps) => void;
  onApply: (vector: CapabilityVector, scenario: HiringScenario) => void;
  onClose: () => void;
}

/**
 * "If we hired N people, who should they be?"
 *
 * One row per hire count, each a real simulated plan rather than an
 * extrapolation, so you can read where the payoff flattens — usually the most
 * useful thing on the screen, because it says how many people are worth asking
 * for rather than just which. Nothing here moves anyone between capabilities:
 * people are specialists, and the only lever is who joins.
 */
export function HiringPlanDrawer({
  api,
  baselineLabel,
  baselineFte,
  insets,
  caps,
  onCapsChange,
  onApply,
  onClose,
}: HiringPlanDrawerProps) {
  const { status, result, solved, simulations, stale } = api;

  // The ladder is computed to the end, then cut where it stops paying: past
  // that point the search still has hires to place and puts them wherever they
  // do no harm, which reads as a recommendation to hire four project managers
  // for nothing. The whole ladder is still simulated first, because a
  // capability that only pays off in pairs looks flat one hire before it works.
  const scenarios = result?.scenarios ?? [];
  let lastGain = 0;
  scenarios.forEach((scenario, index) => {
    const previous = index > 0 ? scenarios[index - 1].score : result?.base.score;
    if (previous && worthHiring(previous, scenario)) lastGain = index + 1;
  });
  const worthwhile = scenarios.slice(0, Math.max(lastGain, 1));
  const saturatedAt = scenarios.length > worthwhile.length ? worthwhile.length : null;

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

      {status === "idle" && (
        <div className="atl-drawer-body atl-opt-intro">
          <p>
            Dla każdej liczby etatów od 1 do 7 szukam najlepszego rozdziału na kompetencje — tego,
            który dotrzymuje najwięcej terminów i kończy wszystkie projekty najwcześniej. Portfel,
            jego kolejność, sufity obłożenia i urlopy zostają bez zmian.
          </p>
          <p className="is-muted">
            Nikt nie zmienia kompetencji — jedynym ruchem jest dołożenie człowieka. Każdy wiersz
            wyniku to policzony harmonogram, więc widać, na której osobie zysk przestaje rosnąć.
          </p>

          <CapsEditor caps={caps} baselineFte={baselineFte} onCapsChange={onCapsChange} />

          <p className="is-muted">
            Nic nie zostanie zapisane — wybrany scenariusz trafia do nowego wariantu, obok obecnych.
          </p>
          <div>
            <button type="button" className="atl-primary" onClick={api.run}>
              Policz scenariusze
            </button>
          </div>
        </div>
      )}

      {status === "running" && (
        <div className="atl-drawer-body atl-opt-intro">
          <p>
            Liczę… {plCount(solved, "scenariusz", "scenariusze", "scenariuszy")} gotowych ·{" "}
            {simulations} symulacji
          </p>
          <div>
            <button type="button" className="atl-btn" onClick={api.cancel}>
              Przerwij
            </button>
          </div>
        </div>
      )}

      {status === "ready" && result && (
        <>
          <div className="atl-drawer-body">
            {stale && (
              <p className="atl-opt-stale">
                Dane zmieniły się od ostatniego liczenia — policz scenariusze jeszcze raz.
              </p>
            )}

            <div className="atl-opt-summary">
              <div className="atl-opt-sum-row">
                <span>obecny zespół</span>
                <b>{fmt(result.base.horizonMonths)} mies.</b>
              </div>
              <div className="atl-opt-sum-row is-muted">
                <span>niedotrzymane terminy</span>
                <b>{result.base.score.missedDeadlines}</b>
              </div>
              {result.base.score.impossible > 0 && (
                <div className="atl-opt-sum-row is-warn">
                  <span>projekty bez końca</span>
                  <b>{result.base.score.impossible}</b>
                </div>
              )}
            </div>

            {result.scenarios.length === 0 ? (
              <p className="atl-opt-empty">
                Żadnej kompetencji nie da się powiększyć — wszystkie mają limit na dzisiejszym
                poziomie albo portfel nie ma dla nich pracy.
              </p>
            ) : (
              <div className="atl-opt-section">
                <span className="atl-eyebrow">ile etatów, tyle planu</span>
                <p className="atl-opt-caption">
                  każdy wiersz to policzony harmonogram — nie przedłużenie trendu
                </p>
                {worthwhile.map((scenario) => (
                  <ScenarioRow
                    key={scenario.hires}
                    scenario={scenario}
                    baseHorizon={result.base.horizonMonths}
                    disabled={stale}
                    onApply={() => onApply(scenario.pools, scenario)}
                  />
                ))}
                {saturatedAt !== null && (
                  <p className="atl-opt-saturated">
                    Powyżej {plCount(saturatedAt, "etatu", "etatów", "etatów")} plan już się nie
                    skraca — wąskim gardłem przestają być ludzie. Dalej działa tylko inne pokrojenie
                    pracy: sufity obłożenia w Wycenach albo kolejność projektów.
                  </p>
                )}
              </div>
            )}

            <BlockedReport blocked={result.blocked} caps={caps} />

            <div className="atl-opt-section">
              <span className="atl-eyebrow">limity kompetencji</span>
              <p className="atl-opt-caption">
                zmiana limitu wymaga ponownego policzenia scenariuszy
              </p>
              <CapsEditor caps={caps} baselineFte={baselineFte} onCapsChange={onCapsChange} />
            </div>
          </div>

          <footer className="atl-opt-foot">
            <span className="is-muted">{simulations} symulacji</span>
            <span style={{ flex: 1 }} />
            <button type="button" className="atl-btn" onClick={api.reset}>
              Zamknij
            </button>
            <button type="button" className="atl-btn" onClick={api.run}>
              Policz ponownie
            </button>
          </footer>
        </>
      )}
    </aside>
  );
}

/** One hire count: who joins, what it buys, and the button that turns it into a
 *  variant. The gain is stated against today's team rather than against the row
 *  above, because that is the number a budget conversation actually uses. */
function ScenarioRow({
  scenario,
  baseHorizon,
  disabled,
  onApply,
}: {
  scenario: HiringScenario;
  baseHorizon: number;
  disabled: boolean;
  onApply: () => void;
}) {
  const hires = CAPABILITY_ORDER.filter((c) => (scenario.byCapability[c] ?? 0) > 0).map((c) => {
    const n = scenario.byCapability[c] ?? 0;
    return n > 1 ? `${CAPABILITY_LABELS[c]}×${n}` : CAPABILITY_LABELS[c];
  });
  const gain = Number.isFinite(scenario.deltaHorizon) ? -scenario.deltaHorizon : 0;
  const heals = scenario.deltaImpossible < 0;
  const savesDeadlines = scenario.deltaMissed < 0;

  return (
    <div className="atl-opt-scenario">
      <span className="atl-opt-hires">{scenario.hires}</span>
      <div className="atl-opt-scenario-main">
        <div className="atl-opt-scenario-who">
          {hires.map((label) => (
            <span className="atl-opt-tag" key={label}>
              {label}
            </span>
          ))}
          {scenario.addedCapability && scenario.hires > 1 && (
            <span className="atl-opt-added">+ {CAPABILITY_LABELS[scenario.addedCapability]}</span>
          )}
        </div>
        <div className="atl-opt-scenario-gain">
          <span className={gain > 0.05 ? "is-good" : "is-muted"}>
            {gain > 0.05
              ? `plan ${fmt(scenario.horizonMonths)} mies. · −${fmt(gain)} mies. (${plCount(
                  Math.round(weeksOf(gain)),
                  "tydzień",
                  "tygodnie",
                  "tygodni",
                )})`
              : `plan ${fmt(scenario.horizonMonths)} mies. — bez skrócenia`}
          </span>
          {heals && (
            <span className="atl-opt-badge is-good">
              ratuje {plCount(-scenario.deltaImpossible, "projekt", "projekty", "projektów")}
            </span>
          )}
          {savesDeadlines && (
            <span className="atl-opt-badge is-good">
              {plCount(-scenario.deltaMissed, "termin", "terminy", "terminów")} więcej
            </span>
          )}
        </div>
        <div className="atl-opt-scenario-sub is-muted">
          suma końców {fmt(scenario.score.sumEndMonths)} mies. ({signed(scenario.deltaSumEnds)}) ·
          zespół {fmt2(sumOf(scenario.pools))} FTE
          {baseHorizon > 0 && Number.isFinite(scenario.horizonMonths)
            ? ` · ${Math.round((gain / baseHorizon) * 100)}% krócej`
            : ""}
        </div>
      </div>
      <button type="button" className="atl-btn" onClick={onApply} disabled={disabled}>
        Wariant
      </button>
    </div>
  );
}

/** Per-capability ceilings on team size. Without them the search will happily
 *  staff four tech leads, because nothing in the model knows a team wants one. */
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
 *  ladder should stop rather than dress it up as a step — the same floor the
 *  ceiling autopilot uses before it will propose anything. */
const MIN_GAIN_MONTHS = 0.25;

/** Did this hire buy something a person would actually pay for? Healing a
 *  project or saving a deadline always counts; months have to clear a week. */
function worthHiring(previous: PlanScore, scenario: HiringScenario): boolean {
  if (scenario.score.impossible !== previous.impossible) {
    return scenario.score.impossible < previous.impossible;
  }
  if (scenario.score.missedDeadlines !== previous.missedDeadlines) {
    return scenario.score.missedDeadlines < previous.missedDeadlines;
  }
  const horizon = previous.horizonMonths - scenario.score.horizonMonths;
  if (horizon >= MIN_GAIN_MONTHS) return true;
  return previous.sumEndMonths - scenario.score.sumEndMonths >= MIN_GAIN_MONTHS;
}

const signed = (n: number) => `${n > 0 ? "+" : "−"}${fmt(Math.abs(n))} mies.`;

function sumOf(vector: CapabilityVector): number {
  return CAPABILITY_ORDER.reduce((sum, capability) => sum + (vector[capability] ?? 0), 0);
}
