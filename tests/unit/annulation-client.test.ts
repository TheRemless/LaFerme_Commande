import { beforeEach, describe, expect, it, vi } from "vitest";
import { baseLocale } from "@/lib/db/locale";

// Vague 3, arbitrage C1 : le client annule depuis son suivi tant que la commande n'est pas acceptée.
// Désactivé par défaut ; la base tranche sous verrou contre l'acceptation ; remboursement complet ;
// e-mail au client ; la colonne annulee_par_client_le distingue l'annulation d'un refus du restaurant.
const stripe = vi.hoisted(() => ({ panne: false, appels: [] as string[] }));
vi.mock("@/lib/paiement/passerelle", async (original) => ({
  ...(await original<typeof import("@/lib/paiement/passerelle")>()),
  passerelle: () => ({
    nom: "stripe",
    async rembourser(pi: string) {
      stripe.appels.push(pi);
      if (stripe.panne) throw Object.assign(new Error("Refus de Stripe (simulé)"), { type: "StripeInvalidRequestError" });
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
const { annulerParClient } = await import("@/lib/annulation-client");
const { POST } = await import("@/app/api/suivi/annuler/route");
const { chargerConfigService } = await import("@/lib/config-service");

let n = 0;
async function commande(comptoir = false): Promise<{ id: string; jeton: string }> {
  const db = await baseLocale();
  n += 1;
  const jeton = `jeton-annulation-client-${n}-abcdef`;
  const p = {
    jeton_suivi: jeton, cle_idempotence: `ac-${n}`, mode: "retrait", statut: comptoir ? "nouvelle" : "paiement_en_attente",
    statut_paiement: comptoir ? "a_encaisser_retrait" : "en_attente", moyen_paiement: comptoir ? "comptoir" : "en_ligne",
    client_prenom: "Lea", client_nom: "Test", client_telephone: "079 000 00 00", client_email: `ac${n}@laferme.test`, quand_type: "asap",
    pizzas_seulement: false, sous_total_centimes: 2500, frais_centimes: 0, total_centimes: 2500, tva_centimes: 0, taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000",
    lignes: [{ slug: "lasagne-de-boeuf", nom: "Lasagne de bœuf", station: "cuisine", qte: 1, unitaire_centimes: 2500, total_centimes: 2500, choix: {}, retraits: [], note: "" }],
  };
  const id = (await db.query<{ id: string }>("select id from creer_commande($1)", [p])).rows[0].id;
  if (!comptoir) await db.query("select appliquer_paiement($1, $2, 'paye', $3, 2500)", [`evt-ac-${n}`, id, `pi_ac_${n}`]);
  return { id, jeton };
}
async function etat(id: string) {
  const db = await baseLocale();
  return (await db.query<{ statut: string; statut_paiement: string; annulee_par_client_le: string | null; motif: string }>(
    "select statut, statut_paiement, annulee_par_client_le, motif from commandes where id = $1", [id])).rows[0];
}
async function activer(oui: boolean) {
  const db = await baseLocale();
  await db.query("update reglages set valeur = $1::jsonb where cle = 'annulation_client_active'", [JSON.stringify(oui)]);
}
const requete = (corps: unknown, origine = "http://localhost:3000") =>
  new Request("http://localhost:3000/api/suivi/annuler", { method: "POST", headers: { origin: origine, host: "localhost:3000" }, body: JSON.stringify(corps) });

beforeEach(async () => {
  stripe.panne = false;
  stripe.appels.length = 0;
  await activer(true);
});

describe("annulation par le client", () => {
  it("désactivée par défaut : rien ne change, le client est invité à appeler", async () => {
    const db = await baseLocale();
    const r = (await db.query<{ valeur: boolean; proposition: boolean }>("select valeur, proposition from reglages where cle = 'annulation_client_active'")).rows[0];
    expect(r.proposition).toBe(true);
    await activer(false);
    const c = await commande();
    expect(await annulerParClient(c.jeton)).toEqual({ ok: false, status: 403, message: "Pour annuler, appelez-nous au 022 792 16 89." });
    expect((await etat(c.id)).statut).toBe("nouvelle");
  });

  it("payée en ligne, pas encore acceptée : annulée, remboursée en entier, marquée « par le client »", async () => {
    const c = await commande();
    const r = await annulerParClient(c.jeton);
    expect(r.ok).toBe(true);
    const e = await etat(c.id);
    expect(e).toMatchObject({ statut: "refusee", statut_paiement: "rembourse", motif: "Annulée à votre demande." });
    expect(e.annulee_par_client_le).not.toBeNull();
    expect(stripe.appels).toHaveLength(1);
    const db = await baseLocale();
    const ev = (await db.query<{ par: string; vers: string }>("select par, vers from evenements_commande where commande_id = $1 order by id desc limit 1", [c.id])).rows[0];
    expect(ev).toEqual({ par: "client", vers: "refusee" });
    const mails = (await db.query<{ texte: string }>("select texte from courriels where commande_id = $1", [c.id])).rows;
    expect(mails.at(-1)?.texte).toContain("annulée, comme vous nous l'avez demandé");
    // Rejouée : rien de plus, pas de second remboursement.
    expect(await annulerParClient(c.jeton)).toEqual({ ok: true, message: "Votre commande est déjà annulée." });
    expect(stripe.appels).toHaveLength(1);
  });

  it("déjà acceptée : l'acceptation gagne, rien n'est remboursé", async () => {
    const c = await commande();
    const db = await baseLocale();
    await db.query("select changer_statut($1, 'acceptee', 'tablette:Test', now() + interval '20 minutes')", [c.id]);
    const r = await annulerParClient(c.jeton);
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(r.ok === false && r.message).toContain("déjà acceptée");
    expect((await etat(c.id)).statut).toBe("acceptee");
    expect(stripe.appels).toHaveLength(0);
  });

  it("annulée d'abord : la tablette ne peut plus l'accepter", async () => {
    const c = await commande();
    await annulerParClient(c.jeton);
    const db = await baseLocale();
    expect((await db.query<{ r: boolean }>("select changer_statut($1, 'acceptee', 'tablette:Test', now()) as r", [c.id])).rows[0].r).toBe(false);
  });

  it("au comptoir : annulée sans remboursement, e-mail « rien n'a été débité »", async () => {
    const c = await commande(true);
    expect(await annulerParClient(c.jeton)).toEqual({ ok: true, message: "Votre commande est annulée." });
    expect(stripe.appels).toHaveLength(0);
    const db = await baseLocale();
    const mails = (await db.query<{ texte: string }>("select texte from courriels where commande_id = $1", [c.id])).rows;
    expect(mails.at(-1)?.texte).toContain("Rien n'a été débité.");
  });

  it("Stripe refuse : la commande reste annulée, le client sait que le remboursement suit", async () => {
    const c = await commande();
    stripe.panne = true;
    const r = await annulerParClient(c.jeton);
    expect(r.ok).toBe(true);
    expect((await etat(c.id))).toMatchObject({ statut: "refusee", statut_paiement: "paye" });
    const db = await baseLocale();
    const mails = (await db.query<{ texte: string }>("select texte from courriels where commande_id = $1", [c.id])).rows;
    expect(mails.at(-1)?.texte).toContain("Le remboursement n'est pas encore parti");
  });
});

describe("réglage lu par le suivi", () => {
  it("annulation_client_active suit la base, faux par défaut", async () => {
    await activer(false);
    expect((await chargerConfigService()).reglages.annulation_client_active).toBe(false);
    await activer(true);
    expect((await chargerConfigService()).reglages.annulation_client_active).toBe(true);
  });
});

describe("route /api/suivi/annuler", () => {
  it("annule avec le jeton dans le corps, refuse un autre site et un jeton inconnu", async () => {
    const c = await commande();
    expect((await POST(requete({ jeton: c.jeton }, "https://pirate.example"))).status).toBe(403);
    expect((await POST(requete({ jeton: "x" }))).status).toBe(404);
    expect((await POST(requete({ jeton: "jeton-qui-n-existe-pas-du-tout" }))).status).toBe(404);
    const r = await POST(requete({ jeton: c.jeton }));
    expect(r.status).toBe(200);
    expect((await etat(c.id)).statut).toBe("refusee");
  });
});
