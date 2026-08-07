import { useEffect, useMemo, useState } from "react";
import type { Project } from "../types";
import {
  CATEGORY_ORDER,
  EFFECTIVE_DAYS_PER_PERSON_PER_MONTH,
  monthsNeeded,
  totalEffortDaysByCategory,
  type TeamVariant,
} from "../lib/estimation";
import type { TeamVariantsApi } from "../hooks/useTeamVariants";
import { AdvancedTimeline } from "./AdvancedTimeline";
import { VariantEditor } from "./VariantEditor";
import {
  DENSITIES,
  HUES,
  ZOOMS,
  buildAxis,
  fmt,
  monthLabel,
  variantCaption,
  soft,
  solid,
  wash,
} from "./timelineChrome";
import "./timeline.css";

interface TimelineViewProps {
  projects: Project[];
  variantId: string;
  variantsApi: TeamVariantsApi;
  onVariantChange: (id: string) => void;
  theme: "auto" | "light" | "dark";
  onCycleTheme: () => void;
  onClose: () => void;
}

const WHOLE_PLAN = "All work";

interface VariantRow {
  variant: TeamVariant;
  hue: number;
  people: number;
  /** Infinity when nobody is on it. */
  months: number;
  isBaseline: boolean;
}

interface CompareBand {
  category: string;
  personMonths: number;
  rows: VariantRow[];
  maxPeople: number;
  isWholePlan: boolean;
}

