import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Position du livreur en direct (migration 20261213210000_position_livreur.sql, décision de Jérémy du 13.11.2026) :
// gardée pour l'arrêt en cours seulement, lue au suivi de cette commande seulement, effacée à la livraison.

let db: PGlite;
async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}
const id = async (email: string) => (await db.query<{ id: string }>("select id from personnel where email = $1", [email])).rows[0].id;

let n = 0;
async function livraison(statut = "acceptee", adresse = { rue: "Avenue du Gros-Chêne", numero: "20", npa: "1213", localite: "Onex" }): Promise<string> {
  n += 1;
  const r = await db.query<{ id: string }>("select id from creer_commande($1)", [
    {
      jeton_suivi: `jeton-pos-${n}`,
      cle_idempotence: `pos-${n}`,
      mode: "livraison",
      statut: "nouvelle",
      statut_paiement: "paye",
      moyen_paiement: "en_ligne",
      client_prenom: `Client${n}`,
      client_nom: "Secret",
      client_telephone: "079 000 00 00",
      client_email: "liv@laferme.test",
      adresse,
      details_livraison: { etage: "3", sonnette: "Rossi", code: "4512", instructions: "Porte de gauche" },
      zone_numero: 1,
      quand_type: "asap",
      pizzas_seulement: false,
      sous_total_centimes: 3000,
      frais_centimes: 500,
      total_centimes: 3500,
      tva_centimes: 76,
      taux_tva_pourcent: 2.6,
      origine: "http://localhost:3000",
      lignes: [
        { slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 2, unitaire_centimes: 1500, total_centimes: 3000, choix: {}, retraits: [], note: "" },
        { slug: "lasagne-de-boeuf", nom: "Lasagne de bœuf", station: "cuisine", qte: 1, unitaire_centimes: 1500, total_centimes: 1500, choix: {}, retraits: [], note: "" },
      ],
    },
  ]);
  const c = r.rows[0].id;
  await db.query("update commandes set statut = $2, heure_confirmee = now() + interval '30 minutes', stripe_payment_intent = 'pi_test' where id = $1", [c, statut]);
  return c;
}

const attribuer = (c: string, l: string) => f<string>("attribuer_livraison($1, $2, 'tablette:Test')", [c, l]);
let cle = 0;
const geste = (l: string, c: string, g: string) => f<{ ok: boolean }>("geste_livreur($1, $2, $3, $4, null, null)", [`cle-position-${String(++cle).padStart(6, "0")}`, l, c, g]);
const noter = (l: string, lat = 46.1843, lon = 6.0921, precision = 12) =>
  f<{ statut: string; numero?: number }>("noter_position_livreur($1, $2, $3, $4)", [l, lat, lon, precision]);
const suivi = (c: string) => f<{ lat: number; lon: number; precision: number; le: string } | null>("position_pour_suivi($1)", [c]);
const lignes = async () => (await db.query<{ livreur_id: string; commande_id: string }>("select livreur_id, commande_id from positions_livreur")).rows;
const numero = async (c: string) => (await db.query<{ numero: number }>("select numero from commandes where id = $1", [c])).rows[0].numero;

let marco: string;
let ines: string;
let c1: string;
let c2: string;
beforeEach(async () => {
  db = await creerBaseLocale();
  marco = await id("marco@laferme.test");
  ines = await id("ines@laferme.test");
  c1 = await livraison();
  c2 = await livraison();
  await attribuer(c1, marco);
  await attribuer(c2, marco);
});

