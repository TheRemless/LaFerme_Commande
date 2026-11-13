import { describe, expect, it } from "vitest";
import { validerCoupDeFeu } from "@/lib/coup-de-feu-regles";

describe("validerCoupDeFeu", () => {
  it("accepte le geste proposé", () => {
    expect(validerCoupDeFeu({ retard_minutes: 20, duree_minutes: 60, capacite_livraison: 2, capacite_retrait: 2 })).toEqual({
      ok: true,
      valeur: { retard_minutes: 20, duree_minutes: 60, livraison_fermee: false, capacite_livraison: 2, capacite_retrait: 2 },
    });
  });

  it("capacités absentes ou nulles : inchangées", () => {
    const r = validerCoupDeFeu({ duree_minutes: 30, livraison_fermee: true, capacite_livraison: null });
    expect(r).toEqual({ ok: true, valeur: { retard_minutes: 0, duree_minutes: 30, livraison_fermee: true, capacite_livraison: null, capacite_retrait: null } });
  });

  it.each([
    [{ retard_minutes: 91, duree_minutes: 60 }, /Retard/],
    [{ retard_minutes: 2.5, duree_minutes: 60 }, /Retard/],
    [{ retard_minutes: "20", duree_minutes: 60 }, /Retard/],
    [{ retard_minutes: 20 }, /Durée/],
    [{ retard_minutes: 20, duree_minutes: 14 }, /Durée/],
    [{ retard_minutes: 20, duree_minutes: 60, livraison_fermee: "oui" }, /Livraison/],
    [{ retard_minutes: 20, duree_minutes: 60, capacite_retrait: 0 }, /créneau/],
    [{ retard_minutes: 20, duree_minutes: 60, capacite_livraison: 51 }, /créneau/],
    [{ duree_minutes: 60 }, /au moins un/],
    [null, /illisibles/],
  ])("refuse %j", (corps, erreur) => {
    const r = validerCoupDeFeu(corps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreur).toMatch(erreur);
  });
});
