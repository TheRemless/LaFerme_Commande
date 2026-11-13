import { beforeAll, describe, expect, it, vi } from "vitest";
import { baseLocale } from "@/lib/db/locale";

// Correctifs de l'audit « journée du gérant » côté serveur (docs/audits/gerant.md) : remboursement après
// coup avec Stripe remplacé (montant, clé, panne), export comptable, retard du soir, courriels d'annulation.
// panne : erreur nette de Stripe (refus) ; muet : pas de réponse claire (délai, réseau), le remboursement a pu partir.
const stripe = { panne: false, muet: false, appels: [] as { pi: string; montantCentimes?: number; cle?: string }[] };
vi.mock("@/lib/paiement/passerelle", async (original) => ({
  ...(await original<typeof import("@/lib/paiement/passerelle")>()),
  passerelle: () => ({
    nom: "stripe",
    async rembourser(pi: string, options: { montantCentimes?: number; cle?: string } = {}) {
      stripe.appels.push({ pi, ...options });
      if (stripe.panne) throw Object.assign(new Error("Refus de Stripe (simulé)"), { type: "StripeInvalidRequestError" });
      if (stripe.muet) throw Object.assign(new Error("Délai dépassé (simulé)"), { type: "StripeConnectionError" });
      // Contrat de la passerelle depuis l'audit de sécurité 2 (S2-03) : l'état du remboursement chez Stripe.
      return { id: `re_${options.cle ?? pi}`, statut: "succeeded" as const };
    },
    async creerSession() {
      throw new Error("non utilisé");
    },
    async lireSession() {
      return { statut: "en_attente", montantCentimes: null, devise: null };
    },
    async expirerSession() {},
  }),
}));

const { rembourserApresCoup } = await import("@/lib/commandes");
const { csvVentes } = await import("@/lib/gestion");
const { chargerConfigService } = await import("@/lib/config-service");
const { courrielRefus, courrielRemboursement, courrielRemboursementGeste, MOTIF_DEMANDE_CLIENT } = await import("@/lib/courriel/modeles");

let gerant: string;
let n = 0;

async function terminee(): Promise<{ id: string; numero: number }> {
  const db = await baseLocale();
  n += 1;
  const p = {
    jeton_suivi: `jeton-gc-${n}`, cle_idempotence: `gc-${n}`, mode: "retrait", statut: "paiement_en_attente", statut_paiement: "en_attente",
    moyen_paiement: "en_ligne", client_prenom: "Lea", client_nom: "Test", client_telephone: "079 000 00 00", client_email: `gc${n}@laferme.test`,
    quand_type: "asap", pizzas_seulement: false, sous_total_centimes: 6000, frais_centimes: 0, total_centimes: 6000, tva_centimes: 152,
    taux_tva_pourcent: 2.6, origine: "http://localhost:3000",
    lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 6000, total_centimes: 6000, choix: {}, retraits: [], note: "" }],
  };
  const c = (await db.query<{ id: string; numero: number }>("select * from creer_commande($1)", [p])).rows[0];
  await db.query("select appliquer_paiement($1, $2, 'paye', $3, 6000)", [`evt-gc-${n}`, c.id, `pi_vrai_${n}`]);
  await db.query("select changer_statut($1, 'acceptee', 'tablette:Test', now())", [c.id]);
  await db.query("select changer_statut($1, 'prete', 'tablette:Test')", [c.id]);
  await db.query("select changer_statut($1, 'terminee', 'tablette:Test')", [c.id]);
  return c;
}

async function courriels(commande: string): Promise<{ sujet: string; texte: string }[]> {
  const db = await baseLocale();
  return (await db.query<{ sujet: string; texte: string }>("select sujet, texte from courriels where commande_id = $1 order by envoye_le", [commande])).rows;
}

beforeAll(async () => {
  const db = await baseLocale();
  gerant = (await db.query<{ id: string }>("select id from personnel where email = 'equipe@laferme.test'")).rows[0].id;
});

