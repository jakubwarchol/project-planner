import { X } from "lucide-react";
import type { PoolProposalApi } from "../hooks/usePoolProposal";
import type {
  BlockedPoolCandidate,
  FloorDiagnostic,
  HiringEntry,
  PlanScore,
  PoolOptimizerResult,
} from "../lib/poolOptimizer";
import type { CapabilityVector, Project } from "../types";
import { fmt, fmt2, plCount, weeksOf } from "./timelineChrome";

interface PoolProposalDrawerProps {
  api: PoolProposalApi;
  baselineLabel: string;
  projectById: Map<string, Project>;
  /** Header/footer heights vary with the density control, unlike cm2's fixed
   *  chrome — so the drawer takes its vertical bounds from the screen. */
  insets: { top: number; bottom: number };
  /** "real": moves only where someone on the roster links both capabilities.
   *  "free": any pair — the recruitment-shape question, not an executable plan. */
  mode: "real" | "free";
  onModeChange: (mode: "real" | "free") => void;
  /** Human-readable executable directions, e.g. "BE → SEC do 0.5". */
  transfers: string[];
  onApply: (vector: CapabilityVector) => void;
  onClose: () => void;
}

const signedMonths = (n: number) => `${n > 0 ? "+" : "−"}${fmt(Math.abs(n))}`;

/**
 * The pool optimizer's output, as a list of claims accepted one at a time —
 * the same contract as the ceiling proposals in Wyceny. Every move asserts
 * that people are interchangeable between two capabilities, which is the
 * variant model's own assumption but still a claim about the world; the
 * machine only knows where the question is worth asking.
 */
