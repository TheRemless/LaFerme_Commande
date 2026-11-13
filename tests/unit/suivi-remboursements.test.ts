import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { baseLocale } from "@/lib/db/locale";
import { creerCommande } from "@/lib/db/serveur";
import { attenteConfirmation, enRetard, libellePaiement, phraseRemboursement, remboursementsSuivi, resteComptoir, type RemboursementSuivi } from "@/lib/suivi";

// Vague 3, client-compte : la page de suivi dit ce qui est rendu au client et dans quel état (S2-03),
// et signale un retard. Paiements de la doublure (pi_doublure_…) : aucun appel réseau. Montants d'essai.

delete process.env.STRIPE_SECRET_KEY;
delete process.env.ALERTE_EMAIL;
process.env.CONTEXTE_DEPLOIEMENT = "local";

let commandes: typeof import("@/lib/commandes");
let gerant: string;
beforeAll(async () => {
  commandes = await import("@/lib/commandes");
  const db = await baseLocale();
  gerant = (await db.query<{ id: string }>("select id from personnel where email = 'equipe@laferme.test'")).rows[0].id;
});
afterEach(() => {
  delete process.env.DOUBLURE_REMBOURSEMENT;
});

async function commandePayee() {
  const cle = randomUUID();
  const c = await creerCommande({
    jeton_suivi: `jeton-${cle}`,
    cle_idempotence: cle,
    mode: "livraison",
    statut: "nouvelle",
    statut_paiement: "paye",
    moyen_paiement: "en_ligne",
    client_prenom: "Essai",
    client_nom: "Suivi",
    client_telephone: "079 000 00 00",
    client_email: `suivi-${cle.slice(0, 8)}@exemple.ch`,
    quand_type: "asap",
    pizzas_seulement: true,
    sous_total_centimes: 4000,
    frais_centimes: 0,
    total_centimes: 4000,
    tva_centimes: 102,
    taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000",
    adresse: { rue: "Route de Chancy", numero: "1", npa: "1213", localite: "Onex" },
    lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 2, unitaire_centimes: 2000, total_centimes: 4000, choix: {}, retraits: [], note: "" }],
  });
  const db = await baseLocale();
  await db.query("update commandes set statut = 'terminee', stripe_payment_intent = $2 where id = $1", [c.id, `pi_doublure_${cle}`]);
  return c.id;
}

describe("suivi_remboursements", () => {
  it("rend montant, moyen, état et dates, sans le motif, l'erreur de Stripe ni l'auteur", async () => {
    process.env.DOUBLURE_REMBOURSEMENT = "pending";
    const c = await commandePayee();
    await commandes.rembourserApresCoup(c, 1500, "Plat froid, note interne.", `cle-${randomUUID()}`, gerant);
    const [r] = await remboursementsSuivi(c);
    expect(r).toMatchObject({ montant_centimes: 1500, moyen: "stripe", statut: "en_cours", fait_le: null });
    expect(Object.keys(r).sort()).toEqual(["cree_le", "fait_le", "montant_centimes", "moyen", "statut"]);
    expect(JSON.stringify(r)).not.toContain("note interne");
  });

  it("une commande sans remboursement : liste vide ; une autre commande ne fuit pas", async () => {
    const a = await commandePayee();
    const b = await commandePayee();
    await commandes.rembourserApresCoup(a, 1000, "Plat froid.", `cle-${randomUUID()}`, gerant);
    expect(await remboursementsSuivi(b)).toEqual([]);
    expect(await remboursementsSuivi(a)).toHaveLength(1);
  });
});

const ligne = (p: Partial<RemboursementSuivi>): RemboursementSuivi => ({
  montant_centimes: 1500,
  moyen: "stripe",
  statut: "fait",
  cree_le: "2026-11-13T18:00:00Z",
  fait_le: "2026-11-13T18:01:00Z",
  ...p,
});

