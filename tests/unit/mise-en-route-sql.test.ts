import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Mise en route (vague 3, bo-socle) : l'état réel lu en base pour cocher les étapes. Gérant seulement.

let db: PGlite;
let gerant: string;
type Etat = Record<string, unknown>;
const etat = async (p = gerant) => (await db.query<{ r: Etat }>("select etat_mise_en_route($1::uuid) as r", [p])).rows[0].r;

beforeAll(async () => {
  db = await creerBaseLocale();
  gerant = (await db.query<{ id: string }>("select id::text as id from personnel where email = 'gerant-bureau@laferme.test'")).rows[0].id;
});

describe("etat_mise_en_route", () => {
  it("rassemble des nombres et des dates, sans donnée de client", async () => {
    const e = await etat();
    expect(Object.keys(e).sort()).toEqual(
      [
        "courriels_envoyes", "equipe", "essai_rembourse", "evenements_paiement", "horaires", "horaires_a_valider", "imprimantes_testees",
        "livreurs", "livreurs_connectes", "plats_bloquants", "tablette_vue_le", "zones_a_valider", "zones_actives",
      ].sort(),
    );
    expect(typeof e.equipe).toBe("number");
    expect(Array.isArray(e.imprimantes_testees)).toBe(true);
  });

  it("suit le signe de vie, un ticket de test sorti, les horaires validés et un livreur connecté", async () => {
    await db.query("update surveillance_etat set tablette_vue_le = now()");
    expect((await etat()).tablette_vue_le).not.toBeNull();

    const imp = (await db.query<{ id: number }>("insert into imprimantes (nom, station, jeton_hache) values ('Essai mise en route', 'pizza', 'mer-jeton') returning id")).rows[0].id;
    expect((await etat()).imprimantes_testees).not.toContain(imp);
    await db.query("select ticket_de_test($1::smallint, $2::uuid)", [imp, gerant]);
    await db.query("update taches_impression set etat = 'imprimee', imprime_le = now() where essai and imprimante_id = $1", [imp]);
    expect((await etat()).imprimantes_testees).toContain(imp);

    await db.query("update horaires set proposition = false");
    expect((await etat()).horaires_a_valider).toBe(0);

    const livreur = (await db.query<{ id: string }>("insert into personnel (email, nom, role) values ('mer-livreur@laferme.test', 'Mer', 'livreur') returning id::text as id")).rows[0].id;
    const avant = (await etat()).livreurs_connectes as number;
    await db.query("insert into sessions_personnel (personnel_id, jeton_hache, expire_le) values ($1::uuid, 'mer-session', now() + interval '12 hours')", [livreur]);
    expect((await etat()).livreurs_connectes).toBe(avant + 1);
  });

  it("refuse tout autre que le gérant", async () => {
    const service = (await db.query<{ id: string }>("select id::text as id from personnel where role = 'service' and actif limit 1")).rows[0].id;
    await expect(etat(service)).rejects.toThrow(/Réservé au gérant/);
  });
});
