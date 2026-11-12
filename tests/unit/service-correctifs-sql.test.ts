import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Correctifs de l'audit « samedi soir » côté base (docs/audits/samedi-soir.md), avec une horloge réglable :
// search_path = public, pg_catalog et une fonction public.now() qui lit l'heure du test. Les fonctions SQL
// du projet appellent now() sans schéma et prennent donc l'heure simulée (les vues et les valeurs par
// défaut des colonnes gardent l'heure réelle).

let db: PGlite;

async function horloge(iso: string) {
  await db.query("delete from horloge_test where true");
  await db.query("insert into horloge_test values ($1::timestamptz)", [iso]);
}
async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}
async function reglage<T>(cle: string): Promise<T> {
  return (await db.query<{ v: T }>("select valeur as v from reglages where cle = $1", [cle])).rows[0].v;
}

let n = 0;
function commande(extra: Record<string, unknown> = {}) {
  n += 1;
  return {
    jeton_suivi: `jeton-sc-${n}`,
    cle_idempotence: `sc-${n}`,
    mode: "retrait",
    statut: "nouvelle",
    statut_paiement: "a_encaisser_retrait",
    moyen_paiement: "comptoir",
    client_prenom: `S${n}`,
    client_nom: "Test",
    client_telephone: "079 000 00 00",
    client_email: "sc@laferme.test",
    quand_type: "asap",
    pizzas_seulement: false,
    sous_total_centimes: 3000,
    frais_centimes: 0,
    total_centimes: 3000,
    tva_centimes: 76,
    taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000",
    lignes: [
      { slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 1500, total_centimes: 1500, choix: {}, retraits: [], note: "" },
      { slug: "lasagne-de-boeuf", nom: "Lasagne de bœuf", station: "cuisine", qte: 1, unitaire_centimes: 1500, total_centimes: 1500, choix: {}, retraits: [], note: "" },
    ],
    ...extra,
  };
}
const enLigne = { statut: "paiement_en_attente", statut_paiement: "en_attente", moyen_paiement: "en_ligne" };
const creneau = (date: string, minutes: number, mode = "retrait") => ({ quand_type: "creneau", quand_date: date, quand_minutes: minutes, mode });

async function creer(extra: Record<string, unknown> = {}): Promise<{ id: string; numero: number }> {
  const r = await db.query<{ id: string; numero: number }>("select * from creer_commande($1)", [commande(extra)]);
  await db.query("update commandes set cree_le = now() where id = $1", [r.rows[0].id]);
  return r.rows[0];
}
const file = () => f<{ id: string; numero: number; statut: string; statut_paiement: string; avertissement?: string | null }[]>("file_tablette()");
const payer = (id: string, evt: string) => f<boolean>("appliquer_paiement($1, $2, 'paye', 'pi_test', 3000)", [evt, id]);
const changer = (id: string, vers: string, heure: string | null = null, motif: string | null = null) =>
  f<boolean>("changer_statut($1, $2, 'tablette:Test', $3, $4)", [id, vers, heure, motif]);
const gerant = async () => (await db.query<{ id: string }>("select id from personnel where role = 'gerant' and actif limit 1")).rows[0].id;

beforeEach(async () => {
  db = await creerBaseLocale();
  await db.exec(`
    create table horloge_test (t timestamptz);
    create function public.now() returns timestamptz language sql stable as $$ select coalesce((select t from horloge_test limit 1), transaction_timestamp()) $$;
    set search_path = public, pg_catalog;
  `);
});

describe("SS-01 : pause automatique après une pause datée", () => {
  it("se déclenche quand la pause datée est finie", async () => {
    await horloge("2026-11-14T18:00:00Z");
    await f("regler_service($1, null)", [{ pause_jusqu_a: "2026-11-14T18:30:00.000Z" }]);
    await horloge("2026-11-14T19:00:00Z");
    expect(await f<boolean>("pause_automatique()")).toBe(true);
    expect(await reglage("pause_jusqu_a")).toBe("sans-fin");
    expect(await reglage("pause_auto")).toBe(true);
  });

  it("ne remplace pas une pause en cours, datée ou sans fin", async () => {
    await horloge("2026-11-14T18:00:00Z");
    await f("regler_service($1, null)", [{ pause_jusqu_a: "2026-11-14T18:30:00.000Z" }]);
    expect(await f<boolean>("pause_automatique()")).toBe(false);
    expect(await reglage("pause_jusqu_a")).toBe("2026-11-14T18:30:00.000Z");
    await f("regler_service($1, null)", [{ pause_jusqu_a: "sans-fin" }]);
    expect(await f<boolean>("pause_automatique()")).toBe(false);
    expect(await reglage("pause_auto")).toBe(false);
  });
});

