import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Décaler les commandes en cours (vague 3, bo-operations, P0 de produit-gestion) : decaler_commandes,
// apercu_decalage. Migration 20261130230000_decaler_commandes.sql. Horloge simulée comme charge-postes-sql.

let db: PGlite;
const ids: Record<string, string> = {};

async function horloge(iso: string) {
  await db.query("delete from horloge_test where true");
  await db.query("insert into horloge_test values ($1::timestamptz)", [iso]);
}
type Resultat = { deja: boolean; minutes: number; commandes: { id: string; avant: string; apres: string }[] };
const decaler = async (minutes: number, station: string | null, cle: string, qui = "service") =>
  (await db.query<{ r: Resultat }>("select decaler_commandes($1, $2::station, $3, $4) as r", [minutes, station, cle, ids[qui]])).rows[0].r;
const apercu = async (station: string | null = null) =>
  (await db.query<{ r: { commandes: number; clients: number } }>("select apercu_decalage($1::station) as r", [station])).rows[0].r;
const heure = async (id: string) => new Date((await db.query<{ h: string }>("select heure_confirmee as h from commandes where id = $1", [id])).rows[0].h).toISOString();

let n = 0;
// Commande de `pizzas` pizzas et `plats` plats, au statut donné, due à `due` (heure confirmée).
async function commande(o: { pizzas: number; plats?: number; statut?: string; due?: string | null }): Promise<string> {
  n += 1;
  const ligne = (slug: string, station: string, qte: number) => ({
    slug,
    nom: slug,
    station,
    qte,
    unitaire_centimes: 1500,
    total_centimes: 1500 * qte,
    choix: {},
    retraits: [],
    note: "",
  });
  // 20 pièces au plus par ligne (contrainte commande_lignes_qte_check) : une grosse commande fait plusieurs lignes.
  const morceaux = (slug: string, station: string, total: number) =>
    Array.from({ length: Math.ceil(total / 20) }, (_, i) => ligne(slug, station, Math.min(20, total - i * 20)));
  const lignes = [...morceaux("pizza-margherita", "pizza", o.pizzas), ...morceaux("lasagne-de-boeuf", "cuisine", o.plats ?? 0)];
  const p = {
    jeton_suivi: `jeton-dc-${n}`,
    cle_idempotence: `dc-${n}`,
    mode: "retrait",
    statut: "nouvelle",
    statut_paiement: "a_encaisser_retrait",
    moyen_paiement: "comptoir",
    zone_numero: null,
    client_prenom: `H${n}`,
    client_nom: "Test",
    client_telephone: "079 000 00 00",
    client_email: "dc@laferme.test",
    quand_type: "asap",
    pizzas_seulement: !o.plats,
    sous_total_centimes: 3000,
    frais_centimes: 0,
    total_centimes: 3000,
    tva_centimes: 76,
    taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000",
    lignes,
  };
  const id = (await db.query<{ id: string }>("select id from creer_commande($1)", [p])).rows[0].id;
  await db.query("update commandes set statut = $2, heure_confirmee = $3::timestamptz where id = $1", [id, o.statut ?? "acceptee", o.due === undefined ? "2026-11-20T19:15:00Z" : o.due]);
  return id;
}

beforeAll(async () => {
  db = await creerBaseLocale();
  await db.exec(`
    create table horloge_test (t timestamptz);
    create function public.now() returns timestamptz language sql stable as $$ select coalesce((select t from horloge_test limit 1), transaction_timestamp()) $$;
    set search_path = public, pg_catalog;
  `);
  for (const [cle, role] of [["service", "service"], ["responsable", "responsable"], ["livreur", "livreur"]] as const) {
    const r = await db.query<{ id: string }>("insert into personnel (email, nom, role) values ($1, $2, $3) returning id", [`dc-${cle}@laferme.test`, `Dc ${cle}`, role]);
    ids[cle] = r.rows[0].id;
  }
}, 120_000);

beforeEach(async () => {
  await db.exec("truncate commandes cascade; delete from decalages_commandes where true;");
  // Vendredi 20 novembre 2026, 20h00 à Genève (19h00 UTC).
  await horloge("2026-11-20T19:00:00Z");
});