export function PoolProposalDrawer({
  api,
  baselineLabel,
  projectById,
  insets,
  mode,
  onModeChange,
  transfers,
  onApply,
  onClose,
}: PoolProposalDrawerProps) {
  const { status, result, found, simulations, accepted, preview } = api;
  const nameOf = (id: string) => projectById.get(id)?.name ?? id;

  const before = result?.scoreBefore ?? null;
  const now = preview?.score ?? before;
  const deltaSum = before && now ? now.sumEndMonths - before.sumEndMonths : 0;
  const improved = deltaSum < -0.005;

  const worsened = (preview?.projectDeltas ?? []).filter(
    (d) => !Number.isFinite(d.after) ? Number.isFinite(d.before) : d.delta > 0.05,
  );
  const better = (preview?.projectDeltas ?? []).filter(
    (d) => d.delta < -0.05 || (!Number.isFinite(d.before) && Number.isFinite(d.after)),
  );
  const unchanged = (preview?.projectDeltas ?? []).length - worsened.length - better.length;

  return (
    <aside
      className="atl-drawer"
      style={{ top: insets.top, bottom: insets.bottom }}
      aria-label="Optymalizacja składu"
    >
      <header className="atl-drawer-head">
        <div className="atl-drawer-title">
          <b>Optymalizacja składu</b>
          <span className="atl-drawer-sub">przesunięcia FTE między pulami · {baselineLabel}</span>
        </div>
        <button
          type="button"
          className="atl-drawer-close"
          onClick={onClose}
          aria-label="Zamknij optymalizację"
        >
          <X size={15} />
        </button>
      </header>

      {status === "idle" && (
        <div className="atl-drawer-body atl-opt-intro">
          <p>
            Szukam przesunięć etatów między kompetencjami — w ćwiartkach — które dotrzymują więcej
            terminów i kończą wszystkie projekty średnio wcześniej. Kolejność projektów, urlopy i
            sufity obłożenia zostają jak są.
          </p>
          <div className="atl-opt-mode">
            <button
              type="button"
              className={`atl-btn ${mode === "real" ? "is-on" : ""}`}
              onClick={() => onModeChange("real")}
            >
              wykonalne zespołem
            </button>
            <button
              type="button"
              className={`atl-btn ${mode === "free" ? "is-on" : ""}`}
              onClick={() => onModeChange("free")}
            >
              docelowy skład
            </button>
          </div>
          {mode === "real" ? (
            <>
              <p className="is-muted">
                Ruchy tylko tam, gdzie ktoś w zespole realnie łączy obie kompetencje — i najwyżej o
                tyle, ile daje dziś stronie oddającej.
              </p>
              {transfers.length > 0 ? (
                <p className="is-muted">możliwe kierunki: {transfers.join(" · ")}</p>
              ) : (
                <p className="is-muted">
                  Nikt w zespole nie łączy dwóch kompetencji, więc nie ma czego przesuwać — zostaje
                  raport „co kupiłby +1 etat".
                </p>
              )}
            </>
          ) : (
            <p className="is-muted">
              Bez ograniczeń kadrowych: odpowiedź na pytanie, jak powinien wyglądać zespół pod ten
              portfel. To wskazówka rekrutacyjna, nie plan przesunięć — obecni ludzie nie zmieniają
              kompetencji.
            </p>
          )}
          <p className="is-muted">
            Nic nie zostanie zapisane — przyjęte ruchy trafiają do nowego wariantu, obok obecnych.
          </p>
          <div>
            <button type="button" className="atl-primary" onClick={api.run}>
              Szukaj przesunięć
            </button>
          </div>
        </div>
      )}

      {status === "running" && (
        <div className="atl-drawer-body atl-opt-intro">
          <p>
            <span className="atl-spinner" aria-hidden="true" />
            Przeliczam plan od nowa dla każdego kandydata…
          </p>
          <p className="is-muted">
            {plCount(found, "ruch", "ruchy", "ruchów")} ·{" "}
            {plCount(simulations, "symulacja", "symulacje", "symulacji")} całego portfela.
          </p>
          <div>
            <button type="button" className="atl-ghost" onClick={api.cancel}>
              Przerwij
            </button>
          </div>
        </div>
      )}

      {status === "ready" && result && before && now && (
        <>
          <div className="atl-opt-summary">
            <div className="atl-opt-fig">
              <span className="atl-eyebrow">terminy</span>
              <b className={now.missedDeadlines < before.missedDeadlines ? "is-ok" : ""}>
                {before.missedDeadlines} → {now.missedDeadlines}
              </b>
              <span className="atl-opt-fig-sub">niedotrzymanych</span>
            </div>
            <div className="atl-opt-arrow" aria-hidden="true">
              ·
            </div>
            <div className="atl-opt-fig">
              <span className="atl-eyebrow">Σ końców</span>
              <b>
                {fmt(before.sumEndMonths)} → {fmt(now.sumEndMonths)} mies.
              </b>
              <span className="atl-opt-fig-sub">suma wszystkich projektów</span>
            </div>
            <div className="atl-opt-fig is-end">
              <span className="atl-eyebrow">różnica</span>
              <b className={improved ? "is-ok" : ""}>
                {Math.abs(deltaSum) < 0.05 ? "0" : `${signedMonths(deltaSum)} mies.`}
              </b>
              {Math.abs(deltaSum) >= 0.05 && (
                <span className="atl-opt-fig-sub">≈ {Math.round(Math.abs(weeksOf(deltaSum)))} tyg.</span>
              )}
            </div>
          </div>
          <p className="atl-opt-footnote">
            {mode === "real"
              ? "tryb: wykonalne obecnym zespołem — ruchy tylko po ludziach łączących kompetencje"
              : "tryb: docelowy skład — wskazówka rekrutacyjna, nie plan przesunięć"}
          </p>
          {(before.impossible > 0 || now.impossible > 0) && (
            <p className={`atl-opt-impossible ${now.impossible < before.impossible ? "is-ok" : ""}`}>
              projekty niewykonalne: {before.impossible} → {now.impossible}
              {now.impossible < before.impossible ? " — przesunięcia ratują projekt" : ""}
            </p>
          )}

          <div className="atl-drawer-body">
            {result.moves.length === 0 ? (
              <p className="atl-opt-none">
                Nie ma czego przesuwać — żadna zamiana ćwiartek między pulami nie skraca planu ani
                nie ratuje terminu. Poniżej powody, pula po puli.
              </p>
            ) : (
              <div className="atl-opt-list">
                {result.moves.map((move, index) => {
                  const on = accepted.has(index);
                  const gain =
                    move.deltaImpossible < 0
                      ? "ratuje projekt"
                      : move.deltaMissed < 0
                        ? `terminy ${move.deltaMissed}`
                        : `${signedMonths(move.deltaSumEnds)} mies.`;
                  return (
                    <div className={`atl-opt-row ${on ? "is-on" : ""}`} key={index}>
                      <button
                        type="button"
                        className="atl-opt-check"
                        onClick={() => api.toggle(index)}
                        aria-label={`Przyjmij przesunięcie ${fmt2(move.fte)} FTE z ${move.from} do ${move.to}`}
                        aria-pressed={on}
                      >
                        {on ? "✓" : ""}
                      </button>
                      <div className="atl-opt-main">
                        <div className="atl-opt-move">
                          <b>
                            {move.from} → {move.to}
                          </b>
                          <span>{fmt2(move.fte)} FTE</span>
                        </div>
                        <span className="atl-opt-note">
                          pule {fmt2(move.poolFromAfter + move.fte)}→{fmt2(move.poolFromAfter)} /{" "}
                          {fmt2(move.poolToAfter - move.fte)}→{fmt2(move.poolToAfter)}
                        </span>
                      </div>
                      <span className="atl-opt-gain">{gain}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {result.truncated && (
              <p className="atl-opt-footnote">
                Zatrzymałem się po {result.moves.length} ruchach. Zastosuj te i uruchom ponownie —
                po każdej zmianie gardło przechodzi gdzie indziej.
              </p>
            )}

            {worsened.length > 0 && (
              <div className="atl-opt-section">
                <span className="atl-eyebrow">kto traci</span>
                {worsened.map((d) => (
                  <div className="atl-opt-loser" key={d.projectId}>
                    <span className="atl-opt-loser-name" title={nameOf(d.projectId)}>
                      {nameOf(d.projectId)}
                    </span>
                    {Number.isFinite(d.after) ? (
                      <b>+{fmt(d.delta)} mies.</b>
                    ) : (
                      <b className="is-broken">staje się niewykonalny</b>
                    )}
                    {d.missedAfter && !d.missedBefore && (
                      <span className="atl-opt-loser-badge">przekroczy termin</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {preview && (better.length > 0 || unchanged > 0) && (
              <p className="atl-opt-footnote">
                {plCount(better.length, "projekt zyskuje", "projekty zyskują", "projektów zyskuje")}
                {unchanged > 0 ? ` · ${unchanged} bez zmian` : ""}
              </p>
            )}

            <BlockedPoolRows blocked={result.blocked} />

            <HiringReport hiring={result.hiring} scoreAfter={result.scoreAfter} />
            <CeilingsReport result={result} nameOf={nameOf} />
            <FloorReport before={result.floorBefore} after={result.floorAfter} />

            <p className="atl-opt-footnote">
              {plCount(result.simulations, "symulacja", "symulacje", "symulacji")} całego portfela.
            </p>
          </div>

          {api.stale && (
            <p className="atl-opt-stale">Dane zmieniły się od wyliczenia — uruchom ponownie.</p>
          )}

          <footer className="atl-opt-foot">
            <span className="atl-opt-count">
              {accepted.size === 0
                ? "zaznacz ruchy, które mają trafić do nowego wariantu"
                : `${plCount(accepted.size, "ruch", "ruchy", "ruchów")} → nowy wariant`}
            </span>
            <button type="button" className="atl-ghost" onClick={onClose}>
              Odrzuć
            </button>
            <button
              type="button"
              className="atl-primary"
              disabled={accepted.size === 0 || api.stale}
              onClick={() => onApply(api.composedVector())}
            >
              Zastosuj
            </button>
          </footer>
        </>
      )}
    </aside>
  );
}

/** Hiring is a separate report, never folded into the zero-sum proposal — a
 *  hire is a different kind of decision. Priced against the vector *after* the
 *  proposed moves, because that is where hiring starts mattering: once
 *  redistribution has saturated, what remains is what only more people fix. */
function HiringReport({ hiring, scoreAfter }: { hiring: HiringEntry[]; scoreAfter: PlanScore }) {
  if (hiring.length === 0) return null;
  return (
    <div className="atl-opt-section">
      <span className="atl-eyebrow">co kupiłby +1 etat</span>
      <p className="atl-opt-caption">
        osobna decyzja — nie wlicza się do przesunięć; liczone po ich zastosowaniu
      </p>
      {hiring.map((entry) => {
        const heals = entry.score.impossible < scoreAfter.impossible;
        const parts: string[] = [];
        if (heals) parts.push("ratuje projekt");
        if (entry.deltaMissed < 0) parts.push(`terminy ${entry.deltaMissed}`);
        if (!heals && Math.abs(entry.deltaSumEnds) >= 0.05) {
          parts.push(`Σ ${signedMonths(entry.deltaSumEnds)} mies.`);
        }
        const idle = parts.length === 0;
        return (
          <div className={`atl-opt-hire ${idle ? "is-idle" : ""}`} key={entry.capability}>
            <b>{entry.capability}</b>
            <span>{idle ? "bez efektu" : parts.join(" · ")}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Ceilings are reported, never manipulated — a search free to raise `maxFte`
 *  would raise every one of them. The pace-setting cells still ceiling-bound
 *  after the moves are exactly the ones no team change can touch; the tool
 *  for those lives in Wyceny. */
function CeilingsReport({
  result,
  nameOf,
}: {
  result: PoolOptimizerResult;
  nameOf: (id: string) => string;
}) {
  const bound = result.ceilings.filter((c) => c.ceilingBound);
  const poolBound = result.ceilings.length - bound.length;
  if (result.ceilings.length === 0) return null;
  return (
    <div className="atl-opt-section">
      <span className="atl-eyebrow">sufity ograniczające plan</span>
      <p className="atl-opt-caption">
        sufit to własność pracy, nie zespołu — podnieś go w Wycenach → Propozycje sufitów
      </p>
      {bound.map((c) => (
        <div className="atl-opt-hire" key={`${c.projectId}:${c.capability}`}>
          <b>{c.capability}</b>
          <span className="atl-opt-cell-name" title={nameOf(c.projectId)}>
            {nameOf(c.projectId)}
          </span>
          <span className="atl-opt-cell-fig">
            max {fmt2(c.maxFte)} (pula {fmt2(c.pool)})
          </span>
        </div>
      ))}
      {bound.length === 0 && (
        <div className="atl-opt-hire is-idle">
          <b>—</b>
          <span>żaden sufit nie ogranicza — tempo wszędzie wyznaczają pule</span>
        </div>
      )}
      {poolBound > 0 && (
        <p className="atl-opt-caption">
          {plCount(poolBound, "komórka nadaje tempo", "komórki nadają tempo", "komórek nadaje tempo")}{" "}
          z ograniczenia puli, nie sufitu
        </p>
      )}
    </div>
  );
}

const floorFig = (n: number) => (Number.isFinite(n) ? `${fmt(n)} mies.` : "—");

/** Arithmetic bounds, deliberately labeled as unreachable: they ignore
 *  phasing, ceilings, minimum crews and leaves. The fungible floor is
 *  invariant under zero-sum moves — it is what no redistribution can beat. */
function FloorReport({ before, after }: { before: FloorDiagnostic; after: FloorDiagnostic }) {
  return (
    <div className="atl-opt-section">
      <span className="atl-eyebrow">dolna granica portfela</span>
      <div className="atl-opt-hire">
        <b>{after.binding ?? "—"}</b>
        <span>
          najbardziej obciążona pula: {floorFig(before.perCapabilityMonths)}
          {before.binding ? ` (${before.binding})` : ""} → {floorFig(after.perCapabilityMonths)}
        </span>
      </div>
      <div className="atl-opt-hire">
        <b>Σ</b>
        <span>przy idealnie podzielnym zespole: {floorFig(after.fungibleMonths)}</span>
      </div>
      <p className="atl-opt-caption">
        niezmienna przy przesunięciach i nieosiągalna w praktyce (pomija fazowanie, sufity i
        urlopy) — pokazuje, ile jest do ugrania
      </p>
    </div>
  );
}

/** Why the search stopped, one line per fact. "pula PM pusta" is the real
 *  answer to "why isn't this faster", and no amount of searching changes it. */
function BlockedPoolRows({ blocked }: { blocked: BlockedPoolCandidate[] }) {
  const rows: { key: string; cap: string; reason: string }[] = [];

  const empty = blocked.filter((b) => b.reason === "pool" && b.poolFrom <= 1e-9);
  if (empty.length > 0) {
    rows.push({
      key: "pool-empty",
      cap: empty.map((b) => b.from).join(" "),
      reason: "pule puste — nie ma czego przesuwać",
    });
  }
  for (const b of blocked.filter((c) => c.reason === "pool" && c.poolFrom > 1e-9)) {
    rows.push({
      key: `pool-${b.from}`,
      cap: b.from,
      reason: `pula ${fmt2(b.poolFrom)} FTE — mniej niż krok przesunięcia`,
    });
  }

  const impossible = blocked.filter((b) => b.reason === "impossible");
  if (impossible.length > 0) {
    const pairs = [...new Set(impossible.map((b) => `${b.from}→${b.to ?? "?"}`))];
    rows.push({
      key: "impossible",
      cap: pairs.join(" "),
      reason: "zabranie stąd zeszłoby poniżej minimalnej obsady któregoś projektu",
    });
  }

  const worse = blocked.filter((b) => b.reason === "worse");
  if (worse.length > 0) {
    rows.push({
      key: "worse",
      cap: "—",
      reason: `${plCount(worse.length, "kandydat pogorszyłby", "kandydatów pogorszyłoby", "kandydatów pogorszyłoby")} plan albo złamał termin`,
    });
  }

  const noEffect = blocked.filter((b) => b.reason === "no-effect");
  if (noEffect.length > 0) {
    rows.push({
      key: "no-effect",
      cap: "—",
      reason: `${plCount(noEffect.length, "kandydat bez efektu", "kandydaty bez efektu", "kandydatów bez efektu")} — sufit obłożenia albo zysk poniżej ćwierci miesiąca`,
    });
  }

  if (rows.length === 0) return null;

  return (
    <div className="atl-opt-section">
      <span className="atl-eyebrow">zablokowane</span>
      {rows.map((row) => (
        <div className="atl-opt-blocked" key={row.key}>
          <b>{row.cap}</b>
          <span>{row.reason}</span>
        </div>
      ))}
    </div>
  );
}