describe("G02 : rembourser après coup", () => {
  it("rembourse une partie chez Stripe avec le montant et la clé, un seul e-mail même sur double appui", async () => {
    const c = await terminee();
    stripe.appels.length = 0;
    const r1 = await rembourserApresCoup(c.id, 2100, "Pizza arrivée froide.", "geste-test-0001", gerant);
    expect(r1).toEqual({ ok: true, message: "CHF 21.00 remboursés. Le client reçoit un e-mail." });
    const r2 = await rembourserApresCoup(c.id, 2100, "Pizza arrivée froide.", "geste-test-0001", gerant);
    expect(r2.ok).toBe(true);
    expect(stripe.appels).toEqual([{ pi: `pi_vrai_${n}`, montantCentimes: 2100, cle: "geste-test-0001", remboursementId: expect.any(String) }]);
    const m = await courriels(c.id);
    const remb = m.filter((x) => x.sujet.startsWith("Remboursement"));
    expect(remb).toHaveLength(1);
    expect(remb[0].texte).toContain("Nous vous remboursons CHF 21.00 sur votre commande");
    expect(remb[0].texte).toContain("Pizza arrivée froide.");
  });

  it("Stripe en panne : rien n'est compté, le gérant peut refaire le geste", async () => {
    const c = await terminee();
    stripe.panne = true;
    const r = await rembourserApresCoup(c.id, 6000, "Commande perdue.", "geste-test-0002", gerant);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Stripe a refusé");
    stripe.panne = false;
    const r2 = await rembourserApresCoup(c.id, 6000, "Commande perdue.", "geste-test-0003", gerant);
    expect(r2.ok).toBe(true);
    const db = await baseLocale();
    const s = (await db.query<{ statut_paiement: string }>("select statut_paiement from commandes where id = $1", [c.id])).rows[0];
    expect(s.statut_paiement).toBe("rembourse");
  });

  it("refuse plus que le total avec un message clair", async () => {
    const c = await terminee();
    const r = await rembourserApresCoup(c.id, 7000, "Erreur.", "geste-test-0004", gerant);
    expect(r).toEqual({ ok: false, message: "Le montant dépasse ce qui reste à rembourser sur cette commande." });
  });
});

describe("export comptable avec remboursements", () => {
  it("liste les remboursements et retire le remboursé des totaux par taux", () => {
    const vente = {
      jour: "2026-11-14", numero: 7, heure: "19:10", mode: "retrait", paiement: "en ligne", sous_total_centimes: 6000, frais_centimes: 0,
      total_centimes: 6000, taux_tva_pourcent: 2.6, tva_centimes: 152, stripe_payment_intent: "pi_1",
    };
    const remb = {
      jour: "2026-11-17", heure: "10:00", numero: 7, jour_vente: "2026-11-14", mode: "retrait", paiement: "en ligne", montant_centimes: 2100,
      taux_tva_pourcent: 2.6, tva_centimes: 53, reference: "re_1",
    };
    const csv = csvVentes([vente], [remb]);
    expect(csv.startsWith("﻿Jour;Numéro")).toBe(true);
    expect(csv).toContain("Remboursements");
    expect(csv).toContain("2026-11-17;7;10:00;retrait;en ligne;2026-11-14;-21.00;2.6;-0.53;re_1");
    // Taux, ventes, total TTC, remboursé, net TTC, TVA nette, hors TVA net.
    expect(csv).toContain("2.6;1;60.00;-21.00;39.00;0.99;38.01");
  });

  it("sans remboursement, les totaux restent ceux des ventes", () => {
    const v = { jour: "2026-11-14", numero: 1, heure: "19:00", mode: "retrait", paiement: "comptoir", sous_total_centimes: 1000, frais_centimes: 0, total_centimes: 1000, taux_tva_pourcent: 2.6, tva_centimes: 25, stripe_payment_intent: null };
    expect(csvVentes([v, { ...v, numero: 2 }])).toContain("2.6;2;20.00;0.00;20.00;0.50;19.50");
  });
});

describe("G05 : retard du soir", () => {
  it("s'ajoute au retrait et aux zones de livraison", async () => {
    const db = await baseLocale();
    const avant = await chargerConfigService();
    await db.query("select regler_service($1, null)", [{ retard_minutes: 15 }]);
    const apres = await chargerConfigService();
    expect(apres.reglages.preparation_minutes).toBe(avant.reglages.preparation_minutes + 15);
    expect(apres.reglages.retard_minutes).toBe(15);
    expect(apres.zones[0].delai_min).toBe(avant.zones[0].delai_min + 15);
    expect(apres.zones[0].delai_max).toBe(avant.zones[0].delai_max + 15);
    await db.query("select regler_service($1, null)", [{ retard_minutes: 0 }]);
  });
});

describe("G09 : annulation à la demande du client", () => {
  it("le courriel ne dit pas que le restaurant ne peut pas préparer", async () => {
    const c = { numero: 12, client_prenom: "Lea", total_centimes: 6100, origine: "http://localhost", jeton_suivi: "x" } as Parameters<typeof courrielRefus>[0];
    for (const m of [courrielRefus(c, MOTIF_DEMANDE_CLIENT), courrielRemboursement(c, MOTIF_DEMANDE_CLIENT)]) {
      expect(m.texte).toContain("Votre commande n° 12 est annulée, comme vous nous l'avez demandé.");
      expect(m.texte).not.toContain("Nous ne pouvons pas");
    }
    expect(courrielRefus(c, "La cuisine est complète pour ce service.").texte).toContain("Nous ne pouvons pas préparer");
    expect(courrielRemboursementGeste(c, 6100, "Commande perdue.").texte).toContain("Nous vous remboursons CHF 61.00, le montant de votre commande n° 12.");
  });
});

