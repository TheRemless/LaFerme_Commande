import { beforeAll, describe, expect, it, vi } from "vitest";
import { baseLocale } from "@/lib/db/locale";

// Panne « confirmation de Stripe perdue » (docs/pannes.md) : le client a payé, le webhook n'est jamais
// arrivé et le client a fermé la page avant son retour sur le suivi. La surveillance relit la session.
// Doublure de Stripe : les sessions payées et leur montant.
const sessions = new Map<string, { statut: "paye" | "en_attente" | "echec"; montantCentimes: number; devise: string }>();
vi.mock("@/lib/paiement/passerelle", async (original) => ({
  ...(await original<typeof import("@/lib/paiement/passerelle")>()),
  paiementDisponible: () => true,
  passerelle: () => ({
    nom: "stripe",
    async lireSession(id: string) {
      const s = sessions.get(id);
      return s ? { ...s, paymentIntent: `pi_${id}` } : { statut: "en_attente", montantCentimes: null, devise: null };
    },
    async rembourser() {
      throw new Error("non utilisé");
    },
    async creerSession() {
      throw new Error("non utilisé");
    },
    async expirerSession() {},
  }),
}));

const { rattraperPaiements } = await import("@/lib/surveillance");

let n = 0;

// Commande payée en ligne, session Stripe liée, créée il y a `minutes` minutes, sans confirmation reçue.
async function enAttente(minutes: number, total = 4200): Promise<{ id: string; session: string }> {
  const db = await baseLocale();
  n += 1;
  const p = {
    jeton_suivi: `jeton-pr-${n}`, cle_idempotence: `pr-${n}`, mode: "retrait", statut: "paiement_en_attente", statut_paiement: "en_attente",
    moyen_paiement: "en_ligne", client_prenom: "Lea", client_nom: "Test", client_telephone: "079 000 00 00", client_email: `pr${n}@laferme.test`,
    quand_type: "asap", pizzas_seulement: true, sous_total_centimes: total, frais_centimes: 0, total_centimes: total, tva_centimes: 106,
    taux_tva_pourcent: 2.6, origine: "http://localhost:3000",
    lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: total, total_centimes: total, choix: {}, retraits: [], note: "" }],
  };
  const c = (await db.query<{ id: string }>("select * from creer_commande($1)", [p])).rows[0];
  const session = `cs_test_rattrapage_${n}`;
  await db.query("select lier_session_paiement($1, $2)", [c.id, session]);
  await db.query("update commandes set cree_le = now() - make_interval(mins => $2) where id = $1", [c.id, minutes]);
  return { id: c.id, session };
}

async function etat(id: string) {
  const db = await baseLocale();
  return (await db.query<{ statut: string; statut_paiement: string }>("select statut, statut_paiement from commandes where id = $1", [id])).rows[0];
}

beforeAll(async () => {
  // Les commandes laissées par d'autres tests dans la même base ne doivent pas compter.
  const db = await baseLocale();
  await db.query("update commandes set stripe_session_id = null where statut = 'paiement_en_attente' and stripe_session_id like 'cs_test_rattrapage_%'");
});

describe("surveillance : paiement dont la confirmation de Stripe n'est jamais arrivée", () => {
  it("la commande payée chez Stripe passe sur la tablette", async () => {
    const c = await enAttente(10);
    sessions.set(c.session, { statut: "paye", montantCentimes: 4200, devise: "chf" });
    expect(await rattraperPaiements()).toBeGreaterThanOrEqual(1);
    expect(await etat(c.id)).toEqual({ statut: "nouvelle", statut_paiement: "paye" });
    // Tour suivant : plus rien à rattraper pour elle, rien ne change.
    await rattraperPaiements();
    expect(await etat(c.id)).toEqual({ statut: "nouvelle", statut_paiement: "paye" });
  });

  it("une session expirée chez Stripe annule la commande", async () => {
    const c = await enAttente(10);
    sessions.set(c.session, { statut: "echec", montantCentimes: 4200, devise: "chf" });
    await rattraperPaiements();
    expect((await etat(c.id)).statut_paiement).toBe("echec");
  });

  it("ne touche ni un paiement en cours (moins de 3 minutes), ni un montant différent", async () => {
    const recente = await enAttente(1);
    sessions.set(recente.session, { statut: "paye", montantCentimes: 4200, devise: "chf" });
    const fausse = await enAttente(10);
    sessions.set(fausse.session, { statut: "paye", montantCentimes: 100, devise: "chf" });
    await rattraperPaiements();
    expect((await etat(recente.id)).statut_paiement).toBe("en_attente");
    expect((await etat(fausse.id)).statut_paiement).toBe("en_attente");
  });

  it("au-delà de deux heures, la commande n'est plus relue", async () => {
    const vieille = await enAttente(180);
    sessions.set(vieille.session, { statut: "paye", montantCentimes: 4200, devise: "chf" });
    await rattraperPaiements();
    expect((await etat(vieille.id)).statut_paiement).toBe("en_attente");
  });
});