describe("phrases du suivi", () => {
  it("dit l'état réel du remboursement Stripe", () => {
    expect(phraseRemboursement(ligne({}))).toMatchObject({ etat: "fait", texte: expect.stringMatching(/^CHF 15\.00 remboursés le 13 novembre\./) });
    // Délais sourcés (documentation Stripe lue le 13.11.2026), pas « selon votre banque » seul.
    expect(phraseRemboursement(ligne({})).texte).toContain("Avec TWINT, la somme revient en général en quelques minutes.");
    expect(phraseRemboursement(ligne({})).texte).toContain("de 5 à 10 jours ouvrables");
    expect(phraseRemboursement(ligne({ statut: "en_cours", fait_le: null })).texte).toBe("CHF 15.00 en cours de remboursement. La banque ne l'a pas encore confirmé.");
    expect(phraseRemboursement(ligne({ statut: "echec", fait_le: null })).texte).toContain("n'a pas abouti");
    expect(phraseRemboursement(ligne({ statut: "echec", fait_le: null })).texte).toContain("022 792 16 89");
  });

  it("comptoir : rendu ou déduit", () => {
    expect(phraseRemboursement(ligne({ moyen: "especes" })).texte).toBe("CHF 15.00 rendus au comptoir.");
    expect(phraseRemboursement(ligne({ moyen: "deduction" })).texte).toBe("CHF 15.00 déduits du montant à payer au comptoir.");
  });

  it("« Remboursée » seulement quand Stripe a tout confirmé", () => {
    expect(libellePaiement({ statut_paiement: "rembourse" }, [ligne({})])).toBe("Remboursée");
    expect(libellePaiement({ statut_paiement: "rembourse" }, [ligne({ statut: "en_cours" })])).toBe("Payée en ligne");
    expect(libellePaiement({ statut_paiement: "rembourse" }, [ligne({ statut: "echec" })])).toBe("Payée en ligne");
    // Avant la migration : aucune ligne lue, libellé d'avant.
    expect(libellePaiement({ statut_paiement: "rembourse" }, [])).toBe("Remboursée");
  });

  it("reste à payer au comptoir après une déduction", () => {
    expect(resteComptoir({ statut_paiement: "a_encaisser_retrait", total_centimes: 4000 }, [ligne({ moyen: "deduction" })])).toBe(2500);
    expect(resteComptoir({ statut_paiement: "a_encaisser_retrait", total_centimes: 4000 }, [])).toBeNull();
    expect(resteComptoir({ statut_paiement: "paye", total_centimes: 4000 }, [ligne({ moyen: "deduction" })])).toBeNull();
  });
});

describe("retard", () => {
  const heure = "2026-11-13T18:40:00Z";
  const apres = (min: number) => new Date(new Date(heure).getTime() + min * 60_000);
  it("livraison pas encore livrée 11 minutes après l'heure : en retard", () => {
    expect(enRetard({ statut: "partie", mode: "livraison", heure_confirmee: heure }, apres(11))).toBe(true);
    expect(enRetard({ statut: "en_preparation", mode: "livraison", heure_confirmee: heure }, apres(9))).toBe(false);
  });
  it("terminée, refusée, sans heure ou à emporter déjà prête : pas en retard", () => {
    expect(enRetard({ statut: "terminee", mode: "livraison", heure_confirmee: heure }, apres(60))).toBe(false);
    expect(enRetard({ statut: "refusee", mode: "livraison", heure_confirmee: heure }, apres(60))).toBe(false);
    expect(enRetard({ statut: "nouvelle", mode: "livraison", heure_confirmee: null }, apres(60))).toBe(false);
    expect(enRetard({ statut: "prete", mode: "retrait", heure_confirmee: heure }, apres(60))).toBe(false);
    expect(enRetard({ statut: "en_preparation", mode: "retrait", heure_confirmee: heure }, apres(11))).toBe(true);
  });
});

describe("commande pas encore acceptée", () => {
  const paye = "2026-11-13T18:00:00Z";
  const a = (min: number) => new Date(new Date(paye).getTime() + min * 60_000);
  const c = { statut: "nouvelle", quand_type: "asap" as const, paye_le: paye, cree_le: paye };
  it("dès que possible, service ouvert, 10 minutes après le paiement : message", () => {
    expect(attenteConfirmation(c, true, a(10))).toBe(true);
    expect(attenteConfirmation(c, true, a(9))).toBe(false);
  });
  it("acceptée, service fermé ou commande à l'avance : pas de message", () => {
    expect(attenteConfirmation({ ...c, statut: "acceptee" }, true, a(30))).toBe(false);
    expect(attenteConfirmation(c, false, a(30))).toBe(false);
    expect(attenteConfirmation({ ...c, quand_type: "creneau" as const }, true, a(30))).toBe(false);
  });
});