describe("SS-02 : capacité par créneau", () => {
  it("refuse une commande de plus que la capacité réglée, par mode, sans compter les refus ni les paiements abandonnés", async () => {
    await horloge("2026-11-14T15:00:00Z");
    const capRetrait = await reglage<number>("capacite_retraits_par_creneau");
    const capLivraison = await reglage<number>("capacite_livraisons_par_creneau");
    const ids: string[] = [];
    for (let i = 0; i < capRetrait; i++) ids.push((await creer(creneau("2026-11-14", 1200))).id);
    await expect(creer(creneau("2026-11-14", 1200))).rejects.toThrow(/creneau_complet/);
    // Les livraisons ont leur propre capacité, et un autre créneau est libre.
    for (let i = 0; i < capLivraison; i++) await creer(creneau("2026-11-14", 1200, "livraison"));
    await expect(creer(creneau("2026-11-14", 1200, "livraison"))).rejects.toThrow(/creneau_complet/);
    await creer(creneau("2026-11-14", 1215));
    // Une commande refusée libère sa place.
    expect(await changer(ids[0], "refusee", null, "Complet.")).toBe(true);
    await creer(creneau("2026-11-14", 1200));
    // Un paiement en ligne abandonné depuis plus de 35 minutes ne retient plus la place.
    await expect(creer({ ...creneau("2026-11-14", 1200), ...enLigne })).rejects.toThrow(/creneau_complet/);
    await db.query("update commandes set statut = 'refusee' where id = $1", [ids[1]]);
    const attente = await creer({ ...creneau("2026-11-14", 1200), ...enLigne });
    await expect(creer(creneau("2026-11-14", 1200))).rejects.toThrow(/creneau_complet/);
    await horloge("2026-11-14T15:40:00Z");
    await creer(creneau("2026-11-14", 1200));
    expect(attente.numero).toBeGreaterThan(0);
  });

  it("une même clé (double clic) ne compte pas deux fois et renvoie la commande existante", async () => {
    await horloge("2026-11-14T15:00:00Z");
    const p = commande(creneau("2026-11-14", 1230));
    const a = (await db.query<{ id: string; deja: boolean }>("select * from creer_commande($1)", [p])).rows[0];
    const b = (await db.query<{ id: string; deja: boolean }>("select * from creer_commande($1)", [p])).rows[0];
    expect(b).toMatchObject({ id: a.id, deja: true });
  });

  it("le gérant règle la capacité, journalisée ; zéro veut dire sans limite", async () => {
    await horloge("2026-11-14T15:00:00Z");
    const g = await gerant();
    await f("regler_capacite('retrait', 1, $1)", [g]);
    expect(await reglage("capacite_retraits_par_creneau")).toBe(1);
    await creer(creneau("2026-11-14", 1245));
    await expect(creer(creneau("2026-11-14", 1245))).rejects.toThrow(/creneau_complet/);
    await f("regler_capacite('retrait', 0, $1)", [g]);
    await creer(creneau("2026-11-14", 1245));
    const journal = (await db.query<{ cle: string }>("select cle from journal_gestion where objet = 'reglage' order by le")).rows.map((r) => r.cle);
    expect(journal).toContain("capacite_retraits_par_creneau");
    await expect(f("regler_capacite('retrait', 1000, $1)", [g])).rejects.toThrow();
  });
});

