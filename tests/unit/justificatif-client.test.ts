import { describe, expect, it } from "vitest";
import { mentionJustificatif, ticketClient, type CommandePourJustificatif, type LigneTicket } from "@/lib/impression/ticket";

// Justificatif du client dans le sac (mission compta, R6, R7, R24) : sans la mention de livraison ou d'emporter,
// l'AFC présume la restauration à 8,1 % sur tout. Ces tests échouent si la mention disparaît.

const textes = (l: LigneTicket[]) => l.map((x) => (x.t === "texte" ? x.texte : x.t === "deux" ? `${x.gauche} | ${x.droite}` : "---")).join("\n");
const base: CommandePourJustificatif = {
  numero: 17, mode: "livraison", client_prenom: "Léa", client_nom: "Rossi", client_telephone: "079 555 12 34",
  adresse: { rue: "Route de Chancy", numero: "76", npa: "1213", localite: "Onex" }, details_livraison: null,
  heure_confirmee: "2026-11-19T18:45:00Z", statut_paiement: "paye", moyen_paiement: "en_ligne",
  lignes: [
    { nom: "Pizza Margherita", qte: 2, station: "pizza", details: [], total_centimes: 4600 },
    { nom: "Coca-Cola 33 cl", qte: 1, station: "comptoir", details: [], total_centimes: 400 },
  ],
  sous_total_centimes: 5000, frais_centimes: 500, total_centimes: 5000, tva_centimes: 127, taux_tva_pourcent: 2.6,
  remise_centimes: 300, code_promo: "BIENVENUE", cagnotte_centimes: 200,
};

describe("justificatif du client", () => {
  it("livraison : la mention, le nom et l'adresse de livraison", () => {
    const t = textes(ticketClient(base, { accepteLe: "2026-11-19T18:10:00Z" }));
    expect(t).toContain("Livraison sans préparation ni service à :\nLéa Rossi\nRoute de Chancy 76\n1213 Onex");
    expect(t).not.toContain("À l'emporter");
  });

  it("livraison pour quelqu'un d'autre : le nom de la personne qui reçoit", () => {
    expect(mentionJustificatif({ ...base, destinataire: { nom: "Marc Dupont", telephone: "078" } })[1]).toBe("Marc Dupont");
  });

  it("retrait : « À l'emporter »", () => {
    const t = textes(ticketClient({ ...base, mode: "retrait", adresse: null, frais_centimes: 0 }, { accepteLe: "2026-11-19T18:10:00Z" }));
    expect(t).toContain("À l'emporter");
    expect(t).not.toContain("Livraison sans préparation");
    expect(t).not.toContain("Frais de livraison");
  });

  it("vendeur, date, articles avec prix et taux, rabais, cagnotte, total et TVA", () => {
    const t = textes(ticketClient(base, { accepteLe: "2026-11-19T18:10:00Z" }));
    expect(t).toContain("Restaurant La Ferme Sàrl\nRoute de Chancy 132, 1213 Onex\nCHE-103.250.692 TVA");
    expect(t).toContain("Commande N° 017 | 19.11.2026");
    expect(t).toContain("2 x Pizza Margherita | CHF 46.00 A");
    expect(t).toContain("1 x Coca-Cola 33 cl | CHF 4.00 A");
    expect(t).toContain("Frais de livraison | CHF 5.00 A");
    expect(t).toContain("Code BIENVENUE | - CHF 3.00");
    expect(t).toContain("Cagnotte utilisée | - CHF 2.00");
    expect(t).toContain("TOTAL | CHF 50.00");
    expect(t).toContain("A = TVA 2,6 %, comprise : CHF 1.27 sur CHF 50.00");
    expect(t).toContain("Paiement : PAYÉ EN LIGNE");
  });
});
