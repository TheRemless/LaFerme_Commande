import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Renvoyer les tickets d'une imprimante en panne sur une autre (vague 3, bo-operations) :
// renvoyer_tickets, migration 20261130250000_renvoyer_tickets.sql.

let db: PGlite;
let pizza: number;
let cuisine: number;
let eteinte: number;
let gerant: string;
let service: string;
let n = 0;

async function commande(statut: string): Promise<string> {
  n += 1;
  const p = {
    jeton_suivi: `jeton-rt-${n}`,
    cle_idempotence: `rt-${n}`,
    mode: "retrait",
    statut: "nouvelle",
    statut_paiement: "a_encaisser_retrait",
    moyen_paiement: "comptoir",
    zone_numero: null,
    client_prenom: `Rt${n}`,
    client_nom: "Test",
    client_telephone: "079 000 00 00",
    client_email: "rt@laferme.test",
    quand_type: "asap",
    pizzas_seulement: true,
    sous_total_centimes: 1500,
    frais_centimes: 0,
    total_centimes: 1500,
    tva_centimes: 38,
    taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000",
    lignes: [{ slug: "pizza-margherita", nom: "Pizza", station: "pizza", qte: 1, unitaire_centimes: 1500, total_centimes: 1500, choix: {}, retraits: [], note: "" }],
  };
  const id = (await db.query<{ id: string }>("select id from creer_commande($1)", [p])).rows[0].id;
  await db.query("update commandes set statut = $2 where id = $1", [id, statut]);
  return id;
}
async function tache(commandeId: string | null, etat: string, essai = false): Promise<string> {
  const r = await db.query<{ id: string }>(
    "insert into taches_impression (commande_id, essai, station, imprimante_id, contenu, etat) values ($1, $2, 'pizza', $3, '[]', $4) returning id",
    [commandeId, essai, pizza, etat],
  );
  return r.rows[0].id;
}
const ou = async (id: string) =>
  (await db.query<{ imprimante_id: number; etat: string; relance: boolean }>("select imprimante_id, etat, relance from taches_impression where id = $1", [id])).rows[0];
const renvoyer = async (de: number, vers: number, qui = gerant) =>
  (await db.query<{ n: number }>("select renvoyer_tickets($1::smallint, $2::smallint, $3) as n", [de, vers, qui])).rows[0].n;

beforeAll(async () => {
  db = await creerBaseLocale();
  pizza = (await db.query<{ id: number }>("insert into imprimantes (nom, station, jeton_hache) values ('Pizza rt', 'pizza', 'h-rt-p') returning id")).rows[0].id;
  cuisine = (await db.query<{ id: number }>("insert into imprimantes (nom, station, jeton_hache) values ('Cuisine rt', 'cuisine', 'h-rt-c') returning id")).rows[0].id;
  eteinte = (await db.query<{ id: number }>("insert into imprimantes (nom, station, jeton_hache, actif) values ('Éteinte rt', 'cuisine', 'h-rt-e', false) returning id")).rows[0].id;
  gerant = (await db.query<{ id: string }>("insert into personnel (email, nom, role) values ('rt-gerant@laferme.test', 'Rt gérant', 'gerant') returning id")).rows[0].id;
  service = (await db.query<{ id: string }>("insert into personnel (email, nom, role) values ('rt-service@laferme.test', 'Rt service', 'service') returning id")).rows[0].id;
}, 120_000);

beforeEach(async () => {
  await db.exec("truncate commandes cascade; delete from taches_impression where true;");
});

describe("renvoyer_tickets", () => {
  it("en attente, envoyé (marqué RENVOI) et en échec partent ; sorti, annulé, commande prête et essai restent", async () => {
    const encours = await commande("acceptee");
    const attente = await tache(encours, "en_attente");
    const envoyee = await tache(encours, "envoyee");
    const echec = await tache(encours, "echec");
    const sortie = await tache(encours, "imprimee");
    const annulee = await tache(encours, "annulee");
    const pourPrete = await tache(await commande("prete"), "en_attente");
    const essai = await tache(null, "en_attente", true);
    expect(await renvoyer(pizza, cuisine)).toBe(3);
    expect(await ou(attente)).toEqual({ imprimante_id: cuisine, etat: "en_attente", relance: false });
    expect(await ou(envoyee)).toEqual({ imprimante_id: cuisine, etat: "en_attente", relance: true });
    expect(await ou(echec)).toEqual({ imprimante_id: cuisine, etat: "en_attente", relance: false });
    for (const id of [sortie, annulee, pourPrete, essai]) expect((await ou(id)).imprimante_id).toBe(pizza);
    const j = await db.query<{ cle: string; apres: { tickets: number; nom: string } }>("select cle, apres from journal_gestion where objet = 'imprimante' order by id desc limit 1");
    expect(j.rows[0]).toMatchObject({ cle: "renvoyer_tickets", apres: { tickets: 3, nom: "Cuisine rt" } });
  });

  it("refus : même imprimante, destination désactivée ou inconnue, pas gérant", async () => {
    await tache(await commande("acceptee"), "en_attente");
    await expect(renvoyer(pizza, pizza)).rejects.toThrow(/autre imprimante/);
    await expect(renvoyer(pizza, eteinte)).rejects.toThrow(/désactivée/);
    await expect(renvoyer(pizza, 999)).rejects.toThrow(/désactivée/);
    await expect(renvoyer(999, cuisine)).rejects.toThrow(/inconnue/);
    await expect(renvoyer(pizza, cuisine, service)).rejects.toThrow();
  });

  it("réservée au serveur", async () => {
    for (const role of ["anon", "authenticated"]) {
      const r = await db.query<{ ok: boolean }>("select has_function_privilege($1, 'renvoyer_tickets(smallint, smallint, uuid)', 'execute') as ok", [role]);
      expect(r.rows[0].ok).toBe(false);
    }
  });
});
