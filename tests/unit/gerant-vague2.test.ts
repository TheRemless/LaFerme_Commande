import { beforeAll, describe, expect, it, vi } from "vitest";
import { baseLocale } from "@/lib/db/locale";

// Vague 2 de la session gérant, côté serveur : supplément épuisé au panier, fermeture d'un service et
// ouverture exceptionnelle dans les créneaux, manque signalé depuis la tablette (Stripe remplacé).
const stripe = { panne: false, appels: [] as { pi: string; montantCentimes?: number; cle?: string }[] };
vi.mock("@/lib/paiement/passerelle", async (original) => ({
  ...(await original<typeof import("@/lib/paiement/passerelle")>()),
  passerelle: () => ({
    nom: "stripe",
    async rembourser(pi: string, options: { montantCentimes?: number; cle?: string } = {}) {
      stripe.appels.push({ pi, ...options });
      if (stripe.panne) throw Object.assign(new Error("Refus de Stripe (simulé)"), { type: "StripeInvalidRequestError" });
      return { id: `re_${options.cle ?? pi}` };
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

const { calculerPanier } = await import("@/lib/panier");
const { creneaux, fermetureProche, depuisHeureGeneve } = await import("@/lib/service");
const { signalerManque } = await import("@/lib/commandes");
const { fileTablette } = await import("@/lib/tablette");
const { chargerCatalogue } = await import("@/lib/catalogue");
type ConfigService = import("@/lib/service").ConfigService;

let service: string;
let n = 0;

async function acceptee(comptoir = false): Promise<{ id: string; numero: number }> {
  const db = await baseLocale();
  n += 1;
  const p = {
    jeton_suivi: `jeton-gv2-${n}`, cle_idempotence: `gv2-${n}`, mode: "retrait",
    statut: comptoir ? "nouvelle" : "paiement_en_attente", statut_paiement: comptoir ? "a_encaisser_retrait" : "en_attente",
    moyen_paiement: comptoir ? "comptoir" : "en_ligne", client_prenom: "Ana", client_nom: "Test", client_telephone: "079 000 00 00",
    client_email: `gv2${n}@laferme.test`, quand_type: "asap", pizzas_seulement: false, sous_total_centimes: 6400, frais_centimes: 0,
    total_centimes: 6400, tva_centimes: 162, taux_tva_pourcent: 2.6, origine: "http://localhost:3000",
    lignes: [
      { slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 2, unitaire_centimes: 2300, total_centimes: 4600, choix: { "supplements-pizza": ["Ananas"] }, retraits: [], note: "" },
      { slug: "lasagne-de-boeuf", nom: "Lasagne de bœuf", station: "cuisine", qte: 1, unitaire_centimes: 1800, total_centimes: 1800, choix: {}, retraits: [], note: "" },
    ],
  };
  const c = (await db.query<{ id: string; numero: number }>("select * from creer_commande($1)", [p])).rows[0];
  if (!comptoir) await db.query("select appliquer_paiement($1, $2, 'paye', $3, 6400)", [`evt-gv2-${n}`, c.id, `pi_vrai_gv2_${n}`]);
  await db.query("select changer_statut($1, 'acceptee', 'tablette:Test', now())", [c.id]);
  return c;
}

beforeAll(async () => {
  const db = await baseLocale();
  service = (await db.query<{ id: string }>("select id from personnel where email = 'equipe-bureau@laferme.test'")).rows[0].id;
});

describe("G07 : supplément épuisé", () => {
  it("le panier refuse un supplément épuisé, les autres passent", async () => {
    const db = await baseLocale();
    await db.query("select regler_rupture_option('supplements-pizza', 'Anchois', true, null)");
    const cat = await chargerCatalogue();
    const ligne = (choix: string[]) => ({ slug: "pizza-margherita", qte: 1, choix: { "supplements-pizza": choix }, retraits: [], note: "" });
    expect(calculerPanier(cat, [ligne(["Anchois"])], null).lignes[0].erreur).toBe("Anchois : épuisé pour aujourd'hui.");
    expect(calculerPanier(cat, [ligne(["Ananas"])], null).lignes[0].erreur).toBeUndefined();
    await db.query("select regler_rupture_option('supplements-pizza', 'Anchois', false, null)");
  });
});

describe("G07 : manque signalé depuis la tablette", () => {
  it("rembourse chez Stripe le montant calculé par la base et prévient le client", async () => {
    const c = await acceptee();
    stripe.appels.length = 0;
    const r = await signalerManque(c.id, [{ ligne: 1, qte: 1 }], "manque-test-0001", service, true);
    expect(r).toMatchObject({ ok: true, montant_centimes: 1800 });
    expect(stripe.appels).toEqual([{ pi: `pi_vrai_gv2_${n}`, montantCentimes: 1800, cle: "manque-test-0001" }]);
    const db = await baseLocale();
    const m = (await db.query<{ sujet: string; texte: string }>("select sujet, texte from courriels where commande_id = $1 and sujet like 'Il manque%'", [c.id])).rows;
    expect(m).toHaveLength(1);
    expect(m[0].texte).toContain("1 × Lasagne de bœuf");
    expect(m[0].texte).toContain("CHF 18.00");
    const file = await fileTablette();
    expect(file.find((x) => x.id === c.id)).toMatchObject({ deduit_centimes: 1800, manques: ["1 × Lasagne de bœuf"] });
  });

  it("estime sans rembourser ni écrire au client", async () => {
    const c = await acceptee();
    stripe.appels.length = 0;
    const r = await signalerManque(c.id, [{ ligne: 0, groupe: "supplements-pizza", nom: "Ananas" }], "manque-test-0002", service, false);
    expect(r).toMatchObject({ ok: true, montant_centimes: 400, description: "Ananas sur 2 × Pizza Margherita" });
    expect(stripe.appels).toHaveLength(0);
  });

  it("au comptoir, déduit sans passer par Stripe et dit ce qu'il reste à encaisser", async () => {
    const c = await acceptee(true);
    stripe.appels.length = 0;
    const r = await signalerManque(c.id, [{ ligne: 1, qte: 1 }], "manque-test-0003", service, true);
    expect(r).toMatchObject({ ok: true, montant_centimes: 1800 });
    expect(r.message).toContain("CHF 46.00");
    expect(stripe.appels).toHaveLength(0);
  });
});

describe("fermer un seul service, ouvrir un jour non prévu", () => {
  const base: ConfigService = {
    zones: [],
    npa: [],
    horaires: [
      { jour: 2, service: "midi", premiere_heure: "11:45:00", derniere_heure: "13:45:00", derniere_commande: "13:15:00", derniere_commande_pizzas: "13:15:00" },
      { jour: 2, service: "soir", premiere_heure: "18:45:00", derniere_heure: "22:45:00", derniere_commande: "21:30:00", derniere_commande_pizzas: "22:15:00" },
    ],
    fermetures: [],
    reglages: { preparation_minutes: 20, creneau_minutes: 15, avance_jours: 7 },
  };
  // Lundi 30.11.2026, 9h : on regarde le mardi 1er et le dimanche 6 décembre.
  const lundi = depuisHeureGeneve("2026-11-30T09:00")!;

  it("ferme le midi du mardi sans toucher au soir, et n'annonce pas une fermeture du jour", () => {
    const config = { ...base, fermetures: [{ debut: "2026-12-01", fin: "2026-12-01", motif: "Formation", service: "midi" as const }] };
    const mardi = creneaux(config, lundi, "retrait").filter((c) => c.date === "2026-12-01");
    expect(mardi.some((c) => c.service === "midi")).toBe(false);
    expect(mardi.some((c) => c.service === "soir")).toBe(true);
    expect(fermetureProche(config, lundi)).toBeNull();
  });

  it("ouvre le dimanche soir avec ses propres heures", () => {
    const config = {
      ...base,
      ouvertures: [{ jour: "2026-12-06", service: "soir" as const, premiere_heure: "18:00:00", derniere_heure: "21:00:00", derniere_commande: "20:30:00", derniere_commande_pizzas: "20:30:00" }],
    };
    const dimanche = creneaux(config, lundi, "retrait").filter((c) => c.date === "2026-12-06");
    expect(dimanche[0]).toMatchObject({ minutes: 18 * 60, service: "soir" });
    expect(dimanche.at(-1)?.minutes).toBeLessThanOrEqual(21 * 60);
  });
});
