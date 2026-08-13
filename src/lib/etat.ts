/**
 * Polish "etat" phrasing for the staffing screens. FTE is a planner's unit;
 * the screen talks about etaty — and the word declines with the number, so
 * "2.2 FTE" becomes "2,2 etatu" and a full person is "1 etat", not "1 etatów".
 */

/** Two decimals with a Polish comma where they carry information, none where
 *  they don't — "1,50" and "2", never "2,00". The comma variant of
 *  `timelineChrome.fmt2`, for screens whose copy is entirely Polish. */
export function fmt2(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Math.abs(r - Math.round(r)) < 0.005 ? String(Math.round(r)) : r.toFixed(2).replace(".", ",");
}

const wholeOf = (r: number): number | null =>
  Math.abs(r - Math.round(r)) < 0.005 ? Math.round(r) : null;

/** Nominative: "1 etat", "2 etaty", "5 etatów", "0,50 etatu". Fractions take
 *  the genitive singular the way any Polish fraction does — pół etatu. */
export function etat(n: number): string {
  const r = Math.round(n * 100) / 100;
  const whole = wholeOf(r);
  const word =
    whole === null
      ? "etatu"
      : whole === 1
        ? "etat"
        : whole % 10 >= 2 && whole % 10 <= 4 && !(whole % 100 >= 12 && whole % 100 <= 14)
          ? "etaty"
          : "etatów";
  return `${fmt2(r)} ${word}`;
}

/** Genitive, for "z …" and "brakuje …": "z 1 etatu", "z 2 etatów". */
export function etatG(n: number): string {
  const r = Math.round(n * 100) / 100;
  const whole = wholeOf(r);
  return `${fmt2(r)} ${whole === null || whole === 1 ? "etatu" : "etatów"}`;
}

/** Search folding: case- and diacritic-insensitive, so "bala" finds
 *  "Bałaciński". NFD strips combining marks; ł carries its stroke as part of
 *  the letter rather than a mark, so it needs its own rule. */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l");
}
