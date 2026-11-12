import { describe, expect, it } from "vitest";
import { nomClient } from "@/lib/nom-plat";
import { courrielConfirmation } from "@/lib/courriel/modeles";
import type { Commande } from "@/lib/db/serveur";

// Conforts restants du rapport client mystère (docs/audits/client-mystere.md).

describe("CM-22 : un seul nom de plat pour le client", () => {
  it("les pizzas gardent le nom de la carte, sans « Pizza » et avec une majuscule", () => {
    expect(nomClient("Pizza Margherita", true)).toBe("Margherita");
    expect(nomClient("Pizza peppino", true)).toBe("Peppino");
    expect(nomClient("Pizza 4 fromages", true)).toBe("4 fromages");
  });
  it("les autres plats ne changent pas", () => {
    expect(nomClient("Lasagne de bœuf", false)).toBe("Lasagne de bœuf");
    expect(nomClient("Pizza dessert", false)).toBe("Pizza dessert");
  });

  it("l'e-mail de confirmation reprend le nom de la carte", () => {
    const ligne = (nom: string, station: "pizza" | "cuisine", position: number) => ({
      position,
      plat_slug: "x",
      nom,
      station,
      qte: 1,
      unitaire_centimes: 0,
      total_centimes: 0,
      choix: {},
      retraits: [],
      note: "",
    });
    const c = {
      id: "c",
      numero: 7,
      jour: "2026-11-10",
      jeton_suivi: "j",
      mode: "retrait",
      statut: "nouvelle",
      statut_paiement: "paye",
      moyen_paiement: "en_ligne",
      client_prenom: "Léa",
      client_nom: "Test",
      client_telephone: "079 000 00 00",
      client_email: "lea@laferme.test",
      adresse: null,
      details_livraison: null,
      quand_type: "asap",
      quand_date: null,
      quand_minutes: null,
      heure_confirmee: null,
      zone_numero: null,
      pizzas_seulement: false,
      avertissement: null,
      sous_total_centimes: 0,
      frais_centimes: 0,
      total_centimes: 0,
      tva_centimes: 0,
      taux_tva_pourcent: 2.6,
      stripe_session_id: null,
      stripe_payment_intent: null,
      motif: null,
      compte_id: null,
      compte_demande: false,
      origine: "http://localhost",
      cree_le: "2026-11-10T18:05:00Z",
      lignes: [ligne("Pizza peppino", "pizza", 1), ligne("Lasagne de bœuf", "cuisine", 2)],
    } as unknown as Commande;
    const m = courrielConfirmation(c, null);
    expect(m.texte).toContain("1 × Peppino");
    expect(m.texte).toContain("1 × Lasagne de bœuf");
    expect(m.texte).not.toContain("Pizza peppino");
    expect(m.html).toContain("1 × Peppino");
  });
});
