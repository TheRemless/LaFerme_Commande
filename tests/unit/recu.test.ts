import { describe, expect, it } from "vitest";
import { recuDisponible, donneesRecu, VENDEUR } from "@/lib/recu";
import type { Commande } from "@/lib/db/serveur";

// Vague 3, client-compte : reçu avec TVA depuis le suivi et le compte. Les faits du vendeur viennent du
// registre (extrait du registre du commerce et registre IDE, lus le 13.11.2026). Montants d'essai.

function commande(p: Partial<Commande> = {}): Commande {
  return {
    id: "c",
    numero: 42,
    jour: "2026-11-13",
    jeton_suivi: "j",
    mode: "livraison",
    statut: "terminee",
    statut_paiement: "paye",
    moyen_paiement: "en_ligne",
    client_prenom: "Léa",
    client_nom: "Essai",
    client_telephone: "079 000 00 00",
    client_email: "lea@exemple.test",
    adresse: { rue: "Route de Chancy", numero: "1", npa: "1213", localite: "Onex" },
    details_livraison: { etage: "", sonnette: "", code: "1234", instructions: "" },
    quand_type: "asap",
    quand_date: null,
    quand_minutes: null,
    heure_confirmee: null,
    zone_numero: 1,
    pizzas_seulement: true,
    avertissement: null,
    sous_total_centimes: 4000,
    frais_centimes: 500,
    total_centimes: 4500,
    tva_centimes: 114,
    taux_tva_pourcent: 2.6,
    stripe_session_id: null,
    stripe_payment_intent: null,
    motif: null,
    compte_id: null,
    compte_demande: false,
    origine: "http://localhost:3000",
    cree_le: "2026-11-13T18:00:00Z",
    paye_le: "2026-11-13T18:01:00Z",
    lignes: [
      { position: 1, slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 2, unitaire_centimes: 2000, total_centimes: 4000, choix: {}, retraits: [], note: "" },
    ],
    ...p,
  } as Commande;
}

describe("reçu avec TVA", () => {
  it("seulement pour une vente payée", () => {
    expect(recuDisponible(commande())).toBe(true);
    expect(recuDisponible(commande({ statut_paiement: "encaisse", moyen_paiement: "comptoir" }))).toBe(true);
    expect(recuDisponible(commande({ statut_paiement: "a_encaisser_retrait", moyen_paiement: "comptoir" }))).toBe(false);
    expect(recuDisponible(commande({ statut: "refusee", statut_paiement: "rembourse" }))).toBe(false);
    expect(recuDisponible(commande({ statut: "paiement_en_attente", statut_paiement: "en_attente" }))).toBe(false);
    expect(recuDisponible(commande({ statut: "annulee", statut_paiement: "echec" }))).toBe(false);
  });

  it("vendeur, numéro de TVA, date, plats, frais, total, taux et montant de la TVA", () => {
    const r = donneesRecu(commande(), null, []);
    expect(VENDEUR).toEqual({
      raison: "Restaurant La Ferme Sàrl",
      adresse: "Route de Chancy 132, 1213 Onex",
      tva: "CHE-103.250.692 TVA",
    });
    expect(r.numero).toBe(42);
    expect(r.date).toBe("13 novembre 2026");
    expect(r.lignes).toEqual([{ titre: "2 × Margherita", details: [], montant: "40.00" }]);
    expect(r.sommes).toEqual([
      ["Plats", "CHF 40.00"],
      ["Livraison", "CHF 5.00"],
      ["Total", "CHF 45.00"],
      ["dont TVA 2,6 %", "CHF 1.14"],
    ]);
    expect(r.paiement).toBe("Payé en ligne");
    expect(r.remboursements).toEqual([]);
  });

  it("ni nom de famille, ni téléphone, ni adresse de livraison, ni code d'entrée", () => {
    const texte = JSON.stringify(donneesRecu(commande(), null, []));
    for (const x of ["Essai", "079 000 00 00", "Route de Chancy\",\"numero", "1234", "lea@exemple.test"]) expect(texte).not.toContain(x);
  });

  it("à emporter : pas de ligne de livraison ; un remboursement fait est rappelé", () => {
    const r = donneesRecu(commande({ mode: "retrait", frais_centimes: 0, total_centimes: 4000 }), null, [
      { montant_centimes: 500, moyen: "stripe", statut: "fait", cree_le: "2026-11-13T19:00:00Z", fait_le: "2026-11-13T19:01:00Z" },
      { montant_centimes: 300, moyen: "stripe", statut: "echec", cree_le: "2026-11-13T19:00:00Z", fait_le: null },
    ]);
    expect(r.sommes.map(([a]) => a)).toEqual(["Plats", "Total", "dont TVA 2,6 %"]);
    expect(r.remboursements).toEqual(["CHF 5.00 remboursés le 13 novembre 2026."]);
  });
});
