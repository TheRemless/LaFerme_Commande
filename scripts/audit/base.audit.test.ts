import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Audit « samedi soir » : constats reproduits sur la base embarquée, avec une horloge réglable.
// Astuce : search_path = public, pg_catalog, et une fonction public.now() qui lit l'heure du test.
// Les fonctions SQL du projet appellent now() sans schéma : elles prennent alors l'heure simulée.
// Les valeurs par défaut des colonnes (cree_le default now()) gardent l'heure réelle : on les règle à la main.
// Chaque test affirme le comportement OBSERVÉ aujourd'hui (le constat), pas le comportement attendu.

let db: PGlite;

async function horloge(iso: string) {
  await db.query("delete from horloge_audit where true");
  await db.query("insert into horloge_audit values ($1::timestamptz)", [iso]);
}
async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}

let n = 0;
function commande(extra: Record<string, unknown> = {}) {
  n += 1;
  return {
    jeton_suivi: `jeton-audit-${n}`,
    cle_idempotence: `audit-${n}`,
    mode: "retrait",
    statut: "nouvelle",
    statut_paiement: "a_encaisser_retrait",
    moyen_paiement: "comptoir",
    client_prenom: `A${n}`,
    client_nom: "Audit",
    client_telephone: "079 000 00 00",
    client_email: "audit@laferme.test",
    quand_type: "asap",
    pizzas_seulement: false,
    sous_total_centimes: 3000,
    frais_centimes: 0,
    total_centimes: 3000,
    tva_centimes: 76,
    taux_tva_pourcent: 2.6,
    origine: "http://localhost:3102",
    lignes: [
      { slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 1500, total_centimes: 1500, choix: {}, retraits: [], note: "" },
      { slug: "lasagne-de-boeuf", nom: "Lasagne de bœuf", station: "cuisine", qte: 1, unitaire_centimes: 1500, total_centimes: 1500, choix: {}, retraits: [], note: "sans œufs" },
    ],
    ...extra,
  };
}
const enLigne = { statut: "paiement_en_attente", statut_paiement: "en_attente", moyen_paiement: "en_ligne" };

async function creer(extra: Record<string, unknown> = {}): Promise<{ id: string; numero: number }> {
  const r = await db.query<{ id: string; numero: number }>("select * from creer_commande($1)", [commande(extra)]);
  // cree_le suit l'horloge du test
  await db.query("update commandes set cree_le = now() where id = $1", [r.rows[0].id]);
  return r.rows[0];
}
const file = () => f<{ id: string; numero: number; statut: string; statut_paiement: string }[]>("file_tablette()");
const payer = (id: string, evt: string) => f<boolean>("appliquer_paiement($1, $2, 'paye', 'pi_audit', 3000)", [evt, id]);
const changer = (id: string, vers: string, heure: string | null = null, motif: string | null = null) =>
  f<boolean>("changer_statut($1, $2, 'tablette:Audit', $3, $4)", [id, vers, heure, motif]);

beforeEach(async () => {
  db = await creerBaseLocale();
  await db.exec(`
    create table horloge_audit (t timestamptz);
    create function public.now() returns timestamptz language sql stable as $$ select coalesce((select t from horloge_audit limit 1), transaction_timestamp()) $$;
    set search_path = public, pg_catalog;
  `);
});

