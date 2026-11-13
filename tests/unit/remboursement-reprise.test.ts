import { beforeAll, describe, expect, it, vi } from "vitest";
import { baseLocale } from "@/lib/db/locale";

// Remboursement accepté par Stripe dont la réponse se perd (délai, réseau) : la ligne reste « en cours »
// sans identifiant Stripe. Stripe oublie ses clés d'idempotence au bout de 24 heures : une relance plus
// tardive créait un second remboursement. Signalé par la revue de sécurité de bo-commandes (13.11.2026).
// Doublure de Stripe qui garde ses remboursements comme le vrai : créés, retrouvables par leurs metadata.
const stripe = {
  perdre: false,
  crees: [] as { id: string; pi: string; montantCentimes?: number; remboursementId?: string }[],
};
vi.mock("@/lib/paiement/passerelle", async (original) => ({
  ...(await original<typeof import("@/lib/paiement/passerelle")>()),
  passerelle: () => ({
    nom: "stripe",
    async rembourser(pi: string, options: { montantCentimes?: number; cle?: string; remboursementId?: string } = {}) {
      const id = `re_reprise_${stripe.crees.length + 1}`;
      stripe.crees.push({ id, pi, montantCentimes: options.montantCentimes, remboursementId: options.remboursementId });
      // Créé chez Stripe, mais la réponse n'arrive pas.
      if (stripe.perdre) throw Object.assign(new Error("Délai dépassé (simulé)"), { type: "StripeConnectionError" });
      return { id, statut: "succeeded" as const };
    },
    async retrouverRemboursement(pi: string, remboursementId: string) {
      const r = stripe.crees.find((x) => x.pi === pi && x.remboursementId === remboursementId);
      return r ? { id: r.id, statut: "succeeded" as const } : null;
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

const { rembourserApresCoup, appliquerEtatRemboursement } = await import("@/lib/commandes");

let gerant: string;
let n = 0;

async function terminee(): Promise<{ id: string; pi: string }> {
  const db = await baseLocale();
  n += 1;
  const p = {
    jeton_suivi: `jeton-rr-${n}`, cle_idempotence: `rr-${n}`, mode: "retrait", statut: "paiement_en_attente", statut_paiement: "en_attente",
    moyen_paiement: "en_ligne", client_prenom: "Lea", client_nom: "Test", client_telephone: "079 000 00 00", client_email: `rr${n}@laferme.test`,
    quand_type: "asap", pizzas_seulement: false, sous_total_centimes: 6000, frais_centimes: 0, total_centimes: 6000, tva_centimes: 152,
    taux_tva_pourcent: 2.6, origine: "http://localhost:3000",
    lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 6000, total_centimes: 6000, choix: {}, retraits: [], note: "" }],
  };
  const c = (await db.query<{ id: string }>("select * from creer_commande($1)", [p])).rows[0];
  const pi = `pi_reprise_${n}`;
  await db.query("select appliquer_paiement($1, $2, 'paye', $3, 6000)", [`evt-rr-${n}`, c.id, pi]);
  await db.query("select changer_statut($1, 'acceptee', 'tablette:Test', now())", [c.id]);
  await db.query("select changer_statut($1, 'prete', 'tablette:Test')", [c.id]);
  await db.query("select changer_statut($1, 'terminee', 'tablette:Test')", [c.id]);
  return { id: c.id, pi };
}

async function ligne(cle: string) {
  const db = await baseLocale();
  return (await db.query<{ id: string; statut: string; stripe_refund_id: string | null }>("select id, statut, stripe_refund_id from remboursements where cle = $1", [cle])).rows[0];
}

beforeAll(async () => {
  const db = await baseLocale();
  gerant = (await db.query<{ id: string }>("select id from personnel where email = 'equipe@laferme.test'")).rows[0].id;
});

describe("remboursement dont la réponse de Stripe s'est perdue", () => {
  it("la relance reprend le remboursement déjà créé chez Stripe au lieu d'en créer un second", async () => {
    const c = await terminee();
    stripe.perdre = true;
    const premier = await rembourserApresCoup(c.id, 2000, "Retard.", "reprise-test-1", gerant);
    stripe.perdre = false;
    expect(premier.ok).toBe(false);
    const avant = await ligne("reprise-test-1");
    expect(avant).toMatchObject({ statut: "en_cours", stripe_refund_id: null });
    // Notre ligne est partie dans les metadata : c'est elle qui permet de la retrouver.
    expect(stripe.crees.filter((x) => x.pi === c.pi)).toEqual([{ id: expect.any(String), pi: c.pi, montantCentimes: 2000, remboursementId: avant.id }]);

    const relance = await rembourserApresCoup(c.id, 2000, "Retard.", "reprise-test-1", gerant);
    expect(relance.ok).toBe(true);
    // Un seul remboursement chez Stripe, et la ligne porte son identifiant.
    const crees = stripe.crees.filter((x) => x.pi === c.pi);
    expect(crees).toHaveLength(1);
    expect(await ligne("reprise-test-1")).toMatchObject({ statut: "fait", stripe_refund_id: crees[0].id });
  });

  it("le webhook rattache la ligne par les metadata, puis la termine", async () => {
    const c = await terminee();
    stripe.perdre = true;
    await rembourserApresCoup(c.id, 1500, "Retard.", "reprise-test-2", gerant);
    stripe.perdre = false;
    const l = await ligne("reprise-test-2");
    const refund = stripe.crees.find((x) => x.remboursementId === l.id)!;
    expect(await appliquerEtatRemboursement(refund.id, "succeeded", null, l.id)).toBe(true);
    expect(await ligne("reprise-test-2")).toMatchObject({ statut: "fait", stripe_refund_id: refund.id });
    // Rejoué : rien ne change, et la relance ne recrée rien.
    expect(await appliquerEtatRemboursement(refund.id, "succeeded", null, l.id)).toBe(false);
    expect((await rembourserApresCoup(c.id, 1500, "Retard.", "reprise-test-2", gerant)).ok).toBe(true);
    expect(stripe.crees.filter((x) => x.pi === c.pi)).toHaveLength(1);
  });

  it("le webhook ne touche pas une ligne déjà liée à un autre remboursement", async () => {
    const c = await terminee();
    await rembourserApresCoup(c.id, 1000, "Retard.", "reprise-test-3", gerant);
    const l = await ligne("reprise-test-3");
    expect(l.stripe_refund_id).toBeTruthy();
    expect(await appliquerEtatRemboursement("re_etranger", "failed", "simulé", l.id)).toBe(false);
    expect(await ligne("reprise-test-3")).toMatchObject({ statut: "fait", stripe_refund_id: l.stripe_refund_id });
  });
});
