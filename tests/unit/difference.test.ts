import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { beforeAll, describe, expect, it } from "vitest";
import { chargerCatalogue } from "@/lib/catalogue";
import { baseLocale } from "@/lib/db/locale";
import { creerCommande } from "@/lib/db/serveur";
import { texteTicket, type LigneTicket } from "@/lib/impression/ticket";
import { calculerPanier, prixChoix, type LignePanier } from "@/lib/panier";

// Le client appelle pour changer sa commande (vague 3, bo-commandes), côté serveur : plus chère par le lien (payé
// par un événement Stripe signé, une fois), à la porte (ticket AJOUT avec le complément), moins chère (remboursée).
// Prix calculés depuis la base, jamais écrits ici. Le webhook se signe avec des clés factices (sans réseau).
process.env.STRIPE_SECRET_KEY = "sk_test_factice";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_factice";
const stripe = new Stripe("sk_test_factice");

let POST: (r: Request) => Promise<Response>;
let gerant: { id: string; nom: string; email: string; role: "gerant" };
beforeAll(async () => {
  ({ POST } = await import("@/app/api/stripe/webhook/route"));
  const db = await baseLocale();
  const g = (await db.query<{ id: string; nom: string }>("select id, nom from personnel where email = 'gerant-bureau@laferme.test'")).rows[0];
  gerant = { ...g, email: "gerant-bureau@laferme.test", role: "gerant" };
});

const MARGHERITA: LignePanier = { slug: "pizza-margherita", qte: 1, choix: {}, retraits: [], note: "" };
const COCA: LignePanier = { slug: "coca-cola", qte: 1, choix: {}, retraits: [], note: "" };

// Commande payée en ligne (ou à la porte en livraison), acceptée, premiers tickets sortis.
async function commandePayee(lignes: LignePanier[], mode: "retrait" | "livraison" = "retrait") {
  const db = await baseLocale();
  const cat = await chargerCatalogue();
  const t = calculerPanier(cat, lignes, null);
  const cle = randomUUID();
  const c = await creerCommande({
    jeton_suivi: `jeton-${cle}`, cle_idempotence: cle, mode, statut: "paiement_en_attente", statut_paiement: "en_attente", moyen_paiement: "en_ligne",
    client_prenom: "Léa", client_nom: "Rossi", client_telephone: "079 555 12 34", client_email: `diff-${cle.slice(0, 8)}@exemple.ch`,
    quand_type: "asap", pizzas_seulement: t.pizzas_seulement, sous_total_centimes: t.sous_total_centimes, frais_centimes: 0,
    total_centimes: t.total_centimes, tva_centimes: t.tva_centimes, taux_tva_pourcent: cat.tauxTvaPourcent, origine: "http://localhost:3000",
    adresse: mode === "livraison" ? { rue: "Route de Chancy", numero: "1", npa: "1213", localite: "Onex" } : null,
    details_livraison: mode === "livraison" ? { sonnette: "Rossi", etage: "", code: "", instructions: "" } : null,
    zone_numero: mode === "livraison" ? 1 : null,
    lignes: t.lignes.map((l) => ({ slug: l.slug, nom: l.nom, station: cat.plats[l.slug].station, qte: l.qte, unitaire_centimes: l.unitaire_centimes, total_centimes: l.total_centimes, choix: l.choix, prix_choix: prixChoix(cat, l), retraits: l.retraits, note: "" })),
  });
  await db.query("select appliquer_paiement($1, $2, 'paye', 'pi_diff', $3)", [`evt-${c.id}`, c.id, t.total_centimes]);
  await db.query("select changer_statut($1, 'acceptee', 'tablette:Test', now())", [c.id]);
  const { imprimerCommande } = await import("@/lib/impression/service");
  await imprimerCommande(c.id);
  return { id: c.id, total: t.total_centimes };
}

