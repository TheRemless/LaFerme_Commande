import { describe, expect, it } from "vitest";
import { prixChf, prixCourt } from "@/lib/prix";

describe("format des prix", () => {
  it("écrit un montant rond avec un tiret", () => {
    expect(prixCourt(1200)).toBe("12.–");
  });
  it("garde les centimes sinon", () => {
    expect(prixCourt(1235)).toBe("12.35");
    expect(prixCourt(450)).toBe("4.50");
  });
  it("préfixe les totaux par CHF", () => {
    expect(prixChf(10195)).toBe("CHF 101.95");
  });
});