export function TimelineView({
  projects,
  variantId,
  variantsApi,
  onVariantChange,
  theme,
  onCycleTheme,
  onClose,
}: TimelineViewProps) {
  const { variants } = variantsApi;
  const baseline: TeamVariant = variants.find((v) => v.id === variantId) ?? variants[0];

  const [advancedMode, setAdvancedMode] = useState(false);
  const [zoomId, setZoomId] = useState("m");
  const [densityId, setDensityId] = useState("m");
  const [keyOpen, setKeyOpen] = useState(true);
  const [hover, setHover] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  useEffect(() => {
    if (advancedMode) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (editorOpen) setEditorOpen(false);
      else onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editorOpen, onClose, advancedMode]);

  const hueByVariant = useMemo(() => {
    const map: Record<string, number> = {};
    variants.forEach((v, i) => {
      map[v.id] = HUES[i % HUES.length];
    });
    return map;
  }, [variants]);

  const totalsByCategory = useMemo(() => totalEffortDaysByCategory(projects), [projects]);

  // One band per category plus a whole-plan band. Categories draw from separate
  // pools, so the plan lands when the slowest category does.
  const bands: CompareBand[] = useMemo(() => {
    const categoryBands = CATEGORY_ORDER.map((category) => {
      const days = totalsByCategory[category] ?? 0;
      const rows: VariantRow[] = variants.map((v) => {
        const people = v.people[category] ?? 0;
        return {
          variant: v,
          hue: hueByVariant[v.id] ?? HUES[0],
          people,
          months: days === 0 ? 0 : monthsNeeded(days, people),
          isBaseline: v.id === baseline.id,
        };
      });
      return {
        category,
        personMonths: days / EFFECTIVE_DAYS_PER_PERSON_PER_MONTH,
        rows,
        maxPeople: rows.reduce((m, r) => Math.max(m, r.people), 0),
        isWholePlan: false,
      };
    });

    const wholePlan: CompareBand = {
      category: WHOLE_PLAN,
      personMonths: categoryBands.reduce((sum, b) => sum + b.personMonths, 0),
      rows: variants.map((v) => {
        const months = categoryBands.reduce((max, band) => {
          const row = band.rows.find((r) => r.variant.id === v.id);
          return row ? Math.max(max, row.months) : max;
        }, 0);
        return {
          variant: v,
          hue: hueByVariant[v.id] ?? HUES[0],
          people: CATEGORY_ORDER.reduce((sum, c) => sum + (v.people[c] ?? 0), 0),
          months,
          isBaseline: v.id === baseline.id,
        };
      }),
      maxPeople: 0,
      isWholePlan: true,
    };
    wholePlan.maxPeople = wholePlan.rows.reduce((m, r) => Math.max(m, r.people), 0);

    return [wholePlan, ...categoryBands];
  }, [variants, totalsByCategory, hueByVariant, baseline.id]);

  const D = DENSITIES.find((d) => d.id === densityId) ?? DENSITIES[1];
  const ppm = (ZOOMS.find((z) => z.id === zoomId) ?? ZOOMS[1]).ppm;
  const nameW = D.name;
  const barTop = Math.round((D.row - D.bar) / 2);

  const longest = useMemo(() => {
    let max = 0;
    for (const band of bands) {
      for (const row of band.rows) {
        if (Number.isFinite(row.months)) max = Math.max(max, row.months);
      }
    }
    return max;
  }, [bands]);

  const months = Math.max(12, Math.ceil(longest / 6) * 6 + 6);
  const totalW = months * ppm;

  const now = useMemo(() => new Date(), []);
  const startYear = now.getFullYear();
  const startMonth = now.getMonth();

  const { ticks, tickLabels, gridlines } = useMemo(
    () => buildAxis(months, ppm, startYear, startMonth),
    [months, ppm, startYear, startMonth],
  );

  const planRows = bands[0].rows;
  const baselinePlan = planRows.find((r) => r.isBaseline) ?? planRows[0];
  const fastestPlan = planRows.reduce((best, r) => (r.months < best.months ? r : best), planRows[0]);

  function deltaAgainstBaseline(row: VariantRow, band: CompareBand) {
    const base = band.rows.find((r) => r.isBaseline);
    if (!base || row.isBaseline) return null;
    if (!Number.isFinite(row.months) || !Number.isFinite(base.months)) return null;
    const diff = base.months - row.months;
    if (Math.abs(diff) < 0.05) return { text: "same", color: "var(--ink-3)" };
    const pct = base.months > 0 ? Math.abs(diff) / base.months : 0;
    const faster = diff > 0;
    return {
      text: `${faster ? "−" : "+"}${fmt(Math.abs(diff))} mo · ${Math.round(pct * 100)}% ${faster ? "faster" : "slower"}`,
      color: faster ? "var(--accent)" : "var(--warn)",
    };
  }

  function renderRow(band: CompareBand, row: VariantRow) {
    const hovered = hover === row.variant.id;
    const base = band.rows.find((r) => r.isBaseline);
    const delta = deltaAgainstBaseline(row, band);
    const noPeople = row.people <= 0 && band.personMonths > 0;
    const noWork = band.personMonths === 0;

    const width = noPeople || noWork ? 0 : Math.max(4, Math.round(row.months * ppm));
    const height = D.bar;
    const baselineX =
      base && !row.isBaseline && Number.isFinite(base.months) ? Math.round(base.months * ppm) : null;

    const outParts: { text: string; color: string }[] = [];
    if (noWork) outParts.push({ text: "no work queued", color: "var(--ink-4)" });
    else if (noPeople) outParts.push({ text: "nobody assigned — never finishes", color: "var(--warn)" });
    else outParts.push({ text: `${fmt(row.months)} mo`, color: "var(--ink-2)" });
    if (delta) outParts.push({ text: delta.text, color: delta.color });

    return (
      <div
        key={row.variant.id}
        className="atl-row"
        style={{ height: D.row, background: hovered ? "var(--row-hover)" : "transparent" }}
        onMouseEnter={() => setHover(row.variant.id)}
        onMouseLeave={() => setHover((h) => (h === row.variant.id ? null : h))}
        onClick={() => onVariantChange(row.variant.id)}
      >
        <div
          className="atl-row-name"
          style={{
            width: nameW,
            background: hovered ? "var(--name-hover)" : "var(--band)",
            cursor: "pointer",
          }}
          title={`Compare against ${row.variant.label}`}
        >
          <span
            className="atl-hue"
            style={{ height: D.bar, background: solid(row.hue), opacity: row.isBaseline ? 1 : 0.55 }}
          />
          <span
            className="atl-row-title"
            style={{ fontSize: D.fsName, fontWeight: row.isBaseline ? 600 : 400 }}
          >
            {row.variant.label}
          </span>
          {row.isBaseline && <span className="atl-band-badge">baseline</span>}
          <span className="atl-row-id" style={{ fontSize: D.fsMono }}>
            {row.people}p
          </span>
        </div>

        <div className="atl-row-track" style={{ width: totalW, height: D.row }}>
          {gridlines.map((x) => (
            <div key={x} className="atl-grid" style={{ left: x, height: D.row, background: "var(--line)" }} />
          ))}

          {width > 0 && height > 0 && (
            <div
              className="atl-bar"
              style={{
                left: 0,
                top: barTop,
                width,
                height,
                border: `1px solid ${row.isBaseline ? solid(row.hue) : "transparent"}`,
                background: row.isBaseline ? solid(row.hue) : soft(row.hue),
                cursor: "pointer",
              }}
            >
              {width >= 34 && height >= 12 && (
                <span
                  className="atl-seg-people"
                  style={{
                    bottom: Math.max(2, Math.round((height - 10) / 2)),
                    color: row.isBaseline ? "var(--on-bar)" : "var(--ink)",
                  }}
                >
                  {row.people}
                </span>
              )}
            </div>
          )}

          {/* where the baseline lands, so the gap is visible and not just stated */}
          {baselineX != null && width > 0 && (
            <div
              style={{
                position: "absolute",
                left: baselineX,
                top: barTop - 3,
                width: 1,
                height: D.bar + 6,
                background: "transparent",
                borderLeft: `1px dashed ${wash(base!.hue, 0.75)}`,
              }}
            />
          )}

          <div
            className="atl-out-label"
            style={{ left: width, top: barTop, height: D.bar, gap: 10 }}
          >
            {outParts.map((p, i) => (
              <span key={i} style={{ color: p.color }}>
                {p.text}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  function renderBand(band: CompareBand) {
    const finite = band.rows.filter((r) => Number.isFinite(r.months) && r.months > 0);
    const best = finite.reduce<VariantRow | null>(
      (b, r) => (b == null || r.months < b.months ? r : b),
      null,
    );
    const worst = finite.reduce<VariantRow | null>(
      (b, r) => (b == null || r.months > b.months ? r : b),
      null,
    );
    const spread =
      best && worst && worst.months > 0 && best.variant.id !== worst.variant.id
        ? Math.round(((worst.months - best.months) / worst.months) * 100)
        : 0;

    return (
      <section className={`atl-band ${band.isWholePlan ? "atl-band-total" : ""}`} key={band.category}>
        <div className="atl-band-head" style={{ height: D.band }}>
          <div className="atl-band-name" style={{ width: nameW }}>
            <div
              style={{
                flex: "none",
                width: 3,
                height: D.bar,
                background: band.isWholePlan ? "var(--accent)" : "var(--ink-3)",
                opacity: 0.6,
              }}
            />
            <b>{band.category}</b>
            <span className="atl-band-people">{fmt(band.personMonths)} person-mo</span>
          </div>
          <div className="atl-band-track" style={{ width: totalW }}>
            <div className="atl-band-chips" style={{ left: 0, height: D.band }}>
              {best && (
                <span style={{ color: "var(--ink-2)" }}>
                  fastest {best.variant.label.toLowerCase()} · {fmt(best.months)} mo
                </span>
              )}
              {spread > 0 && (
                <span style={{ color: "var(--accent)" }}>{spread}% between best and worst</span>
              )}
              {!best && <span style={{ color: "var(--ink-4)" }}>nothing scheduled</span>}
            </div>
          </div>
        </div>

        <div className="atl-rows">{band.rows.map((row) => renderRow(band, row))}</div>
      </section>
    );
  }

  if (advancedMode) {
    return (
      <AdvancedTimeline
        projects={projects}
        variantId={variantId}
        variantsApi={variantsApi}
        onVariantChange={onVariantChange}
        onExitAdvanced={() => setAdvancedMode(false)}
        theme={theme}
        onCycleTheme={onCycleTheme}
        onClose={onClose}
      />
    );
  }

  const planDelta = deltaAgainstBaseline(fastestPlan, bands[0]);
  const themeLabel = theme === "auto" ? "AUTO" : theme === "dark" ? "DARK" : "LIGHT";

  return (
    <div
      className="atl"
      data-theme={theme === "auto" ? undefined : theme}
      role="dialog"
      aria-modal="true"
      aria-label="Capacity comparison"
    >
      <header className="atl-header" style={{ height: D.hdr }}>
        <div className="atl-title">
          <b>Capacity timeline</b>
          <span className="atl-chip">compare</span>
        </div>

        <div className="atl-group is-divided">
          <span className="atl-eyebrow" style={{ paddingLeft: 10 }}>
            baseline
          </span>
          <div className="atl-seg">
            {variants.map((v) => (
              <button
                key={v.id}
                type="button"
                className={`atl-seg-text ${v.id === variantId ? "is-active" : ""}`}
                onClick={() => onVariantChange(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
          <button type="button" className="atl-btn" onClick={() => setEditorOpen(true)}>
            Edit…
          </button>
        </div>

        <div className="atl-spacer" />

        <div className="atl-group">
          <span className="atl-eyebrow" title="row density">
            den
          </span>
          <div className="atl-seg">
            {DENSITIES.map((d) => (
              <button
                key={d.id}
                type="button"
                className={`atl-seg-icon ${d.id === D.id ? "is-active" : ""}`}
                onClick={() => setDensityId(d.id)}
              >
                {d.label}
              </button>
            ))}
          </div>
          <span className="atl-eyebrow" title="months per screen" style={{ paddingLeft: 3 }}>
            zoom
          </span>
          <div className="atl-seg">
            {ZOOMS.map((z) => (
              <button
                key={z.id}
                type="button"
                className={`atl-seg-icon ${z.id === zoomId ? "is-active" : ""}`}
                onClick={() => setZoomId(z.id)}
              >
                {z.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`atl-btn ${keyOpen ? "is-on" : ""}`}
            onClick={() => setKeyOpen((v) => !v)}
          >
            Key
          </button>
          <button
            type="button"
            className="atl-btn is-mono"
            onClick={onCycleTheme}
          >
            {themeLabel}
          </button>
          <button type="button" className="atl-btn" onClick={() => setAdvancedMode(true)}>
            Advanced
          </button>
          <div className="atl-rule" />
          <button type="button" className="atl-close" onClick={onClose} aria-label="Close timeline">
            ×
          </button>
        </div>
      </header>

      {keyOpen && (
        <div className="atl-key">
          <div className="atl-key-item">
            <div className="atl-key-bar" style={{ borderStyle: "solid", borderColor: "var(--line-strong)" }}>
              <i style={{ left: 0, width: 20, height: 13, background: "var(--accent)", borderRadius: 1 }} />
            </div>
            <span>one row per variant · length = time to clear the category · number = people on it</span>
          </div>
          <div className="atl-key-item">
            <div
              className="atl-key-bar"
              style={{ border: "none", background: "none", width: 34, display: "flex", alignItems: "center" }}
            >
              <span style={{ borderLeft: "1px dashed var(--accent)", height: 15, marginLeft: 16 }} />
            </div>
            <span>where the baseline variant lands</span>
          </div>
          <div className="atl-key-item">
            <span className="atl-key-num" style={{ color: "var(--accent)" }}>
              −2 mo · 30% faster
            </span>
            <span>against the baseline, per category</span>
          </div>
          <div className="atl-key-item">
            <span className="atl-key-num">click</span>
            <span>a row to make that variant the baseline</span>
          </div>
        </div>
      )}

      <div className="atl-scroll">
        <div className="atl-axis" style={{ height: D.axis }}>
          <div className="atl-axis-corner" style={{ width: nameW }}>
            <span className="atl-eyebrow">variant</span>
          </div>
          <div className="atl-track" style={{ width: totalW, height: D.axis }}>
            {ticks.map((t, i) => (
              <div key={i} className="atl-tick" style={{ left: t.x, height: t.h, background: t.color }} />
            ))}
            {tickLabels.map((t, i) => (
              <div key={i} className="atl-tick-label" style={{ left: t.x, color: t.color }}>
                {t.label}
              </div>
            ))}
          </div>
        </div>

        {bands.map((band) => renderBand(band))}

        <div style={{ display: "flex", height: D.axis }}>
          <div
            style={{
              position: "sticky",
              left: 0,
              zIndex: 4,
              flex: "none",
              width: nameW,
              background: "var(--surface)",
              borderRight: "1px solid var(--line-strong)",
            }}
          />
          <div style={{ flex: "none", width: totalW }} />
        </div>
      </div>

      <footer className="atl-footer" style={{ height: D.foot }}>
        <span>baseline · {variantCaption(baseline.label)}</span>
        <span>
          {fmt(bands[0].personMonths)} person-months of work · {CATEGORY_ORDER.length} categories
        </span>
        <span>
          lands {Number.isFinite(baselinePlan.months) ? monthLabel(startYear, startMonth, baselinePlan.months) : "never"}
        </span>
        {planDelta ? (
          <span style={{ color: planDelta.color }}>
            best {fastestPlan.variant.label.toLowerCase()} · {planDelta.text}
          </span>
        ) : (
          <span style={{ color: "var(--accent)" }}>baseline is the fastest</span>
        )}
        <span style={{ flex: 1 }} />
        <span>click a row to rebase · esc closes variants · then view</span>
      </footer>

      {editorOpen && (
        <VariantEditor
          api={variantsApi}
          activeId={baseline.id}
          onActivate={onVariantChange}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </div>
  );
}
