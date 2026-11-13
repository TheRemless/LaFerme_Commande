import { beforeEach, describe, expect, it, vi } from "vitest";
import { baseLocale } from "@/lib/db/locale";

// Décision C13 de Jérémy (13.11.2026) : une commande « dès que possible » que personne n'accepte en 15 minutes
// est refusée et remboursée, le client prévenu par e-mail, les commandes en ligne en pause, le gérant alerté.
// La passerelle de paiement est remplacée : aucun appel à Stripe.
const remboursements: string[] = [];
const passerelleEnPanne = { oui: false, bloquee: false };
vi.mock("@/lib/paiement/passerelle", async (original) => ({
  ...(await original<typeof import("@/lib/paiement/passerelle")>()),
  passerelle: () => ({
    nom: "stripe",
    async rembourser(pi: string) {
      if (passerelleEnPanne.bloquee) await new Promise((ok) => setTimeout(ok, 6000));
      if (passerelleEnPanne.oui) throw new Error("Stripe indisponible (simulé)");
      remboursements.push(pi);
      return { id: `re_${pi}`, statut: "succeeded" as const };
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

const { refuserCommandesSansReponse, reprendreRemboursements, tourRefusAutomatique, motifRefusAutomatique } = await import("@/lib/refus-automatique");
const { executerSurveillance } = await import("@/lib/surveillance");
// Mardi soir, en plein service.
const SERVICE = new Date("2026-11-10T18:05:00Z");

let n = 0;
async function nouvelle(extra: Record<string, unknown> = {}): Promise<{ id: string; numero: number }> {
  const db = await baseLocale();
  n += 1;
  const p = {
    jeton_suivi: `jeton-refus-${n}`, cle_idempotence: `refus-${n}`, mode: "retrait", statut: "nouvelle", statut_paiement: "a_encaisser_retrait",
    moyen_paiement: "comptoir", client_prenom: "Refus", client_nom: "Test", client_telephone: "079 000 00 00", client_email: `refus${n}@laferme.test`,
    quand_type: "asap", pizzas_seulement: false, sous_total_centimes: 3300, frais_centimes: 0, total_centimes: 3300, tva_centimes: 85,
    taux_tva_pourcent: 2.6, origine: "http://localhost:3000",
    lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 3300, total_centimes: 3300, choix: {}, retraits: [], note: "" }],
    ...extra,
  };
  return (await db.query<{ id: string; numero: number }>("select * from creer_commande($1)", [p])).rows[0];
}
async function payee(): Promise<{ id: string; numero: number }> {
  const c = await nouvelle({ statut: "paiement_en_attente", statut_paiement: "en_attente", moyen_paiement: "en_ligne" });
  const db = await baseLocale();
  await db.query("update commandes set stripe_session_id = $2 where id = $1", [c.id, `cs_${c.id}`]);
  await db.query("select appliquer_paiement($1, $2, 'paye', $3, 3300)", [`evt-${c.id}`, c.id, `pi_refus_${n}`]);
  return c;
}
// Le délai compte depuis le paiement (ou la création, au comptoir).
async function vieillir(id: string, minutes: number) {
  const db = await baseLocale();
  await db.query("update commandes set cree_le = now() - make_interval(mins => $2), paye_le = case when paye_le is null then null else now() - make_interval(mins => $2) end where id = $1", [id, minutes]);
}
async function etat(id: string) {
  const db = await baseLocale();
  return (await db.query<{ statut: string; statut_paiement: string; motif: string | null }>("select statut, statut_paiement, motif from commandes where id = $1", [id])).rows[0];
}
async function courriels(where: string, v: unknown[]) {
  const db = await baseLocale();
  return (await db.query<{ sujet: string; texte: string }>(`select sujet, texte from courriels where ${where} order by envoye_le`, v)).rows;
}
async function pause() {
  const db = await baseLocale();
  return (await db.query<{ v: unknown }>("select valeur as v from reglages where cle = 'pause_jusqu_a'")).rows[0].v;
}

beforeEach(async () => {
  remboursements.length = 0;
  passerelleEnPanne.oui = false;
  passerelleEnPanne.bloquee = false;
  const db = await baseLocale();
  // Une commande d'un test précédent qui attend encore ne doit pas compter dans le suivant.
  await db.query("update commandes set statut = 'terminee' where statut = 'nouvelle' and client_email like 'refus%@laferme.test'");
  await db.query("update reglages set valeur = 'null' where cle = 'pause_jusqu_a'");
  await db.query("update reglages set valeur = 'true' where cle = 'refus_automatique_actif'");
  await db.query("update reglages set valeur = '15' where cle = 'refus_automatique_minutes'");
});

describe("refus automatique (C13)", () => {
  it("payée en ligne, pas acceptée en 15 minutes : refusée, remboursée, client prévenu, pause et alerte", async () => {
    const c = await payee();
    await vieillir(c.id, 16);
    expect(await refuserCommandesSansReponse()).toContain(c.numero);
    expect(await etat(c.id)).toEqual({ statut: "refusee", statut_paiement: "rembourse", motif: motifRefusAutomatique(15) });
    expect(remboursements).toEqual([`pi_refus_${n}`]);
    const client = await courriels("commande_id = $1", [c.id]);
    expect(client.at(-1)?.texte).toContain("sans confirmation de notre part");
    expect(client.at(-1)?.texte.replace(/\s/g, " ")).toContain("022 792 16 89");
    expect(await pause()).toBe("sans-fin");
    const alerte = await courriels("commande_id is null and sujet like $1", [`%${c.numero}%refusée%`]);
    expect(alerte).toHaveLength(1);
    expect(alerte[0].texte).toContain("Reprendre les commandes");
  });

  it("au comptoir : refusée sans remboursement, le client est prévenu", async () => {
    const c = await nouvelle();
    await vieillir(c.id, 20);
    expect(await refuserCommandesSansReponse()).toContain(c.numero);
    expect((await etat(c.id)).statut).toBe("refusee");
    expect(remboursements).toEqual([]);
    expect((await courriels("commande_id = $1", [c.id])).at(-1)?.texte).toContain("Rien n'a été débité");
  });

  it("rien avant le délai, rien pour une heure choisie, rien de déjà accepté, rien quand c'est éteint", async () => {
    const db = await baseLocale();
    const jeune = await nouvelle();
    await vieillir(jeune.id, 10);
    const creneau = await nouvelle({ quand_type: "creneau", quand_date: "2026-11-20", quand_minutes: 1170 });
    await vieillir(creneau.id, 60);
    const acceptee = await nouvelle();
    await vieillir(acceptee.id, 30);
    await db.query("update commandes set statut = 'acceptee' where id = $1", [acceptee.id]);
    const eteinte = await nouvelle();
    await vieillir(eteinte.id, 30);
    await db.query("update reglages set valeur = 'false' where cle = 'refus_automatique_actif'");
    const r = await refuserCommandesSansReponse();
    for (const c of [jeune, creneau, acceptee, eteinte]) expect(r).not.toContain(c.numero);
    expect((await etat(eteinte.id)).statut).toBe("nouvelle");
    expect(await pause()).toBe(null);
  });

  it("délai réglé à 20 minutes : une commande de 16 minutes attend encore", async () => {
    const db = await baseLocale();
    await db.query("update reglages set valeur = '20' where cle = 'refus_automatique_minutes'");
    const c = await nouvelle();
    await vieillir(c.id, 16);
    expect(await refuserCommandesSansReponse()).not.toContain(c.numero);
    await vieillir(c.id, 21);
    expect(await refuserCommandesSansReponse()).toContain(c.numero);
    expect((await etat(c.id)).motif).toBe(motifRefusAutomatique(20));
  });

  it("hors service (dimanche) : rien n'est refusé ; la surveillance des passages de la tablette ne refuse jamais", async () => {
    const db = await baseLocale();
    const c = await nouvelle();
    await vieillir(c.id, 30);
    expect((await tourRefusAutomatique(new Date("2026-11-15T12:00:00Z"))).refusees).toEqual([]);
    await db.query("update surveillance_etat set surveillance_le = null where id");
    await executerSurveillance(SERVICE);
    expect((await etat(c.id)).statut).toBe("nouvelle");
    expect((await tourRefusAutomatique(SERVICE)).refusees).toContain(c.numero);
  });

  it("une quinzaine en retard : pause et alerte d'abord, puis trois refus par tour", async () => {
    const lot = [];
    for (let i = 0; i < 5; i++) {
      const c = await nouvelle();
      await vieillir(c.id, 20);
      lot.push(c);
    }
    const premier = await refuserCommandesSansReponse();
    expect(premier).toHaveLength(3);
    expect(await pause()).toBe("sans-fin");
    const alertes = await courriels("commande_id is null and sujet like $1", [`%${lot[4].numero}%refusées%`]);
    expect(alertes).toHaveLength(1);
    expect(alertes[0].sujet).toContain(String(lot[0].numero));
    // Tour suivant : les deux dernières, sans nouvelle alerte (la pause était déjà là).
    const second = await refuserCommandesSansReponse();
    expect([...premier, ...second].sort()).toEqual(lot.map((c) => c.numero).sort());
    expect(await courriels("commande_id is null and sujet like $1", [`%${lot[4].numero}%refusées%`])).toHaveLength(1);
  });

  it("budget de temps épuisé : rien n'est refusé dans ce tour, mais la pause est posée", async () => {
    const c = await nouvelle();
    await vieillir(c.id, 20);
    expect(await refuserCommandesSansReponse(Date.now() - 1)).toEqual([]);
    expect((await etat(c.id)).statut).toBe("nouvelle");
    expect(await pause()).toBe("sans-fin");
  });

  it("refusée puis coupée avant le remboursement : repris au tour suivant, client prévenu", async () => {
    const db = await baseLocale();
    const c = await payee();
    await vieillir(c.id, 20);
    // Stripe ne répond pas au moment du refus : refusée, pas remboursée.
    passerelleEnPanne.oui = true;
    expect(await refuserCommandesSansReponse()).toContain(c.numero);
    expect(await etat(c.id)).toMatchObject({ statut: "refusee", statut_paiement: "paye" });
    passerelleEnPanne.oui = false;
    // Moins de 2 minutes après le refus : pas encore repris.
    expect(await reprendreRemboursements()).not.toContain(c.numero);
    await db.query("update evenements_commande set le = now() - interval '150 seconds' where commande_id = $1 and vers = 'refusee'", [c.id]);
    expect(await reprendreRemboursements()).toContain(c.numero);
    expect((await etat(c.id)).statut_paiement).toBe("rembourse");
    expect((await courriels("commande_id = $1", [c.id])).at(-1)?.texte).toContain("sans confirmation de notre part");
    // Déjà remboursée : plus rien à reprendre.
    expect(await reprendreRemboursements()).not.toContain(c.numero);
  });

  it("Stripe en panne au refus puis à la reprise : une seule alerte, celle du refus", async () => {
    const db = await baseLocale();
    const c = await payee();
    await vieillir(c.id, 20);
    passerelleEnPanne.oui = true;
    await refuserCommandesSansReponse();
    await db.query("update evenements_commande set le = now() - interval '150 seconds' where commande_id = $1 and vers = 'refusee'", [c.id]);
    expect(await reprendreRemboursements()).not.toContain(c.numero);
    expect(await reprendreRemboursements()).not.toContain(c.numero);
    expect(await courriels("commande_id is null and sujet = $1", [`Commande ${c.numero} : remboursement à refaire`])).toHaveLength(1);
  });

  it("coupée avant le remboursement et Stripe en panne : le client et le gérant sont prévenus une fois", async () => {
    const db = await baseLocale();
    const c = await payee();
    // La fonction s'est arrêtée juste après le changement d'état : ni remboursement, ni e-mail, ni alerte.
    await db.query("select changer_statut($1, 'refusee', 'tablette:Refus automatique', null, $2, 'nouvelle')", [c.id, motifRefusAutomatique(15)]);
    await db.query("update evenements_commande set le = now() - interval '150 seconds' where commande_id = $1 and vers = 'refusee'", [c.id]);
    passerelleEnPanne.oui = true;
    await reprendreRemboursements();
    await reprendreRemboursements();
    expect(await courriels("commande_id is null and sujet = $1", [`Commande ${c.numero} : remboursement à refaire`])).toHaveLength(1);
    const client = await courriels("commande_id = $1", [c.id]);
    expect(client).toHaveLength(1);
    expect(client[0].texte).toContain("pas encore parti");
  });

  it("Stripe qui ne répond pas : le tour rend la main en quelques secondes", async () => {
    const c = await payee();
    await vieillir(c.id, 20);
    passerelleEnPanne.bloquee = true;
    const debut = Date.now();
    await refuserCommandesSansReponse();
    expect(Date.now() - debut).toBeLessThan(5500);
  }, 15_000);
});