describe("position du livreur en direct", () => {
  it("ouverte par défaut (décision de Jérémy), réservée à la clé de service", async () => {
    expect(await f<boolean>("position_livreur_active()")).toBe(true);
    for (const role of ["anon", "authenticated"]) {
      const r = await db.query<{ ok: boolean }>(
        "select has_table_privilege($1, 'positions_livreur', 'select') or has_table_privilege($1, 'suites_livreur', 'select') or has_function_privilege($1, 'noter_position_livreur(uuid, double precision, double precision, integer)', 'execute') or has_function_privilege($1, 'position_pour_suivi(uuid)', 'execute') or has_function_privilege($1, 'effacer_position_livreur(uuid)', 'execute') as ok",
        [role],
      );
      expect(r.rows[0].ok).toBe(false);
    }
  });

  it("rien n'est gardé avant le départ", async () => {
    expect(await noter(marco)).toEqual({ statut: "pas_en_route" });
    expect(await lignes()).toEqual([]);
    expect(await suivi(c1)).toBeNull();
  });

  it("le 1er client voit le livreur, le 2e rien tant que ce n'est pas son tour", async () => {
    await geste(marco, c1, "partie");
    await geste(marco, c2, "partie");
    expect(await noter(marco, 46.18434, 6.09216)).toEqual({ statut: "ok", numero: await numero(c1) });
    expect(await suivi(c1)).toMatchObject({ lat: 46.1843, lon: 6.0922, precision: 12 });
    expect(await suivi(c2)).toBeNull();
  });

  it("livrée : la position du 1er est effacée, le 2e voit le trajet suivant seulement", async () => {
    await geste(marco, c1, "partie");
    await geste(marco, c2, "partie");
    await noter(marco);
    await geste(marco, c1, "livree");
    expect(await lignes()).toEqual([]);
    expect(await suivi(c1)).toBeNull();
    expect(await suivi(c2)).toBeNull();
    expect(await noter(marco, 46.19, 6.1)).toEqual({ statut: "ok", numero: await numero(c2) });
    // Premier point après une livraison : point de masquage, rien tant qu'on en est à moins de 400 m.
    expect(await suivi(c2)).toBeNull();
    await db.query("update positions_livreur set le = now() - interval '11 seconds'");
    await noter(marco, 46.2, 6.12);
    expect(await suivi(c2)).toMatchObject({ lat: 46.2, lon: 6.12 });
    expect(await suivi(c1)).toBeNull();
    await geste(marco, c2, "livree");
    expect(await lignes()).toEqual([]);
    expect(await noter(marco)).toEqual({ statut: "pas_en_route" });
  });

  it("même point avant et après « Livrée » : le 2e client ne voit pas la porte du 1er (relecture de qualite)", async () => {
    await geste(marco, c1, "partie");
    await geste(marco, c2, "partie");
    await noter(marco, 46.1843, 6.0921);
    await geste(marco, c1, "livree");
    // Encore sur le palier de c1 : écrit pour c2, mais rien au suivi.
    expect(await noter(marco, 46.1843, 6.0921)).toEqual({ statut: "ok", numero: await numero(c2) });
    expect(await suivi(c2)).toBeNull();
    // À 200 m : toujours rien.
    await db.query("update positions_livreur set le = now() - interval '11 seconds'");
    await noter(marco, 46.1861, 6.0921);
    expect(await suivi(c2)).toBeNull();
    // À plus de 400 m de la porte de c1 : le trajet vers c2 se voit.
    await db.query("update positions_livreur set le = now() - interval '11 seconds'");
    await noter(marco, 46.19, 6.1);
    expect(await suivi(c2)).toMatchObject({ lat: 46.19, lon: 6.1 });
  });

  it("course : un point envoyé pendant « Livrée » ne consomme pas la marque de l'arrêt suivant (relecture BIS de qualite)", async () => {
    await geste(marco, c1, "partie");
    await geste(marco, c2, "partie");
    // État vu par un envoi parti au moment du geste : la marque « après c1 » existe déjà, c1 est encore l'arrêt calculé.
    await db.query("insert into suites_livreur (livreur_id, le, apres_commande) values ($1, now(), $2)", [marco, c1]);
    expect(await noter(marco, 46.1843, 6.0921)).toEqual({ statut: "ok", numero: await numero(c1) });
    expect((await db.query("select 1 from suites_livreur where livreur_id = $1", [marco])).rows).toHaveLength(1);
    // Le geste se termine, puis le point suivant, encore à la porte de c1, part pour c2 : masqué.
    await geste(marco, c1, "livree");
    await noter(marco, 46.1843, 6.0921);
    expect(await suivi(c2)).toBeNull();
    // Même si la marque avait été reposée sans arrêt : la ligne de c1 laissée par la course ne compte pas pour c2.
    await db.query("update positions_livreur set le = now() - interval '11 seconds'");
    await noter(marco, 46.1843, 6.0921);
    expect(await suivi(c2)).toBeNull();
  });

  it("point de masquage trop imprécis (plus de 100 m) : rien n'est écrit, on attend le suivant", async () => {
    await geste(marco, c1, "partie");
    await geste(marco, c2, "partie");
    await noter(marco, 46.1843, 6.0921);
    await geste(marco, c1, "livree");
    expect(await noter(marco, 46.19, 6.1, 300)).toEqual({ statut: "ignoree" });
    expect(await lignes()).toEqual([]);
    expect(await noter(marco, 46.1843, 6.0921, 15)).toEqual({ statut: "ok", numero: await numero(c2) });
    expect(await suivi(c2)).toBeNull();
  });

  it("annulée en route (adresse introuvable) : même masquage pour l'arrêt suivant ; départ du restaurant sans masque", async () => {
    await geste(marco, c1, "partie");
    await geste(marco, c2, "partie");
    await noter(marco, 46.1843, 6.0921);
    expect(await suivi(c1)).toMatchObject({ lat: 46.1843 });
    await db.query("update commandes set statut = 'refusee' where id = $1", [c1]);
    await noter(marco, 46.1843, 6.0921);
    expect(await suivi(c2)).toBeNull();
  });

  it("livreur désactivé : plus rien au suivi", async () => {
    await geste(marco, c1, "partie");
    await noter(marco);
    expect(await suivi(c1)).not.toBeNull();
    await db.query("update personnel set actif = false where id = $1", [marco]);
    expect(await suivi(c1)).toBeNull();
  });

  it("le 1er arrêt encore au restaurant : rien, même si le 2e est parti", async () => {
    await geste(marco, c2, "partie");
    expect(await noter(marco)).toEqual({ statut: "pas_en_route" });
    expect(await suivi(c2)).toBeNull();
  });

  it("annulée, ou donnée à un autre livreur : effacée sur-le-champ", async () => {
    await geste(marco, c1, "partie");
    await noter(marco);
    await db.query("update commandes set statut = 'annulee' where id = $1", [c1]);
    expect(await lignes()).toEqual([]);

    await geste(marco, c2, "partie");
    await noter(marco);
    expect(await lignes()).toHaveLength(1);
    await attribuer(c2, ines);
    expect(await lignes()).toEqual([]);
    expect(await suivi(c2)).toBeNull();
  });

  it("position de plus de 2 minutes : plus montrée ; de plus de 15 minutes : effacée", async () => {
    await geste(marco, c1, "partie");
    await noter(marco);
    await db.query("update positions_livreur set le = now() - interval '3 minutes'");
    expect(await suivi(c1)).toBeNull();
    await db.query("update positions_livreur set le = now() - interval '16 minutes'");
    await noter(ines);
    expect(await lignes()).toEqual([]);
  });

  it("une écriture toutes les 10 secondes au plus, signal hors de la région ignoré", async () => {
    await geste(marco, c1, "partie");
    await noter(marco, 46.18, 6.09);
    await noter(marco, 46.2, 6.12);
    expect(await suivi(c1)).toMatchObject({ lat: 46.18, lon: 6.09 });
    await db.query("update positions_livreur set le = now() - interval '11 seconds'");
    expect(await noter(marco, 0, 0)).toEqual({ statut: "ignoree" });
    expect(await noter(marco, 46.2, 6.12, 5000)).toEqual({ statut: "ignoree" });
    expect(await suivi(c1)).toMatchObject({ lat: 46.18, lon: 6.09 });
    await noter(marco, 46.2, 6.12);
    expect(await suivi(c1)).toMatchObject({ lat: 46.2, lon: 6.12 });
  });

  it("réglage coupé : rien n'est gardé ni lu ; fin du partage par le livreur", async () => {
    await geste(marco, c1, "partie");
    await noter(marco);
    await f("effacer_position_livreur($1)", [marco]);
    expect(await lignes()).toEqual([]);
    await noter(marco);
    await db.query("update reglages set valeur = 'false' where cle = 'position_livreur_en_direct'");
    expect(await suivi(c1)).toBeNull();
    expect(await noter(marco)).toEqual({ statut: "desactive" });
    expect(await lignes()).toEqual([]);
  });
});
