import { describe, expect, it } from "vitest";
import { envoyerMaintenant, INTERVALLE_POSITION_MS } from "@/components/livreur/partage-position";

// Rythme d'envoi de la position depuis le téléphone du livreur.
describe("envoi de la position", () => {
  it("la première, à chaque changement d'arrêt, puis toutes les 20 secondes", () => {
    expect(envoyerMaintenant(null, "a", 1000)).toBe(true);
    expect(envoyerMaintenant({ arret: "a", le: 1000 }, "a", 1000 + INTERVALLE_POSITION_MS - 1)).toBe(false);
    expect(envoyerMaintenant({ arret: "a", le: 1000 }, "a", 1000 + INTERVALLE_POSITION_MS)).toBe(true);
    expect(envoyerMaintenant({ arret: "a", le: 1000 }, "b", 1001)).toBe(true);
  });
});

describe("arrêt suivi, stabilisé", () => {
  it("un null passager (rechargement après « Je pars ») n'arrête pas le partage ; un null qui dure, si", async () => {
    const { vi } = await import("vitest");
    const { suiviArret, DELAI_FIN_MS } = await import("@/components/livreur/partage-position");
    vi.useFakeTimers();
    const vus: (string | null)[] = [];
    const s = suiviArret(DELAI_FIN_MS, (a) => vus.push(a));
    s.changer("c1");
    s.changer(null);
    vi.advanceTimersByTime(300);
    s.changer("c1");
    vi.advanceTimersByTime(DELAI_FIN_MS * 2);
    expect(vus).toEqual(["c1", "c1"]);
    s.changer(null);
    vi.advanceTimersByTime(DELAI_FIN_MS - 1);
    expect(vus).toEqual(["c1", "c1"]);
    vi.advanceTimersByTime(1);
    expect(vus).toEqual(["c1", "c1", null]);
    s.changer(null);
    s.arreter();
    vi.advanceTimersByTime(DELAI_FIN_MS);
    expect(vus).toEqual(["c1", "c1", null]);
    vi.useRealTimers();
  });
});
