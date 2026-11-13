import { describe, expect, it } from "vitest";
import type { Commande } from "@/lib/db/serveur";
import { courrielAcceptation, courrielConfirmation, courrielNouvelleHeure } from "@/lib/courriel/modeles";
import { plageCommande } from "@/lib/suivi";

// Vague 3, client-compte : le client lit la même heure partout (accueil, suivi, e-mails), en fourchette selon
// les réglages de bo-operations ; l'allergie signalée est rappelée sans être recopiée dans l'e-mail.

const commande = {
  id: "c1",
  numero: 37,
  jeton_suivi: "abcdefghijklmnopqrstuvwxyz",
  mode: "livraison",
  statut: "acceptee",
  statut_paiement: "paye",
  moyen_paiement: "en_ligne",
  client_prenom: "Léa",
  adresse: { rue: "Route de Chancy", numero: "1", npa: "1213", localite: "Onex" },
  quand_type: "asap",
  quand_date: null,
  quand_minutes: null,
  heure_confirmee: "2026-11-10T18:40:00Z",
  sous_total_centimes: 4300,
  frais_centimes: 0,
  total_centimes: 4300,
  tva_centimes: 109,
  taux_tva_pourcent: 2.6,
  origine: "https://commande.exemple.test",
  allergie: "",
  lignes: [],
} as unknown as Commande;

const config = (livraison: number, retrait: number) => ({ reglages: { fourchette: { livraison, retrait } } }) as never;

describe("heure en fourchette", () => {
  it("suivi : même calcul que l'accueil (fourchette + plageTexte)", () => {
    // 18:40 UTC = 19h40 à Genève (novembre). Largeur 15 : de 19h35 à 19h50 (arrondi aux 5 minutes).
    expect(plageCommande(commande, config(15, 10))).toEqual({ basse: 19 * 60 + 35, haute: 19 * 60 + 50 });
    expect(plageCommande(commande, config(0, 0))).toEqual({ basse: 19 * 60 + 40, haute: 19 * 60 + 40 });
    expect(plageCommande(commande, null)).toEqual({ basse: 19 * 60 + 40, haute: 19 * 60 + 40 });
  });

  it("e-mails : « entre … et … » avec la configuration, « vers » sans elle ou à largeur 0", () => {
    expect(courrielAcceptation(commande, commande.heure_confirmee!, config(15, 10)).texte).toContain("Le livreur passe chez vous entre 19h35 et 19h50.");
    expect(courrielNouvelleHeure(commande, commande.heure_confirmee!, config(15, 10)).texte).toContain("entre 19h35 et 19h50");
    expect(courrielAcceptation(commande, commande.heure_confirmee!).texte).toContain("Le livreur passe chez vous vers 19h40.");
    expect(courrielAcceptation(commande, commande.heure_confirmee!, config(0, 0)).texte).toContain("vers 19h40.");
    const retrait = { ...(commande as object), mode: "retrait", adresse: null } as unknown as Commande;
    expect(courrielAcceptation(retrait, commande.heure_confirmee!, config(15, 10)).texte).toContain("Elle sera prête entre 19h35 et 19h45, Route de Chancy 132 à Onex.");
  });
});

describe("allergie signalée", () => {
  it("l'e-mail de confirmation la mentionne sans recopier le texte (copies en base, transferts)", () => {
    const avec = { ...(commande as object), statut: "nouvelle", allergie: "Arachides, sévère" } as unknown as Commande;
    const m = courrielConfirmation(avec, null);
    expect(m.texte).toContain("Vous avez signalé une allergie. Vérifiez-la sur la page de suivi.");
    expect(m.texte).not.toContain("Arachides");
    expect(m.html).not.toContain("Arachides");
    expect(courrielConfirmation({ ...(commande as object), allergie: "" } as unknown as Commande, null).texte).not.toContain("allergie");
  });
});
