/**
 * The autopilot's output, as a list of claims you accept one at a time.
 *
 * Deliberately not a button that rewrites the matrix. Every move here is the
 * machine asserting that more people could usefully work on something — it has
 * not seen the codebase, the onboarding cost, or whether the work splits at
 * all. It only knows which cell the arithmetic is currently leaning on. So it
 * proposes, shows what each one buys, and waits.
 *
 * The blocked list is the more valuable half once the easy moves are gone:
 * "pula UX = 1.0 — nie ma kogo dołożyć" is the actual answer to why the plan
 * is not shorter, and no amount of searching will change it.
 */
import { X } from "lucide-react";
import type { BlockedCandidate, CeilingMove } from "../lib/autopilot";
import type { CeilingProposalApi } from "../hooks/useCeilingProposal";
import { CAPABILITY_LABELS } from "../lib/estimation";
import type { Project } from "../types";
import { fmt, plCount } from "./timelineChrome";

const EPS = 1e-6;

function fmt2(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Math.abs(r - Math.round(r)) < 0.005 ? String(Math.round(r)) : r.toFixed(2);
}

const signed = (n: number) => `${n >= 0 ? "+" : "−"}${fmt(Math.abs(n))}`;

interface CeilingProposalsProps {
  api: CeilingProposalApi;
  projectById: Map<string, Project>;
  floorMonths: number;
  floorCapability: string | null;
  onApply: (moves: CeilingMove[]) => void;
  onClose: () => void;
}