describe("numérotation du jour", () => {
  it("l'horloge simulée est bien prise par les fonctions SQL", async () => {
    await horloge("2026-11-14T17:00:00Z");
    const c = await creer();
    const jour = (await db.query<{ jour: string }>("select jour::text from commandes where id = $1", [c.id])).rows[0].jour;
    expect(jour).toBe("2026-11-14");
  });

  it("CONSTAT : un paiement en ligne abandonné garde son numéro, la tablette voit des trous (1, 2, 5)", async () => {
    await horloge("2026-11-14T18:00:00Z");
    const a = await creer();
    const b = await creer();
    const c = await creer(enLigne); // client qui quitte Stripe
    const d = await creer(enLigne); // paiement expiré
    await f("appliquer_paiement($1, $2, 'echec')", ["expire-d", d.id]);
    const e = await creer();
    expect([a.numero, b.numero, c.numero, d.numero, e.numero]).toEqual([1, 2, 3, 4, 5]);
    expect((await file()).map((x) => x.numero)).toEqual([1, 2, 5]);
  });

  it("le compteur change bien de jour à minuit, heure de Genève", async () => {
    await horloge("2026-11-14T22:59:50Z"); // 23:59:50 à Genève
    const a = await creer();
    await horloge("2026-11-14T23:00:10Z"); // 00:00:10 le 15
    const b = await creer();
    const jours = (await db.query<{ jour: string; numero: number }>("select jour::text, numero from commandes order by cree_le")).rows;
    expect(jours).toEqual([
      { jour: "2026-11-14", numero: a.numero },
      { jour: "2026-11-15", numero: 1 },
    ]);
    expect(b.numero).toBe(1);
  });

  it("CONSTAT : une commande à l'avance prend le numéro du jour où elle est passée, deux « N° 001 » le samedi", async () => {
    await horloge("2026-11-11T09:00:00Z"); // mercredi 10h
    const avance = await creer({ quand_type: "creneau", quand_date: "2026-11-14", quand_minutes: 19 * 60 + 30 });
    await horloge("2026-11-14T17:50:00Z"); // samedi 18h50
    const samedi = await creer();
    expect(avance.numero).toBe(1);
    expect(samedi.numero).toBe(1);
    const visibles = (await file()).map((x) => x.numero);
    expect(visibles).toEqual([1, 1]);
  });
});

describe("refus et remboursement", () => {
  it("CONSTAT : un refus dont le remboursement a raté disparaît de la tablette après minuit", async () => {
    await horloge("2026-11-14T20:00:00Z"); // samedi 21h
    const c = await creer(enLigne);
    expect(await payer(c.id, "evt-paye")).toBe(true);
    expect(await changer(c.id, "refusee", null, "Cuisine complète.")).toBe(true);
    // Remboursement raté : la commande reste refusee + paye, le bouton « Rembourser » s'affiche.
    expect((await file()).find((x) => x.id === c.id)?.statut_paiement).toBe("paye");
    await horloge("2026-11-14T23:05:00Z"); // dimanche 0h05
    expect((await file()).find((x) => x.id === c.id)).toBeUndefined();
    const reste = (await db.query<{ statut: string; statut_paiement: string }>("select statut, statut_paiement from commandes where id = $1", [c.id])).rows[0];
    expect(reste).toEqual({ statut: "refusee", statut_paiement: "paye" });
  });

  it("CONSTAT : une commande payée pendant la pause ou après la rupture arrive quand même sur la tablette", async () => {
    await horloge("2026-11-14T19:00:00Z");
    const c = await creer(enLigne);
    await f("regler_service($1, null)", [{ pause_jusqu_a: "sans-fin" }]);
    await f("regler_rupture('lasagne-de-boeuf', true, null)");
    expect(await payer(c.id, "evt-pause")).toBe(true);
    expect((await file()).find((x) => x.id === c.id)?.statut).toBe("nouvelle");
  });
});