function evenementComplement(id: string, modification: string, session: string, montant: number) {
  return JSON.stringify({
    id, object: "event", type: "checkout.session.completed",
    data: { object: { object: "checkout.session", id: session, metadata: { commande_id: "x", type: "complement", modification_id: modification }, payment_status: "paid", payment_intent: "pi_complement", amount_total: montant, currency: "chf" } },
  });
}
async function envoyer(corps: string) {
  const signature = stripe.webhooks.generateTestHeaderString({ payload: corps, secret: "whsec_factice" });
  return POST(new Request("http://localhost/api/stripe/webhook", { method: "POST", body: corps, headers: { "stripe-signature": signature } }));
}
async function taches(commande: string) {
  const db = await baseLocale();
  return (await db.query<{ station: string; contenu: LigneTicket[] }>("select station, contenu from taches_impression where commande_id = $1 order by cree_le", [commande])).rows;
}

describe("changer les plats d'une commande payée", () => {
  it("plus chère par le lien : rien avant le paiement ; l'événement Stripe signé l'applique une fois, ticket AJOUT", async () => {
    const { apercuDifference } = await import("@/lib/difference");
    const c = await commandePayee([MARGHERITA]);
    const voulu = [MARGHERITA, COCA];
    const a = await apercuDifference(c.id, { lignes: voulu });
    expect(a).toMatchObject({ ok: true, reglements: ["lien", "comptoir"], paye: true });
    if (!a.ok) return;
    expect(a.difference).toBeGreaterThan(0);
    // Préparée directement en base (le lien chez Stripe demanderait le réseau) puis liée à une session de test.
    const db = await baseLocale();
    const cat = await chargerCatalogue();
    const t = calculerPanier(cat, voulu, null);
    const lignes = t.lignes.map((l) => ({ slug: l.slug, nom: l.nom, station: cat.plats[l.slug].station, qte: l.qte, unitaire_centimes: l.unitaire_centimes, total_centimes: l.total_centimes, choix: l.choix, prix_choix: null, retraits: l.retraits, note: "", pour: "" }));
    const m = (await db.query<{ r: { id: string; difference_centimes: number } }>("select preparer_modification($1, $2, $3) as r", [
      c.id,
      { cle: `lien-${randomUUID()}`, reglement: "lien", lignes, ajouts: [lignes[1]], retires: [], pizzas_seulement: t.pizzas_seulement, sous_total_centimes: t.sous_total_centimes, frais_centimes: 0, total_centimes: t.total_centimes, tva_centimes: t.tva_centimes },
      gerant.id,
    ])).rows[0].r;
    expect(m.difference_centimes).toBe(a.difference);
    await db.query("select lier_session_modification($1, 'cs_test_complement_1')", [m.id]);
    const avant = (await taches(c.id)).length;
    // Mauvais montant : rien. Bon montant : appliqué. Rejoué : rien de plus.
    expect((await envoyer(evenementComplement("evt_c_1", m.id, "cs_test_complement_1", m.difference_centimes - 1))).status).toBe(200);
    expect((await db.query("select 1 from commande_lignes where commande_id = $1", [c.id])).rows).toHaveLength(1);
    expect((await envoyer(evenementComplement("evt_c_2", m.id, "cs_test_complement_1", m.difference_centimes))).status).toBe(200);
    expect((await envoyer(evenementComplement("evt_c_2", m.id, "cs_test_complement_1", m.difference_centimes))).status).toBe(200);
    expect((await db.query("select 1 from commande_lignes where commande_id = $1", [c.id])).rows).toHaveLength(2);
    expect((await db.query<{ n: number }>("select count(*)::int n from complements where commande_id = $1 and statut = 'encaisse'", [c.id])).rows[0].n).toBe(1);
    const nouvelles = (await taches(c.id)).slice(avant);
    expect(nouvelles.length).toBeGreaterThanOrEqual(1);
    expect(texteTicket(nouvelles[0].contenu)).toMatch(/^>> AJOUT <</);
    expect(texteTicket(nouvelles[0].contenu)).toContain("Coca-Cola");
  });

  it("plus chère à la porte : appliquée tout de suite, ticket AJOUT avec le complément à encaisser ; e-mail au client", async () => {
    const { modifierPlats } = await import("@/lib/difference");
    // Assez de pizzas pour le minimum de la zone 1 (lu dans la configuration, jamais écrit ici).
    const { chargerConfigService } = await import("@/lib/config-service");
    const minimum = (await chargerConfigService()).zones.find((z) => z.numero === 1)?.minimum_centimes ?? 0;
    const prix = (await chargerCatalogue()).plats["pizza-margherita"].prix_centimes;
    const pizzas = { ...MARGHERITA, qte: Math.min(20, Math.ceil(minimum / prix) + 1) };
    const c = await commandePayee([pizzas], "livraison");
    const r = await modifierPlats(c.id, { cle: `porte-${randomUUID()}`, de: "acceptee", lignes: [pizzas, COCA], reglement: "porte" }, gerant, "http://localhost:3000");
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    const texte = (await taches(c.id)).map((x) => texteTicket(x.contenu)).join("\n");
    expect(texte).toMatch(/A ENCAISSER A LA LIVRAISON : CHF \d+\.\d\d/);
    // La boisson ajoutée part au poste qui fait le sac de cette commande (pizza), pas en cuisine.
    expect(texte).toMatch(/>> AJOUT <<\nPIZZA/);
    const db = await baseLocale();
    const m = (await db.query<{ texte: string }>("select texte from courriels where commande_id = $1 order by envoye_le desc limit 1", [c.id])).rows[0];
    expect(m.texte).toContain("se paie à la livraison");
  });

  it("moins chère : appliquée, remboursée par la doublure de Stripe, e-mail au client", async () => {
    const { modifierPlats } = await import("@/lib/difference");
    delete process.env.STRIPE_SECRET_KEY;
    try {
      const c = await commandePayee([MARGHERITA, COCA]);
      const r = await modifierPlats(c.id, { cle: `moins-${randomUUID()}`, de: "acceptee", lignes: [MARGHERITA] }, gerant, "http://localhost:3000");
      expect(r).toMatchObject({ ok: true });
      const db = await baseLocale();
      const rb = (await db.query<{ statut: string; moyen: string }>("select statut, moyen from remboursements where commande_id = $1", [c.id])).rows;
      expect(rb).toHaveLength(1);
      expect(rb[0].moyen).toBe("stripe");
      const m = (await db.query<{ texte: string }>("select texte from courriels where commande_id = $1 order by envoye_le desc limit 1", [c.id])).rows[0];
      expect(m.texte).toContain("Nous vous remboursons");
    } finally {
      process.env.STRIPE_SECRET_KEY = "sk_test_factice";
    }
  });

  it("commande refusée après un complément payé par le lien : le complément est remboursé aussi, sur son paiement", async () => {
    const c = await commandePayee([MARGHERITA]);
    const db = await baseLocale();
    // Paiements de la doublure (remboursés sans réseau) : la commande et son complément.
    await db.query("update commandes set stripe_payment_intent = $2 where id = $1", [c.id, `pi_doublure_${c.id}`]);
    const k = (await db.query<{ id: string }>(
      "insert into complements (commande_id, montant_centimes, tva_centimes, moyen, statut, moyen_encaissement, stripe_payment_intent, encaisse_le) values ($1, 450, 11, 'en_ligne', 'encaisse', 'stripe', $2, now()) returning id",
      [c.id, `pi_doublure_complement_${c.id}`],
    )).rows[0].id;
    const { rembourserCommande } = await import("@/lib/commandes");
    expect(await rembourserCommande(c.id, "Fermé plus tôt")).toMatchObject({ rembourse: true });
    const apres = (await db.query<{ rembourse_le: string | null; stripe_refund_id: string | null }>("select rembourse_le, stripe_refund_id from complements where id = $1", [k])).rows[0];
    expect(apres.rembourse_le).not.toBeNull();
    expect(apres.stripe_refund_id).toBeTruthy();
  });
});