export function CeilingProposals({
  api,
  projectById,
  floorMonths,
  floorCapability,
  onApply,
  onClose,
}: CeilingProposalsProps) {
  const { status, result, found, accepted, previewHorizon } = api;
  const nameOf = (id: string) => projectById.get(id)?.name ?? id;

  const before = result?.horizonBefore ?? 0;
  const preview = previewHorizon ?? before;
  // With an impossible project in the plan both horizons are Infinity and the
  // difference is NaN — a dash says more than either would.
  const finiteDelta = Number.isFinite(before) && Number.isFinite(preview);
  const delta = finiteDelta ? preview - before : 0;

  return (
    <aside className="cp" aria-label="Propozycje sufitów">
      <header className="cp-head">
        <div>
          <b>Propozycje sufitów</b>
          <span className="cp-sub">tylko kompetencje, które wyznaczają tempo</span>
        </div>
        <button type="button" className="atl-close" onClick={onClose} aria-label="Zamknij propozycje">
          <X size={15} />
        </button>
      </header>

      {status === "idle" && (
        <div className="cp-body cp-intro">
          <p>
            Szukam sufitów, których podniesienie faktycznie coś zmienia. W fazie tylko jedna
            kompetencja jest na swoim suficie — reszta i tak zwalnia, żeby skończyć razem, więc
            podnoszenie ich niczego nie przyspieszy.
          </p>
          <p className="cp-muted">
            Nic nie zostanie zapisane, dopóki sam nie zatwierdzisz. Każda propozycja to twierdzenie
            „tu da się sensownie dołożyć ludzi” — tego program nie jest w stanie sprawdzić.
          </p>
          <button type="button" className="cp-primary" onClick={api.run}>
            Szukaj propozycji
          </button>
        </div>
      )}

      {status === "running" && (
        <div className="cp-body cp-intro">
          <p className="cp-running">
            <span className="cp-spinner" aria-hidden="true" />
            Przeliczam plan od nowa dla każdej kandydatki…
          </p>
          <p className="cp-muted">
            {plCount(found, "ruch", "ruchy", "ruchów")} znalezione. Każda runda to pełna symulacja
            całego portfela.
          </p>
          <button type="button" className="atl-btn" onClick={api.cancel}>
            Przerwij
          </button>
        </div>
      )}

      {status === "ready" && result && (
        <>
          <div className="cp-summary">
            <div className="cp-figures">
              <span>
                <em>teraz</em>
                <b>{Number.isFinite(before) ? fmt(before) : "—"}</b>
              </span>
              <span className="cp-arrow" aria-hidden="true">→</span>
              <span>
                <em>po zmianach</em>
                <b className={delta < -EPS ? "is-ok" : undefined}>
                  {Number.isFinite(preview) ? fmt(preview) : "—"}
                </b>
              </span>
              <span className="cp-delta">
                <em>różnica</em>
                <b className={delta < -EPS ? "is-ok" : delta > EPS ? "is-warn" : undefined}>
                  {finiteDelta ? `${Math.abs(delta) < 0.05 ? "0" : signed(delta)} mies.` : "—"}
                </b>
              </span>
            </div>
            {floorCapability && (
              <p className="cp-floor">
                Ściana: <b>{fmt(floorMonths)} mies.</b> — tyle samo zajmie sam nakład{" "}
                <b>{floorCapability}</b> przy obecnej puli. Żaden sufit tego nie przeskoczy.
              </p>
            )}
          </div>

          <div className="cp-body">
            {result.moves.length === 0 ? (
              <p className="cp-none">
                Nie ma czego podnosić — każda kompetencja wyznaczająca tempo albo nie ma już kogo
                dołożyć, albo dołożenie ludzi wydłużyłoby plan.
              </p>
            ) : (
              <>
                <div className="cp-actions-top">
                  <span className="atl-eyebrow">
                    {plCount(accepted.size, "zaznaczona", "zaznaczone", "zaznaczonych")} z{" "}
                    {result.moves.length}
                  </span>
                  <span style={{ flex: 1 }} />
                  <button type="button" className="cp-link" onClick={() => api.setAll(true)}>
                    zaznacz wszystkie
                  </button>
                  <button type="button" className="cp-link" onClick={() => api.setAll(false)}>
                    odznacz
                  </button>
                </div>

                <ul className="cp-list">
                  {result.moves.map((move, index) => (
                    <li key={`${move.projectId}-${move.capability}-${index}`}>
                      <label className={`cp-move ${accepted.has(index) ? "is-on" : ""}`}>
                        <input
                          type="checkbox"
                          checked={accepted.has(index)}
                          onChange={() => api.toggle(index)}
                        />
                        <span className="cp-move-body">
                          <span className="cp-move-top">
                            <span className="cp-cap">{move.capability}</span>
                            <span className="cp-move-name" title={nameOf(move.projectId)}>
                              {nameOf(move.projectId)}
                            </span>
                            <span className="cp-move-step">
                              {fmt2(move.from)} → <b>{fmt2(move.to)}</b>
                            </span>
                          </span>
                          <span className="cp-move-ask">
                            Czy {fmt2(move.to)} FTE {CAPABILITY_LABELS[move.capability]} naprawdę
                            przyspieszy ten projekt?
                          </span>
                          <span className="cp-move-meta">
                            <span title="o tyle wcześniej kończy się ten projekt">
                              projekt <b>{signed(move.deltaProject)}</b> mies.
                            </span>
                            <span title="o tyle skraca się cały portfel">
                              plan <b>{signed(move.deltaHorizon)}</b> mies.
                            </span>
                            <span className="cp-muted">pula {fmt(move.pool)} FTE</span>
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {result.truncated && (
              <p className="cp-note">
                Zatrzymałem się po {result.moves.length} ruchach. Zatwierdź te i uruchom ponownie —
                po każdej zmianie tempo przechodzi gdzie indziej.
              </p>
            )}

            <BlockedList blocked={result.blocked} nameOf={nameOf} />

            <p className="cp-note cp-muted">
              {plCount(result.simulations, "symulacja", "symulacje", "symulacji")} całego portfela.
            </p>
          </div>

          {api.stale && (
            <p className="cp-note is-warn">
              Macierz zmieniła się od wyliczenia — uruchom ponownie.
            </p>
          )}

          <footer className="cp-foot">
            <button type="button" className="atl-btn" onClick={onClose}>
              Anuluj
            </button>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              className="cp-primary"
              disabled={accepted.size === 0 || api.stale}
              onClick={() => onApply(api.acceptedMoves())}
            >
              Zastosuj {accepted.size > 0 ? `(${accepted.size})` : ""}
            </button>
          </footer>
        </>
      )}
    </aside>
  );
}

/** Why the search stopped, grouped so seven identical UX lines read as one
 *  fact about the team rather than seven separate disappointments. */
function BlockedList({
  blocked,
  nameOf,
}: {
  blocked: BlockedCandidate[];
  nameOf: (id: string) => string;
}) {
  const pool = blocked.filter((b) => b.reason === "pool");
  const worse = blocked.filter((b) => b.reason === "worse");
  const impossible = blocked.filter((b) => b.reason === "impossible");
  const noEffect = blocked.filter((b) => b.reason === "no-effect");
  if (!pool.length && !worse.length && !impossible.length && !noEffect.length) return null;

  // One candidate per (project, capability) — the same project can appear for
  // several capabilities, but the fact worth reading is per project.
  const impossibleNames = [...new Set(impossible.map((b) => nameOf(b.projectId)))];

  const byCapability = new Map<string, BlockedCandidate[]>();
  for (const b of pool) {
    const list = byCapability.get(b.capability);
    if (list) list.push(b);
    else byCapability.set(b.capability, [b]);
  }

  return (
    <div className="cp-blocked">
      <span className="atl-eyebrow">czego nie da się ruszyć</span>

      {[...byCapability.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([capability, items]) => (
          <div key={capability} className="cp-block">
            <p>
              <b>{capability}</b> — pula {fmt(items[0].pool)} FTE.{" "}
              {plCount(items.length, "projekt czeka", "projekty czekają", "projektów czeka")} na tę
              kompetencję i nie ma kogo dołożyć.
            </p>
            <p className="cp-block-list" title={items.map((i) => nameOf(i.projectId)).join("\n")}>
              {items.map((i) => nameOf(i.projectId)).join(" · ")}
            </p>
          </div>
        ))}

      {worse.length > 0 && (
        <div className="cp-block">
          <p>
            {plCount(worse.length, "kandydatka wydłużyłaby", "kandydatki wydłużyłyby", "kandydatek wydłużyłoby")}{" "}
            plan — większa załoga musi mieć więcej ludzi wolnych naraz, żeby faza w ogóle ruszyła,
            więc projekt dłużej czeka w kolejce, niż zyskuje na budowie.
          </p>
        </div>
      )}

      {impossible.length > 0 && (
        <div className="cp-block">
          <p>
            {plCount(
              impossibleNames.length,
              "projekt nie domyka się",
              "projekty nie domykają się",
              "projektów nie domyka się",
            )}{" "}
            przy obecnych pulach — żaden sufit tego nie zmieni, dopiero większa pula.
          </p>
          <p className="cp-block-list" title={impossibleNames.join("\n")}>
            {impossibleNames.join(" · ")}
          </p>
        </div>
      )}

      {noEffect.length > 0 && (
        <div className="cp-block">
          <p>
            {plCount(
              noEffect.length,
              "kandydatka nie zmieniła",
              "kandydatki nie zmieniły",
              "kandydatek nie zmieniło",
            )}{" "}
            niczego — po podniesieniu sufitu tempo i tak wyznacza inna kompetencja.
          </p>
        </div>
      )}
    </div>
  );
}