describe("créneaux pleins côté client", () => {
  it("ne propose plus un créneau plein, et le premier proposé devient le suivant libre", async () => {
    const { creneauxLibres } = await import("@/lib/service");
    const liste = [
      { date: "2026-11-20", minutes: 1155, service: "soir" as const },
      { date: "2026-11-20", minutes: 1170, service: "soir" as const },
      { date: "2026-11-20", minutes: 1185, service: "soir" as const },
    ];
    const pleins = [
      { date: "2026-11-20", mode: "retrait" as const, minutes: 1155 },
      { date: "2026-11-20", mode: "livraison" as const, minutes: 1170 },
    ];
    expect(creneauxLibres(liste, pleins, "retrait").map((c) => c.minutes)).toEqual([1170, 1185]);
    expect(creneauxLibres(liste, pleins, "livraison").map((c) => c.minutes)).toEqual([1155, 1185]);
    expect(creneauxLibres(liste, [], "retrait")).toHaveLength(3);
  });
});

describe("revue de sécurité du lot gérant", () => {
  it("sans réponse claire de Stripe, le remboursement reste en cours et se relance avec la même clé", async () => {
    const c = await terminee();
    const db = await baseLocale();
    stripe.muet = true;
    const r = await rembourserApresCoup(c.id, 2000, "Retard.", "geste-test-muet1", gerant);
    stripe.muet = false;
    expect(r.ok).toBe(false);
    expect(r.message).toContain("en cours");
    expect((await db.query<{ statut: string }>("select statut from remboursements where cle = 'geste-test-muet1'")).rows[0].statut).toBe("en_cours");
    expect((await rembourserApresCoup(c.id, 2000, "Retard.", "geste-test-muet1", gerant)).ok).toBe(true);
  });
});

describe("revue de code du lot gérant", () => {
  it("une relance pendant que Stripe traite encore ne marque pas le remboursement comme échoué", async () => {
    const c = await terminee();
    const db = await baseLocale();
    // Premier appel encore en vol : la ligne est « en cours ».
    await db.query("select demander_remboursement($1, 1500, 'Retard.', 'geste-test-vol1', $2)", [c.id, gerant]);
    stripe.panne = true;
    const r = await rembourserApresCoup(c.id, 1500, "Retard.", "geste-test-vol1", gerant);
    stripe.panne = false;
    expect(r.ok).toBe(false);
    expect(r.message).toContain("en cours");
    const statut = (await db.query<{ statut: string }>("select statut from remboursements where cle = 'geste-test-vol1'")).rows[0].statut;
    expect(statut).toBe("en_cours");
    // La relance suivante, Stripe revenu, termine le même remboursement.
    expect((await rembourserApresCoup(c.id, 1500, "Retard.", "geste-test-vol1", gerant)).ok).toBe(true);
    expect((await db.query<{ statut: string }>("select statut from remboursements where cle = 'geste-test-vol1'")).rows[0].statut).toBe("fait");
  });

  it("accepte un montant de remboursement au-delà de 500 francs", async () => {
    const { centimes } = await import("@/lib/gestion");
    expect(centimes("620", 100_000)).toBe(62000);
    expect(centimes("620")).toBeNull();
  });

  it("le retard du soir n'ouvre pas « dès que possible » plus tôt avant le service", async () => {
    const { etatService, depuisHeureGeneve } = await import("@/lib/service");
    const config = await chargerConfigService();
    const soir = config.horaires.find((h) => h.jour === 2 && h.service === "soir")!;
    const base = config.reglages.preparation_minutes;
    const avecRetard = { ...config, pause: undefined, reglages: { ...config.reglages, preparation_minutes: base + 45, retard_minutes: 45 } };
    // Une minute avant l'ouverture habituelle de « dès que possible » (première heure moins la préparation).
    const [h, m] = soir.premiere_heure.split(":").map(Number);
    const avant = h * 60 + m - base - 1;
    const iso = `2026-11-17T${String(Math.floor(avant / 60)).padStart(2, "0")}:${String(avant % 60).padStart(2, "0")}`;
    expect(etatService(avecRetard, depuisHeureGeneve(iso)!, "retrait").etat).not.toBe("ouvert");
  });
});
