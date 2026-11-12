import { describe, expect, it } from "vitest";
import type { Commande } from "@/lib/db/serveur";
import { courrielAcceptation, courrielCode, courrielConfirmation, courrielRefus } from "@/lib/courriel/modeles";

// Mise en page des courriels (audit design, D17) : logo en tête, bouton de suivi, total en gras.
const commande = {
  id: "c1",
  numero: 37,
  jeton_suivi: "abcdefghijklmnopqrstuvwxyz",
  mode: "retrait",
  statut: "nouvelle",
  statut_paiement: "paye",
  moyen_paiement: "en_ligne",
  client_prenom: "Léa",
  client_nom: "Rossi",
  adresse: null,
  details_livraison: null,
  quand_type: "asap",
  quand_date: null,
  quand_minutes: null,
  heure_confirmee: null,
  sous_total_centimes: 4300,
  frais_centimes: 0,
  total_centimes: 4300,
  tva_centimes: 109,
  taux_tva_pourcent: 2.6,
  origine: "https://commande.exemple.test",
  lignes: [{ position: 1, plat_slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 1800, total_centimes: 1800, choix: {}, retraits: [], note: "" }],
} as unknown as Commande;

describe("courriels : mise en page", () => {
  it("la confirmation a le logo, un bouton de suivi et le total en gras", () => {
    const { html } = courrielConfirmation(commande, null);
    expect(html).toContain('src="https://commande.exemple.test/logo-la-ferme.png"');
    expect(html).toContain('href="https://commande.exemple.test/suivi/abcdefghijklmnopqrstuvwxyz" style="display:inline-block');
    expect(html).toMatch(/font-weight:700[^>]*>Total</);
  });

  it("l'acceptation a le bouton de suivi, le refus n'en a pas", () => {
    expect(courrielAcceptation(commande, "2026-11-10T18:45:00Z").html).toContain(">Suivre la commande</a>");
    expect(courrielRefus(commande, "La cuisine est complète pour ce service.").html).not.toContain("Suivre la commande");
  });

  it("le code de connexion a le logo du site, et le texte seul ne change pas", () => {
    const m = courrielCode("482913");
    expect(m.html).toContain("/logo-la-ferme.png");
    expect(m.texte).not.toContain("<");
  });
});