describe("pause automatique", () => {
  it("CONSTAT : après une pause datée arrivée à son terme, la pause automatique ne se déclenche plus", async () => {
    await horloge("2026-11-14T18:00:00Z");
    // « Pause 30 min » depuis la tablette : le serveur écrit une date ISO.
    await f("regler_service($1, null)", [{ pause_jusqu_a: "2026-11-14T18:30:00.000Z" }]);
    await horloge("2026-11-14T19:00:00Z"); // pause finie depuis 30 min, rien ne remet la valeur à null
    expect(await f<boolean>("pause_automatique()")).toBe(false);
    const v = (await db.query<{ valeur: unknown }>("select valeur from reglages where cle = 'pause_jusqu_a'")).rows[0].valeur;
    expect(v).toBe("2026-11-14T18:30:00.000Z");
  });

  it("témoin : après « Reprendre », la pause automatique se déclenche", async () => {
    await f("regler_service($1, null)", [{ pause_jusqu_a: null }]);
    expect(await f<boolean>("pause_automatique()")).toBe(true);
  });

  it("le signe de vie vient de n'importe quel appareil connecté au personnel (une seule ligne, sans identité)", async () => {
    const colonnes = (await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'surveillance_etat'")).rows.map((r) => r.column_name);
    expect(colonnes.sort()).toEqual(["id", "surveillance_le", "tablette_vue_le"]);
  });
});

describe("alerte de commande non acceptée", () => {
  it("CONSTAT : une commande du soir passée le matin déclenche l'alerte 5 minutes après, cuisine fermée", async () => {
    await horloge("2026-11-14T09:00:00Z"); // samedi 10h
    const c = await creer({ quand_type: "creneau", quand_date: "2026-11-14", quand_minutes: 20 * 60 });
    await horloge("2026-11-14T09:06:00Z");
    const r = await f<{ numero: number }[]>("commandes_en_retard()");
    expect(r.map((x) => x.numero)).toEqual([c.numero]);
  });

  it("CONSTAT : une commande pour demain déclenche l'alerte à minuit cinq", async () => {
    await horloge("2026-11-13T15:00:00Z"); // vendredi 16h, pour samedi
    const c = await creer({ quand_type: "creneau", quand_date: "2026-11-14", quand_minutes: 19 * 60 });
    await horloge("2026-11-13T22:30:00Z");
    expect(await f<unknown[]>("commandes_en_retard()")).toEqual([]);
    await horloge("2026-11-13T23:01:00Z"); // samedi 0h01
    expect((await f<{ numero: number }[]>("commandes_en_retard()")).map((x) => x.numero)).toEqual([c.numero]);
  });

  it("CONSTAT : l'attente se compte depuis la création, pas depuis le paiement (TWINT lent)", async () => {
    await horloge("2026-11-14T18:00:00Z");
    const c = await creer(enLigne);
    await horloge("2026-11-14T18:07:00Z"); // client payé après 7 minutes sur Stripe
    await payer(c.id, "evt-lent");
    expect((await f<{ numero: number }[]>("commandes_en_retard()")).map((x) => x.numero)).toEqual([c.numero]);
  });
});

describe("impression", () => {
  async function imprimante(station: "pizza" | "cuisine") {
    const jeton = `hache-${station}`;
    await db.query("insert into imprimantes (nom, station, jeton_hache, mac) values ($1, $2, $3, '00:11:62:00:00:01')", [`Audit ${station}`, station, jeton]);
    return jeton;
  }
  const passage = (jeton: string) => f<{ tache: string | null }>("passage_imprimante($1, '00:11:62:00:00:01', '200 OK')", [jeton]);
  const contenu = [{ t: "texte", texte: "test" }];

  it("CONSTAT : la commande annulée après acceptation garde ses tickets en file et sort quand l'imprimante revient", async () => {
    const cuisine = await imprimante("cuisine");
    await horloge("2026-11-14T19:00:00Z");
    const c = await creer();
    expect(await changer(c.id, "acceptee", "2026-11-14T19:30:00Z")).toBe(true);
    await f("creer_taches_impression($1, $2, false)", [c.id, [{ station: "cuisine", contenu }]]);
    expect(await changer(c.id, "refusee", null, "Client injoignable.")).toBe(true);
    const p = await passage(cuisine);
    expect(p.tache).not.toBeNull(); // le ticket d'une commande annulée part en cuisine
  });

  it("CONSTAT : confirmation perdue (DELETE) : le même ticket repart après 2 minutes, sans mention de réimpression", async () => {
    const pizza = await imprimante("pizza");
    await horloge("2026-11-14T19:00:00Z");
    const c = await creer();
    await f("creer_taches_impression($1, $2, false)", [c.id, [{ station: "pizza", contenu }]]);
    const p1 = await passage(pizza);
    expect(await f("tache_pour_imprimante($1, '00:11:62:00:00:01', $2)", [pizza, p1.tache])).not.toBeNull();
    // l'imprimante a imprimé mais la confirmation n'est jamais arrivée
    await db.query("update taches_impression set envoye_le = now() where id = $1", [p1.tache]);
    await horloge("2026-11-14T19:01:00Z");
    expect((await passage(pizza)).tache).toBeNull();
    await horloge("2026-11-14T19:03:00Z");
    expect((await passage(pizza)).tache).toBe(p1.tache);
  });

  it("CONSTAT : « Réimprimer » pendant que l'imprimante est hors ligne met deux tickets en file pour la même commande", async () => {
    const pizza = await imprimante("pizza");
    await horloge("2026-11-14T19:00:00Z");
    const c = await creer();
    await f("creer_taches_impression($1, $2, false)", [c.id, [{ station: "pizza", contenu }]]);
    await f("creer_taches_impression($1, $2, true)", [c.id, [{ station: "pizza", contenu }]]);
    const enFile = (await db.query<{ n: number }>("select count(*)::int as n from taches_impression where commande_id = $1 and etat = 'en_attente'", [c.id])).rows[0].n;
    expect(enFile).toBe(2);
    expect((await passage(pizza)).tache).not.toBeNull();
  });

  it("une imprimante ne donne qu'un ticket par interrogation (vidage d'une file de 10 tickets = 10 passages)", async () => {
    const cuisine = await imprimante("cuisine");
    await horloge("2026-11-14T19:00:00Z");
    for (let i = 0; i < 10; i++) {
      const c = await creer();
      await f("creer_taches_impression($1, $2, false)", [c.id, [{ station: "cuisine", contenu }]]);
    }
    const p = await passage(cuisine);
    expect(typeof p.tache).toBe("string");
  });
});

describe("rupture du jour", () => {
  it("la rupture du jour se lève seule à minuit, heure de Genève", async () => {
    await horloge("2026-11-14T21:00:00Z");
    await f("regler_rupture('lasagne-de-boeuf', true, null)");
    // La vue carte_publique fige now() à sa création (heure réelle) : on lit plats_tablette, qui suit l'horloge.
    const rupture = async () => (await f<{ slug: string; rupture: boolean }[]>("plats_tablette()")).find((p) => p.slug === "lasagne-de-boeuf")?.rupture;
    expect((await db.query<{ d: string }>("select rupture_jour::text as d from plats where slug = 'lasagne-de-boeuf'")).rows[0].d).toBe("2026-11-14");
    expect(await rupture()).toBe(true);
    await horloge("2026-11-14T23:00:30Z");
    expect(await rupture()).toBe(false);
  });
});

describe("capacité par créneau", () => {
  it("CONSTAT : les réglages de capacité existent en base mais aucune fonction ni code ne les lit", async () => {
    const r = (await db.query<{ cle: string; valeur: unknown }>("select cle, valeur from reglages where cle like 'capacite%' order by cle")).rows;
    expect(r).toEqual([
      { cle: "capacite_livraisons_par_creneau", valeur: 3 },
      { cle: "capacite_retraits_par_creneau", valeur: 4 },
    ]);
    const fonctions = (await db.query<{ n: number }>("select count(*)::int as n from pg_proc where prosrc ilike '%capacite%'")).rows[0].n;
    expect(fonctions).toBe(0);
    await horloge("2026-11-14T15:00:00Z");
    for (let i = 0; i < 8; i++) await creer({ quand_type: "creneau", quand_date: "2026-11-14", quand_minutes: 20 * 60 });
    const meme = (await db.query<{ n: number }>("select count(*)::int as n from commandes where quand_minutes = 1200")).rows[0].n;
    expect(meme).toBe(8);
  });
});
