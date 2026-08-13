import { X } from "lucide-react";
import type { PoolProposalApi } from "../hooks/usePoolProposal";
import type { BlockedPoolCandidate } from "../lib/poolOptimizer";
import type { CapabilityVector, Project } from "../types";
import { fmt, fmt2, plCount, weeksOf } from "./timelineChrome";

interface PoolProposalDrawerProps {
  api: PoolProposalApi;
  baselineLabel: string;
  projectById: Map<string, Project>;
  /** Header/footer heights vary with the density control, unlike cm2's fixed
   *  chrome — so the drawer takes its vertical bounds from the screen. */
  insets: { top: number; bottom: number };
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
          <p className="is-muted">
            Nic nie zostanie zapisane — przyjęte ruchy trafiają do nowego wariantu, obok obecnych.
            Każdy ruch zakłada, że ludzie są wymienni między kompetencjami; tego program nie jest w
            stanie sprawdzić.
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
