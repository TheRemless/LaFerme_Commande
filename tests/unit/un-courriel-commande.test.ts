import { describe, expect, it } from "vitest";
import type { Commande } from "@/lib/db/serveur";
import { courrielConfirmation } from "@/lib/courriel/modeles";

// Un seul e-mail à la commande (Jérémy, 13.11.2026) : récapitulatif, reçu et lien de suivi. L'heure confirmée,
// « prête » et « en route » se lisent sur la page de suivi.

const base = {
  id: "c1",
  numero: 41,
  jeton_suivi: "abcdefghijklmnopqrstuvwxyz",
  mode: "retrait",
  statut: "nouvelle",
  statut_paiement: "paye",
  moyen_paiement: "en_ligne",
  client_prenom: "Léa",
  adresse: null,
  quand_type: "asap",
  quand_date: null,
  quand_minutes: null,
  sous_total_centimes: 1800,
  frais_centimes: 0,
  total_centimes: 1800,
  tva_centimes: 46,
  taux_tva_pourcent: 2.6,
  origine: "https://commande.exemple.test",
  allergie: "",
  lignes: [],
} as unknown as Commande;

describe("e-mail de confirmation, seul e-mail de la commande", () => {
  it("renvoie au suivi pour l'heure confirmée et donne le reçu d'une commande payée", () => {
    const m = courrielConfirmation(base, null);
    expect(m.texte).toContain("Le restaurant confirme l'heure sur la page de suivi dès qu'il accepte la commande.");
    expect(m.texte).not.toContain("vous confirme l'heure dès qu'il l'accepte");
    expect(m.texte).toContain("Suivre la commande : https://commande.exemple.test/suivi/abcdefghijklmnopqrstuvwxyz");
    expect(m.texte).toContain("Reçu avec TVA : https://commande.exemple.test/suivi/abcdefghijklmnopqrstuvwxyz/recu");
    expect(m.html).toContain('href="https://commande.exemple.test/suivi/abcdefghijklmnopqrstuvwxyz/recu"');
  });

  it("à payer au comptoir : pas encore de reçu", () => {
    const m = courrielConfirmation({ ...base, moyen_paiement: "comptoir", statut_paiement: "a_encaisser_retrait" } as Commande, null);
    expect(m.texte).not.toContain("Reçu avec TVA");
    expect(m.html).not.toContain("/recu");
  });
});
