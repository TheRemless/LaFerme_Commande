import { beforeAll, describe, expect, it, vi } from "vitest";
import { baseLocale } from "@/lib/db/locale";

// Vague 3, bo-commandes : gestes du back-office sur une commande (heure, annuler, réimprimer, renvoyer un
// e-mail), par agir() de la tablette, journalisés au back-office. Stripe remplacé comme dans gerant-correctifs.
const stripe = vi.hoisted(() => ({ appels: [] as string[] }));
vi.mock("@/lib/paiement/passerelle", async (original) => ({
  ...(await original<typeof import("@/lib/paiement/passerelle")>()),
  passerelle: () => ({
    nom: "stripe",
    async rembourser(pi: string) {
      stripe.appels.push(pi);
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
const { actionGestion } = await import("@/lib/actions-gestion");

let gerant: { id: string; email: string; nom: string; role: "gerant" };
let n = 0;

async function commande(accepter = true): Promise<string> {
  const db = await baseLocale();
  n += 1;
  const p = {
    jeton_suivi: `jeton-act-${n}`, cle_idempotence: `act-${n}`, mode: "retrait", statut: "paiement_en_attente", statut_paiement: "en_attente", moyen_paiement: "en_ligne",
    client_prenom: "Lea", client_nom: "Test", client_telephone: "079 000 00 00", client_email: `act${n}@laferme.test`, quand_type: "asap", pizzas_seulement: false,
    sous_total_centimes: 3000, frais_centimes: 0, total_centimes: 3000, tva_centimes: 0, taux_tva_pourcent: 2.6, origine: "http://localhost:3000",
    lignes: [
      { slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 1500, total_centimes: 1500, choix: {}, retraits: [], note: "" },
      { slug: "lasagne-de-boeuf", nom: "Lasagne de bœuf", station: "cuisine", qte: 1, unitaire_centimes: 1500, total_centimes: 1500, choix: {}, retraits: [], note: "" },
    ],
  };
  const id = (await db.query<{ id: string }>("select id from creer_commande($1)", [p])).rows[0].id;
  await db.query("select appliquer_paiement($1, $2, 'paye', $3, 3000)", [`evt-act-${n}`, id, `pi_act_${n}`]);
  if (accepter) await db.query("select changer_statut($1, 'acceptee', 'tablette:Test', now() + interval '20 minutes')", [id]);
  return id;
}
async function journal(id: string) {
  const db = await baseLocale();
  return (await db.query<{ apres: Record<string, unknown> }>("select apres from journal_gestion where objet = 'commande_action' and cle = $1 order by id", [id])).rows.map((r) => r.apres);
}

beforeAll(async () => {
  const db = await baseLocale();
  const g = (await db.query<{ id: string; nom: string }>("select id, nom from personnel where email = 'gerant-bureau@laferme.test'")).rows[0];
  gerant = { ...g, email: "gerant-bureau@laferme.test", role: "gerant" };
});

describe("gestes du back-office sur une commande", () => {
  it("changer l'heure : refuse une heure passée, puis change, prévient le client et journalise", async () => {
    const c = await commande();
    expect(await actionGestion(c, { action: "heure", heure: new Date(Date.now() - 3_600_000).toISOString() }, gerant)).toEqual({ ok: false, message: "Choisissez une heure à venir." });
    const heure = new Date(Date.now() + 45 * 60_000).toISOString();
    expect((await actionGestion(c, { action: "heure", heure }, gerant)).ok).toBe(true);
    expect((await journal(c))[0]).toMatchObject({ action: "heure" });
    const db = await baseLocale();
    const sujets = (await db.query<{ sujet: string }>("select sujet from courriels where commande_id = $1", [c])).rows.map((r) => r.sujet);
    expect(sujets.some((s) => s.includes("nouvelle heure"))).toBe(true);
  });

  it("annuler : remboursée en entier une seule fois, motif obligatoire, état vérifié", async () => {
    const c = await commande();
    expect((await actionGestion(c, { action: "annuler", motif: "x" }, gerant)).ok).toBe(false);
    expect((await actionGestion(c, { action: "annuler", motif: "Client injoignable", de: "nouvelle" }, gerant)).ok).toBe(false);
    stripe.appels.length = 0;
    const r = await actionGestion(c, { action: "annuler", motif: "Le client a appelé pour annuler", de: "acceptee" }, gerant);
    expect(r).toEqual({ ok: true, message: "Commande refusée et remboursée." });
    expect(stripe.appels).toHaveLength(1);
    expect((await actionGestion(c, { action: "annuler", motif: "Encore" }, gerant)).ok).toBe(false);
    expect(stripe.appels).toHaveLength(1);
    expect((await journal(c)).map((j) => j.action)).toEqual(["annuler"]);
  });

  it("réimprimer : seulement une commande acceptée", async () => {
    const pasAcceptee = await commande(false);
    expect(await actionGestion(pasAcceptee, { action: "reimprimer" }, gerant)).toEqual({ ok: false, message: "Seule une commande acceptée s'imprime." });
    const c = await commande();
    const r = await actionGestion(c, { action: "reimprimer", station: "pizza" }, gerant);
    expect(r.ok).toBe(true);
    expect((await journal(c)).at(-1)).toMatchObject({ action: "reimprimer" });
  });

  it("renvoyer un e-mail : seulement un e-mail de cette commande, sujet marqué « nouvel envoi »", async () => {
    const a = await commande();
    const b = await commande();
    const db = await baseLocale();
    await db.query("select enregistrer_courriel($1)", [{ commande_id: a, destinataire: `act${n - 1}@laferme.test`, sujet: "Commande reçue", texte: "Merci", html: "<p>Merci</p>", fournisseur: "doublure" }]);
    const mail = (await db.query<{ id: string; sujet: string }>("select id, sujet from courriels where commande_id = $1 order by envoye_le limit 1", [a])).rows[0];
    expect(await actionGestion(b, { action: "renvoyer_courriel", courriel: mail.id }, gerant)).toEqual({ ok: false, message: "E-mail introuvable." });
    const r = await actionGestion(a, { action: "renvoyer_courriel", courriel: mail.id }, gerant);
    expect(r).toEqual({ ok: true, message: `E-mail renvoyé à act${n - 1}@laferme.test.` });
    const derniers = (await db.query<{ sujet: string }>("select sujet from courriels where commande_id = $1 order by envoye_le desc limit 1", [a])).rows[0];
    expect(derniers.sujet).toBe(`${mail.sujet} (nouvel envoi)`);
    expect((await journal(a)).at(-1)).toMatchObject({ action: "renvoyer_courriel", courriel: mail.id });
  });
});
