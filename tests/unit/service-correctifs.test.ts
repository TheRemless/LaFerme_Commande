import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { baseLocale } from "@/lib/db/locale";

// Correctifs de l'audit « samedi soir » côté serveur (docs/audits/samedi-soir.md) : tablette, remboursement,
// surveillance. La passerelle de paiement est remplacée : remboursement en panne ou rétabli à la demande.
const etatPasserelle = { panne: false, appels: 0 };
vi.mock("@/lib/paiement/passerelle", async (original) => ({
  ...(await original<typeof import("@/lib/paiement/passerelle")>()),
  passerelle: () => ({
    nom: "stripe",
    async rembourser(pi: string) {
      etatPasserelle.appels += 1;
      if (etatPasserelle.panne) throw new Error("Stripe indisponible (simulé)");
      await new Promise((ok) => setTimeout(ok, 20));
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
}));

const { agir } = await import("@/lib/tablette");
const { confirmerPaiement } = await import("@/lib/commandes");
const { executerSurveillance } = await import("@/lib/surveillance");
const personnel = { id: "00000000-0000-0000-0000-000000000000", email: "test@laferme.test", nom: "Test", role: "service" as const };

let n = 0;
async function nouvelle(extra: Record<string, unknown> = {}): Promise<{ id: string; numero: number }> {
  const db = await baseLocale();
  n += 1;
  const p = {
    jeton_suivi: `jeton-svc-${n}`, cle_idempotence: `svc-${n}`, mode: "retrait", statut: "nouvelle", statut_paiement: "a_encaisser_retrait",
    moyen_paiement: "comptoir", client_prenom: "Svc", client_nom: "Test", client_telephone: "079 000 00 00", client_email: `svc${n}@laferme.test`,
    quand_type: "asap", pizzas_seulement: false, sous_total_centimes: 3300, frais_centimes: 0, total_centimes: 3300, tva_centimes: 85,
    taux_tva_pourcent: 2.6, origine: "http://localhost:3000",
    lignes: [
      { slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 1800, total_centimes: 1800, choix: {}, retraits: [], note: "" },
      { slug: "lasagne-de-boeuf", nom: "Lasagne de bœuf", station: "cuisine", qte: 1, unitaire_centimes: 1500, total_centimes: 1500, choix: {}, retraits: [], note: "" },
    ],
    ...extra,
  };
  return (await db.query<{ id: string; numero: number }>("select * from creer_commande($1)", [p])).rows[0];
}
async function payee(): Promise<{ id: string; numero: number }> {
  const c = await nouvelle({ statut: "paiement_en_attente", statut_paiement: "en_attente", moyen_paiement: "en_ligne" });
  const db = await baseLocale();
  await db.query("update commandes set stripe_session_id = $2 where id = $1", [c.id, `cs_${c.id}`]);
  await db.query("select appliquer_paiement($1, $2, 'paye', $3, 3300)", [`evt-${c.id}`, c.id, `pi_test_${n}`]);
  return c;
}
async function etat(id: string) {
  const db = await baseLocale();
  return (await db.query<{ statut: string; statut_paiement: string; avertissement: string | null }>("select statut, statut_paiement, avertissement from commandes where id = $1", [id])).rows[0];
}
async function courriels(where: string, v: unknown[]) {
  const db = await baseLocale();
  return (await db.query<{ destinataire: string; sujet: string; texte: string }>(`select destinataire, sujet, texte from courriels where ${where} order by envoye_le`, v)).rows;
}
const heure = () => new Date(Date.now() + 30 * 60_000).toISOString();

beforeAll(async () => {
  await baseLocale();
});
beforeEach(async () => {
  etatPasserelle.panne = false;
  etatPasserelle.appels = 0;
  const db = await baseLocale();
  await db.query("update reglages set valeur = 'null' where cle = 'pause_jusqu_a'");
  await db.query("update plats set rupture_jour = null where rupture_jour is not null");
});

describe("SS-03 : annulation après acceptation", () => {
  it("imprime « ANNULÉE » au poste qui a déjà le ticket et retire l'autre de la file", async () => {
    const db = await baseLocale();
    await db.query("insert into imprimantes (nom, station, jeton_hache, mac) values ('SC pizza', 'pizza', 'svc-pizza', '00:11:62:00:00:09'), ('SC cuisine', 'cuisine', 'svc-cuisine', '00:11:62:00:00:0a')");
    const c = await nouvelle();
    expect((await agir(c.id, { action: "accepter", heure: heure() }, personnel)).ok).toBe(true);
    await db.query("update taches_impression set etat = 'imprimee', imprime_le = now() where commande_id = $1 and station = 'pizza'", [c.id]);
    const r = await agir(c.id, { action: "refuser", motif: "Client injoignable." }, personnel);
    expect(r.ok).toBe(true);
    const taches = (await db.query<{ station: string; etat: string; contenu: { texte?: string; gauche?: string }[] }>(
      "select station, etat, contenu from taches_impression where commande_id = $1 order by cree_le", [c.id])).rows;
    expect(taches.filter((t) => t.station === "cuisine").map((t) => t.etat)).toEqual(["annulee"]);
    const annonce = taches.filter((t) => t.station === "pizza" && t.etat === "en_attente");
    expect(annonce).toHaveLength(1);
    expect(JSON.stringify(annonce[0].contenu)).toContain("ANNULÉE");
    await db.query("update imprimantes set actif = false where jeton_hache like 'svc-%'");
  });
});

describe("SS-04 : refus d'une commande payée quand le remboursement échoue", () => {
  it("prévient le client et le restaurant", async () => {
    etatPasserelle.panne = true;
    const c = await payee();
    const r = await agir(c.id, { action: "refuser", motif: "La cuisine est complète pour ce service." }, personnel);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/remboursement n'est pas passé/);
    expect(await etat(c.id)).toMatchObject({ statut: "refusee", statut_paiement: "paye" });
    const client = await courriels("commande_id = $1", [c.id]);
    expect(client).toHaveLength(1);
    expect(client[0].sujet).toMatch(new RegExp(`Commande ${c.numero}`));
    expect(client[0].texte).toMatch(/rembours/i);
    const alerte = await courriels("commande_id is null and sujet like $1", [`%${c.numero}%rembours%`]);
    expect(alerte.length).toBeGreaterThan(0);
  });

  it("SS-16 : deux appuis simultanés sur « Rembourser » disent tous deux que c'est fait", async () => {
    etatPasserelle.panne = true;
    const c = await payee();
    await agir(c.id, { action: "refuser", motif: "Un des plats commandés est épuisé." }, personnel);
    etatPasserelle.panne = false;
    const [a, b] = await Promise.all([agir(c.id, { action: "rembourser" }, personnel), agir(c.id, { action: "rembourser" }, personnel)]);
    expect([a.ok, b.ok]).toEqual([true, true]);
    expect((await etat(c.id)).statut_paiement).toBe("rembourse");
  });
});

describe("SS-06 : deux tablettes au même instant", () => {
  it("accepter sur l'une et refuser sur l'autre : une seule action passe", async () => {
    const c = await payee();
    const [acc, ref] = await Promise.all([
      agir(c.id, { action: "accepter", heure: heure(), de: "nouvelle" }, personnel),
      agir(c.id, { action: "refuser", motif: "La cuisine est complète pour ce service.", de: "nouvelle" }, personnel),
    ]);
    expect([acc.ok, ref.ok].filter(Boolean)).toHaveLength(1);
  });
});

describe("G01 : retrait payé au comptoir", () => {
  it("« Retirée et payée » termine et encaisse d'un geste", async () => {
    const c = await nouvelle();
    await agir(c.id, { action: "accepter", heure: heure() }, personnel);
    await agir(c.id, { action: "statut", vers: "prete" }, personnel);
    const r = await agir(c.id, { action: "retiree_payee" }, personnel);
    expect(r.ok).toBe(true);
    expect(await etat(c.id)).toMatchObject({ statut: "terminee", statut_paiement: "encaisse" });
  });

  it("une commande déjà retirée sans être encaissée peut encore l'être", async () => {
    const c = await nouvelle();
    await agir(c.id, { action: "accepter", heure: heure() }, personnel);
    await agir(c.id, { action: "statut", vers: "prete" }, personnel);
    await agir(c.id, { action: "statut", vers: "terminee" }, personnel);
    expect((await agir(c.id, { action: "encaisser" }, personnel)).ok).toBe(true);
    expect((await etat(c.id)).statut_paiement).toBe("encaisse");
  });
});

describe("SS-08 : paiement confirmé pendant une pause ou après une rupture", () => {
  it("la commande arrive avec un avertissement", async () => {
    const db = await baseLocale();
    const c = await nouvelle({ statut: "paiement_en_attente", statut_paiement: "en_attente", moyen_paiement: "en_ligne" });
    await db.query("update commandes set stripe_session_id = $2 where id = $1", [c.id, `cs_${c.id}`]);
    await db.query("update reglages set valeur = '\"sans-fin\"' where cle = 'pause_jusqu_a'");
    await db.query("update plats set rupture_jour = (now() at time zone 'Europe/Zurich')::date where slug = 'lasagne-de-boeuf'");
    expect(await confirmerPaiement(c.id, `evt-av-${c.id}`, { sessionId: `cs_${c.id}`, montantCentimes: 3300, devise: "chf", paymentIntent: "pi_av" })).toBe(true);
    const a = (await etat(c.id)).avertissement ?? "";
    expect(a).toMatch(/pause/i);
    expect(a).toMatch(/Lasagne de bœuf/);
  });

  it("aucun avertissement quand tout va bien", async () => {
    const db = await baseLocale();
    const c = await nouvelle({ statut: "paiement_en_attente", statut_paiement: "en_attente", moyen_paiement: "en_ligne", lignes: [
      { slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 3300, total_centimes: 3300, choix: {}, retraits: [], note: "" },
    ] });
    await db.query("update commandes set stripe_session_id = $2 where id = $1", [c.id, `cs_${c.id}`]);
    // Heure demandée hors de tout service : on ne vérifie ici que la pause et les ruptures.
    await confirmerPaiement(c.id, `evt-ok-${c.id}`, { sessionId: `cs_${c.id}`, montantCentimes: 3300, devise: "chf", paymentIntent: "pi_ok" });
    expect((await etat(c.id)).avertissement ?? "").not.toMatch(/pause|épuisé/i);
  });
});

describe("SS-09 : pas d'alerte « pas acceptée » hors service", () => {
  it("dimanche, restaurant fermé : la commande en attente ne déclenche rien", async () => {
    const db = await baseLocale();
    const c = await nouvelle();
    await db.query("update commandes set cree_le = now() - interval '20 minutes' where id = $1", [c.id]);
    await db.query("update surveillance_etat set surveillance_le = null where id");
    const dimanche = new Date("2026-11-15T12:00:00Z");
    const r = await executerSurveillance(dimanche);
    expect(r.retards).toBe(0);
    expect((await db.query<{ a: string | null }>("select alerte_le as a from commandes where id = $1", [c.id])).rows[0].a).toBeNull();
  });
});

describe("SS-15 : courriels successifs d'une même commande", () => {
  it("deux changements d'heure ont deux clés d'idempotence Resend différentes", async () => {
    const { cleIdempotence } = await import("@/lib/courriel/envoi");
    const base = { commandeId: "c1", destinataire: "a@b.ch", sujet: "Commande 4, nouvelle heure", html: "" };
    expect(cleIdempotence({ ...base, texte: "vers 19h45" })).not.toBe(cleIdempotence({ ...base, texte: "vers 20h00" }));
    expect(cleIdempotence({ ...base, texte: "vers 19h45" })).toBe(cleIdempotence({ ...base, texte: "vers 19h45" }));
  });
});