describe("SS-03 : annulation après acceptation", () => {
  async function imprimante(station: "pizza" | "cuisine") {
    await db.query("insert into imprimantes (nom, station, jeton_hache, mac) values ($1, $2, $3, '00:11:62:00:00:01')", [`Test ${station}`, station, `hache-${station}`]);
    return `hache-${station}`;
  }
  const passage = (jeton: string) => f<{ tache: string | null }>("passage_imprimante($1, '00:11:62:00:00:01', '200 OK')", [jeton]);
  const contenu = [{ t: "texte", texte: "test" }];

  it("retire de la file les tickets pas encore sortis et dit quels postes ont déjà le ticket", async () => {
    const pizza = await imprimante("pizza");
    const cuisine = await imprimante("cuisine");
    await horloge("2026-11-14T19:00:00Z");
    const c = await creer();
    expect(await changer(c.id, "acceptee", "2026-11-14T19:30:00Z")).toBe(true);
    await f("creer_taches_impression($1, $2, false)", [c.id, [{ station: "pizza", contenu }, { station: "cuisine", contenu }]]);
    // Le ticket pizza sort, la cuisine est débranchée.
    const t = (await passage(pizza)).tache;
    await f("tache_pour_imprimante($1, '00:11:62:00:00:01', $2)", [pizza, t]);
    await f("confirmer_tache($1, '00:11:62:00:00:01', $2, '200 OK')", [pizza, t]);
    expect(await changer(c.id, "refusee", null, "Client injoignable.")).toBe(true);
    expect(await f<string[]>("annuler_impression($1)", [c.id])).toEqual(["pizza"]);
    expect((await passage(cuisine)).tache).toBeNull();
    const etats = (await db.query<{ etat: string }>("select etat from taches_impression where commande_id = $1 and station = 'cuisine'", [c.id])).rows;
    expect(etats).toEqual([{ etat: "annulee" }]);
  });
});

describe("SS-04 : refus payé pas encore remboursé", () => {
  it("reste sur la tablette après minuit tant que l'argent n'est pas rendu", async () => {
    await horloge("2026-11-14T20:00:00Z");
    const c = await creer(enLigne);
    expect(await payer(c.id, "evt-paye")).toBe(true);
    expect(await changer(c.id, "refusee", null, "Cuisine complète.")).toBe(true);
    await horloge("2026-11-16T09:00:00Z");
    expect((await file()).find((x) => x.id === c.id)?.statut_paiement).toBe("paye");
    await f("appliquer_paiement($1, $2, 'rembourse')", ["evt-remb", c.id]);
    // Remboursée : elle reste dans « Terminées » le jour du remboursement, puis quitte la file.
    expect((await file()).find((x) => x.id === c.id)?.statut_paiement).toBe("rembourse");
    await horloge("2026-11-17T09:00:00Z");
    expect((await file()).find((x) => x.id === c.id)).toBeUndefined();
  });
});

describe("SS-05 : numéro du jour de service", () => {
  it("une commande à l'avance prend un numéro du jour où elle est servie, la date de vente reste celle de la commande", async () => {
    await horloge("2026-11-11T09:00:00Z"); // mercredi 10h
    const mercredi = await creer();
    const avance = await creer(creneau("2026-11-14", 19 * 60 + 30));
    await horloge("2026-11-14T17:50:00Z"); // samedi 18h50
    const samedi = await creer();
    expect(mercredi.numero).toBe(1);
    expect([avance.numero, samedi.numero]).toEqual([1, 2]);
    const jours = (await db.query<{ jour: string; jour_service: string }>("select jour::text, jour_service::text from commandes where id = $1", [avance.id])).rows[0];
    expect(jours).toEqual({ jour: "2026-11-11", jour_service: "2026-11-14" });
    expect((await file()).filter((x) => x.statut === "nouvelle").map((x) => x.numero).sort()).toEqual([1, 1, 2]);
  });
});

describe("SS-06 : changement d'état contrôlé contre ce que la personne voyait", () => {
  it("un refus envoyé depuis l'état « nouvelle » échoue si la commande vient d'être acceptée", async () => {
    await horloge("2026-11-14T19:00:00Z");
    const c = await creer();
    expect(await changer(c.id, "acceptee", "2026-11-14T19:30:00Z")).toBe(true);
    expect(await f<boolean>("changer_statut($1, 'refusee', 'tablette:B', null, 'Complet.', 'nouvelle')", [c.id])).toBe(false);
    expect(await f<boolean>("changer_statut($1, 'refusee', 'tablette:B', null, 'Complet.', 'acceptee')", [c.id])).toBe(true);
  });
});

