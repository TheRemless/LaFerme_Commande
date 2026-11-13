import { describe, expect, it } from "vitest";
import type { Commande } from "@/lib/db/serveur";
import { courrielAcceptation, courrielCode, courrielConfirmation, courrielRemboursementGeste } from "@/lib/courriel/modeles";

// Vague 3, client-compte : lisibles sur téléphone dans Gmail, Outlook et Apple Mail, en mode sombre, avec
// une ligne d'aperçu utile dans la boîte de réception. Montants d'essai.
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

const tous = () => [
  courrielConfirmation(commande, null),
  courrielAcceptation(commande, "2026-11-10T18:45:00Z"),
  courrielRemboursementGeste(commande, 500, "Plat froid."),
  courrielCode("482913"),
];

describe("courriels : lisibilité", () => {
  it("document complet en français, thème clair déclaré, fond blanc explicite", () => {
    for (const { html } of tous()) {
      expect(html.startsWith("<!doctype html>")).toBe(true);
      expect(html).toContain('<html lang="fr">');
      expect(html).toContain('<meta name="color-scheme" content="light">');
      expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
      expect(html).toMatch(/<body[^>]*style="[^"]*background:#ffffff/);
    }
  });

  it("une ligne d'aperçu cachée, qui dit l'essentiel", () => {
    const aperçu = (html: string) => html.match(/<div style="display:none[^"]*"[^>]*>([^<]*)<\/div>/)?.[1];
    expect(aperçu(courrielConfirmation(commande, null).html)).toBe("Nous avons bien reçu votre commande n° 37.");
    expect(aperçu(courrielAcceptation(commande, "2026-11-10T18:45:00Z").html)).toBe("Votre commande n° 37 est acceptée.");
    expect(aperçu(courrielCode("482913").html)).toBe("Votre code est valable 10 minutes.");
  });

  it("le bouton garde sa couleur dans Outlook (bgcolor)", () => {
    expect(courrielAcceptation(commande, "2026-11-10T18:45:00Z").html).toMatch(/<td bgcolor="#1c1b1a"/);
  });
});