describe("decaler_commandes", () => {
  it("+20 min sur les commandes acceptées et en préparation des 90 prochaines minutes, pas les autres", async () => {
    const a = await commande({ pizzas: 2, due: "2026-11-20T19:20:00Z" });
    const b = await commande({ pizzas: 1, plats: 1, statut: "en_preparation", due: "2026-11-20T18:55:00Z" });
    const plusTard = await commande({ pizzas: 1, due: "2026-11-20T21:00:00Z" });
    const prete = await commande({ pizzas: 1, statut: "prete" });
    expect(await apercu()).toEqual({ commandes: 2, clients: 2 });
    const r = await decaler(20, null, "geste-00000001");
    expect(r.deja).toBe(false);
    expect(r.commandes.map((c) => c.id).sort()).toEqual([a, b].sort());
    expect(await heure(a)).toBe("2026-11-20T19:40:00.000Z");
    expect(await heure(b)).toBe("2026-11-20T19:15:00.000Z");
    expect(await heure(plusTard)).toBe("2026-11-20T21:00:00.000Z");
    expect(await heure(prete)).toBe("2026-11-20T19:15:00.000Z");
    const ev = await db.query<{ par: string; detail: string }>("select par, detail from evenements_commande where commande_id = $1 order by id desc limit 1", [a]);
    expect(ev.rows[0]).toMatchObject({ par: "tablette:Dc service" });
    expect(ev.rows[0].detail).toMatch(/décalage \+20 min/);
    const j = await db.query<{ cle: string; apres: { minutes: number; commandes: number } }>("select cle, apres from journal_gestion where objet = 'decalage' order by id desc limit 1");
    expect(j.rows[0]).toEqual({ cle: "tous", apres: { minutes: 20, commandes: 2 } });
  });

  it("même clé : aucun second décalage (double appui), autre clé : nouveau décalage", async () => {
    const a = await commande({ pizzas: 2 });
    await decaler(15, null, "geste-00000002");
    const again = await decaler(15, null, "geste-00000002");
    expect(again.deja).toBe(true);
    expect(again.commandes).toHaveLength(1);
    expect(await heure(a)).toBe("2026-11-20T19:30:00.000Z");
    await decaler(5, null, "geste-00000003");
    expect(await heure(a)).toBe("2026-11-20T19:35:00.000Z");
  });

  it("un poste : seulement les commandes qui y ont des lignes et dont ce poste n'a pas fini", async () => {
    const pizzas = await commande({ pizzas: 2 });
    const plats = await commande({ pizzas: 0, plats: 2 });
    const mixteFourFini = await commande({ pizzas: 1, plats: 1 });
    await db.query("insert into commande_postes (commande_id, station, a_faire_le, pret_le, pret_par) values ($1, 'pizza', now(), now(), 'test')", [mixteFourFini]);
    expect((await apercu("pizza")).commandes).toBe(1);
    const r = await decaler(10, "pizza", "geste-00000004");
    expect(r.commandes.map((c) => c.id)).toEqual([pizzas]);
    expect(await heure(plats)).toBe("2026-11-20T19:15:00.000Z");
    expect(await heure(mixteFourFini)).toBe("2026-11-20T19:15:00.000Z");
    const j = await db.query<{ cle: string }>("select cle from journal_gestion where objet = 'decalage' order by id desc limit 1");
    expect(j.rows[0].cle).toBe("pizza");
  });

  it("bornes, équipe du restaurant seulement, droits", async () => {
    await commande({ pizzas: 1 });
    await expect(decaler(3, null, "geste-00000005")).rejects.toThrow(/de 5 à 90 minutes/);
    await expect(decaler(95, null, "geste-00000006")).rejects.toThrow(/de 5 à 90 minutes/);
    await expect(decaler(10, null, "court")).rejects.toThrow(/Clé du geste/);
    await expect(decaler(10, null, "geste-00000007", "livreur")).rejects.toThrow(/Réservé à l'équipe/);
    expect((await decaler(10, null, "geste-00000008", "responsable")).commandes).toHaveLength(1);
    for (const role of ["anon", "authenticated"]) {
      const r = await db.query<{ ok: boolean }>("select has_function_privilege($1, 'decaler_commandes(integer, station, text, uuid)', 'execute') as ok", [role]);
      expect(r.rows[0].ok).toBe(false);
    }
  });

  it("aucune commande en cours : rien ne bouge, le geste est quand même noté", async () => {
    expect(await apercu()).toEqual({ commandes: 0, clients: 0 });
    expect((await decaler(10, null, "geste-00000009")).commandes).toEqual([]);
  });
});