describe("SS-07 : ticket renvoyé après une confirmation perdue", () => {
  it("porte une mention en tête", async () => {
    await db.query("insert into imprimantes (nom, station, jeton_hache, mac) values ('P', 'pizza', 'h-p', '00:11:62:00:00:01')");
    await horloge("2026-11-14T19:00:00Z");
    const c = await creer();
    await f("creer_taches_impression($1, $2, false)", [c.id, [{ station: "pizza", contenu: [{ t: "texte", texte: "PIZZA" }] }]]);
    const t1 = (await f<{ tache: string }>("passage_imprimante('h-p', '00:11:62:00:00:01', '200 OK')")).tache;
    const premier = await f<{ texte?: string }[]>("tache_pour_imprimante('h-p', '00:11:62:00:00:01', $1)", [t1]);
    expect(premier[0].texte).toBe("PIZZA");
    await horloge("2026-11-14T19:03:00Z");
    const t2 = (await f<{ tache: string }>("passage_imprimante('h-p', '00:11:62:00:00:01', '200 OK')")).tache;
    expect(t2).toBe(t1);
    const renvoi = await f<{ texte?: string }[]>("tache_pour_imprimante('h-p', '00:11:62:00:00:01', $1)", [t2]);
    expect(renvoi[0].texte).toMatch(/^RENVOI/);
    expect(renvoi[1].texte).toBe("PIZZA");
  });
});

describe("SS-08 : avertissement posé au paiement", () => {
  it("la file de la tablette montre l'avertissement de la commande", async () => {
    await horloge("2026-11-14T19:00:00Z");
    const c = await creer(enLigne);
    await payer(c.id, "evt-av");
    await f("noter_avertissement($1, $2)", [c.id, "Payée pendant la pause."]);
    expect((await file()).find((x) => x.id === c.id)?.avertissement).toBe("Payée pendant la pause.");
  });
});

describe("SS-09 : alerte de commande non acceptée", () => {
  it("compte l'attente depuis le paiement, pas depuis la création", async () => {
    await horloge("2026-11-14T18:00:00Z");
    const c = await creer(enLigne);
    await horloge("2026-11-14T18:07:00Z");
    await payer(c.id, "evt-lent");
    await db.query("update commandes set paye_le = now() where id = $1", [c.id]);
    expect(await f<unknown[]>("commandes_en_retard()")).toEqual([]);
    await horloge("2026-11-14T18:13:00Z");
    expect((await f<{ numero: number }[]>("commandes_en_retard()")).map((x) => x.numero)).toEqual([c.numero]);
  });
});

describe("petits correctifs d'impression", () => {
  it("revue : les tickets d'une commande acceptée il y a plus de 18 heures restent visibles tant qu'elle est en cours", async () => {
    await horloge("2026-11-11T09:00:00Z");
    const c = await creer({ quand_type: "creneau", quand_date: "2026-11-14", quand_minutes: 1170 });
    expect(await changer(c.id, "acceptee", "2026-11-14T18:30:00Z")).toBe(true);
    await f("creer_taches_impression($1, $2, false)", [c.id, [{ station: "pizza", contenu: [{ t: "texte", texte: "x" }] }]]);
    await db.query("update taches_impression set cree_le = now() where commande_id = $1", [c.id]);
    await horloge("2026-11-14T17:00:00Z");
    const taches = (await f<{ taches: { commande_id: string }[] }>("etat_impression()")).taches;
    expect(taches.some((t) => t.commande_id === c.id)).toBe(true);
  });

  it("SS-17 : « Réimprimer » ne double pas un ticket encore en file", async () => {
    await db.query("insert into imprimantes (nom, station, jeton_hache, mac) values ('P', 'pizza', 'h-p', '00:11:62:00:00:01')");
    const c = await creer();
    const contenu = [{ t: "texte", texte: "x" }];
    await f("creer_taches_impression($1, $2, false)", [c.id, [{ station: "pizza", contenu }]]);
    expect(await f<number>("creer_taches_impression($1, $2, true)", [c.id, [{ station: "pizza", contenu }]])).toBe(0);
    const n2 = (await db.query<{ n: number }>("select count(*)::int as n from taches_impression where commande_id = $1", [c.id])).rows[0].n;
    expect(n2).toBe(1);
  });

  it("SS-19 : une imprimante ajoutée reprend les tickets « sans imprimante » des commandes en cours", async () => {
    const c = await creer();
    expect(await changer(c.id, "acceptee", new Date(Date.now() + 1_800_000).toISOString())).toBe(true);
    await f("creer_taches_impression($1, $2, false)", [c.id, [{ station: "cuisine", contenu: [{ t: "texte", texte: "x" }] }]]);
    expect((await db.query<{ etat: string }>("select etat from taches_impression where commande_id = $1", [c.id])).rows[0].etat).toBe("sans_imprimante");
    await f("ajouter_imprimante('Cuisine', 'cuisine', 'h-c', $1)", [await gerant()]);
    expect((await db.query<{ etat: string }>("select etat from taches_impression where commande_id = $1", [c.id])).rows[0].etat).toBe("en_attente");
  });
});
