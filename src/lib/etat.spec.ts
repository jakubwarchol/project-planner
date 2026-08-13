import { describe, expect, it } from "vitest";
import { etat, etatG, fmt2, fold } from "./etat";

describe("fmt2", () => {
  it("drops decimals that carry nothing", () => {
    expect(fmt2(2)).toBe("2");
    expect(fmt2(2.001)).toBe("2");
  });

  it("writes the fraction with a Polish comma", () => {
    expect(fmt2(0.5)).toBe("0,50");
    expect(fmt2(1.25)).toBe("1,25");
  });
});

describe("etat", () => {
  it("declines whole numbers: 1 etat, 2-4 etaty, 5+ etatów", () => {
    expect(etat(1)).toBe("1 etat");
    expect(etat(2)).toBe("2 etaty");
    expect(etat(4)).toBe("4 etaty");
    expect(etat(5)).toBe("5 etatów");
    expect(etat(12)).toBe("12 etatów");
    expect(etat(22)).toBe("22 etaty");
  });

  it("gives fractions the genitive singular", () => {
    expect(etat(0.5)).toBe("0,50 etatu");
    expect(etat(2.2)).toBe("2,20 etatu");
  });
});

describe("etatG", () => {
  it("keeps 1 in the singular and every other whole number plural", () => {
    expect(etatG(1)).toBe("1 etatu");
    expect(etatG(2)).toBe("2 etatów");
    expect(etatG(5)).toBe("5 etatów");
    expect(etatG(0.8)).toBe("0,80 etatu");
  });
});

describe("fold", () => {
  it("matches Polish names typed without diacritics", () => {
    expect(fold("Bałaciński")).toBe("balacinski");
    expect(fold("Dzięcielski")).toBe("dziecielski");
    expect(fold("Nieć")).toBe("niec");
  });
});
