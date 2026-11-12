import { beforeAll, describe, expect, it, vi } from "vitest";
import { baseLocale } from "@/lib/db/locale";

// Audit « samedi soir » : refus d'une commande payée quand le prestataire de paiement échoue.
// La passerelle est remplacée par une fausse : remboursement en panne, puis rétabli.
const etatPasserelle = { panne: true, appels: 0 };
vi.mock("@/lib/paiement/passerelle", () => ({
  passerelle: () => ({
    nom: "stripe",
    async rembourser(pi: string) {
      etatPasserelle.appels += 1;
      if (etatPasserelle.panne) throw new Error("Stripe indisponible (simulé)");
      await new Promise((ok) => setTimeout(ok, 30));
      return { id: `re_${pi}` };
    },
    async creerSession() {
      throw new Error("non utilisé");
    },
    async lireSession() {
      return { statut: "en_attente", montantCentimes: null, devise: null };
    },
    async expirerSession() {},
  }),
  clientStripe: () => null,
}));

const { agir } = await import("@/lib/tablette");
const personnel = { id: "00000000-0000-0000-0000-000000000000", email: "audit@laferme.test", nom: "Audit", role: "service" as const };

let n = 0;
async function commandePayee(): Promise<{ id: string; numero: number }> {
  const db = await baseLocale();
  n += 1;
  const p = {
    jeton_suivi: `jeton-remb-${n}`, cle_idempotence: `remb-${n}`, mode: "retrait", statut: "paiement_en_attente", statut_paiement: "en_attente",
    moyen_paiement: "en_ligne", client_prenom: "Rem", client_nom: "Audit", client_telephone: "079 000 00 00", client_email: "remb@laferme.test",
    quand_type: "asap", pizzas_seulement: true, sous_total_centimes: 1800, frais_centimes: 0, total_centimes: 1800, tva_centimes: 46,
    taux_tva_pourcent: 2.6, origine: "http://localhost:3102",
    lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 1800, total_centimes: 1800, choix: {}, retraits: [], note: "" }],
  };
  const c = (await db.query<{ id: string; numero: number }>("select * from creer_commande($1)", [p])).rows[0];
  await db.query("select appliquer_paiement($1, $2, 'paye', $3, 1800)", [`evt-${n}`, c.id, `pi_${n}`]);
  return c;
}
async function courriels(id: string) {
  const db = await baseLocale();
  return (await db.query<{ sujet: string }>("select sujet from courriels where commande_id = $1 order by envoye_le", [id])).rows.map((r) => r.sujet);
}
async function etat(id: string) {
  const db = await baseLocale();
  return (await db.query<{ statut: string; statut_paiement: string }>("select statut, statut_paiement from commandes where id = $1", [id])).rows[0];
}

beforeAll(async () => {
  await baseLocale();
});

describe("refus avec prestataire de paiement en panne", () => {
  it("CONSTAT : la commande passe « refusée » mais reste « payée », et le client ne reçoit aucun e-mail", async () => {
    etatPasserelle.panne = true;
    const c = await commandePayee();
    const r = await agir(c.id, { action: "refuser", motif: "La cuisine est complète pour ce service." }, personnel);
    expect(r).toEqual({ ok: true, message: "Commande refusée, mais le remboursement n'est pas passé. Réessayez." });
    expect(await etat(c.id)).toEqual({ statut: "refusee", statut_paiement: "paye" });
    // Ni courriel de refus, ni courriel de remboursement : le client a payé et n'est prévenu de rien.
    expect(await courriels(c.id)).toEqual([]);
  });

  it("le bouton « Rembourser » marche une fois le prestataire revenu, et le client est alors prévenu", async () => {
    etatPasserelle.panne = true;
    const c = await commandePayee();
    await agir(c.id, { action: "refuser", motif: "Un des plats commandés est épuisé." }, personnel);
    etatPasserelle.panne = false;
    const r = await agir(c.id, { action: "rembourser" }, personnel);
    expect(r.ok).toBe(true);
    expect(await etat(c.id)).toEqual({ statut: "refusee", statut_paiement: "rembourse" });
    expect((await courriels(c.id)).length).toBe(1);
  });

  it("CONSTAT : deux appuis simultanés sur « Rembourser » : un seul remboursement, mais un des deux écrans dit « pas passé »", async () => {
    etatPasserelle.panne = true;
    const c = await commandePayee();
    await agir(c.id, { action: "refuser", motif: "Un des plats commandés est épuisé." }, personnel);
    etatPasserelle.panne = false;
    etatPasserelle.appels = 0;
    const [a, b] = await Promise.all([agir(c.id, { action: "rembourser" }, personnel), agir(c.id, { action: "rembourser" }, personnel)]);
    expect(etatPasserelle.appels).toBe(2); // deux appels au prestataire (même clé d'idempotence chez Stripe)
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a.message, b.message]).toContain("Le remboursement n'est pas passé. Vérifiez dans Stripe ou appelez Jérémy.");
    expect((await etat(c.id)).statut_paiement).toBe("rembourse");
  });

  it("CONSTAT : accepter et refuser au même instant depuis deux tablettes : les deux réussissent", async () => {
    etatPasserelle.panne = false;
    const c = await commandePayee();
    const heure = new Date(Date.now() + 30 * 60_000).toISOString();
    const [acc, ref] = await Promise.all([
      agir(c.id, { action: "accepter", heure }, personnel),
      agir(c.id, { action: "refuser", motif: "La cuisine est complète pour ce service." }, personnel),
    ]);
    expect(acc.ok).toBe(true);
    expect(ref.ok).toBe(true);
    const db = await baseLocale();
    const evts = (await db.query<{ de: string; vers: string }>("select de, vers from evenements_commande where commande_id = $1 order by id", [c.id])).rows;
    expect(evts).toEqual([
      { de: "nouvelle", vers: "acceptee" },
      { de: "acceptee", vers: "refusee" },
    ]);
  });
});
